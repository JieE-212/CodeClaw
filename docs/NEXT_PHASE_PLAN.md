# CodeClaw 后续阶段路线图

更新日期：2026-07-13

## 1. 当前决策

CodeClaw 已完成第一轮真人测试、第一批问题修复和 `Stage 3.0.9` remediation 工程闭环。真人复测继续暂停；当前按用户授权进入无需逐项确认的工程加固循环。`Stage 3.0.10` 至 `3.0.14` 已完成机器验证和独立提交；当前直接推进 `4B`。

这里的“工程闭环”不等于复测准入已经通过：host-1 的七项人工验收尚未完成，真实 remediation 状态继续是 `REMEDIATION_HOLD`。后续阶段的机器通过不会改写 tester-2 的 `AFTER_LIVE_BLOCKED`，也不会自动开放真实原项目写入。

当前不安排 tester-3，也不把 tester-2 的结果重新跑成绿色。每个工程阶段都必须完成实现、自动验证、临时产物清理和独立提交后再进入下一阶段；不直接 push。人工体验、真实 Windows 和像素级验收缺失时必须保留为人工项，不得由自动化冒充通过。

本路线图遵循四条原则：

1. tester-2 的 `AFTER_LIVE_BLOCKED` 是永久历史事实，不改写、不删除、不通过重跑掩盖。
2. 修复证据写入独立的 remediation（修复闭环）报告，不冒充原会话证据。
3. 自动化检查只能证明机器可验证的事实；同意、理解程度、主观感受和主持人接受必须由真人明确确认。
4. `dist/`、`.codeclaw/`、真人原始记录、截图、日志、真实项目信息和证据包始终留在本地，不进入 Git。

## 2. 已确认基线

### 2.1 tester-2 真实会话

- 日期：2026-07-12。
- 匿名测试者：`tester-2`；主持人：`host-1`；语言：`zh-CN`。
- 现场同意：已明确取得；总时长约 120 分钟。
- 实际范围：只使用 Demo；真实项目只读预检因没有安全副本而记为 `N/A`。
- 未点击 Apply，未写入项目文件，未运行项目验证命令，未创建临时测试代码或临时项目。
- tester-2 的最终泄露顾虑为 `No`，但这是在获得本地/只读边界解释后形成的结论。
- host-1 的真实决定是 `Fix first`，是否继续下一位测试者为 `No`。

`trial:after-live` 只运行了一次，结果必须原样保留：

```text
SESSION_COMPLETION_READY
PRIVACY_OK
NO_GO_FIX_FIRST          11 blockers, 10 warnings
REVIEW_BLOCKED            3 blockers,  4 warnings
AFTER_LIVE_BLOCKED       10 blockers, 27 warnings
```

本轮没有成功归档，也没有 evidence packet。当时报告错误展示了 2026-07-09 的旧归档结果；源码中的新鲜度判断已修复，但不能据此声称 tester-2 本轮归档成功。

### 2.2 第一批修复基线

提交 `61f3786 Fix first-live feedback issues` 已完成以下修复：

- 中文 Demo 目标可以生成补丁，并为已知失败原因显示本地化、可行动提示。
- 旧会话不再自动注入；用户必须选择“继续”或“全新开始”，Demo 从干净任务状态开始。
- 只读预检会解释自动生成计划和读取上下文的行为，并明确不会写文件或运行命令。
- 桌面侧栏保持可见，窄屏布局改善，主持人清单默认收起，各模块增加新手说明。
- Apply 明确表示会写文件；Verify 在确认前显示完整命令、用途和风险。
- 在线模型隐私说明准确列出可能发送的目标、元数据、路径和所选上下文。
- after-live 不再把旧归档当作本轮成功归档，也不会在本轮归档未成功时生成证据包。

已完成的自动验证：源码测试 132/132、打包副本测试 132/132、`check`、`health`、`smoke` 和 `trial:ready` 均通过；三种语言各 544 个键且无警告；中文 Demo 补丁健康检查生成 1 个适用文件；包卫生为缺失 0、禁入 0、共 169 个文件。

自动浏览器当时没有可连接实例，因此尚不能声称完成像素级视觉验收。这是 Stage 3.0.9 的人工验收项，不是重新开展真人测试。

## 3. 总体阶段图

| 阶段 | 核心目标 | 真人参与 | 进入下一阶段的必要结果 |
| --- | --- | --- | --- |
| 3.0.9 | 修复闭环、写入/回滚加固、主持人验收、重新准入 | 仅 host-1 内部验收 | `REMEDIATION_READY_FOR_RETEST`，且没有未接受的高风险项 |
| 3.1 | tester-3 独立受控复测 | 1 位未接触产品的新手 | 隐私通过、会话真实收尾、核心路径无关键回归 |
| 3.2 | tester-4 复核并形成趋势 | 另一位独立测试者 | 至少两轮修复后测试无关键安全或可用性回归 |
| 4A 后段 | 扩展为 3–5 位小规模本地 Web 用户 | 小规模 cohort | cohort 门禁允许扩展，核心价值与安全边界稳定 |
| 4B | 降低本地启动和诊断摩擦 | 以既有用户回归为主 | 启动器在目标 Windows 环境稳定、失败可诊断 |
| 4C | 决定是否采用桌面壳 | 小范围原型验证 | 有证据支持 Electron、Tauri 或继续本地 Web |

