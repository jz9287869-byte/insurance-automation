# 本地自动化执行器

这个目录用于承接配置页面导出的 JSON，并用浏览器自动化执行后台导出、数据清洗、保险平台填写。

当前已完成：

- 读取配置 JSON
- 校验本次执行表是否匹配总路线配置库
- 启动可保留登录态的浏览器
- 打开后台管理系统和保险平台
- 尝试使用配置里的账号密码登录
- 清洗订单列表和销转表
- 输出保险平台粘贴名单和投保字段 JSON

运行方式：

```bash
npm install
npm run install-browsers
npm run dashboard
```

启动后打开：

```text
http://localhost:17820
```

在这个页面里点击“开始执行”，会把当前配置保存为 `automation/config.json` 并启动本地执行器。

也可以直接运行命令：

```bash
npm run dry-run -- --config automation/config.json
npm run run -- --config automation/config.json
```

第一次使用时，可以先从配置页面点击“导出配置”，保存为 `automation/config.json`。如果网站有验证码或短信校验，第一次需要在打开的浏览器里手动完成；后续会复用 `automation/.browser-profile` 里的登录态。

清洗两个 Excel：

```bash
node automation/clean-data.mjs \
  --orders /path/to/订单列表.xlsx \
  --routes /path/to/销转表.xlsx \
  --config automation/config.json \
  --output-dir automation/outputs
```

完整流程命令示例：

```bash
node automation/run.mjs \
  --config automation/config.json \
  --orders ./downloads/订单列表.xlsx \
  --routes ./downloads/销转表.xlsx \
  --summary automation/outputs/summary.json
```

Windows PowerShell 示例：

```powershell
npm install
npm run install-browsers
node .\automation\run.mjs --config .\automation\config.json --dry-run true
```

如果要让脚本直接尝试后台导出：

```bash
node automation/run.mjs --config automation/config.json --export true
```

投保材料确认逻辑：

- 投保前会尝试打开并确认“投保注意事项”
- 会依次尝试确认“保险条款”
- 会依次尝试确认“投保通知/投保须知”
- 会依次尝试确认“客户告知书”
- `confirmMode` 不是 `auto` 时，点击“确定投保”前会暂停
- `payMode` 不是 `auto` 时，点击支付前会暂停

下一步会继续适配：

- 根据真实页面 DOM 细调后台订单列表导出选择器
- 根据真实页面 DOM 细调销转表导出选择器
- 根据真实页面 DOM 细调保险平台产品下拉、日期控件和名单弹窗选择器
