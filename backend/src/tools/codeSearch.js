import fs from "fs/promises";
import path from "path";
import { PROJECT_ROOT } from "../config.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const MAX_MATCHES = 50;
const MAX_FILES_SCANNED = 3000;
const MAX_MATCH_LINE_LEN = 200;

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function walk(dir, pattern, matches, scanned) {
    if (matches.length >= MAX_MATCHES || scanned.count >= MAX_FILES_SCANNED) return;

    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (matches.length >= MAX_MATCHES || scanned.count >= MAX_FILES_SCANNED) return;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            await walk(fullPath, pattern, matches, scanned);
            continue;
        }

        scanned.count++;
        try {
            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
                if (pattern.test(lines[i])) {
                    matches.push({
                        file: path.relative(PROJECT_ROOT, fullPath),
                        line: i + 1,
                        text: lines[i].trim().slice(0, MAX_MATCH_LINE_LEN)
                    });
                }
            }
        } catch {
            // binary or unreadable file — skip
        }
    }
}

export async function codeSearch(query) {
    if (!query || !String(query).trim()) {
        return { success: false, error: "Search query is required." };
    }

    try {
        const pattern = new RegExp(escapeRegex(query), "i");
        const matches = [];
        await walk(PROJECT_ROOT, pattern, matches, { count: 0 });

        return {
            success: true,
            tool: "codeSearch",
            result: { query, matchCount: matches.length, matches }
        };
    } catch (err) {
        return { success: false, error: `Search failed: ${err.message}` };
    }
}
