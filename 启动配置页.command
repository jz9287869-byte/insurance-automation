#!/bin/zsh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "进入项目目录：$PROJECT_DIR"
cd "$PROJECT_DIR"

echo ""
echo "正在启动本地配置页..."
echo "启动后请在浏览器打开：http://localhost:17820"
echo ""

npm run dashboard
