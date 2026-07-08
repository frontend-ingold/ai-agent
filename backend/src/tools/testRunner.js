import { runArgs } from "./shell.js";

// Fixed menu of known test runners rather than "run this arbitrary shell
// string" — the LLM can only pick a name from this list, not construct a
// command line itself.
const RUNNERS = {
    npm: ["npm", ["test", "--silent"]],
    jest: ["npx", ["jest"]],
    pytest: ["pytest", ["-q"]],
    vitest: ["npx", ["vitest", "run"]]
};

export async function runTests(runner = "npm") {
    const entry = RUNNERS[runner];
    if (!entry) {
        return {
            success: false,
            error: `Unknown test runner "${runner}". Supported: ${Object.keys(RUNNERS).join(", ")}`
        };
    }

    const [cmd, args] = entry;
    const out = await runArgs(cmd, args, { tolerateNonZeroExit: true });
    return { ...out, tool: "runTests" };
}
