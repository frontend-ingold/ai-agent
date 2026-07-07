// src/planner.js

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

function looksLikeDatabase(message) {
  return /\b(database|customer|employee|order|product|sql)\b/i.test(message);
}

export async function plan(message) {

  const input = String(message ?? "").trim();

  if (!input) {
    return {
      action: "llm"
    };
  }

  // Calculator
  if (looksLikeCalculation(input)) {
    return {
      action: "tool",
      tool: "calculator",
      expression: extractExpression(input)
    };
  }

  // System Tool (Date/Time)
  if (looksLikeSystem(input)) {
    return {
      action: "tool",
      tool: "system",
      operation: "datetime"
    };
  }

  // Internet Search
  if (looksLikeSearch(input)) {
    return {
      action: "tool",
      tool: "search",
      query: input
    };
  }

  // Memory
  if (looksLikeMemory(input)) {
    return {
      action: "tool",
      tool: "memory",
      query: input
    };
  }

  // Database
  if (looksLikeDatabase(input)) {
    return {
      action: "tool",
      tool: "database",
      query: input
    };
  }

  // Default → LLM
  return {
    action: "llm"
  };

}