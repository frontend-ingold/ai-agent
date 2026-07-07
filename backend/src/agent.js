import { askLLM, askLLMStream } from "./llm.js";
import { plan } from "./planner.js";
import { executeTool } from "./toolManager.js";
import { addMemory, getMemory } from "./memory.js";

export async function agent(message, images = []) {
    return runAgent(message, images);
}

export async function agentStream(message, images = [], onToken = () => {}, onStatus = () => {}) {
    return runAgent(message, images, onToken, onStatus);
}

async function runAgent(message, images = [], onToken = null, onStatus = null) {
    const input = String(message ?? "").trim();

    // Validate input - must have either message or images
    if (!input && images.length === 0) {
        return { success: false, message: "Please enter a message or attach an image." };
    }

    // Add context about images to memory if present
    const memoryMessage = input || `[${images.length} image${images.length > 1 ? 's' : ''}]`;
    addMemory("user", memoryMessage);

    const emit = typeof onToken === "function" ? onToken : null;
    const status = typeof onStatus === "function" ? onStatus : null;

    const respond = emit
        ? async (prompt, imageFiles = []) => askLLMStream(prompt, imageFiles, emit)
        : async (prompt, imageFiles = []) => askLLM(prompt, imageFiles);

    // If images are provided, process them first
    if (images.length > 0) {
        console.log(`🖼️  Processing ${images.length} image(s)...`);
        
        const prompt = input || `Describe these ${images.length} image${images.length > 1 ? 's' : ''}.`;
        
        if (status) status("Analyzing images");
        const answer = await respond(prompt, images);
        addMemory("assistant", answer);
        return { success: true, message: answer };
    }

    // Text-only flow with planning and tools
    if (status) status("Planning");
    const nextStep = await plan(input);

    // If tool execution is needed
    if (nextStep.action === "tool") {
        if (status) status("Using tool");
        const toolResult = await executeTool(nextStep);

        let answer = "";

        if (!toolResult.success) {
            answer = toolResult.error || "Tool execution failed.";
            addMemory("assistant", answer);
            return { success: true, message: answer };
        }

        const prompt = `
You are an AI assistant.

The following data comes from a trusted tool.

Answer ONLY using this information.

Do not say that you don't have real-time information.

User Question:

${input}

--------------------------------------------

Tool Result:

${JSON.stringify(toolResult.result, null, 2)}

--------------------------------------------

Provide a clear answer.
`;
        if (status) status("Generating");
        answer = await respond(prompt);
        addMemory("assistant", answer);
        return { success: true, message: answer };
    }

    // Standard conversation flow
    if (status) status("Generating");
    const history = getMemory().slice(-6);
    const answer = await respond(history);
    addMemory("assistant", answer);
    return { success: true, message: answer };
}