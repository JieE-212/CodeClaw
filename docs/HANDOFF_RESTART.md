# CodeClaw 重启交接：Stage 4B 已完成，等待后续阶段规划

更新日期：2026-07-13（Asia/Shanghai）

这是重启后唯一有效的 Codex 交接文件，完整替代此前关于 tester-2 首次真人测试、standby、现场主持和 after-live 的旧交接。旧流程已经结束，不得按旧截图或旧聊天重新执行。

## 重启后可直接发给 Codex

~~~text
请完整读取 docs/HANDOFF_RESTART.md、docs/NEXT_PHASE_PLAN.md、docs/PROJECT_STATUS.md 和 docs/STAGE_4B_MACHINE_CANDIDATE.md，并按其中顺序接管 CodeClaw。先只读核对 Git、候选 Authority 和当前运行状态，再向我汇报你确认到的事实。

当前任务不是继续旧真人测试，而是在短期暂停真人测试的前提下，规划 Stage 4B 之后最合适的后续阶段。请先给出有依赖、优先级、验收证据、停止条件和退出条件的详细规划，不要自动进入 Stage 4C，也不要自动创建 tester-3 或执行真人流程。

tester-2 的 AFTER_LIVE_BLOCKED、remediation 的 REMEDIATION_HOLD 和 tester-3 的 not scheduled 都必须保持不变。不要重跑 tester-2 after-live，不要改写真人记录，不要提交 dist、.codeclaw、截图、日志、真人材料或证据包，不要自动 push，不要保留临时测试代码或墓碑代码。
~~~

## 当前状态摘要

| 项目 | 当前真实状态 |
| --- | --- |
| Git 功能基线 | 编写本交接前的最新功能提交为 Remove local path and stabilize launcher test；准确哈希以 git log 和候选 Authority 的 sourceCommit 实查为准 |
| GitHub / Gitee | 2026-07-13 用户已明确确认双端 push；当时本地 main、github/main、gitee/main 精确一致 |
| 工作树 | 编写本交接前为 clean；本交接文件可能形成一个更晚的纯文档本地提交，重启后以 Git 实查为准 |
| Stage 3.0.10–3.0.14 | 授权的机器工程循环全部完成并验证 |
| Stage 4B | machine verified and committed；machine candidate 已生成并只证明其 Authority 绑定的提交 |
| Windows / host 人工验收 | 尚未完成 |
| remediation | REMEDIATION_HOLD |
| tester-2 | AFTER_LIVE_BLOCKED，历史结果不可改写 |
| tester-3 | not scheduled |
| 真人测试 | 短期暂停 |
| 原项目权限 | 服务端强制只读；写入和项目命令只允许内置 Demo 或已创建、登记、激活并复验的 disposable copy |
| Stage 4C | 延后且未开始 |

其他文档中描述本轮功能提交“尚未 push”的句子是推送前快照；“Codex 不自动 push”的政策仍然有效。2026-07-13 双端 push 由用户明确确认，本地 remote-tracking refs 和 reflog 当时一致，但它们在未 fetch 时不等于服务器当前状态的独立证明；以后如确需证明服务器最新状态，先征得用户同意再 fetch 比较。机器候选身份始终以包内 Authority 为准。

## 当前产品已经具备的能力

- 唯一八步工作流：project → preflight → plan → context → patch → workspace → verify → complete。
- 默认新手呈现，桌面 sticky 导航、窄屏响应式布局、模块用途与读/写/联网/命令/本地状态边界说明。
- 原项目服务端只读；只有 Demo 或显式激活的 disposable copy 可以 Apply、Revert 或运行允许的项目命令。
- Apply/Revert 使用持久事务、写前 journal、备份、原子替换、跨进程项目锁、冲突停写和启动恢复。
- 模型操作统一为精确 Preview → 人工单次批准 → Send，可见完整请求、目标、字节、摘要和逐文件披露；敏感内容与 ignored 内容 fail closed。
- 扫描、上下文、工具输出、状态增长、并发、取消、deadline、commit 和服务关停都有明确预算与回归。
- Stage 4B 候选从 clean Git commit 的 tracked blobs 构建，使用 Authority 与 SHA-256 sidecar、候选感知启动器、HMAC 实例身份、旧标签锁定、端口分流和外置 runtime Demo。
- legacy local-trial 包只保留历史回归意义，不可启动、不可分享，也不能作为真人测试或发布准入证据。

