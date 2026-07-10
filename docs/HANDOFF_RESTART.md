# CodeClaw 重启交接：tester-2 首次真人测试

更新时间：2026-07-10

这是一份唯一有效的 Codex 重启交接文件。旧的 `HANDOFF_CURRENT_*` 已删除。

## 新 Codex 首条指令

重启后请让 Codex 完整读取本文件，并发送：

```text
请完整读取 docs/HANDOFF_RESTART.md，然后接管 CodeClaw tester-2 首次真人测试。我的朋友快到了，他是小白，会在这台电脑上亲自操作。先检查 Git 和当前 standby 报告，再按交接文件逐步带我完成通话前检查、真人测试和 after-live；不要伪造反馈，不要提前运行 after-live，不要把任何真人记录或 dist 内容提交到 Git。
```

## 当前结论

- 代码和本地试用包已经验证完成，可以准备 tester-2 首次真人测试。
- 朋友还没有开始操作；当前没有任何真人反馈或真人 after-live 证据。
- tester-2 是第一位真人测试者，语言为 `zh-CN`。
- 允许范围只有 `demo` 和 `real-read-only`。
- 本轮任何位置都不要点击 Apply。
- 当前功能基线已经推送到 Gitee 和 GitHub：

```text
ea4d7aa Update handoff after first-live hardening
31be5fb Harden beginner first-live session flow
```

重启后的 Codex 必须先运行：

```powershell
git rev-parse --show-toplevel
git status --short --branch
git log -5 --oneline --decorate
```

正常情况下工作区应干净；如果只有本交接文件的新提交领先远端，提醒用户稍后运行 `git pushall` 即可。

## 当前已验证状态

最近状态：

```text
TESTER_LAUNCH_READY_TO_HOST
FIRST_LIVE_STANDBY_READY_WITH_REVIEW
standby blockers: 0
standby warnings: 5
RECORD_DRAFT_READY_WITH_GAPS
record-draft suggestions: 0
record-draft missing human fields: 20
```

这表示会话包是空的、没有伪造反馈，并且可以在主持人逐条阅读和接受警告后开场。

最近完整验证：

```text
124/124 tests passed in source and packaged copy
npm.cmd run check passed
npm.cmd run health passed
506 i18n keys per language, no warnings
trial:ready passed
package hygiene: missingRequired 0, disallowed 0, files 170
synthetic post-call feedback: READY_WITH_WATCH_ITEMS, blockers 0
```

朋友已经快到，不要无故重跑整套 `trial:ready` 或 124 项测试。只有代码发生变化或试用包缺失时才重跑。

## 当前 5 条 standby 警告

重启后的 Codex 要读取最新 `dist/TRIAL_FIRST_LIVE_STANDBY.json`，不要只依赖本段。当前五条是：

1. backlog 有需要主持人明确接受的 watch items。
2. pre-live 继承了 backlog watch items。
3. 旧的通用 `trial:status` 显示 `NEXT_LIVE_BLOCKED`。
4. live-capture 是 ready-with-review，需要主持人确认。
5. live-capture 继承了 pre-live 警告。

第 3 条来自“没有前一位真人 after-live”的通用下一位测试者路径；本次明确使用 `--first-live`，而当前 launch plan 是 `TESTER_LAUNCH_READY_TO_HOST`，所以它没有形成 first-live blocker。不要因此伪造前一位测试记录。

当前主要 watch items：

- Apply/Verify 和写入边界是否让小白感到安全。
- Demo 与真实项目模式是否足够明显。
- 测试者何时需要主持人帮助，以及帮助发生在哪一步。

这些是此前合成演练留下的观察项，不是真人 tester-2 反馈。

## 朋友到达前：只做这些

在项目根目录运行：

```powershell
npm.cmd run trial:tester-launch-plan -- --tester tester-2 --first-live
npm.cmd run trial:first-live-standby -- --tester tester-2
```

只在以下任一结果下继续：

```text
FIRST_LIVE_STANDBY_READY
FIRST_LIVE_STANDBY_READY_WITH_REVIEW
```

如果是 `READY_WITH_REVIEW`，Codex 必须把最新警告逐条用中文解释，并让主持人明确确认接受。不要替用户自动接受。

如果变成 `WAITING`、`NEEDS_REFRESH` 或 `BLOCKED`，停止开场并诊断；不要为了通过门禁而制造反馈。记录开始后也不要用 `trial:session-pack --force` 或 `trial:intake-session --force` 覆盖会话文件。

必须打开并阅读：

```text
dist/trial-session-packs/tester-2/BEGINNER_FIRST_LIVE_GUIDE.md
dist/trial-session-packs/tester-2/HOST_RUNBOOK.md
dist/trial-session-packs/tester-2/LIVE_SESSION_CAPTURE.md
dist/trial-session-packs/tester-2/HUMAN_TRIAL_OBSERVATION.md
```

如果 Codex 内置浏览器可用，开场前快速检查 zh-CN 操作面板、窄屏布局和一个 Copy 按钮；时间允许再看 English 和 Russian。浏览器工具不可用时，让用户手动做最小检查并记录这一限制，不要伪造视觉验证。

## 启动给朋友操作的程序

在另一个 PowerShell 窗口中，从项目根目录进入已经验证的打包副本；保持 Codex 的工作目录仍在项目根目录：

```powershell
cd .\dist\CodeClaw-local-trial-20260710
.\start-codeclaw.cmd
```

