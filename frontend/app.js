// Use local backend when running the frontend locally, otherwise use the
// deployed Vercel API. Update DEPLOYED_API_URL if the backend URL changes.
const DEPLOYED_API_URL = "https://ai-agent-api.vercel.app";
const isLocalHost = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
const API_BASE_URL = isLocalHost ? "http://localhost:3000" : DEPLOYED_API_URL;

const messages = document.getElementById("messages");
const input = document.getElementById("message");
const preview = document.getElementById("preview");
const fileInput = document.getElementById("fileInput");
const attach = document.getElementById("attach");
const button = document.getElementById("send");
const clearButton = document.getElementById("clear");
const newChatButton = document.getElementById("newChat");
const historySearch = document.getElementById("historySearch");
const historyList = document.getElementById("historyList");
const projectPath = document.getElementById("projectPath");
const projectPathInput = document.getElementById("projectPathInput");
const openProjectBtn = document.getElementById("openProjectBtn");
const projectError = document.getElementById("projectError");
const autoApplyToggle = document.getElementById("autoApplyToggle");

let attachments = [];
let activeAbortController = null;
let conversationId = null; // null until the backend assigns one (first reply)

// Backend markdown links like "/download/<id>" are relative to the API
// origin, not wherever this frontend is hosted (localhost vs Vercel) — so
// any rendered download link needs the API base prefixed onto its href.
function fixDownloadLinks(html) {
    return html.replace(/href="\/download\//g, `href="${API_BASE_URL}/download/`);
}

addSystemMessage("How can I help today?");

button.addEventListener("click", sendMessage);
attach.addEventListener("click", () => fileInput.click());
clearButton.addEventListener("click", resetComposer);
newChatButton.addEventListener("click", startNewChat);

let historyDebounceTimer = null;
historySearch.addEventListener("input", () => {
    clearTimeout(historyDebounceTimer);
    historyDebounceTimer = setTimeout(() => fetchHistory(historySearch.value.trim()), 250);
});

openProjectBtn.addEventListener("click", openProject);
projectPathInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") openProject();
});

autoApplyToggle.addEventListener("change", async () => {
    try {
        const res = await fetch(`${API_BASE_URL}/settings/auto-apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: autoApplyToggle.checked }),
        });
        const data = await res.json();
        autoApplyToggle.checked = Boolean(data.autoApply);
        addSystemMessage(
            data.autoApply
                ? "Auto-apply is ON — file writes will happen without asking for approval."
                : "Auto-apply is OFF — file writes will ask for approval first."
        );
    } catch (err) {
        console.error("Failed to update auto-apply setting:", err);
        autoApplyToggle.checked = !autoApplyToggle.checked; // revert on failure
    }
});

async function fetchAutoApply() {
    try {
        const res = await fetch(`${API_BASE_URL}/settings/auto-apply`);
        const data = await res.json();
        autoApplyToggle.checked = Boolean(data.autoApply);
    } catch (err) {
        console.error("Failed to load auto-apply setting:", err);
    }
}

fetchHistory();
fetchProjectRoot();
fetchAutoApply();

input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 220) + "px";
});

input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

fileInput.addEventListener("change", (e) => {
    [...e.target.files].forEach(addAttachment);
});

input.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
        if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) addAttachment(file);
        }
    }
});

// Drag and drop support on textarea
input.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.style.opacity = "0.7";
});

input.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.style.opacity = "1";
});

input.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.style.opacity = "1";
    const files = e.dataTransfer?.files || [];
    [...files].forEach(addAttachment);
});

// Drag and drop support on composer
const composer = document.querySelector(".composer");
composer.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    composer.style.borderColor = "var(--accent)";
});

composer.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    composer.style.borderColor = "";
});

composer.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    composer.style.borderColor = "";
    const files = e.dataTransfer?.files || [];
    [...files].forEach(addAttachment);
});