云端、多用户服务和微信小程序 companion 属于更晚的 4D 候选，不在当前执行范围内。

## 4. Stage 3.0.9：首次真人反馈修复闭环

### 4.1 目标

在不改写 tester-2 历史记录的前提下，建立一条正式的复测准入路径，并把真实项目写入、回滚和人工视觉验收补齐到下一轮可接受的安全水平。

### 4.2 准入条件

- tester-2 三份最终记录已由 host-1 确认准确。
- 唯一一次 after-live 的真实结果和计数可读取，且保持 `AFTER_LIVE_BLOCKED`。
- 修复基线提交为 `61f3786` 或其可追溯后继提交。
- 工作树中没有被误加入版本控制的真人记录、`dist` 产物、日志或截图。
- 下一位真人测试尚未被邀请或创建为“已完成”状态。

### 4.3 工作包

#### A. 文档和事实同步

- 让项目状态、重启交接、README 和本路线图反映真实首测结果。
- 明确旧会话是“显式继续 / 全新开始”，不再描述为无条件自动恢复。
- 把 tester-2 的历史事实、产品修复和未来验收分成三层，避免状态混淆。

#### B. 独立 remediation 门禁

新增独立修复报告和命令，至少表达三种结论：

- `REMEDIATION_HOLD`：证据缺失、仍有未解决阻断项或安全检查失败。
- `REMEDIATION_READY_WITH_REVIEW`：机器检查通过，但仍有需要 host-1 明确接受的人工项。
- `REMEDIATION_READY_FOR_RETEST`：所有必修项均有修复映射，自动验证和主持人验收均有效，可以在未来创建 tester-3 会话。

报告至少包含：原 after-live 决定及摘要、每个 must-fix 到修复/测试/人工验收的映射、源码提交、试用包版本、证据时间、新鲜度检查和 host-1 的明确决定。它只能引用匿名、安全摘要；不得复制真人原始回答或真实项目内容。

`trial:status`、`trial:next-live` 和 cohort 交接后续应识别以下合法关系：

```text
历史 AFTER_LIVE_BLOCKED（保持不变）
  + 独立 remediation 全部完成
  + host-1 明确验收
  + 最新候选包验证通过
  = 允许未来受控复测
```

任何逻辑都不得用 remediation 把原 after-live 字段改成 ready。

#### C. Apply / Revert 安全加固

真实项目写入开放前必须完成：

- 生成补丁时记录每个目标文件的基线内容哈希。
- Apply 前重新计算哈希；文件已变化时拒绝写入并要求重新生成补丁。
- 多文件 Apply 出现部分失败时，回滚本次已经写入的文件，并留下清晰审计结果。
- Revert 前检测 Apply 后是否有人为编辑；有冲突时拒绝覆盖，并给出安全恢复指引。
- 不允许路径越过已扫描项目根目录；不跟随可疑链接写到根目录之外。
- 对新增、修改、删除分别验证，错误提示说明哪些文件未写、已回滚或需要人工检查。
- 增加覆盖基线冲突、部分失败、回滚冲突和路径边界的自动测试。

在这些条件通过前，真实项目仍只允许只读预检；Apply 仅限内置 Demo 或 host-1 明确准备的无秘密一次性副本。

#### D. host-1 内部验收

这不是新一轮真人测试，也不需要朋友在场。host-1 使用最新候选包完成并记录：

1. 中文桌面宽屏滚动时侧栏持续可见。
2. 约 900px、620px 和 390px 宽度下没有关键控件遮挡或无法到达。
3. 已保存会话出现“继续 / 全新开始”，两条分支行为符合文案。
4. 只点击 Demo 后任务状态干净，且中文目标首次生成补丁。
5. 预检说明能解释自动计划、上下文读取、零写入和零命令。
6. 各模块用途、隐私说明、Apply 写入边界和 Verify 命令风险可见。
7. 在 Demo 中完成一次 Apply -> Verify -> Revert，并确认文件恢复。
8. 若启用一次性副本验收，故意制造基线冲突和 Revert 冲突，确认产品拒绝覆盖。

视觉验收应记录通过/失败和候选提交，不保存含隐私内容的截图到 Git。无法完成浏览器验收时只能保持 `REMEDIATION_READY_WITH_REVIEW` 或 `REMEDIATION_HOLD`，不能声称像素级通过。

#### E. 重新冻结候选包

只有 A–D 完成后才按顺序运行非真人候选验证：

```powershell
npm.cmd run trial:simulate
npm.cmd run trial:ready
npm.cmd run trial:freeze
npm.cmd run trial:dispatch
```

候选包、readiness、freeze、dispatch 和 remediation 必须指向同一源码提交；旧包不得作为新一轮依据。运行这些命令不等于开始真人测试，也不能自动创建 tester-3 的回答。

### 4.4 指标

- tester-2 的每个 must-fix 都有且仅有一条可追溯处置：已修复、明确延期或风险接受；高风险项不得延期。
- 自动检查、主持人验收和候选包提交一致率为 100%。
- 历史记录改写数为 0；旧归档误认数为 0；未成功归档时证据包生成数为 0。
- Git 中真人原始记录、`dist`、截图、日志、秘密和真实项目信息数量为 0。
- Apply 基线冲突、部分失败回滚、Revert 冲突和路径边界测试全部通过。
- 中文 Demo 首次补丁成功；宽屏/窄屏验收表无未解释失败。

