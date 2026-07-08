import { runArgs } from "./shell.js";

const LINTERS = {
    eslint: ["npx", ["eslint", ".", "--format", "compact"]],
    ruff: ["ruff", ["check", "."]],
    tsc: ["npx", ["tsc", "--noEmit"]]
};

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
    return { ...out, tool: "runLint" };
}
