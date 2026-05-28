# Insurance Automation

本项目用于在 Windows 本地完成以下流程：

- 直接打开 `file://.../index.html` 配置路线、任务和账号
- 通过 Playwright 自动登录后台与保险平台
- 自动导出订单列表、销转表，或直接使用本地 Excel
- 清洗数据并生成投保 payload
- 自动填写九时保投保页面，并在自动模式下判断是否出现成功结果特征

## 运行环境

- Node.js 18+
- npm
- Playwright Chromium

## Windows 一键启动

如果你是把产品打包给别人用，优先使用：

```powershell
.\one-click-start.cmd
```

它会自动完成：

- 首次生成 `automation/config.json`
- 检查 `node_modules`
- 检查或安装 Playwright Chromium
- 启动本地桥接
- 打开本地配置页

## Windows 快速开始

```powershell
.\install-deps.cmd
.\install-browsers.cmd
.\open-config.cmd
```

推荐再开一个终端启动本地桥接服务：

```powershell
.\start-bridge.cmd
```

桥接启动后，`index.html` 页面里可以直接：

- 保存配置到 `automation/config.json`
- 执行预检
- 启动自动化
- 查看最近一次运行状态

## 不启桥接时的用法

即使不启动 `localhost` 桥接，配置页依然可以：

- 保存到浏览器本地缓存
- 导出 JSON
- 生成推荐命令

然后在项目根目录运行：

```powershell
node automation\preflight.mjs --config automation\config.json --export true
node automation\run.mjs --config automation\config.json --export true
```

本地 Excel 模式：

```powershell
node automation\preflight.mjs --config automation\config.json --orders "D:\orders.xlsx" --routes "D:\routes.xlsx"
node automation\run.mjs --config automation\config.json --orders "D:\orders.xlsx" --routes "D:\routes.xlsx"
```

## 常用脚本

- `one-click-start.cmd`：一键检查依赖、安装浏览器、启动桥接并打开配置页
- `open-config.cmd`：打开本地配置页
- `start-bridge.cmd`：启动本地桥接服务
- `dry-run.cmd`：执行预检并做 dry-run
- `run-auto-export.cmd`：自动导出全链路运行
- `run-local-excel.cmd "订单列表.xlsx" "销转表.xlsx"`：使用本地 Excel 直投

## 打包发布

```powershell
powershell -ExecutionPolicy Bypass -File .\build-windows-package.ps1
```

打包结果：

- `dist/insurance-automation-windows/`
- `dist/insurance-automation-windows.zip`

打包脚本会尽量把 `node_modules` 和已下载的 `ms-playwright` 浏览器一起带上，让下载包更接近“解压即用”。

## 说明

- `automation/config.json`、`automation/status.json`、`automation/logs/` 都不会入库
- 首次运行若目标站点出现验证码、短信校验或二次密码弹窗，仍可能需要人工接管
- 自动模式下，成功判定以页面出现“投保成功”“查看订单”“下载电子保单”“下载保险条款”等结果特征之一为准
## Public release

- This repo is for public Windows automation use.
- `automation/config.sample.json` is the tracked template. Copy it to `automation/config.json` locally and fill in your own values.
- Do not commit real account names or passwords to GitHub.
