export function createTaskPlan(goal, repoProfile = {}) {
  const normalizedGoal = String(goal || "").trim();
  if (!normalizedGoal) return { title: "等待任务目标", confidence: "low", steps: [] };

  const intent = detectIntent(normalizedGoal);
  const baseSteps = [
    { id: "understand-goal", title: "理解目标", detail: "提取用户想完成的工程任务和验收标准。", tools: ["chat"] },
    { id: "collect-context", title: "收集仓库上下文", detail: contextDetail(repoProfile), tools: ["list_files", "search_code", "read_file"] }
  ];
  const verificationSteps = [
    { id: "review-diff", title: "展示变更和风险", detail: "在写入后展示 diff、影响文件和潜在风险。", tools: ["git_diff"] },
    { id: "verify", title: "运行验证", detail: verificationDetail(repoProfile), tools: ["run_command"] },
    { id: "summarize", title: "总结结果", detail: "输出完成情况、测试结果、后续建议，并写入任务日志。", tools: ["chat"] }
  ];

  return {
    title: titleForIntent(intent),
    intent,
    confidence: repoProfile.fileCount ? "medium" : "low",
    steps: [...baseSteps, ...stepsForIntent(intent), ...verificationSteps]
  };
}

function detectIntent(goal) {
  const lower = goal.toLowerCase();
  if (/test|测试|单元测试|覆盖/.test(lower)) return "add-tests";
  if (/bug|fix|修复|报错|error|失败|异常/.test(lower)) return "fix-bug";
  if (/review|评审|检查|风险/.test(lower)) return "review";
  if (/解释|理解|架构|结构|怎么启动|readme|overview/.test(lower)) return "explain";
  return "implementation";
}

function titleForIntent(intent) {
  return ({ "add-tests": "补充测试计划", "fix-bug": "缺陷修复计划", review: "代码评审计划", explain: "仓库理解计划", implementation: "开发任务计划" })[intent] || "开发任务计划";
}

function stepsForIntent(intent) {
  if (intent === "explain") return [{ id: "map-project", title: "生成项目地图", detail: "整理入口、关键模块、运行命令和主要数据流。", tools: ["read_file"] }];
  if (intent === "review") return [{ id: "inspect-diff", title: "检查当前变更", detail: "读取 git diff，识别风险、缺失测试和兼容性问题。", tools: ["git_diff", "read_file"] }];
  return [{ id: "propose-patch", title: intent === "add-tests" ? "生成测试补丁" : "生成代码补丁", detail: "根据现有代码风格准备最小可审查修改。", tools: ["write_patch"] }];
}

function contextDetail(repoProfile) {
  if (!repoProfile.fileCount) return "项目尚未扫描，先读取目录和关键文件。";
  const languages = repoProfile.languages?.map((item) => item.name).join("、") || "未知语言";
  return `项目已扫描 ${repoProfile.fileCount} 个文件，优先读取 ${languages} 相关上下文。`;
}

function verificationDetail(repoProfile) {
  const command = repoProfile.commands?.find((item) => item.name === "test")?.command;
  return command ? `优先运行项目测试命令：${command}` : "未识别到测试命令，先建议用户确认验证方式。";
}
