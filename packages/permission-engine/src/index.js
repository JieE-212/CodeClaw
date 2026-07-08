export const PermissionLevel = Object.freeze({
  CHAT: "L0_CHAT",
  READ: "L1_READ",
  WRITE: "L2_WRITE",
  COMMAND: "L3_COMMAND",
  NETWORK_OR_INSTALL: "L4_NETWORK_OR_INSTALL",
  GIT_PUBLISH: "L5_GIT_PUBLISH"
});

const TOOL_LEVELS = {
  chat: PermissionLevel.CHAT,
  list_files: PermissionLevel.READ,
  read_file: PermissionLevel.READ,
  search_code: PermissionLevel.READ,
  git_status: PermissionLevel.READ,
  git_diff: PermissionLevel.READ,
  write_patch: PermissionLevel.WRITE,
  write_file: PermissionLevel.WRITE,
  run_command: PermissionLevel.COMMAND,
  install_dependency: PermissionLevel.NETWORK_OR_INSTALL,
  git_commit: PermissionLevel.GIT_PUBLISH,
  git_push: PermissionLevel.GIT_PUBLISH
};

export function classifyToolCall(toolName, args = {}) {
  const level = TOOL_LEVELS[toolName] || PermissionLevel.COMMAND;
  return {
    toolName,
    level,
    requiresApproval: level !== PermissionLevel.CHAT && level !== PermissionLevel.READ,
    risk: describeRisk(level, args)
  };
}

export function describeRisk(level, args = {}) {
  if (level === PermissionLevel.CHAT) return "No repository access.";
  if (level === PermissionLevel.READ) return "Reads project context only.";
  if (level === PermissionLevel.WRITE) return `May modify workspace files${args.path ? `: ${args.path}` : ""}.`;
  if (level === PermissionLevel.COMMAND) return `May execute a local command${args.command ? `: ${args.command}` : ""}.`;
  if (level === PermissionLevel.NETWORK_OR_INSTALL) return "May install dependencies or access the network.";
  return "May publish repository changes or affect remote state.";
}

export function canAutoApprove(toolName) {
  return !classifyToolCall(toolName).requiresApproval;
}
