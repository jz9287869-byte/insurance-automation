# Insurance Automation

本项目用于本地执行旅游订单导出、销转表导出、数据清洗，以及九时保投保自动化。

## 目录说明

- `index.html` / `app.js` / `styles.css`
  - 本地配置页面
- `automation/run.mjs`
  - 主执行器
- `automation/browser-actions.mjs`
  - 浏览器自动化动作
- `automation/clean-data.mjs`
  - 订单列表和销转表清洗脚本
- `automation/config.sample.json`
  - 配置模板

## 运行环境

- Node.js 18+
- npm
- Playwright Chromium

## 安装

```bash
npm install
npm run install-browsers
```

## 启动配置页面

```bash
npm run dashboard
```

然后访问：

```text
http://localhost:17820
```

页面登录账号：

- 账号：`xingzou20s`
- 密码：`Xingzou520`

## 配置说明

请基于模板创建本地配置：

```bash
cp automation/config.sample.json automation/config.json
```

`automation/config.json` 已加入 `.gitignore`，用于保存本机真实账号密码，不会提交到仓库。

## 直接运行执行器

```bash
node automation/run.mjs --config automation/config.json
```

只做配置预检：

```bash
npm run dry-run -- --config automation/config.json
```

自动执行后台导出：

```bash
node automation/run.mjs --config automation/config.json --export true
```

## 数据清洗

```bash
node automation/clean-data.mjs \
  --orders /path/to/订单列表.xlsx \
  --routes /path/to/销转表.xlsx \
  --config automation/config.json \
  --output-dir automation/outputs
```

## Windows

Windows 可按同样方式安装 Node/npm 和 Playwright 后运行，命令示例：

```powershell
npm install
npm run install-browsers
npm run dashboard
```

## 注意

- 本仓库不包含真实下载数据、浏览器登录态、运行输出和真实密码配置
- `node_modules` 不入库，依赖通过 `package.json` 和 `package-lock.json` 还原
- Playwright 浏览器二进制通过 `npm run install-browsers` 安装
