# 码爪 CodeClaw

码爪 CodeClaw 是一个面向个人开发者和小团队的本地优先 AI 开发者助手。第一阶段目标是跑通这个闭环：选择本地 repo，扫描项目结构，生成任务计划，调用受控工具，展示结果并留下审计记录。

## 当前版本

这是 v0.1 工程胚胎，暂时不依赖第三方包，方便先跑起来：

- 本地 Web 工作台
- 仓库扫描 API
- 技术栈和命令识别
- Agent 计划生成
- 工具注册和权限分级
- 只读工具调用和安全写入
- 白名单验证命令执行
- 审计日志和最近事件展示
- 当前任务状态、工具调用和验证结果归档
- Mock / OpenAI-compatible 模型建议入口
- 模型上下文文件推荐和手动读取归档
- 补丁草案、审查应用和最近补丁回滚
- 崩溃安全的 Apply/Revert 写前日志、跨 state-dir 所有权 claim、启动恢复和冲突停写
- 原子文件替换、工作区/父目录实体身份绑定、任务状态串行写入和 Windows 路径别名防护
- OpenAI-compatible 结构化 JSON patch 解析
- 多文件 patch proposal 展示和应用
- 真实模型 patch 输出校验和失败原因提示
- 文件级补丁回滚选择
- 验证失败摘要和修复建议入口
- 任务引导 Stepper 和内置 Demo 快速入口
- 快速开始检查清单和首次使用空状态引导
- UI 只读预检和 Patch 安全闸门
- 主链路中文界面和可操作错误提示
- 模型配置成本提示：Flash 默认推荐，Pro 高成本确认
- 系统检查 API
- 本地项目记忆：项目画像、命令、用户备注和任务总结
- 启动时检测最近会话，由用户明确选择继续或全新开始；继续时恢复项目、任务和本地记忆
- 轻量 JS/TS 符号索引和更精确的上下文推荐
- `search_code` 返回命中行号、命中行和前后文
- Patch 风险摘要、文件级新增/删除统计和任务 Review 草稿
- 自动 smoke 和 CodeClaw 自身只读 pilot 试跑
- 一键本地健康检查脚本
- Windows 本地启动器和首次启动指南
- 本地试用包自动准备脚本
- 本地试用发包 readiness 检查脚本
- 本地第一轮试用模拟脚本
- 2-3 小时安全夜跑验证脚本
- 本地试用包清单和试用反馈模板
- 第一轮真实试用主持手册和邀请文案
- 拟人化试用者评审记录
- Codex 重启接续文档
- 发布形态决策文档：先本地 Web，后桌面壳，再考虑云端/小程序 companion
- 本地 fake OpenAI-compatible 模型契约 pilot
- 稍大 JS fixture 的多文件功能改动 pilot
- API / 状态流 fixture 的三文件功能改动 pilot
- 真实仓库只读预检脚本
- 真实本地模型人工试跑指南
- 真实模型试跑记录台账和问题分类表
- 基础测试

## Quickstart

在 Windows PowerShell 里建议使用 `npm.cmd`：

```bash
npm.cmd run dev
```

打开：<http://127.0.0.1:4173>

点击 `Demo` 会先运行只读预检；之后按 `Task guide` 依次完成计划、上下文、补丁、验证和完成。

再次打开页面且存在已保存会话时，CodeClaw 会先让用户明确选择“继续”或“全新开始”，不会自动把旧任务注入当前页面。选择继续后会恢复最近项目、任务和本地记忆；恢复的项目仍需重新运行 `Run preflight`，刷新扫描、上下文和 Patch 安全闸门后再继续改代码。选择“全新开始”或进入 Demo 时会使用干净的当前任务状态。

## 3 分钟试用路径

1. 在 PowerShell 里运行 `npm.cmd run dev`，打开 <http://127.0.0.1:4173>。
2. 点击 `Demo`。CodeClaw 会自动填入内置 demo 仓库、填入默认目标并运行只读预检。
3. 确认 `Read-only preflight` 通过，`Patch proposal` 里的闸门显示可以继续。
4. 按 `Task guide` 的 `Next` 依次推进：生成计划、选择上下文、读取文件、生成补丁。
5. 看到 patch proposal 后确认 `Apply`，再运行检测到的 `npm run test` 验证命令。
6. 验证通过后点击 `Complete task`，查看任务摘要、Review 草稿和 Audit 记录。

