export const APP_NAME = "码爪 CodeClaw";
export const DEFAULT_PORT = Number.parseInt(process.env.CODECLAW_PORT || "4173", 10);
export const SKIPPED_DIRECTORIES = new Set([".git", ".hg", ".svn", ".codeclaw", "node_modules", "vendor", "dist", "build", "out", "coverage", ".next", ".nuxt", ".turbo", ".cache", ".gradle", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv", "venv", "target", "__pycache__"]);
export const SENSITIVE_DIRECTORIES = new Set([".aws", ".azure", ".gnupg", ".kube", ".ssh", ".secrets", "credentials"]);
export const SENSITIVE_FILE_NAMES = new Set([
  ".codeclaw",
  ".codeclaw-copy-root-owner.json",
  ".codeclaw-disposable-copy.json",
  ".git",
  ".git-credentials",
  ".hg",
  ".netrc",
  "_netrc",
  ".npmrc",
  ".pypirc",
  ".svn",
  ".token",
  "application_default_credentials.json",
  "client-secret.json",
  "client_secret.json",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secret.json",
  "secrets.json",
  "service-account-key.json",
  "service-account.json",
  "token.json",
  "tokens.json"
]);
export const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/i,
  /^id_(?:dsa|ecdsa|ed25519|rsa)(?:\..*)?$/i,
  /^(?:access[-_]?token|api[-_]?key|client[-_]?secret|credentials?|refresh[-_]?token|secrets?|service[-_]?account(?:[-_]?key)?|tokens?)\.(?:cfg|conf|ini|json|toml|txt|ya?ml)$/i,
  /\.(?:jks|key|keystore|p12|pfx|pem)$/i
];
export const TEXT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".css", ".html", ".py", ".toml", ".yaml", ".yml", ".rs", ".go", ".java", ".kt", ".cs", ".php", ".rb", ".sh", ".sql", ".xml", ".vue", ".svelte"]);
