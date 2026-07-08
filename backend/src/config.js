import path from "path";

// All file/shell/git tools are sandboxed to this directory. Nothing the
// agent does can read or write outside of it.
export const PROJECT_ROOT = process.env.PROJECT_ROOT
    ? path.resolve(process.env.PROJECT_ROOT)
    : process.cwd();

// Hard cap on how many tool-call iterations a single request can trigger.
// Prevents infinite loops (and runaway Ollama calls) if the model gets stuck.
export const MAX_AGENT_ITERATIONS = 8;

// Timeout for any shell-backed tool (tests, lint, git).
export const SHELL_TIMEOUT_MS = 60_000;

// Tools that modify state (disk writes, git commits) require an explicit
// confirmation round-trip before they execute. See agent.js.
export const WRITE_TOOLS = new Set(["commitWrite", "gitCommit"]);