## 启动

```bash
npm run dev
```

打开：<http://127.0.0.1:4173>

Windows 试用用户也可以直接运行：

```text
start-codeclaw.cmd
```

启动指南见 [`docs/START_GUIDE.md`](docs/START_GUIDE.md)。

## 扫描仓库

```bash
npm run scan -- "C:\\path\\to\\repo"
```

## 测试

```bash
npm test
```

## Smoke 验证

```bash
npm.cmd run smoke
```

该命令会自动启动临时本地服务，扫描 `examples/demo-js`，生成并应用 mock patch，运行 `npm run test`，生成 Review 草稿，然后回滚补丁并确认 demo 文件已恢复。

## 本地健康检查

```bash
npm.cmd run health
```

该命令会自动启动临时本地服务，验证页面关键标记、mock 模型配置、只读预检、会话恢复和无写入行为。它不会修改真实项目文件。

## 本地试用包

```bash
npm.cmd run package:local-trial
```

该命令会在 `dist/CodeClaw-local-trial-YYYYMMDD` 准备一个可分享的本地试用文件夹，并自动排除 `.codeclaw`、日志、API key 配置、`node_modules`、构建产物和 git 元数据。分享前仍应先跑 `health`、`check` 和 `test`。

发给试用者前，推荐直接跑完整 readiness：

```bash
npm.cmd run trial:ready
```

它会自动跑 `health/check/test`、生成试用包、检查包内容卫生，并在生成包里再次验证 `check/health/test`，最后写出 `dist/TRIAL_READINESS_REPORT.json`。

没有外部试用者时，可以先跑模拟试用：

```bash
npm.cmd run trial:simulate
```

它会模拟第一轮安全试用路径：检查首屏标记、跑 Demo 只读预检、生成但不应用 Demo 补丁、跑一次真实项目只读预检，并写出 `dist/SIMULATED_FIRST_TRIAL_REPORT.md`。

晚上无人值守时，可以跑 2-3 小时安全夜跑：

```text
run-nightly-trial.cmd
```

或：

```bash
npm.cmd run nightly:trial
```

它会循环运行检查和模拟试用，不自动改代码，并把汇总写到 `dist/nightly-trial/YYYYMMDD-HHMMSS/summary.md`。说明见 [`docs/NIGHTLY_TRIAL.md`](docs/NIGHTLY_TRIAL.md)。

## 真实项目试跑

```bash
npm.cmd run pilot:self
```

该命令会扫描 CodeClaw 工程自身，创建只读任务，验证计划、上下文推荐、代码搜索和项目记忆，并确认关键源码文件未被修改。

## 模型契约试跑

```bash
npm.cmd run pilot:model
```

该命令会启动本地 fake OpenAI-compatible 服务，验证模型工作流契约：任务建议、上下文推荐、失败修复建议，以及真实模型 patch 契约中的好 JSON、坏 JSON、diff 冒充完整文件、缺字段、缺上下文和多文件 JSON。

## 稍大项目功能试跑

```bash
npm.cmd run pilot:fixture
```

该命令会扫描 `examples/task-board-js`，模拟一个真实功能改动：给任务列表新增 `priority` 过滤。流程会读取多个上下文文件，让 fake OpenAI-compatible 模型生成多文件完整 patch，应用补丁，运行 fixture 测试，生成 Review 草稿，然后回滚并确认 fixture 文件恢复。

## API / 状态流试跑

```bash
npm.cmd run pilot:inbox
```

该命令会扫描 `examples/support-inbox-js`，模拟更接近软件/APP 的状态流改动：给客服 inbox 的 API 查询和视图状态新增 `channel` 过滤。流程会生成三文件 patch，应用、验证、完成任务、回滚并确认 fixture 恢复。

## 真实仓库只读预检

```bash
npm.cmd run pilot:real:preflight -- "C:\\path\\to\\repo" "short trial goal"
```

该命令会用临时状态目录和 mock 模型扫描指定真实仓库，创建只读任务，生成计划、推荐上下文、读取候选文件并做一次代码搜索。它不会申请 patch、不会写文件、不会消耗真实模型额度。试用流程见 [`docs/REAL_REPO_TRIAL.md`](docs/REAL_REPO_TRIAL.md)。