### 4.5 停止条件

出现以下任一情况时保持或退回 `REMEDIATION_HOLD`：

- 原 after-live、隐私结果或 must-fix 摘要缺失、陈旧或互相矛盾。
- 需要修改 tester-2 的真实回答才能让门禁通过。
- 最新代码、自动验证、人工验收和候选包不是同一提交。
- 发现意外联网、秘密采集、路径越界、未确认写入或未确认命令执行。
- Apply 部分失败后不能证明文件状态，或 Revert 可能覆盖后续人工编辑。
- 视觉关键路径无法完成且没有真实人工验收。
- 工作树将真人记录、`dist`、截图或日志纳入提交。

### 4.6 退出条件

- remediation 报告包含完整修复映射，且原结果仍显示 `AFTER_LIVE_BLOCKED`。
- 所有 P0/P1 必修项关闭；P2 项如延期，已写明原因、风险和复查阶段。
- 源码和打包副本全量验证通过，候选包卫生通过。
- host-1 完成人工视觉和核心交互验收并明确接受。
- Apply/Revert 安全加固满足 C 的要求，或者下一轮范围继续明确禁止任何真实项目写入。
- 门禁最终给出 `REMEDIATION_READY_FOR_RETEST`；此状态只表示将来可以安排 tester-3，不会自动启动会话。

## 5. Stage 3.1：tester-3 独立受控复测

### 5.1 定位与准入

tester-3 应是未接触过 CodeClaw 的中文初学者，使用新的匿名编号。此前参加过 tester-2 会话的朋友可以做熟悉用户回归，但不作为“独立新手”的主要证据。

准入要求：Stage 3.0.9 为 `REMEDIATION_READY_FOR_RETEST`；最新包与验收提交一致；本地匿名 roster、现场同意和允许范围完整；host-1 明确决定开始；如测试真实写入，必须有无秘密、可丢弃且可独立恢复的副本。

### 5.2 范围和流程

- 默认 Mock，不配置在线模型。
- 独立完成 Demo：选择模式、理解预检、生成计划/上下文/补丁、审查、Apply、Verify、Revert。
- 真实项目默认只做一次只读预检。
- 只有 Apply/Revert 加固已验收、项目为无秘密一次性副本且测试者再次确认时，才可尝试真实副本补丁。
- 主持人先观察；除安全风险外，测试者卡住约 30 秒后才提供帮助，并记录帮助发生的位置。

### 5.3 核心指标

- 在无提示情况下 20 秒内找到 Demo，并能说出当前是 Demo 模式。
- 中文目标第一次生成可审查补丁，不出现无关英文错误。
- 核心路径主持人帮助次数为 0；若非 0，记录首次帮助步骤和原因。
- 测试者能用自己的话区分只读预检、Apply 写入、Verify 命令和 Revert 边界。
- 旧会话不会自动混入，新手能理解“继续 / 全新开始”。
- 桌面和约 390px 窄屏至少各完成一次关键导航检查。
- 隐私疑问由产品文案解决，不依赖主持人补充秘密或云端承诺。
- 真实项目只读路径保持 0 写入、0 命令；未经确认的联网、写入和命令均为 0。

### 5.4 停止与退出

立即停止：撤回同意；即将输入身份、联系方式、密钥或私密代码；意外联网；真实项目未经确认写入/运行命令；路径越界；Apply/Revert 后文件状态不明确；主持人无法判断动作风险。

退出需要三份匿名最终记录经测试者/主持人确认，completion 和 privacy 有真实结果，并且 after-live 仅运行一次。若结果为 blocked，回到 remediation；若为 ready-with-review，逐项记录 host 决定；绝不通过修改回答刷绿。

## 6. Stage 3.2：tester-4 复核与趋势分析

### 6.1 准入和设计

- tester-3 已真实收尾，所有新增 P0 已处理。
- tester-4 使用不同匿名身份，优先选择不同设备宽度或不同新手背景。
- 测试脚本保持核心任务一致，避免因任务差异掩盖回归；可增加一个窄屏或启动器观察项。
- tester-4 不读取 tester-2/tester-3 的答案，主持人不提前提示前两轮卡点。

### 6.2 指标和退出

比较 tester-3 与 tester-4 的 Demo 发现时间、首次补丁成功、帮助次数、模式识别、安全边界理解、最大困惑和信任来源。重复出现两次的摩擦升级为必修候选；任何安全问题一次即升级为 P0。

退出要求至少两轮修复后真人测试均无未解决的关键安全回归，隐私门禁通过，并形成匿名 cohort 趋势摘要。tester-2 继续计入历史趋势，但不算作一轮“成功复测”。

## 7. Stage 4A 后段：3–5 位小规模本地 Web 用户

### 7.1 准入

- tester-3 和 tester-4 已完成，至少两轮修复后结果达到可继续状态。
- 没有未解决的 P0；真实写入边界和在线模型数据边界有稳定文案与测试。
- `trial:cohort-summary` / `trial:cohort-handoff` 能在不读取原始隐私数据的前提下给出扩展决定。

### 7.2 目标与指标

- 累计 3–5 份有效匿名真人会话，覆盖至少两种新手背景和桌面/窄屏。
- 跟踪启动成功、Demo 发现、首次补丁成功、完成率、帮助次数、Apply/Revert 信心、隐私疑问和再次使用意愿。
- 以重复问题频率排序产品工作；一次安全问题优先于多次视觉偏好。
- 计划和补丁是否持续成为信任/价值来源，必须由用户原话或明确选择支持。

