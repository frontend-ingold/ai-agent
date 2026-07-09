import crypto from "crypto";
import { GENERATED_FILE_TTL_MS } from "./config.js";

// Holds full files generated on-demand (see agent.js's "download" intent
// handling for large uploaded files). In-memory only, matching the rest of
// this project's memory model — swap for a real store/S3/etc. if this needs
// to survive a server restart or serve multiple concurrent users safely.
const files = new Map();

export function saveGeneratedFile(filename, content, mimeType = "text/plain") {
    const id = crypto.randomBytes(6).toString("hex");
    files.set(id, { filename, content, mimeType, createdAt: Date.now() });
    return id;
}

export function getGeneratedFile(id) {
    const entry = files.get(id);
    if (!entry) return null;

    if (Date.now() - entry.createdAt > GENERATED_FILE_TTL_MS) {
        files.delete(id);
        return null;
    }

    return entry;
}