import path from "path";
import fs from "fs";

// All file/shell/git tools are sandboxed to this directory. Nothing the
// agent does can read or write outside of it.
//
// This used to be a fixed `export const` set once from the PROJECT_ROOT env
// var at startup. It's now a getter/setter pair so the "open folder" flow
// (see server.js's POST /project) can switch it at runtime without
// restarting the server — closer to how Cursor/Codex let you open a
// different project folder from within the app itself.
let currentProjectRoot = process.env.PROJECT_ROOT
    ? path.resolve(process.env.PROJECT_ROOT)
    : process.cwd();

// True only once the developer has explicitly opened a folder (via chat or
// the sidebar's Open button) — as opposed to the default fallback (the
// backend's own cwd, which nobody actually asked to work on). See
// planner.js: once a real project is open, ambiguous requests should lean
// toward "this is about my project" rather than defaulting to plain chat.
let projectHasBeenOpened = Boolean(process.env.PROJECT_ROOT);

export function getProjectRoot() {
    return currentProjectRoot;
}

export function hasOpenProject() {
    return projectHasBeenOpened;
}

// Controls whether write tools (proposeWrite/commitWrite/gitCommit) pause
// for human approval or execute immediately. Off by default — writing to
// disk without confirmation is a real risk, so this has to be explicitly
// turned on, either via env var or the sidebar toggle (see server.js's
// /settings/auto-apply route).
let autoApplyEnabled = process.env.AUTO_APPLY === "true";

export function isAutoApplyEnabled() {
    return autoApplyEnabled;
}

export function setAutoApply(enabled) {
    autoApplyEnabled = Boolean(enabled);
    return autoApplyEnabled;
}

// Validates the folder exists and is actually a directory before switching
// — a bad path here would otherwise silently sandbox every tool call to a
// path that doesn't exist.
export function setProjectRoot(newRoot) {
    const resolved = path.resolve(String(newRoot ?? "").trim());

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error(`Not a valid directory: ${resolved}`);
    }

    currentProjectRoot = resolved;
    projectHasBeenOpened = true;
    return currentProjectRoot;
}

// Hard cap on how many tool-call iterations a single request can trigger.
// Prevents infinite loops (and runaway Ollama calls) if the model gets stuck.
export const MAX_AGENT_ITERATIONS = 8;

// Timeout for any shell-backed tool (tests, lint, git).
export const SHELL_TIMEOUT_MS = 60_000;

// Tools that modify state (disk writes, git commits) require an explicit
// confirmation round-trip before they execute. See agent.js.
export const WRITE_TOOLS = new Set(["commitWrite", "gitCommit"]);

// Uploaded code/text files bigger than either threshold get a diff-only
// response instead of the full rewritten file dumped into chat (see
// agent.js's codeFiles handling). The full file is only generated, saved,
// and made downloadable when the developer actually asks for it.
export const LARGE_FILE_CHAR_THRESHOLD = 3000;
export const LARGE_FILE_LINE_THRESHOLD = 150;

// How long a generated full-file download stays available before it's
// evicted from the in-memory store (see fileStore.js).
export const GENERATED_FILE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Where conversation history is persisted, one JSON file per conversation.
// Lives alongside the app's own code, NOT under PROJECT_ROOT — PROJECT_ROOT
// is the user's project the coding tools operate on, this is the app's own
// storage and shouldn't mix with it.
export const CONVERSATIONS_DIR = path.join(process.cwd(), "data", "conversations");