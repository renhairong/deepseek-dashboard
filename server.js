const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

const PORT = 3456;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// 确保 data 目录和默认配置文件存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    deepseek_api_key: '',
    usage_token: '',
    refresh_interval: 60
  }, null, 2));
}
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify({ daily: [] }, null, 2));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── 读取配置 ───
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return { deepseek_api_key: '', usage_token: '', refresh_interval: 60 };
  }
}

// ─── 读取历史 ───
function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    return { daily: [] };
  }
}

// ─── 写入历史 ───
function writeHistory(data) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
}

// ─── GET /api/config — 获取配置 ───
app.get('/api/config', (req, res) => {
  const cfg = readConfig();
  res.json({
    has_api_key: !!cfg.deepseek_api_key,
    has_usage_token: !!cfg.usage_token,
    refresh_interval: cfg.refresh_interval,
    deepseek_api_key: cfg.deepseek_api_key || '',
    usage_token: cfg.usage_token || ''
  });
});

// ─── POST /api/config — 保存配置 ───
app.post('/api/config', (req, res) => {
  const { deepseek_api_key, usage_token, refresh_interval } = req.body;
  const cfg = readConfig();
  if (deepseek_api_key !== undefined) cfg.deepseek_api_key = deepseek_api_key;
  if (usage_token !== undefined) cfg.usage_token = usage_token;
  if (refresh_interval !== undefined) cfg.refresh_interval = refresh_interval;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  res.json({ ok: true });
});