保持启动器窗口打开。朋友只操作 CodeClaw 浏览器页面，不操作 Codex、Git 或主持记录文件。

如果该打包目录不存在，回到项目根目录运行一次 `npm.cmd run trial:ready`；不要私自换用未验证的副本。

## 真人开场

主持人先关闭私人通知、聊天窗口和可能泄露信息的页面，然后照读：

> 这是在测试软件，不是在考你。请你自己操作，并把看到什么、想点什么、不明白什么直接说出来。你随时可以停止。我们不记录姓名或联系方式，也不录屏。不要输入账号、密钥或私人资料。

然后再次询问朋友是否自愿参加。预填的 consent 不能替代这次现场同意。

身份只能写：

```text
Tester / Name: tester-2
Host / Trial host: host-1
```

不要记录朋友的姓名、电话、邮箱、微信、公司、GitHub/Gitee 账号或真实项目名称。

## 真人操作顺序

1. 把浏览器交给朋友，先问他觉得第一步应该做什么。
2. 从 Demo 开始，让他主动判断当前是 Demo 还是真实项目。
3. 让 Demo 到达补丁建议或 Apply 审查，但本轮不要点击 Apply。
4. 问他认为 CodeClaw 什么时候会读取文件、写入文件、运行命令。
5. 如果有不含 `.env`、密钥、个人信息的安全项目副本，只运行一次真实项目只读预检，然后停止。
6. 如果没有安全项目副本，跳过真实项目步骤并记录 `N/A`，不要临时使用私人项目。
7. 除非涉及安全风险，否则朋友卡住约 30 秒后主持人才帮助。
8. 主持人边看边填写 `HUMAN_TRIAL_OBSERVATION.md`，记录第一个卡点、第一次帮助、最大困惑和最大信任顾虑。

不要在测试中途修改产品代码。发现问题先记录，完成或安全停止会话后再分析。

## 立即停止条件

出现任一情况立即停止：

- 朋友准备输入姓名、联系方式、账号、API Key、密钥或其他私人资料。
- 朋友准备点击 Apply，尤其是真实项目中的 Apply。
- 主持人无法确认某个动作是否会写文件或运行命令。
- 朋友要求停止或撤回同意。
- CodeClaw 经过基本路径和 Node.js 检查后，10 分钟仍无法启动。
- 真实项目路径、日志、截图或源码片段即将进入主持记录。

停止后如实记录原因，不要为了让报告变绿而改答案。

## 朋友离开前必须完成

不要让朋友在必需问题尚未确认时离开。

1. 把明确观察或朋友明确说出的内容保存到本地会话记录。
2. 在项目根目录运行：

```powershell
npm.cmd run trial:record-draft -- --session dist/trial-session-packs/tester-2
```

3. 阅读 `dist/TRIAL_RECORD_DRAFT.md`。
4. 只把有明确依据的建议复制到以下三份最终记录：

```text
HUMAN_TRIAL_OBSERVATION.md
TRIAL_FEEDBACK_TEMPLATE.md
TRIAL_RESULT_RECORD.md
```

5. 草稿列出的缺失问题必须当面询问朋友；不能由 Codex 或主持人猜测。
6. “是否继续下一位测试者”只能填 `Yes` 或 `No`。
7. `Decision after trial` 只能填 `Continue`、`Fix first` 或 `Stop`。
8. 确认允许继续且没有必修项时，`Required fix before the next tester` 填 `None`。

本轮开始前的空草稿有 20 个缺失字段。真人测试后数量应该根据真实记录下降；不要为了追求 0 而编造内容。

## 会后受控收尾

只有三份最终记录都由真人或主持人明确确认后，才运行：

```powershell
npm.cmd run trial:after-live -- --session dist/trial-session-packs/tester-2 --tester tester-2 --force
```

处理结果：

- `AFTER_LIVE_READY`：本轮可以完成。
- `AFTER_LIVE_READY_WITH_REVIEW`：逐条说明警告，由主持人决定接受或修复。
- `AFTER_LIVE_BLOCKED`：停止推进，保留真实结果并诊断阻断项，绝不改写反馈来通过。

收尾后必须汇报：

- completion、privacy、feedback ingest、review、archive 和 after-live 的 decision。
- blocker 与 warning 数量。
- 是否出现安全、信任、模式识别或首次卡点问题。
- 下一阶段是修复问题、保持观察，还是才可以考虑下一位测试者。

## Git 与隐私边界

永远不要提交：

```text
.codeclaw/
dist/
node_modules/
server-bg.log
真人原始记录
截图或录屏
日志
联系方式
API keys 或 secret tokens
真实项目路径、名称或源码片段
after-live evidence packet
```

真人会话完成并不自动授权修改产品代码。若反馈暴露产品问题，先向用户报告证据和建议，再按“规划 → 实现 → 验证 → 提交 → 告诉用户运行 git pushall”的节奏进入修复轮次。

不要直接 push，除非用户明确要求。

## 本轮完成标准

只有以下条件全部满足，才算成功接上进度：

- 最新 standby 已检查，0 blocker；所有 warning 由主持人明确处理。
- 朋友现场重新同意并亲自操作。
- 测试严格限制为 Demo 加最多一次真实项目只读预检，全程未点击 Apply。
- 三份最终记录只含匿名、明确确认的信息。
- `trial:record-draft` 没有被当作真人答案来源。
- `trial:after-live` 已真实运行，或因真实 blocker 被明确停止。
- 没有把任何真人资料、dist 输出或证据包加入 Git。
