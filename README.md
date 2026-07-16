# 🐳 DeepSeek 仪表盘

一个本地运行的 DeepSeek API 用量监控仪表盘，支持手机端访问。

## 功能

- 实时查看 DeepSeek 账户余额
- 月度/今日 API 调用费用统计
- 各模型 Token 消耗明细（输入、输出、缓存命中/未命中）
- 每日花费趋势图
- 缓存命中率监控
- 60s 自动刷新
- 移动端自适应
- iPhone 添加到主屏幕（支持图标）

## 快速开始

**一键启动（推荐）：**
双击项目目录下的 `启动仪表盘.command` 文件即可。

**或者手动启动：**

```bash
# 1. 安装依赖
npm install

# 2. 启动服务
node server.js

# 3. 浏览器打开
open http://localhost:3456
```

首次打开会提示配置 DeepSeek API Key 和 usage_token。

## 手机访问

同 WiFi 下：手机浏览器访问 `http://你电脑的IP:3456`

远程访问：配合 Cloudflare Tunnel（参考下方说明）

## 配置说明

| 配置项 | 必填 | 说明 |
|--------|------|------|
| API Key | ✅ | 从 [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) 获取 |
| usage_token | ❌ | 用于查看用量明细，登录平台后在 DevTools Console 执行 `JSON.parse(localStorage.userToken).value` 获取 |

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML + Chart.js + Tailwind CSS
- **部署**: 本地运行，推荐 Cloudflare Tunnel 远程访问

## License

MIT
