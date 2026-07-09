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

// --- Groq (fast path) ---
// Groq's LPU inference is dramatically faster than local Ollama for
// text-only requests. Vision requests still go straight to Ollama since
// the local vision model (qwen2.5vl) is what's configured/tested; Groq
// is only attempted for text-only calls, and only if a key is present.
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// Thrown when Groq itself is unavailable/blocked so callers can decide to
// fall back to Ollama. Anything else (a genuine bad request, etc.) is
// still thrown as a normal Error and will surface to the user as-is.
class GroqUnavailableError extends Error {
    constructor(status, message) {
        super(message);
        this.name = "GroqUnavailableError";
        this.status = status;
    }
}

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

// Groq uses the OpenAI-compatible chat/completions shape, not Ollama's.
// messages here are the same {role, content} pairs already built by
// buildMessages — Groq just needs max_tokens/temperature at the top level
// instead of nested under "options", and SSE ("data: {...}\n\n") framing
// instead of Ollama's newline-delimited JSON.
async function streamGroq(messages, onToken = () => {}, optionOverrides = {}) {
    console.time("Groq Fetch");

    // Groq's schema validation rejects any extra properties on a message
    // object (e.g. the "createdAt" field memory.js stores, or "images"
    // from buildMessages). Ollama ignores unknown fields; Groq does not —
    // so only role/content survive the trip over.
    const groqMessages = messages.map(({ role, content }) => ({ role, content }));

    let response;
    try {
        response = await fetch(GROQ_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: groqMessages,
                stream: true,
                temperature: optionOverrides.temperature ?? 0.2,
                max_tokens: optionOverrides.num_predict ?? DEFAULT_NUM_PREDICT
            })
        });
    } catch (err) {
        console.timeEnd("Groq Fetch");
        // Network-level failure (offline, DNS, etc.) — treat as unavailable.
        throw new GroqUnavailableError(0, `Groq request failed: ${err.message}`);
    }

    console.timeEnd("Groq Fetch");

    if (!response.ok) {
        const errorText = await response.text();
        // 429 = rate limited, 413 = request too large for the free-tier TPM
        // budget (a big HTML file can blow past Groq's 12k TPM cap in one
        // shot), 5xx = Groq-side outage. All three should fall back to
        // Ollama, which has no such per-minute token ceiling, rather than
        // fail the whole request.
        if (response.status === 429 || response.status === 413 || response.status >= 500) {
            throw new GroqUnavailableError(response.status, `Groq API Error (${response.status}): ${errorText}`);
        }
        // Anything else (400 bad request, 401 bad key, etc.) is a real
        // error worth surfacing rather than silently masking with Ollama.
        throw new Error(`Groq API Error (${response.status}): ${errorText}`);
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
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;

            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;

            try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                    fullResponse += delta;
                    onToken(delta, fullResponse);
                }
            } catch (err) {
                console.warn("Failed to parse Groq response line:", data);
            }
        }
    }

    return fullResponse || "No response generated";
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

        // Groq fast path: text-only, key configured. Vision requests
        // always go to Ollama (qwen2.5vl).
        if (imageCount === 0 && GROQ_API_KEY) {
            try {
                console.log("=================================");
                console.log("Provider: Groq (fast path)");
                console.log("Model:", GROQ_MODEL);
                console.log("Messages:", messages.length);
                console.log("=================================");

                return await streamGroq(messages, () => {}, optionOverrides);
            } catch (err) {
                if (err instanceof GroqUnavailableError) {
                    console.warn(`Groq unavailable (${err.status || "network"}), falling back to Ollama:`, err.message);
                } else {
                    throw err;
                }
            }
        }

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
        console.log("Provider: Ollama");
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

        // Groq fast path: text-only, key configured. Vision requests
        // always go to Ollama (qwen2.5vl). If Groq starts streaming and
        // then dies mid-stream, we can't cleanly "undo" partial tokens
        // already sent to onToken, so on a pre-stream failure (rate limit,
        // bad response, network error) we fall back and re-run cleanly
        // against Ollama instead of stitching two partial outputs together.
        if (imageCount === 0 && GROQ_API_KEY) {
            try {
                console.log("=================================");
                console.log("Provider: Groq (fast path, streaming)");
                console.log("Model:", GROQ_MODEL);
                console.log("Messages:", messages.length);
                console.log("=================================");

                return await streamGroq(messages, onToken, optionOverrides);
            } catch (err) {
                if (err instanceof GroqUnavailableError) {
                    console.warn(`Groq unavailable (${err.status || "network"}), falling back to Ollama:`, err.message);
                } else {
                    throw err;
                }
            }
        }

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
        console.log("Provider: Ollama");
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