function renderAttachment(file){

    const div = document.createElement("div");

    div.className = "attachment";

    let icon = "📄";

    if(file.type.startsWith("image/")) icon = "🖼️";
    else if(file.name.endsWith(".pdf")) icon = "📕";
    else if(file.name.endsWith(".docx")) icon = "📝";
    else if(file.name.endsWith(".xlsx")) icon = "📊";
    else if(file.name.endsWith(".zip")) icon = "📦";
    else if(file.name.endsWith(".mp3")) icon = "🎵";
    else if(file.name.endsWith(".mp4")) icon = "🎬";

    div.innerHTML = `${icon} ${file.name}`;

    preview.appendChild(div);

}

function resetComposer() {
    attachments = [];
    preview.innerHTML = "";
    fileInput.value = "";
    input.value = "";
    input.style.height = "52px";
}

function addAttachment(file) {
    if (!file) return;

    attachments.push(file);

    const wrapper = document.createElement("div");
    wrapper.className = "preview-item";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.innerHTML = "&times;";
    remove.className = "remove-image";
    remove.onclick = () => {
        attachments = attachments.filter((item) => item !== file);
        wrapper.remove();
    };

    // Check if file is an image
    if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(file);
        img.alt = file.name || "Attached image";
        wrapper.appendChild(img);
    } else {
        // For non-image files, show icon and filename
        const fileDisplay = document.createElement("div");
        fileDisplay.className = "file-preview";
        
        let icon = "📄";
        if (file.name.endsWith(".pdf")) icon = "📕";
        else if (file.name.endsWith(".docx")) icon = "📝";
        else if (file.name.endsWith(".xlsx")) icon = "📊";
        else if (file.name.endsWith(".zip")) icon = "📦";
        else if (file.name.endsWith(".mp3")) icon = "🎵";
        else if (file.name.endsWith(".mp4")) icon = "🎬";
        else if (file.name.endsWith(".html") || file.name.endsWith(".htm")) icon = "🌐";
        else if (file.name.endsWith(".js")) icon = "⚙️";
        else if (file.name.endsWith(".css")) icon = "🎨";
        else if (file.name.endsWith(".json")) icon = "⬚";
        
        fileDisplay.innerHTML = `<span style="font-size: 2rem;">${icon}</span><div style="font-size: 0.75rem; margin-top: 4px; word-break: break-word; text-align: center;">${file.name}</div>`;
        wrapper.appendChild(fileDisplay);
    }

    wrapper.appendChild(remove);
    preview.appendChild(wrapper);
}