详细实现历史不要重新抄进本文件。需要时读取：

~~~text
docs/NEXT_PHASE_PLAN.md
docs/PROJECT_STATUS.md
docs/STAGE_4B_MACHINE_CANDIDATE.md
docs/RELEASE_STRATEGY.md
~~~

## 最新机器证据

- 完整测试：476 total、469 pass、0 fail、7 个环境性 skip。
- Stage 4B 聚焦门禁：84 total、81 pass、0 fail、3 个环境性 skip。
- check 与 i18n 通过：英文、简体中文、俄文各 724 keys，0 warnings/failures。
- health、smoke、四个 pilot、真实示例仓库只读 preflight、PowerShell wrapper 语法和 diff 审计通过。
- 真实 packaged candidate 的 start、status、stop、restart、最终完整性和清理门禁通过。
- 独立安全复审没有剩余 High 或 Medium。
- 推送前隐私检查移除了 run-dev.cmd 中写死的本机用户路径。
- 一个 launcher 取消测试的 100ms 墙钟竞态已改为在真实 readiness 探测时触发；定向连续 20 次和随后完整测试均通过。
- dist、.codeclaw、日志、截图、真人原始记录、证据包和临时测试产物均未进入 Git。

这些结果只证明 machine candidate。不得据此宣称签名、安装器、SmartScreen、Defender、真实双击、真实 taskkill /T、像素、完整键盘、NVDA、高对比度或真人理解已经通过。

## 重启后第一轮只读检查

先进入 git rev-parse --show-toplevel 返回的仓库根目录，然后运行：

~~~powershell
git rev-parse --show-toplevel
git status --short --branch --untracked-files=all
git log -8 --oneline --decorate
git rev-list --left-right --count github/main...HEAD
git rev-list --left-right --count gitee/main...HEAD
git remote -v
~~~

预期解释：

- 如果本交接的纯文档提交尚未再次推送，main 可能比两端远端领先 1；这是预期状态，不要 reset。
- 如果用户已把交接提交也 push，两个计数应为 0 / 0。
- 如果本交接形成了比 Authority sourceCommit 更晚的纯文档提交，现有 candidate 仍只证明 Authority 绑定的旧提交，不能称为“当前 HEAD candidate”。最终验收必须明确绑定旧 Authority 提交，或从新的 clean HEAD 重新生成候选后再验收。
- 不要自动 fetch、pull、push、reset、checkout 或清理用户改动。
- 若工作树有变化，先完整阅读 diff 并区分用户改动、交接文档和临时产物。
- PowerShell 读取中文 Markdown 时显式使用 Get-Content -Encoding UTF8，避免把 UTF-8 显示成乱码。

查找本地 ignored machine candidate：

~~~powershell
Get-ChildItem -LiteralPath dist -Directory -Filter "CodeClaw-machine-candidate-*" -ErrorAction SilentlyContinue
~~~

- 不要把候选目录加入 Git。
- candidate ID 和 sourceCommit 是身份信息，不是秘密；可以在本地核对或向用户汇报，但不要把动态值、Authority hash 或绝对候选路径硬编码进 tracked 文档。不得复制 LocalAppData control record、shutdown capability、HMAC authority、日志或截图。
- 有多个候选时，从每个包内 CODECLAW_CANDIDATE_AUTHORITY.json 获取 sourceCommit 和候选身份，不靠目录时间或猜测。
- 不要删除现有 ignored dist 或 .codeclaw 内容。只清理由本轮新验证明确创建且确认无保留价值的临时资源。
- 如果候选缺失，不要手工复制源码或补写 Authority。只有在工作树 clean、HEAD 已提交且确实需要新候选时，才运行 npm.cmd run stage4b:machine。
- 没有代码变化时，不要为了“看起来完整”自动重跑全部耗时门禁。

