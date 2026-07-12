export const REQUIRED_REMEDIATION_HOST_CHECKS = Object.freeze([
  "desktop-sticky-navigation",
  "narrow-layout",
  "saved-session-choice",
  "chinese-demo-patch",
  "preflight-read-only-explanation",
  "apply-verify-boundaries",
  "demo-apply-verify-revert"
]);

export function passedRemediationHostCheckIds(hostChecks) {
  return new Set((Array.isArray(hostChecks) ? hostChecks : [])
    .filter((item) => item?.status === "passed" && ["manual", "host-observed"].includes(item?.method))
    .map((item) => String(item.id || "").trim())
    .filter(Boolean));
}

export function hasAllRequiredRemediationHostChecks(hostChecks) {
  const passed = passedRemediationHostCheckIds(hostChecks);
  return REQUIRED_REMEDIATION_HOST_CHECKS.every((id) => passed.has(id));
}