function createMessageElement(type, label) {
    const div = document.createElement("article");
    div.className = `message ${type}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const metaLabel = document.createElement("span");
    metaLabel.className = "message-meta-label";
    metaLabel.textContent = label;
    meta.appendChild(metaLabel);

    div.appendChild(meta);

    return div;
}

// Adds a copy-to-clipboard icon into a message's meta row. getText is called
// at click time so it can copy the final text even if the message streamed
// in after this was attached.
function addCopyButton(div, getText) {
    const meta = div.querySelector(".message-meta");
    if (!meta || meta.querySelector(".copy-button")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-button";
    btn.title = "Copy response";
    btn.setAttribute("aria-label", "Copy response");
    btn.innerHTML = "&#128203;"; // 📋

    btn.addEventListener("click", async () => {
        const text = getText();
        if (!text) return;

        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error("Copy failed:", err);
            return;
        }

        btn.innerHTML = "&#9989;"; // ✅
        btn.classList.add("copied");
        setTimeout(() => {
            btn.innerHTML = "&#128203;";
            btn.classList.remove("copied");
        }, 1500);
    });

    meta.appendChild(btn);
}

function addUserMessage(text, images = []) {
    const div = createMessageElement("user", "You");

    if (images.length > 0) {
        const gallery = document.createElement("div");
        gallery.className = "chat-images";

        images.forEach((file) => {
            const img = document.createElement("img");
            img.src = URL.createObjectURL(file);
            img.className = "chat-image";
            img.alt = file.name || "Attached image";
            gallery.appendChild(img);
        });

        div.appendChild(gallery);
    }

    if (text) {
        const content = document.createElement("div");
        content.innerHTML = marked.parse(text);
        div.appendChild(content);
    }

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

function addSystemMessage(text) {
    const div = createMessageElement("system", "System");
    const content = document.createElement("div");
    content.textContent = text;
    div.appendChild(content);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    addCopyButton(div, () => text);
}

async function fetchProjectRoot() {
    try {
        const res = await fetch(`${API_BASE_URL}/project`);
        const data = await res.json();
        projectPath.textContent = data.projectRoot || "Not set";
    } catch (err) {
        console.error("Failed to load current project folder:", err);
        projectPath.textContent = "Unavailable";
    }
}

async function openProject() {
    const path = projectPathInput.value.trim();
    if (!path) return;

    projectError.textContent = "";
    openProjectBtn.disabled = true;
    openProjectBtn.textContent = "Opening...";

    try {
        const res = await fetch(`${API_BASE_URL}/project`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path }),
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.message || "Could not open that folder.");
        }

        projectPath.textContent = data.projectRoot;
        projectPathInput.value = "";
        addSystemMessage(`Opened project folder: ${data.projectRoot}`);
    } catch (err) {
        projectError.textContent = err.message;
    } finally {
        openProjectBtn.disabled = false;
        openProjectBtn.textContent = "Open";
    }
}

function startNewChat() {
    if (activeAbortController) activeAbortController.abort();
    conversationId = null;
    messages.innerHTML = "";
    resetComposer();
    addSystemMessage("New conversation started.");
    setActiveHistoryItem(null);
}

// Renders a past message (user or assistant) when reopening a conversation
// from history. Unlike addUserMessage, there's no image File object to show
// here — only the text placeholder the backend stored (e.g. "[2 images]").
function addStaticMessage(role, text) {
    const type = role === "user" ? "user" : "ai";
    const label = role === "user" ? "You" : "Assistant";
    const div = createMessageElement(type, label);
    const content = document.createElement("div");
    content.innerHTML = fixDownloadLinks(marked.parse(text || ""));
    div.appendChild(content);
    messages.appendChild(div);
    addCopyButton(div, () => text);
}

function loadConversationIntoUI(conversation) {
    if (activeAbortController) activeAbortController.abort();
    messages.innerHTML = "";
    conversationId = conversation.id;
    resetComposer();

    if (!conversation.messages || conversation.messages.length === 0) {
        addSystemMessage("How can I help today?");
    } else {
        conversation.messages.forEach((m) => addStaticMessage(m.role, m.content));
    }

    messages.scrollTop = messages.scrollHeight;
    setActiveHistoryItem(conversation.id);
}

async function openConversation(id) {
    try {
        const res = await fetch(`${API_BASE_URL}/conversations/${id}`);
        if (!res.ok) throw new Error("Conversation not found.");
        const data = await res.json();
        loadConversationIntoUI(data.conversation);
    } catch (err) {
        console.error("Failed to open conversation:", err);
    }
}

function setActiveHistoryItem(id) {
    [...historyList.querySelectorAll(".history-item")].forEach((el) => {
        el.classList.toggle("active", el.dataset.id === id);
    });
}

async function fetchHistory(query = "") {
    try {
        const url = query
            ? `${API_BASE_URL}/conversations?q=${encodeURIComponent(query)}`
            : `${API_BASE_URL}/conversations`;
        const res = await fetch(url);
        const data = await res.json();
        renderHistory(data.conversations || []);
    } catch (err) {
        console.error("Failed to load conversation history:", err);
    }
}

function renderHistory(conversations) {
    historyList.innerHTML = "";

    if (conversations.length === 0) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent = "No conversations yet.";
        historyList.appendChild(empty);
        return;
    }

    conversations.forEach((conv) => {
        const item = document.createElement("div");
        item.className = "history-item" + (conv.id === conversationId ? " active" : "");
        item.dataset.id = conv.id;

        const title = document.createElement("span");
        title.className = "history-item-title";
        title.textContent = conv.title || "New conversation";
        item.appendChild(title);

        const del = document.createElement("button");
        del.type = "button";
        del.className = "history-item-delete";
        del.innerHTML = "&times;";
        del.title = "Delete conversation";
        del.addEventListener("click", async (e) => {
            e.stopPropagation();
            try {
                await fetch(`${API_BASE_URL}/conversations/${conv.id}`, { method: "DELETE" });
            } catch (err) {
                console.error("Failed to delete conversation:", err);
            }
            if (conv.id === conversationId) startNewChat();
            fetchHistory(historySearch.value.trim());
        });
        item.appendChild(del);

        item.addEventListener("click", () => openConversation(conv.id));
        historyList.appendChild(item);
    });
}

function addStreamingMessage() {
    const div = createMessageElement("ai", "Assistant");
    const content = document.createElement("div");
    content.className = "stream-content";
    div.appendChild(content);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return { div, content };
}

function appendMarkdownStream(target, text) {
    target.innerHTML = fixDownloadLinks(marked.parse(text));
    messages.scrollTop = messages.scrollHeight;
}

// The backend writes this marker (instead of normal streamed text) when the
// coding agent wants to write a file or run a git commit and is waiting on
// human approval. Format: MARKER + JSON + MARKER.
const CONTROL_MARKER = "\u0001CONFIRM_ACTION\u0001";

// Sent as the very first thing on every /chat/stream response, before any
// real content, so the client knows which conversation to keep using for
// follow-up messages (see agent.js's onConversationId callback).
const CONVERSATION_ID_MARKER = "\u0001CONVERSATION_ID\u0001";

// Returns { id, rest }. id is null if the closing marker hasn't arrived
// yet (still buffering) — caller should wait for more chunks in that case.
function extractConversationId(buffer) {
    const body = buffer.slice(CONVERSATION_ID_MARKER.length);
    const endIdx = body.indexOf(CONVERSATION_ID_MARKER);
    if (endIdx === -1) return { id: null, rest: "" };
    return { id: body.slice(0, endIdx), rest: body.slice(endIdx + CONVERSATION_ID_MARKER.length) };
}

function parseControlPayload(buffer) {
    const body = buffer.slice(CONTROL_MARKER.length);
    const endIdx = body.indexOf(CONTROL_MARKER);
    const jsonText = endIdx === -1 ? body : body.slice(0, endIdx);

    try {
        return JSON.parse(jsonText);
    } catch {
        return null;
    }
}

function renderConfirmationCard(div, content, payload) {
    content.innerHTML = "";

    const text = document.createElement("div");
    text.className = "confirm-text";
    text.textContent = payload.message;
    content.appendChild(text);

    if (payload.proposedAction) {
        const actionLine = document.createElement("div");
        actionLine.className = "confirm-action";
        actionLine.innerHTML = `<code>${payload.proposedAction.tool}</code>`;
        content.appendChild(actionLine);
    }

    const buttonRow = document.createElement("div");
    buttonRow.className = "confirm-buttons";

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "confirm-approve";
    approveBtn.textContent = "Approve";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "confirm-cancel";
    cancelBtn.textContent = "Cancel";

    buttonRow.appendChild(approveBtn);
    buttonRow.appendChild(cancelBtn);
    content.appendChild(buttonRow);

    const respond = async (approve) => {
        approveBtn.disabled = true;
        cancelBtn.disabled = true;
        text.textContent = approve ? "Running..." : "Cancelling...";

        try {
            const res = await fetch(`${API_BASE_URL}/chat/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmationId: payload.confirmationId, approve }),
            });
            const result = await res.json();

            if (result.requiresConfirmation) {
                renderConfirmationCard(div, content, result); // chained confirmation
                return;
            }

            const finalText = result.message || "Done.";
            content.innerHTML = fixDownloadLinks(marked.parse(finalText));
            messages.scrollTop = messages.scrollHeight;
            addCopyButton(div, () => finalText);
            fetchHistory(historySearch.value.trim());
        } catch (err) {
            console.error(err);
            content.innerHTML = `<div class="loading">Something went wrong confirming this action.</div>`;
        }
    };

    approveBtn.addEventListener("click", () => respond(true));
    cancelBtn.addEventListener("click", () => respond(false));
}