## 真实本地模型人工试跑

自动契约通过后，可按 [`docs/LOCAL_MODEL_TRIAL.md`](docs/LOCAL_MODEL_TRIAL.md) 接入本地或自托管 OpenAI-compatible endpoint，记录 Ollama-style / OpenAI-compatible 模型在建议、上下文、patch、失败修复上的真实表现。

试跑结果统一沉淀到 [`docs/LOCAL_MODEL_TRIALS.md`](docs/LOCAL_MODEL_TRIALS.md)，用于比较不同模型、归类问题和决定下一步 prompt / parser / context / UI 改进。

## Demo

```bash
npm.cmd run dev
```

Open <http://127.0.0.1:4173>, click `Demo`, then follow the `Task guide`.

Demo walkthroughs are in [`docs/DEMOS.md`](docs/DEMOS.md).

真实项目试跑记录在 [`docs/PILOT_RUNS.md`](docs/PILOT_RUNS.md)。

真实本地模型人工试跑指南在 [`docs/LOCAL_MODEL_TRIAL.md`](docs/LOCAL_MODEL_TRIAL.md)。

阶段二模型供应商策略在 [`docs/MODEL_PROVIDER_STRATEGY.md`](docs/MODEL_PROVIDER_STRATEGY.md)。

真实模型试跑记录台账在 [`docs/LOCAL_MODEL_TRIALS.md`](docs/LOCAL_MODEL_TRIALS.md)。

真实仓库试用清单在 [`docs/REAL_REPO_TRIAL.md`](docs/REAL_REPO_TRIAL.md)。

发布前检查清单在 [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md)。

发布形态路线在 [`docs/RELEASE_STRATEGY.md`](docs/RELEASE_STRATEGY.md)。

Windows 本地启动指南在 [`docs/START_GUIDE.md`](docs/START_GUIDE.md)。

本地试用包清单在 [`docs/LOCAL_TRIAL_PACKAGE.md`](docs/LOCAL_TRIAL_PACKAGE.md)。

第一轮试用主持手册在 [`docs/FIRST_TRIAL_RUNBOOK.md`](docs/FIRST_TRIAL_RUNBOOK.md)。

拟人化试用者评审在 [`docs/PERSONA_TRIAL_REVIEW.md`](docs/PERSONA_TRIAL_REVIEW.md)。

夜跑验证说明在 [`docs/NIGHTLY_TRIAL.md`](docs/NIGHTLY_TRIAL.md)。

重启接续文档在 [`docs/HANDOFF_RESTART.md`](docs/HANDOFF_RESTART.md)。

试用邀请文案在 [`docs/TRIAL_INVITE_MESSAGE.md`](docs/TRIAL_INVITE_MESSAGE.md)。

试用反馈模板在 [`docs/TRIAL_FEEDBACK_TEMPLATE.md`](docs/TRIAL_FEEDBACK_TEMPLATE.md)。

## 当前工具能力