只读检查 4173–4199 是否仍有监听：

~~~powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -eq "127.0.0.1" -and $_.LocalPort -ge 4173 -and $_.LocalPort -le 4199 } |
  Select-Object LocalAddress, LocalPort, OwningProcess
~~~

端口为空表示没有发现该范围的 IPv4 loopback listener；端口非空不等于一定是 CodeClaw，不要据此终止进程。

## 不可改写的真人历史

- tester-2 首次真人测试已于 2026-07-12 完成，不再处于 standby。
- 匿名测试者为 tester-2，主持人为 host-1，语言为 zh-CN，总时长约 120 分钟。
- 现场同意已确认；测试者只使用 Demo，没有点击 Apply，没有写项目文件，也没有确认项目命令。
- host-1 已确认最终匿名记录准确；决定为 Fix first，下一位测试者为 No。
- trial:after-live 已在确认后运行且只运行一次，真实最终状态为 AFTER_LIVE_BLOCKED。
- 不要再次运行 tester-2 after-live，不要运行 archive 来“修复”历史，不要编辑回答，不要把 remediation 写回原 after-live。
- 不要邀请朋友补答，不要用合成回答填真人字段，不要自动创建 tester-3。

第一轮反馈所要求的 sticky 导航、清晰层级、模块新手说明、Demo 中文补丁、显式会话选择、只读预检说明、Apply/Verify 风险说明和更准确的隐私文案都已经进入后续工程实现并有机器回归。但机器实现不等于 host 或真人主观验收。

## 尚未完成的 host-1 产品验收

这是内部产品验收，不是新一轮真人测试，也不需要朋友到场。当前仍需由 host-1 在同一候选上真实检查：

1. 宽屏滚动时左侧导航持续可见。
2. 900px、620px、390px 下关键内容和控件可达。
3. 已保存会话的“继续”和“全新开始”两条分支都正确。
4. 干净 Demo 使用中文目标时，第一次即可生成可理解的补丁。
5. 预检清楚解释自动生成计划、读取上下文、写入 0、命令 0。
6. 模块用途、隐私边界、Apply 写入影响和 Verify 命令用途/风险足够清楚。
7. Demo 完成 Apply → Verify → Revert，并确认文件恢复。

条件项：以后若决定验收 disposable copy，再额外检查基线冲突和 Revert 后人工编辑冲突会拒绝覆盖。原项目不要用于写入验收。

## 尚未完成的 Stage 4B Windows 人工验收

- 干净 Windows 10 与 11。
- 非管理员账户启动。
- Node.js 20+ 安装与 PATH。
- PowerShell execution policy。
- Defender 与 SmartScreen 实际行为。
- 默认浏览器打开和复用。
- 真实双击 start/stop、控制台关闭和错误提示。
- 真实 Windows taskkill /T 后代进程树清理。
- 像素布局、完整键盘操作、NVDA 和高对比度。
- Authority 损坏、端口占用、浏览器失败和实例身份不匹配时的恢复指引。
- 真实断电、异常 ACL、杀毒软件锁定、网络盘和大型项目主观性能仍是更后面的诚实边界。

Stage 4B 当前只能叫 machine candidate，不是签名安装器或最终 Windows release。SHA-256 完整性也不等于发布者代码签名。

## 两个相互独立的人工门禁

不要把以下门禁合并：

1. remediation / 未来复测准入：核心是 host-1 七项产品验收、修复映射、证据新鲜度、源码/候选一致性和 host-1 明确接受。它最多支持未来讨论 REMEDIATION_READY_FOR_RETEST，不代表 Windows release 通过。
2. Stage 4B Windows 人工验收：核心是干净 Windows、非管理员、Defender/SmartScreen、默认浏览器、真实双击、进程树和无障碍矩阵。它通过也不会自动修改 remediation、安排 tester-3 或证明最终 Windows release。

任一门禁通过都不能代替另一门禁；二者也都不能代替签名、安装器、更新、修复、卸载和发布者信誉验证。

## 重启后最合适的规划方向

