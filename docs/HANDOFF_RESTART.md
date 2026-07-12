# CodeClaw 重启交接：暂停真人测试的工程加固循环

更新日期：2026-07-13

这是当前唯一有效的 Codex 重启交接文件。它替代此前“等待 tester-2 首次真人测试”的说明；tester-2 已完成，当前不要再次主持该会话。

## 重启后的第一条指令

```text
请完整读取 docs/HANDOFF_RESTART.md 和 docs/NEXT_PHASE_PLAN.md，然后继续 CodeClaw 的暂停真人测试工程循环。Stage 3.0.11 可丢弃项目副本已完成机器验证，下一阶段是 3.0.12 模型出站透明度与隐私；之后依次推进 3.0.13、3.0.14 和 4B。tester-2 的真实结果是 AFTER_LIVE_BLOCKED，必须保持不变；不要重跑 after-live、不要修改真人答案、不要创建 tester-3。每阶段实现、验证、清理并独立提交；不要提交 dist、.codeclaw、真人记录、截图、日志或证据包，不要保留临时/墓碑代码，也不要直接 push。
```

## 当前结论

- 第一轮真人测试已于 2026-07-12 完成，不再处于 standby。
- 匿名测试者为 `tester-2`，主持人为 `host-1`，语言为 `zh-CN`，总时长约 120 分钟。
- 现场同意已明确确认。实际只使用 Demo；因没有安全副本，真实项目只读预检为 `N/A`。
- 未点击 Apply，未写入项目文件，未确认项目命令，未创建临时项目或测试代码。
- host-1 已确认三份最终记录准确；最终决定为 `Fix first`，下一位测试者为 `No`。
- 进入本轮工程循环前的产品修复基线为：

```text
c402b45 Prioritize remediation in trial status
62d1ec5 Complete Stage 3.0.9 remediation safety
61f3786 Fix first-live feedback issues
```

- 最新阶段提交以 `git log -1 --oneline` 为准。后续提交仍由用户决定何时运行 `git pushall`；Codex 不直接 push。
- 下一轮真人测试明确暂缓。`Stage 3.0.11` 已完成机器验证，当前下一阶段是 `Stage 3.0.12`，详见 [`NEXT_PHASE_PLAN.md`](NEXT_PHASE_PLAN.md)。
- `Stage 3.0.9` 的工程映射完成不代表复测准入通过：host-1 七项人工验收仍缺失，真实状态保持 `REMEDIATION_HOLD`；tester-3 仍为 `not scheduled`。
- Stage 3.0.10 的最终机器证据为 `npm.cmd test` 187/187、`npm.cmd run check` 通过，以及 health、smoke、四个 pilot 全部通过。它实现了三阶段全局 claim、写前 journal、root/parent/临时文件实体身份绑定和跨 state-dir 恢复阻断，但没有宣称真实断电、自定义 ACL、杀毒软件/网络盘或真人原项目写入已验收。
- Stage 3.0.11 的最终机器证据为 `npm.cmd test` 245 pass、0 fail、1 个环境性 symlink skip（246 total），`npm.cmd run check` 通过且三语各 665 键，以及 health、smoke、四个 pilot 全部通过。它实现了完整 Data Boundary Manifest、三类服务端工作区能力、显式副本创建/激活/清理、崩溃恢复和 exact-target 复验；原项目仍不可写或运行项目命令。副本不等于匿名化或适合分享，自身被忽略的 `.gitignore` 也不宣称规则快照已被保留。

## 重启后先检查

在项目根目录运行只读检查：

```powershell
git rev-parse --show-toplevel
git status --short --branch
git log -5 --oneline --decorate
```

不要假设工作树干净。若存在未提交修改，先阅读 diff，区分当前 Stage 3.0.9 工作与用户的其他修改；保留无关改动，不使用 `git reset --hard` 或 `git checkout --` 丢弃它们。

随后读取：

```text
docs/NEXT_PHASE_PLAN.md
docs/PROJECT_STATUS.md
docs/FIRST_TRIAL_RUNBOOK.md
docs/RELEASE_STRATEGY.md
```

本地真人记录只在确有必要验证摘要时读取，并且不要把原文复制到聊天、源码、文档或 Git diff。

