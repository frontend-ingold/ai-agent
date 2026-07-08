import "dotenv/config";
import { Agent } from "undici";

const OLLAMA_URL = process.env.OLLAMA_URL;

// Node's built-in fetch (undici) kills any request that takes longer than
// 300s (5 min) by default via headersTimeout/bodyTimeout. Ollama streams
// can legitimately run longer than that, so we use a dedicated Agent with
// those timeouts disabled for calls to Ollama.
const noTimeoutAgent = new Agent({
    headersTimeout: 0,
    bodyTimeout: 0
});

const TEXT_MODEL = "llama3.2";
const VISION_MODEL = "qwen2.5vl";

function buildMessages(input, images = []) {
    let messages;

    if (Array.isArray(input)) {
        messages = [...input];
    } else {
        messages = [
            {
                role: "user",
                content: input
            }
        ];
    }

    // Process all uploaded images
    const base64Images = images.map((file) => {
        try {
            const data = file.buffer || file.data;
            if (data) {
                return Buffer.from(data).toString("base64");
            }
            if (file.path) {
                throw new Error("Disk-backed uploads are no longer supported in this path.");
            }
            throw new Error("Uploaded image has no readable data.");
        } catch (err) {
            console.error(`Failed to read image file ${file.originalname || file.filename || "unknown"}:`, err.message);
            throw new Error(`Failed to process image: ${file.originalname || file.filename}`);
        }
    });

    // Attach all images to the last message
    if (base64Images.length > 0) {
        const last = messages[messages.length - 1];
        last.images = base64Images;
        console.log(`✅ Attached ${base64Images.length} image(s) to message`);
    }

    return {
        messages,
        model: base64Images.length > 0 ? VISION_MODEL : TEXT_MODEL,
        imageCount: base64Images.length
    };
}

async function streamOllama(body, onToken = () => {}) {
    console.time("Ollama Fetch");

    try {
        const response = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body),
            dispatcher: noTimeoutAgent
        });

        console.timeEnd("Ollama Fetch");

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama API Error (${response.status}): ${errorText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullResponse = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;
                
                try {
                    const json = JSON.parse(line);
                    if (json.message?.content) {
                        fullResponse += json.message.content;
                        onToken(json.message.content, fullResponse);
                    }
                } catch (err) {
                    console.warn("Failed to parse Ollama response line:", line);
                }
            }
        }

        // Process remaining buffer
        if (buffer.trim()) {
            try {
                const json = JSON.parse(buffer);
                if (json.message?.content) {
                    fullResponse += json.message.content;
                    onToken(json.message.content, fullResponse);
                }
            } catch (err) {
                console.warn("Failed to parse final Ollama response:", buffer);
            }
        }

        return fullResponse || "No response generated";
    } catch (err) {
        console.error("Ollama streaming error:", err);
        throw err;
    }
}

// Previous defaults (num_predict: 200, no explicit num_ctx) capped every
// response to ~200 tokens and relied on Ollama's default context window
// (often 2048 tokens) — both are far too small for returning a full source
// file. These are the real ceilings; raise DEFAULT_NUM_PREDICT further if
// you're regularly editing large files.
const DEFAULT_NUM_PREDICT = 4096;
const DEFAULT_NUM_CTX = 8192;

export async function askLLM(input, images = [], optionOverrides = {}) {
    const files = Array.isArray(images) ? images : [];
    
    try {
        const { messages, model, imageCount } = buildMessages(input, files);
        
        const body = {
            model,
            messages,
            stream: true,
            keep_alive: "30m",
            options: {
                temperature: 0.2,
                num_predict: DEFAULT_NUM_PREDICT,
                num_ctx: DEFAULT_NUM_CTX,
                ...optionOverrides
            }
        };

        console.log("=================================");
        console.log("Model:", model);
        console.log("Messages:", messages.length);
        console.log("Images:", imageCount);
        console.log("Request Size:", JSON.stringify(body).length, "bytes");
        console.log("=================================");

        return await streamOllama(body);
    } catch (err) {
        console.error("Error in askLLM:", err);
        throw err;
    } finally {
        // Memory storage means there are no temp files to delete.
    }
}

export async function askLLMStream(input, images = [], onToken = () => {}, optionOverrides = {}) {
    const files = Array.isArray(images) ? images : [];
    
    try {
        const { messages, model, imageCount } = buildMessages(input, files);
        
        const body = {
            model,
            messages,
            stream: true,
            keep_alive: "30m",
            options: {
                temperature: 0.2,
                num_predict: DEFAULT_NUM_PREDICT,
                num_ctx: DEFAULT_NUM_CTX,
                ...optionOverrides
            }
        };

        console.log("=================================");
        console.log("Model:", model);
        console.log("Messages:", messages.length);
        console.log("Images:", imageCount);
        console.log("Request Size:", JSON.stringify(body).length, "bytes");
        console.log("=================================");

        return await streamOllama(body, onToken);
    } catch (err) {
        console.error("Error in askLLMStream:", err);
        throw err;
    } finally {
        // Memory storage means there are no temp files to delete.
    }
}
