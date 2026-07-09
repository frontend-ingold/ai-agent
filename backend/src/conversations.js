import fs from "fs";
import path from "path";
import crypto from "crypto";
import { CONVERSATIONS_DIR as DATA_DIR } from "./config.js";

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePathFor(id) {
    return path.join(DATA_DIR, `${id}.json`);
}

function titleFromMessage(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "New conversation";
    return clean.length > 50 ? `${clean.slice(0, 50)}...` : clean;
}

function readConversationFile(filename) {
    try {
        const raw = fs.readFileSync(path.join(DATA_DIR, filename), "utf-8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeConversation(conversation) {
    ensureDataDir();
    fs.writeFileSync(filePathFor(conversation.id), JSON.stringify(conversation, null, 2));
    return conversation;
}

export function createConversation() {
    const now = new Date().toISOString();
    return writeConversation({
        id: crypto.randomBytes(8).toString("hex"),
        title: "New conversation",
        messages: [],
        createdAt: now,
        updatedAt: now
    });
}

export function getConversation(id) {
    if (!id) return null;
    try {
        const raw = fs.readFileSync(filePathFor(id), "utf-8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// Appends a message and persists it. Auto-titles the conversation from the
// first user message, same idea as ChatGPT's history sidebar titles.
export function appendMessage(id, role, content) {
    let conversation = getConversation(id);

    if (!conversation) {
        const now = new Date().toISOString();
        conversation = { id, title: "New conversation", messages: [], createdAt: now, updatedAt: now };
    }

    conversation.messages.push({ role, content, createdAt: new Date().toISOString() });

    if (conversation.messages.length === 1 && role === "user") {
        conversation.title = titleFromMessage(content);
    }

    conversation.updatedAt = new Date().toISOString();
    return writeConversation(conversation);
}

// Returns plain {role, content} pairs (no timestamps) — the shape llm.js
// expects for message history.
export function getMessages(id, limit) {
    const conversation = getConversation(id);
    if (!conversation) return [];

    const messages = conversation.messages.map(({ role, content }) => ({ role, content }));
    return typeof limit === "number" ? messages.slice(-limit) : messages;
}

function summarize(conversation) {
    return {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length
    };
}

// For the history sidebar: metadata only, newest first.
export function listConversations() {
    ensureDataDir();
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

    return files
        .map(readConversationFile)
        .filter(Boolean)
        .map(summarize)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// Keyword search across title + message content, ChatGPT-style. Simple
// substring match — fine for a personal/local history, swap for a real
// index (e.g. SQLite FTS) if this ever needs to scale.
export function searchConversations(query) {
    const q = String(query || "").toLowerCase().trim();
    if (!q) return listConversations();

    ensureDataDir();
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

    return files
        .map(readConversationFile)
        .filter(Boolean)
        .filter((c) => {
            const titleMatch = c.title.toLowerCase().includes(q);
            const contentMatch = c.messages.some((m) => String(m.content || "").toLowerCase().includes(q));
            return titleMatch || contentMatch;
        })
        .map(summarize)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function deleteConversation(id) {
    try {
        fs.unlinkSync(filePathFor(id));
        return true;
    } catch {
        return false;
    }
}