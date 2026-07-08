import { search } from "./tools/search.js";
import { calculator } from "./tools/calculator.js";
import { database } from "./tools/database.js";
import { system } from "./tools/system.js";
import { readFile, listDir, proposeWrite, commitWrite } from "./tools/fileSystem.js";
import { runTests } from "./tools/testRunner.js";
import { runLint } from "./tools/lint.js";
import { gitStatus, gitDiff, gitLog, gitCommit } from "./tools/git.js";
import { codeSearch } from "./tools/codeSearch.js";
import { getMemory } from "./memory.js";
import { WRITE_TOOLS } from "./config.js";

export async function executeTool(step) {
    switch (step.tool) {
        // --- existing tools ---
        case "search":
            return await search(step.query);

        case "calculator":
            return await calculator(step.expression);

        case "system":
            return await system(step.operation);

        case "database":
            return await database(step.query);

        case "memory":
            // Was previously unimplemented (fell to "Unknown Tool"). Now it
            // actually reads back recent conversation history.
            return {
                success: true,
                tool: "memory",
                result: { recent: getMemory(step.limit ?? 20) }
            };

        // --- coding tools ---
        case "readFile":
            return await readFile(step.path);

        case "listDir":
            return await listDir(step.path);

        case "codeSearch":
            return await codeSearch(step.query);

        case "runTests":
            return await runTests(step.runner);

        case "runLint":
            return await runLint(step.linter);

        case "gitStatus":
            return await gitStatus();

        case "gitDiff":
            return await gitDiff(step.path ?? null);

        case "gitLog":
            return await gitLog(step.limit);

        // --- write tools: only ever called after confirmation by agent.js ---
        case "proposeWrite":
            return await proposeWrite(step.path, step.content);

        case "commitWrite":
            return await commitWrite(step.path, step.content);

        case "gitCommit":
            return await gitCommit(step.message);

        default:
            return { success: false, error: `Unknown Tool: "${step.tool}"` };
    }
}

export function isWriteTool(toolName) {
    return WRITE_TOOLS.has(toolName);
}
