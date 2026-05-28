#!/bin/zsh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "进入项目目录：$PROJECT_DIR"
cd "$PROJECT_DIR"

echo ""
echo "1/2 安装 Node 依赖..."
npm install

echo ""
echo "2/2 安装 Playwright Chromium..."
npm run install-browsers

echo ""
echo "依赖安装完成。"
echo "下一步请双击运行：启动配置页.command"
echo ""
read -k 1 "?按任意键关闭此窗口..."