- `list_files` / `read_file` / `search_code`：只读工具，自动允许。
- `write_patch`：仅供事务 Apply/Revert 内部写入完整文件；必须携带有效事务 ID、已审查的工作区身份和父目录身份，拒绝通用工具 API 直接调用、敏感/忽略/受保护目录和越界路径。
- `run_command`：执行扫描识别出的命令，需要确认，返回 exit code、stdout、stderr、耗时和超时状态。
- 审计日志：扫描、计划生成、工具调用和验证命令会记录到本地 `.codeclaw/audit.jsonl`。
- 任务存储：生成计划会创建/更新当前任务，工具调用和验证结果会保存到 `.codeclaw/tasks.json`。
- 模型建议：默认使用 `mock` provider；也可配置 OpenAI-compatible `baseUrl`、`model` 和 `apiKey`，建议会保存到当前任务。
- 上下文选择：模型可推荐候选文件，用户读取后会作为 `contextFiles` 保存到当前任务。
- 补丁审查：模型可生成 patch proposal，用户确认后应用；最近一次补丁可回滚。
- 结构化补丁：真实模型可返回单文件 `{ path, content, summary }`，也可返回多文件 `{ summary, files: [{ path, content }] }`，CodeClaw 会解析为 patch proposal 并生成 diff。
- 补丁校验：真实模型输出必须是完整文件内容；diff、缺字段、未读上下文、不安全路径和无实际变化会被拒绝为不可应用 proposal。
- 失败修复：验证命令失败后会保存失败摘要，可请求模型给出下一步修复建议。
- 任务引导：`Task guide` 会按扫描、计划、上下文、补丁、验证、完成推动 MVP 闭环。
- 项目记忆：扫描后自动保存项目 profile 和命令；任务完成后自动保存任务总结；Memory 面板支持编辑项目备注。
- 上下文推荐：结合路径、摘要、基础符号和测试/源码关系给候选文件排序，并展示推荐原因。
- 代码搜索：`search_code` 返回每个文件的命中行、列号、命中行文本和前后文，便于定位。
- 审查体验：patch proposal 会显示文件数、新增/删除统计、测试/配置影响提示；任务完成后会保存可复用的 Review/PR 草稿。
- 试跑脚本：`smoke` 和 `pilot:self` 会使用临时状态目录，不污染默认 `.codeclaw`；仓库扫描会跳过 `.codeclaw` 本地状态。
- 模型契约：`pilot:model` 用本地 fake OpenAI-compatible server 验证 suggest、context、patch 和 failure-fix 工作流契约，不需要外网或真实 API key。
- 阶段三 fixture：`pilot:fixture` 用稍大的 `examples/task-board-js` 验证多模块扫描、多文件 patch、测试、Review 和回滚。
- 阶段三 inbox fixture：`pilot:inbox` 用 `examples/support-inbox-js` 验证 API 查询、视图状态、多文件 patch、测试、Review 和回滚。
- 真实仓库预检：`pilot:real:preflight` 对任意指定仓库做只读扫描、计划、上下文读取和搜索，作为进入真实写入试验前的安全门。
- 发布路线：优先做本地 Web 试用包，再做本地启动器/桌面壳；微信小程序更适合作为后续 companion，而不是第一版核心产品。
- 试用包：`docs/LOCAL_TRIAL_PACKAGE.md` 记录本地 trial package 应包含/排除的文件、验证命令、试用任务和停止条件。
- 试用包脚本：`npm.cmd run package:local-trial` 会生成干净的 `dist/CodeClaw-local-trial-YYYYMMDD` 文件夹和 `PACKAGE_MANIFEST.md`。

当前安全边界：Stage 3.0.10 的机器测试覆盖已知中断状态的恢复或 fail-closed，但不等于真实断电、杀毒软件占用、网络盘、自定义 Windows ACL 或真人项目写入已经验收。原项目继续按只读范围对待；写入实验只应在后续 Stage 3.0.11 登记并验证的无秘密可丢弃副本中进行。
- 发包检查：`npm.cmd run trial:ready` 会生成试用包、检查敏感文件排除、在包内复跑验证并输出 `dist/TRIAL_READINESS_REPORT.json`。
- 模拟试用：`npm.cmd run trial:simulate` 会扮演第一位安全路径试用者，输出 `dist/SIMULATED_FIRST_TRIAL_REPORT.md`。
- 夜跑验证：`npm.cmd run nightly:trial` 会跑 2.5 小时安全检查和模拟试用，输出 `dist/nightly-trial/.../summary.md`。
- 拟人化评审：`docs/PERSONA_TRIAL_REVIEW.md` 记录一人公司视角下的首次使用卡点、已修复问题和下一批 UX 候选。
- 重启接续：`docs/HANDOFF_RESTART.md` 记录当前阶段、最近夜跑结果、关键报告和下一步优化顺序。
- 第一轮试用：`docs/FIRST_TRIAL_RUNBOOK.md` 和 `docs/TRIAL_INVITE_MESSAGE.md` 支持一位外部试用者的 Demo + 真实项目只读预检闭环。
- 本地模型试跑：`docs/LOCAL_MODEL_TRIAL.md` 提供真实 OpenAI-compatible / Ollama-style endpoint 的人工配置、场景、记录模板和判定标准。
- 试跑台账：`docs/LOCAL_MODEL_TRIALS.md` 记录真实模型试跑结果、问题类型、严重度、归属和下一步动作。
