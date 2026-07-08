import path from "path";
import { PROJECT_ROOT } from "../config.js";

// Resolves a relative path and throws if it would land outside PROJECT_ROOT.
// This is the single choke point every file tool must go through — no tool
// should call fs.* directly with a user/LLM-supplied path.
export function resolveSafePath(relativePath) {
    const cleaned = String(relativePath ?? "").trim() || ".";
    const resolved = path.resolve(PROJECT_ROOT, cleaned);

    if (resolved !== PROJECT_ROOT && !resolved.startsWith(PROJECT_ROOT + path.sep)) {
        throw new Error(`Path escapes project root: "${relativePath}"`);
    }

    return resolved;
}