// Downscale + recompress images client-side before upload so the vision
// model has far less pixel data to process (big speedup for large photos).
const MAX_IMAGE_DIMENSION = 1280; // longest side, in px
const IMAGE_QUALITY = 0.8; // JPEG quality (0-1)

function resizeImageIfNeeded(file) {
    return new Promise((resolve) => {
        // Only touch actual images; leave other file types untouched.
        if (!file.type.startsWith("image/")) {
            resolve(file);
            return;
        }

        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            const { width, height } = img;
            const longestSide = Math.max(width, height);

            // Already small enough — skip resizing, just send as-is.
            if (longestSide <= MAX_IMAGE_DIMENSION) {
                URL.revokeObjectURL(objectUrl);
                resolve(file);
                return;
            }

            const scale = MAX_IMAGE_DIMENSION / longestSide;
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(width * scale);
            canvas.height = Math.round(height * scale);

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            canvas.toBlob(
                (blob) => {
                    URL.revokeObjectURL(objectUrl);
                    if (!blob) {
                        resolve(file); // fallback to original on failure
                        return;
                    }
                    const resizedFile = new File(
                        [blob],
                        file.name.replace(/\.\w+$/, "") + ".jpg",
                        { type: "image/jpeg" }
                    );
                    resolve(resizedFile);
                },
                "image/jpeg",
                IMAGE_QUALITY
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file); // fallback to original if image fails to load
        };

        img.src = objectUrl;
    });
}