## tester-2 的不可改写结果

`trial:after-live` 已在 host-1 确认记录后运行且只运行了一次：

```powershell
npm.cmd run trial:after-live -- --session dist/trial-session-packs/tester-2 --tester tester-2 --force
```

真实结果：

```text
SESSION_COMPLETION_READY                 0 blockers,  0 warnings
PRIVACY_OK                              0 blockers,  0 warnings
NO_GO_FIX_FIRST                        11 blockers, 10 warnings
REVIEW_BLOCKED                          3 blockers,  4 warnings
AFTER_LIVE_BLOCKED                     10 blockers, 27 warnings
```

重要边界：

- 不要再次运行该命令。
- 不要把 `Fix first` 或“下一位：No”改成更容易通过的值。
- 不要编辑 tester-2 的回答来证明修复有效。
- 不要把 remediation 结果写回原 after-live。
- 本轮 archive 没有运行，evidence packet 没有生成。
- 当时 after-live 错误展示了 2026-07-09 的旧 archive 结果；`61f3786` 已修复新鲜度判断。这只证明显示逻辑已修复，不代表 tester-2 本轮归档成功。

## 已确认的人类反馈

- 中文 Demo 目标当时无法生成 Mock 补丁，并显示误导性的英文错误。
- tester-2 只点击了 Demo；预检随后自动准备计划和读取上下文，但页面没有解释自动进展。
- 旧会话当时可能在没有显式选择时恢复。
- tester-2 希望桌面左侧导航滚动时保持可见、页面层次更清楚、每个模块增加新手用途说明。
- 计划是最能建立信任的部分；补丁是最有价值的预期能力。
- 解释本地/只读边界后，最终泄露顾虑为 `No`。
- tester-2 愿意尝试可丢弃补丁，也愿意未来在安全条件下用于真实项目。

技术表述必须准确：预检本来就会创建计划并读取上下文。观察到的问题是产品没有解释这一自动只读进展；不能断言这些步骤必然来自旧会话。

## `61f3786` 已完成的修复

- 中文、英文、俄文除零 Demo 目标可生成补丁。
- 已知 Mock 失败原因结构化并本地化，不再附加无关英文原始错误。
- 已保存会话要求明确选择“继续 / 全新开始”；Demo 使用干净任务状态，迟到旧响应不会覆盖它。
- 删除未使用的旧 `refreshTask` 路径，没有保留墓碑代码。
- 预检说明自动生成计划、读取上下文，但不写文件、不运行命令。
- 桌面侧栏固定、窄屏响应式布局、主持人清单默认收起、模块用途说明增强。
- Apply 明示写入；Verify 在确认前展示完整命令、用途和风险。
- 在线模型隐私文案准确说明可能发送目标、元数据、路径和所选上下文。
- after-live 只承认当前运行的新鲜归档，且没有当前成功归档时禁止 evidence packet。

## 最近已通过的验证

以 `61f3786` 为基线：

```text
focused tests: 28/28
source tests: 132/132
packaged tests: 132/132
npm.cmd run check: passed
i18n: 544 keys/language, 0 warnings/failures
npm.cmd run health: passed; Chinese Demo patch applicable, 1 file
npm.cmd run smoke: Apply/Verify/Revert passed; Demo restored
npm.cmd run trial:ready: passed
package hygiene: missing 0, disallowed 0, files 169
candidate: dist/CodeClaw-local-trial-20260712
```

自动视觉 QA 没有完成：当时 in-app Browser 没有连接实例。因此不能声称已经做过像素级宽屏/窄屏验收。临时视觉服务已停止，没有遗留临时状态目录。

除非代码又发生变化或当前实现需要验证，不要为了“看起来更完整”无意义重跑整套耗时检查。修改后按风险先跑聚焦测试，再跑完整门禁。

## Stage 3.0.9 历史执行顺序与仍待人工项

以下工程工作已经实现；涉及 host-1 的人工视觉、核心交互和候选接受仍未完成，因此 remediation 继续保持 `REMEDIATION_HOLD`。本节是恢复条件，不是当前待自动重跑的命令清单。

### 1. 同步文档和事实

