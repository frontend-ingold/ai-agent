import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";

import { agent, agentStream, resumeAfterConfirmation } from "./agent.js";
import { getGeneratedFile } from "./fileStore.js";
import { listConversations, searchConversations, getConversation, deleteConversation } from "./conversations.js";
import { getProjectRoot, setProjectRoot, isAutoApplyEnabled, setAutoApply } from "./config.js";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Extensions treated as readable source/text — these get attached as inline
// text context (like a code review), not sent to the vision model.
const TEXT_FILE_EXTENSIONS = new Set([
    ".js", ".jsx", ".ts", ".tsx", ".html", ".htm", ".css", ".scss",
    ".json", ".md", ".txt", ".py", ".java", ".go", ".rb", ".php",
    ".c", ".cpp", ".h", ".yml", ".yaml", ".xml", ".csv", ".sql", ".sh"
]);

function isTextFile(filename) {
    return TEXT_FILE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 10 * 1024 * 1024, // 10MB per file
        files: 10 // Max 10 files per request
    },
    fileFilter(req, file, cb) {
        if (file.mimetype.startsWith("image/") || isTextFile(file.originalname)) {
            cb(null, true);
        } else {
            cb(new Error(`File type not allowed: ${file.mimetype || path.extname(file.originalname)}. Supported: images, and common code/text files (.js, .html, .css, .json, .py, etc.).`));
        }
    }
});

// With memory storage there are no temp files to clean up.
const cleanupFiles = () => {};

app.get("/", (req, res) => {
    res.json({ success: true, message: "AI Agent Server Running" });
});

app.post("/chat", upload.array("files", 10), async (req, res) => {
    const files = req.files || [];
    
    try {
        const message = req.body.message || "";

        // Validate input
        if (!message && files.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Please provide a message or upload at least one file." 
            });
        }

        if (files.length > 10) {
            cleanupFiles(files);
            return res.status(400).json({ 
                success: false, 
                message: "Maximum 10 files allowed per request." 
            });
        }

        const images = files.filter((f) => f.mimetype.startsWith("image/"));
        const codeFiles = files.filter((f) => isTextFile(f.originalname));

        console.log(`📁 Processing ${images.length} image(s), ${codeFiles.length} text file(s) with message: "${message.substring(0, 50)}..."`);

        const result = await agent(message, images, codeFiles, req.body.conversationId || null);
        res.json(result);
    } catch (err) {
        console.error("Error in /chat:", err);
        cleanupFiles(files);
        res.status(500).json({ success: false, message: err.message });
    }
});


app.post("/chat/stream", upload.array("files", 10), async (req, res) => {
    const files = req.files || [];
    
    try {
        const message = req.body.message || "";

        // Validate input
        if (!message && files.length === 0) {
            cleanupFiles(files);
            return res.status(400).json({ 
                success: false, 
                message: "Please provide a message or upload at least one file." 
            });
        }

        if (files.length > 10) {
            cleanupFiles(files);
            return res.status(400).json({ 
                success: false, 
                message: "Maximum 10 files allowed per request." 
            });
        }

        const images = files.filter((f) => f.mimetype.startsWith("image/"));
        const codeFiles = files.filter((f) => isTextFile(f.originalname));

        console.log(`📁 Stream processing ${images.length} image(s), ${codeFiles.length} text file(s) with message: "${message.substring(0, 50)}..."`);

        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        let finalMessage = "";
        let streamedAny = false;
        let conversationIdSent = false;

        const result = await agentStream(
            message,
            images,
            codeFiles,
            (chunk, full) => {
                streamedAny = true;
                finalMessage = full;
                res.write(chunk);
            },
            null,
            req.body.conversationId || null,
            (conversationId) => {
                if (conversationIdSent) return;
                conversationIdSent = true;
                res.write(`\u0001CONVERSATION_ID\u0001${conversationId}\u0001CONVERSATION_ID\u0001`);
            }
        );

        if (result.requiresConfirmation) {
            // The coding-agent loop paused before writing a file / committing.
            // Send a control payload the frontend can detect and render as an
            // approve/cancel card instead of markdown.
            const payload = JSON.stringify({
                confirmationId: result.confirmationId,
                proposedAction: result.proposedAction,
                message: result.message
            });
            res.write(`\u0001CONFIRM_ACTION\u0001${payload}\u0001CONFIRM_ACTION\u0001`);
        } else if (!streamedAny && result.message) {
            // The LLM-planner loop (coding requests) doesn't stream token-by-
            // token like askLLMStream does — write its final answer now so
            // the UI isn't left blank.
            res.write(result.message);
        }

        finalMessage = result.message || finalMessage;
        res.end();
    } catch (err) {
        console.error("Error in /chat/stream:", err);
        res.write(`\n\nError: ${err.message}`);
        res.end();
    } finally {
        cleanupFiles(files);
    }
});

