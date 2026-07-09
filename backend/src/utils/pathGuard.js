import path from "path";
import { getProjectRoot } from "../config.js";

// Resolves a relative path and throws if it would land outside the
// currently open project folder. This is the single choke point every file
// tool must go through — no tool should call fs.* directly with a
// user/LLM-supplied path.
export function resolveSafePath(relativePath) {
    const projectRoot = getProjectRoot();
    const cleaned = String(relativePath ?? "").trim() || ".";
    const resolved = path.resolve(projectRoot, cleaned);

    if (resolved !== projectRoot && !resolved.startsWith(projectRoot + path.sep)) {
        throw new Error(`Path escapes project root: "${relativePath}"`);
    }

    return resolved;
}   