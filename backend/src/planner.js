// src/planner.js
import { askLLM } from "./llm.js";
import { PLANNER_SYSTEM_PROMPT } from "./prompts/plannerPrompt.js";
import { hasOpenProject } from "./config.js";

// --- Fast, free, regex-based routing for the small set of intents where a
// keyword match is reliable and unambiguous. This avoids burning an LLM
// call on the common cases (and matches the original design). Anything
// that doesn't match one of these falls through to the LLM-based planner
// below, which handles open-ended coding requests. ---

function looksLikeCalculation(message) {
    return /(^|[\s(])[0-9+\-*/().^%\s]+([\s)]|$)/.test(message)
        && /[+\-*/^%]/.test(message);
}

function extractExpression(message) {
    const match = message.match(/[0-9+\-*/().^%\s]+/);
    return match ? match[0].trim() : "";
}

function looksLikeSystem(message) {
    return /\b(date|today|time|now|day|month|year)\b/i.test(message);
}

function looksLikeSearch(message) {
    return /\b(weather|temperature|news|latest|current weather|stock|price|score|who is|search|find|lookup|look up)\b/i.test(message);
}

function looksLikeMemory(message) {
    return /\b(memory|remember|recall|forget|what did i say|what have i said)\b/i.test(message);
}

function looksLikeSmallTalk(message) {
    // Deliberately narrow (exact-ish match, not a substring search) —
    // greeting phrasing is far more predictable than feature-request
    // phrasing, so this can be strict without risking false negatives on
    // real requests the way a broader "coding keywords" list would.
    return /^(hi|hello|hey+|yo|sup|good\s*(morning|afternoon|evening|night)|how\s*(are\s*you|'s\s*it\s*going)|thanks?( you)?|thx|ok(ay)?|cool|nice|great|bye|goodbye|see\s*ya|got\s*it)(\s+(there|guys?|team))?[\s!.,?]*$/i.test(message.trim());
}
function looksLikeGenericDatabase(message) {
    // Deliberately narrow now that "database" overlaps heavily with coding
    // vocabulary (queries about an app's DB schema/code should go to the
    // coding planner, not the toy database stub).
    return /\b(query the database|database record|customer database)\b/i.test(message);
}

// Lets the developer switch which local folder the agent operates on from
// chat itself, not just the sidebar's "Open" button — e.g. "project
// folder: C:\path\to\app", "open folder /home/me/app", "use this folder:
// ../my-project". Captures everything after the trigger phrase as the path.
const OPEN_PROJECT_REGEX = /^(?:project\s*folder|open\s*(?:folder|project)|use\s*(?:this\s*)?folder|set\s*(?:the\s*)?project\s*(?:root|folder))\s*(?:to)?\s*[:\-]?\s*(.+)$/i;

function extractProjectPath(message) {
    const match = message.trim().match(OPEN_PROJECT_REGEX);
    if (!match) return null;
    // Strips a trailing aside like "this one" or a trailing period, which
    // people naturally tack on when pointing at a path in chat.
    return match[1].replace(/\s*[.,]?\s*(this one|please|thanks)?\s*$/i, "").trim();
}

// Only route into the (expensive, multi-step) coding planner when the
// message plausibly involves the codebase. Everything else — greetings,
// small talk, general questions — should go straight to plain conversation.
function looksLikeCoding(message) {
    const codingKeywords = /\b(file|files|folder|director(y|ies)|repo|repository|function|method|class|variable|bug|error|exception|stack ?trace|refactor|test|tests|lint|git|commit|diff|branch|code|codebase|implement|fix|debug|script|module|import|export|endpoint|api|server|component|deploy)\b/i;
    const looksLikeAFilename = /[\w-]+\.(js|ts|jsx|tsx|py|json|css|html|md|yml|yaml|java|go|rb|php|c|cpp|h)\b/i;
    // Broader exploration/analysis phrasing ("analyze the project", "what
    // does this project do", "explain this codebase") — these don't use
    // narrow dev-jargon words above but still need listDir/readFile, not a
    // generic chat answer.
    const looksLikeProjectExploration = /\b(project|codebase|repo|application|app)\b.*\b(analy[sz]e|explain|understand|review|summar(y|ize)|explore|overview|walkthrough|what does|how does|structure)\b/i
        .test(message) || /\b(analy[sz]e|explain|understand|review|summar(y|ize)|explore|overview|walkthrough)\b.*\b(project|codebase|repo|application|app)\b/i.test(message);

    return codingKeywords.test(message) || looksLikeAFilename.test(message) || looksLikeProjectExploration;
}

export async function plan(message) {
    const input = String(message ?? "").trim();

    if (!input) {
        return { action: "llm" };
    }

    if (looksLikeCalculation(input)) {
        return { action: "tool", tool: "calculator", expression: extractExpression(input) };
    }

    if (looksLikeSystem(input)) {
        return { action: "tool", tool: "system", operation: "datetime" };
    }

    if (looksLikeMemory(input)) {
        return { action: "tool", tool: "memory" };
    }

    const projectPath = extractProjectPath(input);
    if (projectPath) {
        return { action: "tool", tool: "openProject", path: projectPath };
    }

    if (looksLikeGenericDatabase(input)) {
        return { action: "tool", tool: "database", query: input };
    }

    if (looksLikeSearch(input)) {
        return { action: "tool", tool: "search", query: input };
    }

    // Only hand off to the multi-step coding planner when the message
    // actually looks like it's about the codebase. Plain conversation
    // (greetings, general questions, etc.) goes straight to the LLM.
    if (looksLikeCoding(input)) {
        return { action: "delegate_to_llm_planner" };
    }

    // Once the developer has explicitly opened a project, anything that
    // wasn't caught above (calculator, date/time, memory, search, opening
    // a different folder) is almost certainly about that project — even
    // when phrased in product/UI terms with no dev jargon ("change the
    // start counting button to blue"). Regex keyword-matching alone can't
    // keep up with every way of describing a UI change, so once a project
    // is open we lean on the coding loop (which has real file access) by
    // default instead of falling back to a plain chat answer that has to
    // guess/hallucinate about code it's never seen.
    if (hasOpenProject() && !looksLikeSmallTalk(input)) {
        return { action: "delegate_to_llm_planner" };
    }

    return { action: "llm" };
}

// --- LLM-based planner for open-ended coding requests. Called once per
// iteration of the agent loop in agent.js, with the running history of
// steps taken so far. ---

function summarizeStep(step, i) {
    const resultPreview = step.result?.error
        ? `ERROR: ${step.result.error}`
        : JSON.stringify(step.result?.result ?? step.result, null, 2).slice(0, 1500);

    return `Step ${i + 1}: called tool "${step.tool}" with params ${JSON.stringify(step.params)}\nResult:\n${resultPreview}`;
}

const KNOWN_TOOLS = new Set([
    "listDir", "readFile", "codeSearch", "runTests", "runLint",
    "gitStatus", "gitDiff", "gitLog", "proposeWrite", "gitCommit"
]);

function extractJson(text) {
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        // model may have wrapped it in prose or fences — grab the first {...} block
        const match = trimmed.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch {
                return null;
            }
        }
        return null;
    }
}