确认 README、项目状态、重启交接和后续路线均已从“等待第一位真人”更新为“真实 blocked -> 修复闭环”。

### 2. 实现独立 remediation 门禁

目标状态：

```text
REMEDIATION_HOLD
REMEDIATION_READY_WITH_REVIEW
REMEDIATION_READY_FOR_RETEST
```

remediation 报告必须保留原 `AFTER_LIVE_BLOCKED`，并独立映射 must-fix、修复提交、测试、人工验收、候选包和 host-1 决定。缺少人类验收时不能自动升级为 ready。

然后让 `trial:status`、`trial:next-live` 和 cohort 流程识别“历史 blocked + 修复闭环完成 = 可在未来受控复测”，而不是要求伪造 `AFTER_LIVE_READY`。

### 3. 加固 Apply/Revert

真实项目写入开放前，至少完成：基线哈希、Apply 冲突拒绝、多文件部分失败回滚、Revert 后续编辑冲突拒绝、路径边界检查及对应测试。

若该工作尚未完成，下一轮范围必须继续限制为 Demo Apply 和真实项目只读；不要用一次成功 smoke 推断真实多文件冲突已经安全。

### 4. 准备 host-1 内部验收

让 host-1 在准确候选提交上检查中文宽屏滚动、900/620/390px、继续/全新开始、干净 Demo、中文首次补丁、预检说明、模块说明、隐私文案以及 Demo Apply -> Verify -> Revert。

这是内部产品验收，不是新一轮真人测试。没有真实浏览器证据时保留 review/hold，不能声称通过。

### 5. 重新冻结候选

只有 remediation、安全加固和 host 验收完成后才运行：

```powershell
npm.cmd run trial:simulate
npm.cmd run trial:ready
npm.cmd run trial:freeze
npm.cmd run trial:dispatch
```

确保源码、测试、readiness、候选包、freeze、dispatch 和 remediation 指向同一提交。不要复用早于修复的旧产物。

## 当前不要做的事

- 不要运行 tester-2 after-live、archive 或任何“修复历史结果”的命令。
- 不要开始 tester-3 intake、session pack、pre-live、live capture 或真人主持。
- 不要邀请朋友回来补答问题，也不要用合成答案填真人字段。
- 不要在用户未要求时扩展到 Electron、Tauri、云服务或微信小程序。
- 不要直接 push。
- 不要提交 `dist/`、`.codeclaw/`、真人记录、截图、日志、私密路径或 evidence packet。
- 不要保留验证结束后无用的临时代码、注释掉的旧实现或墓碑分支。

## Git 与隐私边界

永远不提交：

```text
.codeclaw/
dist/
node_modules/
server-bg.log
真人原始记录和 roster
截图、录屏和终端日志
联系方式、身份信息、API keys 或 secret tokens
真实项目路径、名称或源代码片段
after-live evidence packet
临时测试项目、临时服务状态或一次性调试代码
```

暂存时必须列出明确的源码、测试和文档文件，不使用可能把本地产物一并加入的宽泛命令。提交前至少检查：

```powershell
git diff --check
git status --short
git diff --cached --name-only
```

## Stage 3.0.9 仍待满足的人工完成标准

- tester-2 原始 `AFTER_LIVE_BLOCKED` 和计数保持可追溯且未改写。
- 独立 remediation 报告逐项映射所有 must-fix，并验证证据新鲜度。
- 自动化门禁、host-1 人工验收和候选包指向同一提交。
- Apply/Revert 高风险项已修复；若明确延期，则未来真人范围继续禁止真实写入。
- 视觉验收真实完成；没有浏览器时诚实保留 review/hold。
- 门禁给出 `REMEDIATION_READY_FOR_RETEST`，但 tester-3 仍保持未安排，直到 host-1 以后主动决定开始。
- 全量验证按修改风险通过，临时代码已删除，无墓碑代码。
- Git 暂存区不含任何本地真人/隐私/产物文件。

完成后向用户汇报：实现内容、真实门禁结果、测试结果、尚未完成的人工项、提交哈希，以及是否需要由用户运行 `git pushall`。不要把“可以规划 tester-3”表述成“已经开始 tester-3”。
