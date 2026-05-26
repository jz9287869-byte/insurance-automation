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

默认公开版不内置页面登录账号密码，启动后会直接进入配置页。
如果你希望给本地配置页再加一层登录校验，可以在 [app.js](/Users/macm/Documents/保险/app.js) 里设置 `PAGE_USERNAME` 和 `PAGE_PASSWORD`。

## 两种打开方式

### 1. `file:///.../index.html`

- 适合离线维护配置
- 可以编辑并点击“保存”，数据会写入当前浏览器 `localStorage`
- 不会写入 `automation/config.json`
- 不能直接执行自动化；点击“开始执行”前需要先启动本地执行器

### 2. `http://localhost:17820`

- 适合正式执行自动化
- 仍然可以点击“保存”，但这一步只保存浏览器本地配置
- 点击“开始执行”时，页面会把当前配置提交给本地执行器，并写入 `automation/config.json`
- 如果执行器未运行，页面会提示先执行 `npm run dashboard`

## 配置说明

请基于模板创建本地配置：

```bash
cp automation/config.sample.json automation/config.json
```

`automation/config.json` 已加入 `.gitignore`，用于保存本机真实账号密码，不会提交到仓库。
公开仓库里只保留空白示例文件 [automation/config.sample.json](/Users/macm/Documents/保险/automation/config.sample.json)。

如果只是想把页面里的配置长期保存在当前浏览器，用“保存”即可；如果想让本地执行器真正读取并执行，必须通过 `http://localhost:17820` 页面点击“开始执行”，或直接在命令行里指定 `automation/config.json` 运行。

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
- 本仓库的公开版本为 `v1.0.1`
- `node_modules` 不入库，依赖通过 `package.json` 和 `package-lock.json` 还原
- Playwright 浏览器二进制通过 `npm run install-browsers` 安装