### 7.3 停止与退出

任何隐私泄露、越权写入、命令绕过确认或不可恢复的数据问题立即暂停扩展。退出需要 cohort 门禁允许扩大、本地 Web 核心闭环稳定，并有证据说明启动摩擦是否值得进入 4B。

## 8. Stage 4B：本地启动器完善

原计划把 3–5 次真人试用作为投入门槛；2026-07-12 用户已授权在暂停真人测试期间提前完成 4B 的工程候选。重点不是重写架构，而是减少 Windows 用户启动摩擦：

- 检查 Node 版本和项目包完整性。
- 清晰处理端口占用，避免误打开旧服务页面。
- 自动打开正确 URL，并展示当前包版本/提交。
- 提供显式停止方式、可行动错误信息和不含秘密的诊断摘要。
- 保持本地服务、显式写入/命令确认和本地审计边界。

机器准入依据改为 3.0.10–3.0.14 全部机器门禁通过；机器退出依据是候选身份、回环监听、端口分流、启动/停止、哈希完整性和无孤儿进程自动回归通过。干净 Windows、非管理员账户、Defender/SmartScreen、默认浏览器和真实双击体验仍是人工验收项；缺少这些证据时只能称 `4B machine candidate`，不能称最终 Windows 发布就绪。

## 9. Stage 4C：桌面壳决策与原型

先做决策记录和最小原型，不直接承诺 Electron 或 Tauri：

- Electron：集成成熟，但安装体积和更新/签名成本更高。
- Tauri：体积更小，但引入 Rust/toolchain 和新的跨平台测试成本。
- 继续本地 Web + 启动器：如果反馈主要集中在工作流而非安装体验，可能仍是最佳选择。

准入要求：3–5 次真人试用完成、4B 数据证明桌面壳有明确收益。退出交付包括技术决策记录、最小启动/关闭/升级原型、安全威胁检查和继续/暂停结论。桌面壳不得弱化本地优先、写入确认、命令确认、路径边界或审计记录。

## 10. 延后范围：Stage 4D 与 companion

云端账号、团队账单、模型代理、远程共享和微信小程序仅在本地流程稳定后评估。若未来实现，默认仍由本地 agent 处理文件、补丁和命令；云端不得默认接收源码。微信小程序最多作为查看摘要、通知或高级审批的 companion，不作为核心开发 agent。

## 11. 角色与决策权

| 角色 | 责任 | 不得代替的决定 |
| --- | --- | --- |
| host-1 / 产品负责人 | 设定范围、准备安全副本、逐项验收、接受风险、决定何时邀请下一位 | 不得替测试者回答感受、理解程度或同意 |
| Codex / 实施者 | 实现代码、测试、门禁和文档；报告真实结果；清理临时代码 | 不得伪造真人反馈、自动接受 warning、重跑历史来刷绿或擅自 push |
| 真人测试者 | 自愿操作、说出判断、随时停止、确认匿名记录 | 不负责调试产品或证明预设结论 |
| 自动门禁 | 检查一致性、新鲜度、隐私和机器可验证条件 | 不得把自动通过解释为真人理解或授权 |
| 可选独立复审者 | 检查高风险写入/回滚逻辑和证据映射 | 不得修改原始会话记录 |

只有 host-1 可以决定何时开始下一轮真人测试；`REMEDIATION_READY_FOR_RETEST` 不会自动邀请、创建或启动 tester-3。

## 12. 隐私、数据和 Git 边界

- 只使用匿名编号；不记录姓名、电话、邮箱、微信、公司、账号或可识别项目名称。
- 默认 Mock 和 Demo。在线模型只在单独确认后启用，并预先说明可能发送的目标、元数据、路径和所选上下文。
- 真实项目优先只读；写入只使用无秘密、可丢弃、可恢复的副本。
- 不在会话记录中粘贴源代码、完整路径、终端日志、截图或密钥。
- 真人原始记录、roster、报告产物和 evidence packet 仅本地保存，并遵循 `.gitignore`；分享前再次做隐私检查。
- 临时测试代码、fixture 副本和临时服务状态在验证完成后删除，不保留墓碑代码。
- 任何报告只保留完成门禁所需的最小匿名摘要；不因“以后可能有用”扩大采集。

## 13. 优先级与执行顺序

### P0：开始任何新真人测试前

1. 文档与事实同步。
2. remediation 报告及独立准入门禁。
3. 修复状态、试用包和提交的新鲜度/一致性检查。
4. Apply/Revert 冲突检测、失败回滚和路径边界加固；若未完成，则下一轮继续禁止真实写入。
5. host-1 中文宽屏/窄屏、会话选择、Demo、Apply/Verify/Revert 人工验收。

### P1：tester-3 前完成或明确纳入范围

1. `trial:status`、`trial:next-live` 与 remediation 连接。
2. tester-3 的新手指标和主持记录字段更新。
3. 最新包冻结/dispatch 与源码提交绑定。
4. 对在线模型数据说明和旧会话竞态做回归检查。

### P2：两轮复测后决策

1. cohort 趋势指标和重复摩擦排序。
2. 启动器体验改进。
3. 桌面壳技术选择。
4. 云端或微信 companion 可行性；当前不实施。

