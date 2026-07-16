#!/bin/bash
# DeepSeek 仪表盘 - 一键启动
# 把这个文件随便放在哪里（桌面、Dock、其他文件夹）双击都能用

PROJECT_DIR="/Users/renhairong/WorkBuddy/2026-07-15-20-07-00/deepseek-dashboard"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     🔵 DeepSeek 仪表盘启动中...     ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# 切到项目目录
cd "$PROJECT_DIR" || { echo "  ❌ 项目目录不存在: $PROJECT_DIR"; exit 1; }

# 先清理可能残留的进程
lsof -ti:3456 2>/dev/null | xargs kill -9 2>/dev/null

# 启动服务（后台）
node server.js &
SERVER_PID=$!
echo "  ✅ 服务已启动 (PID: $SERVER_PID)"
sleep 2

# 启动隧道（前台）
./start-tunnel.sh