async function sendMessage() {
    const text = input.value.trim();

    if (!text && attachments.length === 0) return;

    addUserMessage(text, attachments);

    const pendingAttachments = [...attachments];
    resetComposer();

    const { div, content } = addStreamingMessage();
    activeAbortController = new AbortController();

    try {
        const form = new FormData();
        form.append("message", text);
        if (conversationId) form.append("conversationId", conversationId);

        const filesToSend = await Promise.all(
            pendingAttachments.map((file) => resizeImageIfNeeded(file))
        );

        filesToSend.forEach((file) => {
            form.append("files", file);
        });

        const response = await fetch(`${API_BASE_URL}/chat/stream`, {
            method: "POST",
            body: form,
            signal: activeAbortController.signal,
        });

        if (!response.ok) {
            let serverMessage = "Request failed.";
            try {
                const errBody = await response.json();
                serverMessage = errBody.message || serverMessage;
            } catch {
                // response wasn't JSON — fall back to the generic message
            }
            throw new Error(serverMessage);
        }

        if (!response.body) {
            throw new Error("Streaming failed: no response body.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";
        let isControlMessage = false;
        let conversationIdCaptured = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            textBuffer += decoder.decode(value, { stream: true });

            if (!conversationIdCaptured) {
                if (textBuffer.startsWith(CONVERSATION_ID_MARKER)) {
                    const { id, rest } = extractConversationId(textBuffer);
                    if (id === null) continue; // closing marker not arrived yet
                    conversationId = id;
                    conversationIdCaptured = true;
                    textBuffer = rest;
                } else if (CONVERSATION_ID_MARKER.startsWith(textBuffer) && textBuffer.length < CONVERSATION_ID_MARKER.length) {
                    continue; // still receiving the opening marker itself
                } else {
                    conversationIdCaptured = true; // no marker present, proceed as-is
                }
            }

            if (!isControlMessage && textBuffer.startsWith(CONTROL_MARKER)) {
                isControlMessage = true; // stop live-rendering, wait for the full payload
            }

            if (!isControlMessage) {
                appendMarkdownStream(content, textBuffer);
            }
        }

        if (isControlMessage) {
            const payload = parseControlPayload(textBuffer);
            if (payload) {
                renderConfirmationCard(div, content, payload);
            } else {
                content.innerHTML = `<div class="loading">Received an unexpected response.</div>`;
            }
        } else if (textBuffer) {
            addCopyButton(div, () => textBuffer);
        }

        fetchHistory(historySearch.value.trim());
    } catch (err) {
        if (err.name === "AbortError") return;
        console.error(err);
        div.className = "message ai";
        content.innerHTML = `<div class="loading">${err.message || "Something went wrong."}</div>`;
    } finally {
        activeAbortController = null;
    }
}