// ─── GET /api/balance — 代理 DeepSeek 余额查询 ───
app.get('/api/balance', async (req, res) => {
  const cfg = readConfig();
  if (!cfg.deepseek_api_key) {
    return res.json({ error: '请先配置 DeepSeek API Key', needs_config: true });
  }
  try {
    const resp = await fetch('https://api.deepseek.com/user/balance', {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${cfg.deepseek_api_key}`
      }
    });
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: `DeepSeek API 返回错误 (${resp.status}): ${text}` });
    }
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `连接失败: ${err.message}` });
  }
});

// ─── 数据归一化：把 DeepSeek 复杂嵌套结构展平 ───
// 输入: data.data.biz_data 可能是数组或对象
// 输出: { currency, models: [...], daily: [...], month_total: {...} }
function normalizeBizData(rawBizData) {
  // amount 接口返回对象，cost 接口返回数组，统一处理
  const root = Array.isArray(rawBizData) ? rawBizData[0] : rawBizData;
  if (!root) return null;

  const { total = [], days = [], currency = 'CNY' } = root;

  // 把 {usage: [{type, amount}]} 转成键值对
  function usageToMap(usageArr) {
    const m = {};
    for (const item of usageArr || []) {
      m[item.type] = parseFloat(item.amount) || 0;
    }
    return m;
  }

  // 解析模型用量
  const models = (total || []).map(item => {
    const u = usageToMap(item.usage);
    return {
      model: item.model,
      input_tokens: u.PROMPT_TOKEN || 0,
      cache_hit_tokens: u.PROMPT_CACHE_HIT_TOKEN || 0,
      cache_miss_tokens: u.PROMPT_CACHE_MISS_TOKEN || 0,
      output_tokens: u.RESPONSE_TOKEN || 0,
      requests: u.REQUEST || 0
    };
  });

  // 解析每日数据
  const daily = (days || []).map(d => {
    const dayModels = (d.data || []).map(item => {
      const u = usageToMap(item.usage);
      return {
        model: item.model,
        input_tokens: u.PROMPT_TOKEN || 0,
        cache_hit_tokens: u.PROMPT_CACHE_HIT_TOKEN || 0,
        cache_miss_tokens: u.PROMPT_CACHE_MISS_TOKEN || 0,
        output_tokens: u.RESPONSE_TOKEN || 0,
        requests: u.REQUEST || 0
      };
    });
    return { date: d.date, models: dayModels };
  });

  // 月度合计
  const month_total = models.reduce((acc, m) => {
    acc.input_tokens += m.input_tokens;
    acc.cache_hit_tokens += m.cache_hit_tokens;
    acc.cache_miss_tokens += m.cache_miss_tokens;
    acc.output_tokens += m.output_tokens;
    acc.requests += m.requests;
    return acc;
  }, { input_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0, output_tokens: 0, requests: 0 });

  return { currency, models, daily, month_total };
}

// ─── 从 cost 归一化数据提取金额（字段名虽叫 tokens，值实际是 ¥） ───
function sumModelCost(modelEntry) {
  // 只把 token 相关的字段当金额求和（跳过 requests）
  return (modelEntry.input_tokens || 0)
       + (modelEntry.cache_hit_tokens || 0)
       + (modelEntry.cache_miss_tokens || 0)
       + (modelEntry.output_tokens || 0);
}
function sumDailyCost(dailyEntry) {
  return (dailyEntry.models || []).reduce((s, m) => s + sumModelCost(m), 0);
}

// ─── 通用代理：拉数据 + 归一化 ───
async function fetchUsageNormalized(cfg, kind) {
  const now = new Date();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = now.getFullYear().toString();
  const url = `https://platform.deepseek.com/api/v0/usage/${kind}?month=${month}&year=${year}`;
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${cfg.usage_token}` }
  });
  if (!resp.ok) {
    return { error: `用量 API 错误 (${resp.status})` };
  }
  const raw = await resp.json();
  if (raw.code !== 0) {
    return { error: raw.msg || `平台返回错误 code=${raw.code}` };
  }
  const biz = raw.data?.biz_data;
  if (!biz) return { error: '数据为空' };
  return normalizeBizData(biz);
}

// ─── GET /api/usage — 统一用量接口（合并 amount + cost） ───
app.get('/api/usage', async (req, res) => {
  const cfg = readConfig();
  if (!cfg.usage_token) {
    return res.json({ error: '请先配置 usage_token', needs_token: true });
  }
  try {
    const [amountNorm, costNorm] = await Promise.all([
      fetchUsageNormalized(cfg, 'amount'),
      fetchUsageNormalized(cfg, 'cost')
    ]);

    if (amountNorm.error && costNorm.error) {
      return res.json({ error: amountNorm.error });
    }

    // 合并数据：token 数从 amount 接口取，金额从 cost 接口取
    const models = (amountNorm.models || []).map(am => {
      // 找 cost 接口中对应模型的金额
      const cm = (costNorm.models || []).find(c => c.model === am.model);
      const cost = cm ? sumModelCost(cm) : 0;
      return { ...am, cost };
    });

    // 每日数据（token 从 amount，金额从 cost）
    const today = new Date().toISOString().slice(0, 10);
    const daily = (amountNorm.daily || []).map(d => {
      const cd = (costNorm.daily || []).find(x => x.date === d.date);
      const dailyCost = cd ? sumDailyCost(cd) : 0;
      return { date: d.date, models: d.models, cost: dailyCost };
    });

    // 月度总计
    const monthCost = models.reduce((s, m) => s + m.cost, 0);

    // 今日数据
    const todayEntry = daily.find(d => d.date === today);
    const todayCost = todayEntry ? todayEntry.cost : 0;
    const todayCalls = todayEntry ? todayEntry.models.reduce((s, m) => s + m.requests, 0) : 0;

    // 缓存命中率（从 amount 接口算）
    const totalCacheHit = models.reduce((s, m) => s + m.cache_hit_tokens, 0);
    const totalCacheMiss = models.reduce((s, m) => s + m.cache_miss_tokens, 0);
    const totalInputDirect = models.reduce((s, m) => s + m.input_tokens, 0);
    const totalIn = totalCacheHit + totalCacheMiss + totalInputDirect;
    const cacheHitRate = totalIn > 0 ? totalCacheHit / totalIn : 0;

    res.json({
      currency: amountNorm.currency || 'CNY',
      models,
      daily,
      summary: {
        month_cost: monthCost,
        today_cost: todayCost,
        today_requests: todayCalls,
        cache_hit_rate: cacheHitRate,
        month_total: amountNorm.month_total
      }
    });
  } catch (err) {
    res.status(500).json({ error: `连接失败: ${err.message}` });
  }
});

// ─── GET /api/usage/cost — 代理 DeepSeek 平台月度花费（原始数据） ───
app.get('/api/usage/cost', async (req, res) => {
  const cfg = readConfig();
  if (!cfg.usage_token) {
    return res.json({ error: '请先配置 usage_token', needs_token: true });
  }
  try {
    const norm = await fetchUsageNormalized(cfg, 'cost');
    if (norm.error) return res.status(500).json(norm);
    res.json(norm);
  } catch (err) {
    res.status(500).json({ error: `连接失败: ${err.message}` });
  }
});

// ─── GET /api/usage/amount — 代理 DeepSeek 平台 Token 用量（原始归一化） ───
app.get('/api/usage/amount', async (req, res) => {
  const cfg = readConfig();
  if (!cfg.usage_token) {
    return res.json({ error: '请先配置 usage_token', needs_token: true });
  }
  try {
    const norm = await fetchUsageNormalized(cfg, 'amount');
    if (norm.error) return res.status(500).json(norm);
    res.json(norm);
  } catch (err) {
    res.status(500).json({ error: `连接失败: ${err.message}` });
  }
});

// ─── GET /api/history — 本地历史记录 ───
app.get('/api/history', (req, res) => {
  res.json(readHistory());
});

// ─── 兜底：所有非 API 路由返回 index.html ───
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🔵 DeepSeek API 仪表盘已启动`);
  console.log(`  ───────────────────────────`);
  console.log(`  本地:  http://localhost:${PORT}\n`);
});
