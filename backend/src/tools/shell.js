import { execFile } from "child_process";
import { promisify } from "util";
import { PROJECT_ROOT, SHELL_TIMEOUT_MS } from "../config.js";

const execFileAsync = promisify(execFile);

// Deliberately NOT a general "run any shell string" tool. There is no
// `exec`/shell:true anywhere here, so there's no shell-metacharacter
// injection surface (;, &&, backticks, $()...). Callers (git.js,
// testRunner.js, lint.js) pass a fixed binary name plus an argv array —
// the LLM never gets to construct an arbitrary command line, only fill in
// specific parameters (like a commit message) for a known operation.
export async function runArgs(cmd, args = [], { tolerateNonZeroExit = false } = {}) {
    try {
        const { stdout, stderr } = await execFileAsync(cmd, args, {
            cwd: PROJECT_ROOT,
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
