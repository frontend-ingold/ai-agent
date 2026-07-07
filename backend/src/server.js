import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";

import { agent, agentStream } from "./agent.js";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 10 * 1024 * 1024, // 10MB per file
        files: 10 // Max 10 files per request
    },
    fileFilter(req, file, cb) {
        // Allow image files
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error(`File type not allowed: ${file.mimetype}. Only image files are supported.`));
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
                message: "Please provide a message or upload at least one image." 
            });
        }

        if (files.length > 10) {
            cleanupFiles(files);
            return res.status(400).json({ 
                success: false, 
                message: "Maximum 10 files allowed per request." 
            });
        }

        console.log(`📁 Processing ${files.length} file(s) with message: "${message.substring(0, 50)}..."`);

        const result = await agent(message, files);
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
            res.status(400);
            res.write(JSON.stringify({ 
                success: false, 
                message: "Please provide a message or upload at least one image." 
            }));
            return res.end();
        }

        if (files.length > 10) {
            cleanupFiles(files);
            res.status(400);
            res.write(JSON.stringify({ 
                success: false, 
                message: "Maximum 10 files allowed per request." 
            }));
            return res.end();
        }

        console.log(`📁 Stream processing ${files.length} file(s) with message: "${message.substring(0, 50)}..."`);

        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        let finalMessage = "";

        const result = await agentStream(
            message,
            files,
            (chunk, full) => {
                finalMessage = full;
                res.write(chunk);
            },
            null
        );

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
