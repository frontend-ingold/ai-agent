import { runArgs } from "./shell.js";

const LINTERS = {
    eslint: ["npx", ["eslint", ".", "--format", "compact"]],
    ruff: ["ruff", ["check", "."]],
    tsc: ["npx", ["tsc", "--noEmit"]]
};

// Signatures that mean "the linter itself couldn't run" (missing config,
// not installed, wrong project type) rather than "it ran and found issues
// in your code". runArgs's tolerateNonZeroExit treats both the same way
// (a non-zero exit is normal for a linter that found problems), which
// silently hides genuine setup failures as if linting had just succeeded
// with no output — this catches that case and surfaces it as a real error
// with the specific reason instead.
const FATAL_SIGNATURES = /couldn't find|could not find|cannot find module|command not found|no configuration found|is not recognized as an internal or external command/i;

export async function runLint(linter = "eslint") {
    const entry = LINTERS[linter];
    if (!entry) {
        return {
            success: false,
            error: `Unknown linter "${linter}". Supported: ${Object.keys(LINTERS).join(", ")}`
        };
    }

    const [cmd, args] = entry;
    const out = await runArgs(cmd, args, { tolerateNonZeroExit: true });

    const stderr = out.result?.stderr || "";
    if (out.success && stderr && FATAL_SIGNATURES.test(stderr)) {
        return {
            success: false,
            error: `Linter "${linter}" could not run — ${stderr.trim().split("\n").filter(Boolean).slice(0, 3).join(" ")}`,
            tool: "runLint"
        };
    }

    return { ...out, tool: "runLint" };
}