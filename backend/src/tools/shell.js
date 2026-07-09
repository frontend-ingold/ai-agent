import { execFile } from "child_process";
import { promisify } from "util";
import { getProjectRoot } from "../config.js";
import { SHELL_TIMEOUT_MS } from "../config.js";

const execFileAsync = promisify(execFile);

// On Windows, npm-installed CLIs (npx, npm, and anything they shim) are
// actually .cmd files, not .exe. execFile deliberately doesn't use a shell
// (that's what keeps this safe from injection — see the comment below), so
// it won't auto-resolve the .cmd extension the way a shell would, and
// fails with "spawn npx ENOENT" even though npx works fine from a normal
// terminal. Explicitly resolving to the .cmd form here fixes that without
// giving up the shell:false safety.
const WINDOWS_CMD_SHIMS = new Set(["npx", "npm"]);

function resolveCmd(cmd) {
    if (process.platform === "win32" && WINDOWS_CMD_SHIMS.has(cmd)) {
        return `${cmd}.cmd`;
    }
    return cmd;
}

// Deliberately NOT a general "run any shell string" tool. There is no
// `exec`/shell:true anywhere here, so there's no shell-metacharacter
// injection surface (;, &&, backticks, $()...). Callers (git.js,
// testRunner.js, lint.js) pass a fixed binary name plus an argv array —
// the LLM never gets to construct an arbitrary command line, only fill in
// specific parameters (like a commit message) for a known operation.
export async function runArgs(cmd, args = [], { tolerateNonZeroExit = false } = {}) {
    const resolvedCmd = resolveCmd(cmd);

    try {
        const { stdout, stderr } = await execFileAsync(resolvedCmd, args, {
            cwd: getProjectRoot(),
            timeout: SHELL_TIMEOUT_MS,
            maxBuffer: 5 * 1024 * 1024
        });

        return { success: true, result: { command: `${cmd} ${args.join(" ")}`, exitCode: 0, stdout, stderr } };
    } catch (err) {
        // Test runners and linters exit non-zero on failing tests/lint
        // findings — that's a normal, informative result, not a broken
        // tool. Only treat it as a hard failure when the caller hasn't
        // opted into tolerating it (e.g. git/file operations).
        if (tolerateNonZeroExit && typeof err.code === "number") {
            return {
                success: true,
                result: {
                    command: `${cmd} ${args.join(" ")}`,
                    exitCode: err.code,
                    stdout: err.stdout ?? "",
                    stderr: err.stderr ?? ""
                }
            };
        }

        return {
            success: false,
            error: `Command failed: ${err.message}`,
            result: { stdout: err.stdout, stderr: err.stderr }
        };
    }
}