当前不适合直接启动 Stage 4C。Stage 4C 的既定准入仍要求 3–5 次独立真人试用，并证明安装摩擦而非工作流困惑是主要剩余问题；短期真人测试暂停时，这些证据不存在。

建议使用“Stage 4B.1：人工验收与 remediation 收口”作为临时工作包名称；它不新增或改写 NEXT_PHASE_PLAN.md 的正式阶段编号。按以下顺序设计计划：

1. 只读基线复核：Git、Authority、候选状态、禁入项和当前机器环境。
2. 当前电脑的 host-1 七项产品验收，以及 launcher start/status/stop/restart 的低成本人工检查。
3. 单独规划干净 Windows、非管理员、Defender/SmartScreen、双击、默认浏览器、键盘/NVDA/高对比度的 Stage 4B 环境矩阵和证据模板。
4. 把 host 产品验收和 Windows 发布验收分别记录；remediation 映射只引用所需的 host 证据，绝不改写 tester-2 after-live。
5. 若发现真实缺陷，只修复缺陷本身；删除临时测试代码，先跑受影响聚焦测试，再跑完整 test/check 和 Stage 4B gate，从新的 clean commit 生成新候选，并重做受影响的人工作业。
6. 只有 remediation 所需的全部必做项真实通过、候选/源码/证据指向同一提交且 host-1 明确接受后，才讨论把 remediation 从 HOLD 提升到 READY_FOR_RETEST。
7. Windows 人工门禁独立给出 passed / hold，不因 remediation 状态自动变化，也不把 machine candidate 升格为最终 release。
8. 即使达到 READY_FOR_RETEST，也继续保持 tester-3 not scheduled，直到用户以后明确恢复真人测试。
9. 暂停期只能维护“Stage 4C 证据缺口与继续延后”说明。正式 Stage 4C 决策记录、Electron/Tauri 原型或路线选择必须等既定真人证据与 4B 收益证据满足后再开始。

重启后的 Codex 应先向用户提交这份后续计划，不应在计划呈现前自动执行新阶段、创建验收结论或启动真人流程。

## 永久边界

- 永久不重跑 tester-2 after-live，也不为该会话补做 archive 或改写任何历史结果。
- 当前真人测试暂停期不运行 trial freeze、dispatch 或其他真人候选流程；未来只有路线图被用户明确恢复或修订后，才可从匹配的 clean source 流程重新评估。
- 不创建 tester-3，不开始 intake、session pack、pre-live、live capture 或真人主持。
- 不自动开始 Stage 4C、Electron、Tauri、云服务、微信小程序或安装器工程。
- 不把原项目提升为可写；仅 Demo 或明确登记、激活并复验的 disposable copy 可写。
- 不自动 push。新的提交由用户决定何时运行 git pushall。
- 不提交 dist、.codeclaw、node_modules、真人记录、roster、截图、录屏、日志、证据包、私密路径、真实项目内容、API key 或 secret token。
- 不把 legacy local-trial 包当作可启动或可分享候选。
- 不宣称未执行的人工、Windows、无障碍、签名、安装或真人理解结果。
- 不保留一次性调试开关、临时测试项目、注释掉的旧实现、未使用分支或墓碑代码。
- 不使用 git reset --hard 或 git checkout -- 丢弃未知改动。

## 交接完成标准

重启后的接管者应先完成只读核对，然后向用户汇报：

1. 实际 HEAD、工作树和双远端差异。
2. 找到的最新 machine candidate 及其 Authority sourceCommit，并说明它是否与 HEAD 一致；身份值可汇报，但不要暴露 LocalAppData control、shutdown/HMAC capability 或绝对私密路径。
3. 当前仍为 REMEDIATION_HOLD、tester-3 not scheduled、真人测试暂停。
4. 临时 4B.1 工作包的详细推荐计划、两个独立人工门禁、每项证据、依赖、风险、停止条件和退出条件。
5. 哪些步骤需要 host-1 亲自操作，哪些可以由 Codex 自动完成。

如本文与更早聊天或旧截图冲突，以实际 Git、候选 Authority、不可改写的真人历史和用户最新明确决定为准。