## 14. 阶段推进规则

每个阶段只允许以下流转：

```text
planned -> in progress -> machine verified -> host reviewed -> ready/hold
```

不能跳过 host reviewed，也不能让较新的成功报告覆盖较旧的真人失败事实。若某阶段进入 hold，记录原因、责任人和恢复条件；不要为了时间表降低隐私或写入安全门槛。

## 15. 真人测试暂停期工程循环（当前权威顺序）

| 阶段 | 状态 | 机器退出条件 | 不得自动宣称的结果 |
| --- | --- | --- | --- |
| 3.0.10 崩溃安全 Apply/Revert | machine verified；host acceptance pending | 写前 WAL、原子替换、跨进程项目锁、启动恢复、冲突停写、事务绕行关闭、故障矩阵通过 | 断电绝对持久性、跨操作系统用户/不同锁目录互斥、Windows 自定义 ACL 完整保留、真实项目写入已开放 |
| 3.0.11 可丢弃项目副本 | machine verified；host acceptance pending | 统一数据边界策略、预览/创建/激活/清理、哈希 Manifest、原项目服务端只读能力 | “副本可安全分享”或“副本不含普通源码” |
| 3.0.12 隐私与模型出站透明度 | machine verified；committed | 所有模型操作两阶段 preview/send、精确披露、秘密/ignored 阻断、endpoint 范围限制、本地状态最小化；全量门禁通过 | 在线模型零出站；本机模型零本地 HTTP 数据传输；所有外部 TOCTOU 已完全关闭 |
| 3.0.13 新手界面与无障碍 | machine verified；committed | 单一权威流程、新手/高级模式、语义标签、焦点/键盘/响应式静态契约、三语门禁；顺序/竞态门禁通过 | 新手主观清晰度、NVDA/高对比度/真实像素验收 |
| 3.0.14 稳定性与性能 | machine verified；committed | 测试 fixture 全隔离、请求/扫描/模型预算、取消与超时、进程/端口/状态清理、增长上限 | 真实大型项目的主观等待感、真实断电、Windows 后代树完整验收 |
| 4B Windows 启动器与候选包 | planned；next | 候选身份校验、回环监听、就绪后开页、端口冲突分流、哈希 Manifest/篡改检测、无孤儿进程 | 干净 Windows 10/11、Defender/SmartScreen、双击体验等人工验收 |

### 15.1 Stage 3.0.10 已完成的机器证据

- Apply/Revert 在任何项目写入前持久化本地私有事务 journal 和 before 备份；任务提交或安全恢复后立即清理。
- 每个项目在持久的用户级协调目录中使用 `reserved -> journaled -> complete` 所有权 claim；claim 与本地 journal 必须精确对应，另一 state dir 不能接管未完成事务，claim 或 journal 缺失时 fail closed。
- 服务启动先对账未完成事务，再开始监听；文件既不等于 before 也不等于 after 时停止写入，绝不覆盖人工编辑。
- 目标文件与 `tasks.json` 使用同目录临时文件、`fsync` 和原子 rename；临时文件实体身份先写回 journal，恢复只能清理可证明由该事务创建的文件；Windows 锁定错误仅有限重试，不使用“先删除目标再改名”的降级路径。
- 同一项目 Apply/Revert 先按真实规范路径在进程内排队，再通过共享锁目录跨进程、跨 state dir 互斥；TaskStore 的 read-modify-write 也跨实例加锁并原子保存。
- 任务、批准、journal 和每次实际写入/恢复共同绑定工作区根目录及所有目标父目录的实体身份；同一路径被替换成普通目录或 junction 时停止写入并保留恢复证据。
- 用户批准与不可变 `proposalId` / `proposalDigest`、`patchIdentity` 绑定；排队后再次核对，禁止把对补丁 A 的批准用于后来替换的补丁 B。
- 通用工具 API 和高级工具 UI 已移除直接 `write_patch` 绕行；文件写入只能经过已审查的事务 Apply/Revert。
- 拒绝 NTFS ADS、Windows 设备名、尾随点/空格、大小写重复事务目标、链接和非 UTF-8 目标；严格 UTF-8 读取保留 BOM，保证可逐字节回滚文本属性。
- 恢复状态 API 和 UI 只显示匿名计数/错误码，不返回项目根路径、目标路径或源码正文。
- 故障测试覆盖首文件后中断、全部写完但任务未提交、未提交 Revert（恢复已有文件与重建已删除新文件）、任务已提交仅清理、人工冲突、备份损坏、临时文件冒名、root/父目录替换、junction 越界清理、启动恢复、跨 state-dir 持久所有权、双实例竞争、批准替换和直接写绕行。

最终机器证据：`npm.cmd test` 为 `187/187`，`npm.cmd run check` 通过（3 种语言各 563 个 key，0 warning/failure），`health`、`smoke`、`pilot:self`、`pilot:fixture`、`pilot:inbox`、`pilot:model` 均通过，所有会启动服务的自动脚本使用并清理独立临时 state/lock 目录。