export async function planNext(originalRequest, stepHistory = [], retry = false) {
    const historyText = stepHistory.length
        ? stepHistory.map(summarizeStep).join("\n\n")
        : "(no tools called yet)";

    const userPrompt = `Developer request:\n${originalRequest}\n\nSteps taken so far:\n${historyText}\n\nWhat is the next single action?`;

    const messages = [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
    ];

    if (retry) {
        messages.push({
            role: "user",
            content: 'Your last response did not match the required format. Reply with ONLY one JSON object: either {"action":"tool","tool":"...","params":{...}} or {"action":"final","message":"..."}. Nothing else.'
        });
    }

    let raw;
    try {
        raw = await askLLM(messages);
    } catch (err) {
        return { action: "final", message: `Planner error: ${err.message}` };
    }

    const parsed = extractJson(raw);

    if (!parsed || !parsed.action) {
        // Model didn't return usable JSON — treat its raw text as the final answer
        // rather than looping forever on unparseable output.
        return { action: "final", message: raw || "I couldn't determine a next step." };
    }

    if (parsed.action === "final") {
        return { action: "final", message: parsed.message ?? "" };
    }

    if (parsed.action === "tool" && parsed.tool && KNOWN_TOOLS.has(parsed.tool)) {
        return { action: "tool", tool: parsed.tool, params: parsed.params ?? {} };
    }

    // Got valid JSON, but not one of the two accepted shapes (e.g. the model
    // invented its own action name, or "tool" with no tool field). Give it
    // one retry with a stricter reminder before giving up.
    if (!retry) {
        return planNext(originalRequest, stepHistory, true);
    }

    // Still off-format after a retry — salvage whatever looks like a
    // message rather than surfacing raw internal state to the user.
    const salvaged = parsed.message ?? parsed.answer ?? parsed.response ?? parsed.content ?? parsed.text;
    if (typeof salvaged === "string" && salvaged.trim()) {
        return { action: "final", message: salvaged };
    }

    // Last resort: the request probably didn't have enough concrete detail
    // (no file, error, or repo state to act on). Ask for what's missing
    // instead of showing an internal planner error.
    return {
        action: "final",
        message: "I'd like to help, but I need a bit more detail — which file, error message, or behavior are you seeing? Once I know that I can look at the relevant code."
    };
}