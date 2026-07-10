# CodeClaw 小白真人测试主持操作单

这份操作单给主持人使用。测试者不需要懂编程，只需要亲自操作浏览器并说出真实感受。

生成会话包时，以下占位符会替换为当前会话值：

```text
{{TESTER_ID}}
{{SESSION_FOLDER}}
```

## 一、开始前

1. 现场重新取得测试者同意；预填的 consent 状态不能代替真人同意。
2. 只使用匿名编号 `{{TESTER_ID}}`，主持人使用 `host-1`。
3. 关闭私人窗口和通知，不录屏、不截图，不记录姓名或联系方式。
4. 保持模型为 Mock，不填写 API Key。
5. 准备一个不含 `.env`、密钥、私人信息的安全项目副本；没有安全项目就跳过真实项目步骤并记录 `N/A`。
6. 在项目根目录运行：

```powershell
npm.cmd run trial:first-live-standby -- --tester {{TESTER_ID}}
```

只在结果为 `FIRST_LIVE_STANDBY_READY`，或主持人逐条接受 `FIRST_LIVE_STANDBY_READY_WITH_REVIEW` 的警告后开始。

## 二、对测试者照读

> 这是在测试软件，不是在考你。请你自己操作，并把看到什么、想点什么、不明白什么直接说出来。你随时可以停止。我们不记录姓名或联系方式，也不录屏。不要输入账号、密钥或私人资料。

## 三、测试者操作

1. 把浏览器交给测试者，先问他认为第一步是什么。
2. 从 Demo 开始，让测试者说明当前是 Demo 还是真实项目。
3. 让 Demo 到达补丁建议或 Apply 审查；本次不要点击 Apply。
4. 询问测试者何时会读取文件、写入文件或运行命令。
5. 对安全项目只运行一次真实项目只读预检，然后停止。
6. 除安全风险外，测试者卡住约 30 秒后再帮助。
7. 主持人记录第一个卡点、第一次帮助、最大困惑和最大信任顾虑。

## 四、立即停止条件

- 测试者准备输入姓名、联系方式、账号、密钥或其他私人信息。
- 测试者准备在真实项目点击 Apply。
- 主持人无法确认某个操作是否会写文件或运行命令。
- 应用十分钟仍无法启动。
- 测试者要求停止。

## 五、通话后填写

填写 `HUMAN_TRIAL_OBSERVATION.md`、`TRIAL_FEEDBACK_TEMPLATE.md` 和 `TRIAL_RESULT_RECORD.md`。

身份字段只能使用：

```text
Tester / Name: {{TESTER_ID}}
Host / Trial host: host-1
```

“是否继续下一位测试者”只填 `Yes` 或 `No`；测试结论只填 `Continue`、`Fix first` 或 `Stop`。如果允许继续且没有必须修复项，填写 `None`。不要猜测缺失答案。

## 六、统一收尾命令

先生成草稿建议：

```powershell
npm.cmd run trial:record-draft -- --session {{SESSION_FOLDER}}
```

阅读 `dist\TRIAL_RECORD_DRAFT.md`，只把真人或主持人明确确认的内容写入最终记录。缺失字段必须询问真人，不能补造。

三份最终记录完整后运行：

```powershell
npm.cmd run trial:after-live -- --session {{SESSION_FOLDER}} --tester {{TESTER_ID}} --force
```

`AFTER_LIVE_READY` 可以完成；`AFTER_LIVE_READY_WITH_REVIEW` 需要主持人接受警告；`AFTER_LIVE_BLOCKED` 必须停止并修复阻断项。

原始记录、截图、日志、项目路径和证据包继续留在本地，不提交 Git。