已知边界：目录 `fsync` 在 Windows 仅能 best effort；自动测试构造中断后的磁盘状态，不等于真实断电或在每条机器指令处强杀；不同操作系统账户或被显式配置到不同 `CODECLAW_PROJECT_LOCK_DIR` 的实例不共享锁；自定义 Windows ACL、杀毒软件占用、网络盘和异常文件系统尚未独立验收。Node 路径 API 在最终身份检查与 rename/unlink 之间仍有不可完全消除的极小竞态窗口。上述限制禁止把实现描述为绝对断电事务或跨账户分布式锁；4B 仍需用候选感知的单实例启动器进一步收口。

### 15.2 继续推进规则

1. Stage 3.0.11 已建立统一 Data Boundary Policy；后续出站、复制和扫描边界继续复用它，不能把最多 800 个文件的 UI 扫描结果当作完整复制或出站清单。
2. 原项目默认 `original-readonly`；只有服务端登记并验证的 `disposable-copy` 才能获得写入/命令能力，客户端提交 `mode`、路径或 `approved:true` 不能提权。
3. 副本保护原项目不被修改，但副本仍含源码，不等于匿名化，也不等于适合分享。
4. 3.0.12 的模型出站门禁已复用同一数据边界策略；后续改动不得另建一套互相矛盾的敏感文件规则，也不得让 ignored 内容参与派生元数据。
5. 每阶段提交前运行聚焦测试、全量 `test/check`、health/smoke 和相关 pilot；随后检查 Git 暂存清单并删除临时 fixture、状态目录和测试开关。
6. 不运行 tester-2 after-live，不创建 tester-3，不生成或提交真人记录、截图、日志、`dist/`、`.codeclaw/` 或 evidence packet。

### 15.3 Stage 3.0.11 已完成的机器证据

- Data Boundary Policy 完整枚举复制范围并绑定 SHA-256、目录/文件实体身份、严格 nested `.gitignore`、敏感对象阻断和便携路径冲突；它不复用最多 800 文件的 UI 扫描清单。
- 服务端只发放 `original-readonly`、`built-in-demo`、`disposable-copy` 三类能力。客户端路径、模式、工作区 ID 或确认字段不能把原项目提升为可写。
- 副本创建使用签名 Preview、私有 copy-root owner claim、持久创建阶段、原子 rename、marker 和 exact-target 复验；pre-marker、post-marker、post-rename、恢复和首次激活都拒绝额外 excluded 内容。
- Cleanup 先持久预约再移入可证明所有权的 quarantine；同路径替换、未知 copy-root 条目、linked ancestor、linked source 和 linked Demo 均 fail closed。
- 所有 task-bound 读取、补丁 baseline、Apply/Revert 和命令都绑定 workspace ID 与 root identity；原路径替换成指向私有 state 的 junction 时不泄露内容。
- Git 工具不向父仓库发现，不执行外部 fsmonitor/ext diff；原项目的 Apply、Revert、Git 与项目命令保持禁止。
- UI 明确副本仍含普通源码、未匿名化、不代表适合分享，创建后也不会自动激活。

最终机器证据：`npm.cmd test` 为 246 total、245 pass、0 fail、1 个环境性 file-symlink skip；`npm.cmd run check` 通过（三语各 665 个 key，0 warning/failure）；health、smoke、`pilot:self`、`pilot:fixture`、`pilot:inbox`、`pilot:model` 全部通过，fake model 请求为 9，Demo/副本 fixture 恢复且源 fixture 未变化。

诚实边界：Node 路径 API 仍有极小 TOCTOU 窗口；未验证真实断电、异常文件系统、ACL/杀毒软件干预和真人副本使用。若 `.gitignore` 忽略其自身，该规则文件不会进入副本，因此不宣称原 ignore 规则快照会约束副本未来新建路径。浏览器插件缺少自动化 helper，像素、键盘、NVDA、高对比度和干净 Windows 验收仍为人工项。

当前正式状态：`Stage 3.0.14 machine verified and committed; Stage 4B in progress; remediation REMEDIATION_HOLD`。host-1 七项人工验收仍待完成，真人 tester-3 保持 `not scheduled`，真实原项目写入没有因此开放。

### 15.4 Stage 3.0.12 已完成的机器证据

当前状态是 `machine verified; committed`。已完成的实现包括：

- 所有模型操作统一为 `POST /api/model/preview -> 明确审核 -> POST /api/model/send`；放弃审核使用 `POST /api/model/cancel`。客户端 Preview 只提交 `operation` 与 `taskId`，目标、根目录、repo profile、上下文和配置由服务端权威状态推导。
- Preview 精确披露完整 UTF-8 请求正文、字节数、SHA-256、endpoint/channel/是否离开设备、数据类别，以及每个传输文件组件和传输字节；approval 同时绑定 task revision、workspace ID/root identity、Data Boundary Manifest digest/policy version、模型配置代次和 prepared request。
- approval 在网络调用前同步单次消费；并发双 Send 只有一个能执行，失败后不可重放。Cancel、TTL 到期和配置变化会释放 Preview，并 best-effort 覆写保留的请求缓冲；Send 前后复验 task、workspace、Manifest 和配置，阻断 TOCTOU 结果落盘。
- 在线 transport 仅允许 loopback 明文 HTTP；HTTPS 必须解析为公共地址，检查全部 DNS 结果、pin 并复验实际 remote address，禁止 redirect，限制超时与请求/响应大小并要求 JSON Content-Type。endpoint 不能嵌入凭据、query 或 fragment；响应回显 API key 时拒绝结果。
- API key 仅驻留进程内存，`model.json` 不再持久化凭据；损坏、未知、旧式带凭据配置启动时原子替换或改写为无凭据安全配置。TaskStore 使用 revision/CAS；context、model event 和 audit 只持久化最小元数据与 hash，patch proposal 与 model event 在同一次 CAS 中提交；旧 context/suggestion/model body 和旧 model/server-error audit detail 启动迁移清理。
- ignored Manifest 内容不会进入请求，也不再参与命令、框架、包管理器等派生仓库元数据。八个自动化脚本统一使用资源作用域，等待/强杀子进程、关闭 listener、恢复 fixture、验证临时目录身份后清理，并聚合工作错误与清理错误。

