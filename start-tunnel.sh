#!/bin/bash
# DeepSeek 仪表盘 - 一键启动隧道
# 用法: ./start-tunnel.sh

echo ""
echo "  🔵 正在启动 Cloudflare Tunnel..."
echo "  ─────────────────────────────────"

# 先启动并捕获输出中的链接
cloudflared tunnel --url http://localhost:3456 2>&1 | (
  url=""
  while IFS= read -r line; do
    echo "$line"
    extracted=$(echo "$line" | grep -oE '[a-z0-9-]+\.trycloudflare\.com' | head -1)
    if [ -n "$extracted" ] && [ -z "$url" ]; then
      url="$extracted"
      echo ""
      echo "  ┌──────────────────────────────────────────┐"
      echo "  │  ✅ 手机访问地址:                        │"
      echo "  │                                          │"
      echo "  │  https://$url"
      echo "  │                                          │"
      echo "  │  发送到微信/复制到浏览器即可打开          │"
      echo "  └──────────────────────────────────────────┘"
      echo ""
      echo "  按 Ctrl+C 停止隧道"
      echo ""
    fi
  done
)