// Approves or rejects a pending write action (file write, git commit) that
// the agent paused on. Body: { confirmationId, approve: true|false }
app.post("/chat/confirm", async (req, res) => {
    try {
        const { confirmationId, approve } = req.body || {};

        if (!confirmationId) {
            return res.status(400).json({ success: false, message: "confirmationId is required." });
        }

        const result = await resumeAfterConfirmation(confirmationId, Boolean(approve));
        res.json(result);
    } catch (err) {
        console.error("Error in /chat/confirm:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Returns the folder the coding-agent tools (readFile, listDir, shell,
// git, etc.) currently operate on.
app.get("/project", (req, res) => {
    res.json({ success: true, projectRoot: getProjectRoot() });
});

// Switches which local folder the coding-agent tools operate on — this is
// the "Open folder" action, like Cursor/Codex. Takes effect immediately for
// every subsequent tool call, no server restart needed. Body: { path }
app.post("/project", (req, res) => {
    try {
        const { path: newPath } = req.body || {};

        if (!newPath || !String(newPath).trim()) {
            return res.status(400).json({ success: false, message: "A folder path is required." });
        }

        const resolved = setProjectRoot(newPath);
        res.json({ success: true, projectRoot: resolved });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// Whether write tools (proposeWrite/commitWrite/gitCommit) execute
// immediately or pause for approval. Off by default.
app.get("/settings/auto-apply", (req, res) => {
    res.json({ success: true, autoApply: isAutoApplyEnabled() });
});

app.post("/settings/auto-apply", (req, res) => {
    const { enabled } = req.body || {};
    const result = setAutoApply(enabled);
    res.json({ success: true, autoApply: result });
});

// History sidebar: list all conversations (newest first), or filter with
// ?q= to search titles + message content, ChatGPT-style.
app.get("/conversations", (req, res) => {
    try {
        const q = req.query.q;
        const results = q ? searchConversations(q) : listConversations();
        res.json({ success: true, conversations: results });
    } catch (err) {
        console.error("Error in /conversations:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Reopen a past conversation to continue/reuse it — returns full message
// history, not just the summary the list endpoint gives.
app.get("/conversations/:id", (req, res) => {
    const conversation = getConversation(req.params.id);

    if (!conversation) {
        return res.status(404).json({ success: false, message: "Conversation not found." });
    }

    res.json({ success: true, conversation });
});

app.delete("/conversations/:id", (req, res) => {
    const deleted = deleteConversation(req.params.id);

    if (!deleted) {
        return res.status(404).json({ success: false, message: "Conversation not found." });
    }

    res.json({ success: true });
});

// Serves a full file generated on-demand for a large-file "download"
// request (see agent.js). Links expire after GENERATED_FILE_TTL_MS.
app.get("/download/:id", (req, res) => {
    const file = getGeneratedFile(req.params.id);

    if (!file) {
        return res.status(404).json({ success: false, message: "File not found or the link has expired." });
    }

    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.setHeader("Content-Type", `${file.mimeType}; charset=utf-8`);
    res.send(file.content);
});

// Error handling middleware for multer and custom errors
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
                success: false, 
                message: "File size exceeds 10MB limit." 
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ 
                success: false, 
                message: "Maximum 10 files allowed per request." 
            });
        }
        return res.status(400).json({ 
            success: false, 
            message: err.message 
        });
    }
    
    if (err.message && err.message.includes("Only image")) {
        return res.status(400).json({ 
            success: false, 
            message: err.message 
        });
    }

    console.error("Unhandled error:", err);
    res.status(500).json({ success: false, message: "Internal server error." });
});

app.use((req, res) => {
    res.status(404).json({ success: false, message: "Route not found." });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});