聚焦证据：Preview/UI/provider 测试 46/46，server model-outbound integration 8/8，automation finalizer 故障注入 8/8；八个受影响自动化脚本均已实跑通过，`pilot:model` 保持 9 次 fake-model 请求且 9 次 exact-body 检查通过。

最终全量门禁结果：

1. 单并发完整 `npm.cmd test` 为 319 total、318 pass、0 fail、1 个环境性 file-symlink skip；默认并发曾出现一次共享状态串扰，失败用例独立运行通过，最终权威结果采用隔离后的单并发全量回归。
2. `npm.cmd run check` 通过，三语各 714 个 key；health、smoke、`pilot:self`、`pilot:fixture`、`pilot:inbox`、`pilot:model`、real-repo preflight 和 first-trial simulation 全部通过，`pilot:model` 为 9 次 exact send。
3. 默认 `.codeclaw` 已完成启动迁移：26 个 task、59 个 context record，正文 0，当前 59 个 source 均为白名单内的 `read_file`；legacy suggestion entry 0；`model.json` 无凭据字段；model/server-error audit detail 均为空。`.codeclaw` 仍是本地状态，不进入 Git。
4. 14 个自动化 `%TEMP%` 前缀剩余数为 0，已知历史临时目录和 `server-bg.log` 已删除；4173 无监听，三个 example 无 diff，未保留一次性调试代码、测试开关或墓碑分支。
5. 最终 Git 审计与独立提交已由主线程完成；`dist/`、`.codeclaw/`、日志、截图、evidence 和真人记录均未进入提交，也未 push。

诚实边界：在线 provider 会收到用户审核过的请求正文，CodeClaw 无法控制其后续保留；本机 provider 仍通过 loopback HTTP 传输；JavaScript 缓冲覆写只是 best effort；本阶段未重新运行任何真实云模型，也未完成真人、像素、NVDA、高对比度或干净 Windows 验收。Manifest 最终复验与随后 TaskStore 原子 rename 不是一个文件系统原子快照，极端外部并发编辑仍可能留下过时补丁草案；Apply 的 baseline hash 复验会阻止它覆盖已变化文件，因此不得宣称完全关闭所有外部 TOCTOU。

### 15.5 Stage 3.0.13 已完成的机器证据

当前状态是 `machine verified; committed`。已完成的实现包括：

- 删除 Quick Start、旧 Guide 和 trial-host 产品路径，建立唯一的八步流程：`project -> preflight -> plan -> context -> patch -> workspace -> verify -> complete`。默认新手模式；高级模式只改变呈现，不进入请求或权限判断。
- 每一步都有语义 section、用途、读取/项目写入/联网/命令/本地状态五类影响说明；桌面侧栏 sticky，900/620/390px 有响应式契约，导航和步骤使用 `aria-current`，表单标签、单主状态区、focus-visible、reduced-motion、forced-colors 和 AA 主按钮对比度均有静态门禁。
- Demo 自动执行只读预检并显示计划、上下文读取数、写入 0、命令 0 回执；刷新工作区列表不会静默采用另一个标签页的 active copy，只有显式 Activate 才切换任务绑定。
- Apply、Verify、Complete 形成服务端权威顺序。verification 绑定完整 active patch-set digest；Verify 在同一项目锁内执行 recovery gate、命令前后 top-of-path 内容复核、命令和结果落盘；Complete 在同一锁内执行 recovery、内容、digest、时间、revision CAS 和最终 commit guard。Apply/Revert 会清除陈旧 verification/summary，Revert 重新打开任务；completed task 除 Revert 和纯查看外不能继续计划、模型、补丁或命令操作。
- 所有 stateful UI 响应绑定 workflow generation、路径、workspace、task ID 和单调 revision；路径/目标/工作区改变后，旧 scan/preflight/model/copy/memory/Apply/Revert/Verify/Complete 响应不会重新绑定错误目标。并发 scan 使用请求局部 profile/workspace。
- MemoryStore 改为进程内队列、跨实例文件锁和原子写；notes、完成摘要新增/删除不会互相丢失。启动在 patch recovery 前后依据 TaskStore 对账派生摘要，防止崩溃窗口复活已 Revert 的完成记录。
- 三语词典修复为每种 710 个同键；质量门禁拒绝连续问号、U+FFFD、缺少目标文字和占位符不一致。Apply 与 Revert 的项目写入边界已在运行时和 HTML fallback 中统一。

最终机器证据：

