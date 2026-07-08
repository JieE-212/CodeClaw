export const APP_NAME = "码爪 CodeClaw";
export const DEFAULT_PORT = Number.parseInt(process.env.CODECLAW_PORT || "4173", 10);
export const SKIPPED_DIRECTORIES = new Set([".git", ".hg", ".svn", ".codeclaw", "node_modules", "vendor", "dist", "build", "coverage", ".next", ".nuxt", ".turbo", ".cache", "target", "__pycache__"]);
export const SENSITIVE_FILE_PATTERNS = [/^\.env(\..*)?$/i, /.*\.pem$/i, /.*\.key$/i, /.*\.p12$/i, /.*id_rsa.*/i, /.*id_ed25519.*/i, /.*token.*/i, /.*secret.*/i];
export const TEXT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".css", ".html", ".py", ".toml", ".yaml", ".yml", ".rs", ".go", ".java", ".kt", ".cs", ".php", ".rb", ".sh", ".sql", ".xml", ".vue", ".svelte"]);
