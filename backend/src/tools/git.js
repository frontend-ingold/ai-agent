import { runArgs } from "./shell.js";

export async function gitStatus() {
    const out = await runArgs("git", ["status", "--short"]);
    return { ...out, tool: "gitStatus" };
}

export async function gitDiff(relativePath = null) {
    const args = relativePath ? ["diff", "--", relativePath] : ["diff"];
    const out = await runArgs("git", args);
    return { ...out, tool: "gitDiff" };
}

export async function gitLog(limit = 10) {
    const out = await runArgs("git", ["log", `-${Number(limit) || 10}`, "--oneline"]);
    return { ...out, tool: "gitLog" };
}

// Write action — the agent loop requires confirmation before calling this.
export async function gitCommit(message) {
    if (!message || typeof message !== "string") {
        return { success: false, error: "Commit message is required." };
    }
    const out = await runArgs("git", ["commit", "-m", message]);
    return { ...out, tool: "gitCommit", requiresConfirmation: true };
}