1. 独立红队复审未发现剩余 P0、High 或 Medium；聚焦模型/状态/写入/工作流回归 58/58，通过内容漂移、同路径叠加、Verify/Apply-Revert 竞态、Complete/Revert CAS、Memory 并发与前端乱序契约。
2. 单并发完整测试为 344 total、343 pass、0 fail、1 个环境性 file-symlink skip；`npm.cmd run check` 与 i18n 通过，三语各 710 个 key，0 warning/failure。
3. health、smoke、`pilot:self`、`pilot:fixture`、`pilot:inbox`、`pilot:model`、明确路径的 real-repo preflight 和 first-trial simulation 全部通过。只读 self pilot 不再伪造 Complete；两个副本写入 pilot 均 Verify 成功、恢复副本且源 fixture 未变化；模型 pilot 为 9 次 fake request。
4. 真实仓库预检明确 `writeAttempted:false`；模拟报告显示 Demo 恢复、真实仓库 0 写入、未确认 Apply/Verify 均被阻断。生成的两份 `dist` 模拟报告已在记录结果后删除，不进入 Git。

诚实边界：浏览器插件缺少必需的自动化 helper，因此没有宣称真实像素、完整键盘、NVDA 或 Windows 高对比度实测通过；静态响应式/无障碍契约不能代替真人主观清晰度。浏览器、模型和外部编辑仍存在无法完全消除的调度窗口，但权威服务端门禁会拒绝陈旧对象落盘或完成。真人测试继续暂停，host-1 人工验收仍未完成，故 remediation 保持 `REMEDIATION_HOLD`。

### 15.6 Stage 3.0.14 已完成的机器证据

当前状态是 `machine verified; committed`。已完成的实现包括：

- 测试 fixture 不再写仓库 `dist`，临时项目、状态目录、listener 和 server 统一登记并幂等清理；源契约门禁拒绝固定端口、未关闭服务以及没有可靠 cleanup 的临时目录。
- JSON 请求体、仓库遍历、文件/深度/摘要/Manifest/ignore 规则、上下文、ToolRegistry 读取/搜索/总字节/长行/结果序列化均有明确预算。可安全保留的超限结果用结构化 `partial`/`truncated` 与原因呈现；Data Boundary Manifest 则 fail closed，并在 stat 已知超限时于哈希 I/O 前拒绝。
- 敏感遍历复验目录父链身份；持续路径替换返回 `TRAVERSAL_PATH_CHANGED`。Node 没有 `openat` 风格 API，因此该复验是风险收窄，不是绝对消除外部 TOCTOU。
- OperationManager 提供全局/同类并发、deadline、显式取消、`running -> committing -> committed` 单向边界和有界 `waitForIdle`。Scan、Preflight、模型 Send、工具调用和 Verify 纳入统一管理；客户端断开可取消 running 操作，进入 commit 后不再接受迟到的用户取消，但仍受独立 commit deadline 约束。权威原子写完成后显式确认 committed，避免 deadline 与落盘完成重叠时出现“已保存却返回 504”。
- 服务收到 SIGINT/SIGTERM 后先停止接收新 API，再取消 running 操作：普通 running 清理最多等待 2.5 秒，已进入 commit 的操作按独立 10 秒 deadline 加 750 ms 余量完成；连接另有 1 秒收口，整体 13.25 秒强制退出上限。POSIX 使用独立进程组 TERM/KILL；Windows 使用参数化 `taskkill /PID /T /F` 路径并在无法验证后代终止时 fail closed。
- TaskStore、MemoryStore 和 AuditLog 均有文件/集合/条目增长上限与启动迁移；审计跨实例加锁、两代轮转并连接 rotation digest。活动补丁和恢复证据不会为满足普通历史上限而被自动删除。
- UI 为 Scan、Preflight、模型 Send 和 Verify 提供明确取消按钮和 active/cancelling/cancelled 状态；三语词典为每语种 723 个同键，0 warning/failure。

最终机器证据：默认 `npm.cmd test` 已限制为并发 4；最终有界全量为 398 total、394 pass、0 fail、4 个环境性 skip。单并发完整基线为 397/393/0/4，随后唯一新增的文件增长预算回归也以单并发通过。`npm.cmd run check`、health、i18n、UI/accessibility/workflow 静态契约及聚焦 operation/process/stable-directory/state/server 集成回归通过；在途模型显式取消、提交中的 SIGTERM 等待、审计写入故障、原子 preflight 和 Windows 瞬时锁竞争均由集成测试覆盖。取消场景没有保存成功模型结果，已确认的原子提交也不会因 deadline 竞态被误报为 504。

诚实边界：当前 Windows 沙箱拒绝真实 `taskkill /T`，相关后代树测试诚实 skip；父 wrapper 已退出后的可靠 Windows 后代归属仍可能需要 Job Object，不能宣称真实 Windows 进程树已验收。Node 缺少 `openat`，不能宣称所有目录替换竞态已关闭。真实断电、异常文件系统、真实大型项目主观等待感、像素、完整键盘、NVDA、高对比度、干净 Windows 10/11、非管理员账户、Defender/SmartScreen、默认浏览器和双击体验均未验收。真人测试继续暂停；tester-2 的 `AFTER_LIVE_BLOCKED`、remediation 的 `REMEDIATION_HOLD`、tester-3 `not scheduled` 和原项目只读边界保持不变。

最终 diff/Git/禁入项/临时产物审计与独立提交已完成；`dist/`、`.codeclaw/`、日志、截图、真人记录或证据包均未提交，也未保留临时测试代码或墓碑分支。当前进入 Stage 4B，不直接 push。
