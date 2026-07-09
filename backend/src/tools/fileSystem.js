import fs from "fs/promises";
import path from "path";
import { resolveSafePath } from "../utils/pathGuard.js";


const MAX_FILE_BYTES = 200 * 1024; // keep file contents small enough for a prompt
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);

export async function readFile(relativePath) {
    try {
        const fullPath = resolveSafePath(relativePath);
        const stat = await fs.stat(fullPath);

        if (!stat.isFile()) {
            return { success: false, error: `Not a file: ${relativePath}` };
        }
        if (stat.size > MAX_FILE_BYTES) {
            return { success: false, error: `File too large (${stat.size} bytes, max ${MAX_FILE_BYTES}).` };
        }

        const content = await fs.readFile(fullPath, "utf-8");
        return { success: true, tool: "readFile", result: { path: relativePath, content } };
    } catch (err) {
        return { success: false, error: `Could not read file: ${err.message}` };
    }
}

export async function listDir(relativePath = ".") {
    try {
        const fullPath = resolveSafePath(relativePath);
        const entries = await fs.readdir(fullPath, { withFileTypes: true });

        const listing = entries
            .filter((e) => !IGNORED_DIRS.has(e.name))
            .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
            .sort();

        return { success: true, tool: "listDir", result: { path: relativePath, entries: listing } };
    } catch (err) {
        return { success: false, error: `Could not list directory: ${err.message}` };
    }
}

// Step 1 of writing: compute a diff-able proposal but touch nothing on disk.
// The agent loop surfaces this to the caller for confirmation.
export async function proposeWrite(relativePath, newContent) {
    try {
        const fullPath = resolveSafePath(relativePath);
        let oldContent = null;

        try {
            oldContent = await fs.readFile(fullPath, "utf-8");
        } catch {
            oldContent = null; // file doesn't exist yet — that's a valid "new file" proposal
        }

        return {
            success: true,
            tool: "proposeWrite",
            requiresConfirmation: true,
            result: {
                path: relativePath,
                isNewFile: oldContent === null,
                oldContent: oldContent ?? "",
                newContent
            }
        };
    } catch (err) {
        return { success: false, error: `Could not prepare write: ${err.message}` };
    }
}

// Step 2: only called after the caller has confirmed the proposal.
export async function commitWrite(relativePath, newContent) {
    try {
        const fullPath = resolveSafePath(relativePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, newContent, "utf-8");

        return {
            success: true,
            tool: "commitWrite",
            result: { path: relativePath, bytesWritten: Buffer.byteLength(newContent, "utf-8") }
        };
    } catch (err) {
        return { success: false, error: `Could not write file: ${err.message}` };
    }
}