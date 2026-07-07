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

let attachments = [];
let activeAbortController = null;

addSystemMessage("How can I help today?");

button.addEventListener("click", sendMessage);
attach.addEventListener("click", () => fileInput.click());
clearButton.addEventListener("click", resetComposer);
newChatButton.addEventListener("click", () => {
    if (activeAbortController) activeAbortController.abort();
    messages.innerHTML = "";
    resetComposer();
    addSystemMessage("New conversation started.");
});

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
    meta.textContent = label;
    div.appendChild(meta);

    return div;
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
    target.innerHTML = marked.parse(text);
    messages.scrollTop = messages.scrollHeight;
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

        if (!response.ok || !response.body) {
            throw new Error("Streaming failed.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            textBuffer += decoder.decode(value, { stream: true });
            appendMarkdownStream(content, textBuffer);
        }
    } catch (err) {
        if (err.name === "AbortError") return;
        console.error(err);
        div.className = "message ai";
        content.innerHTML = `<div class="loading">Something went wrong.</div>`;
    } finally {
        activeAbortController = null;
    }
}