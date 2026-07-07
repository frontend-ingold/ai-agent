const DEFAULT_LIMIT = 20;

export const memory = [];

export function addMemory(role, content) {
  if (!content) {
    return;
  }

  memory.push({
    role,
    content,
    createdAt: new Date().toISOString()
  });

  if (memory.length > DEFAULT_LIMIT) {
    memory.splice(0, memory.length - DEFAULT_LIMIT);
  }
}

export function getMemory(limit = DEFAULT_LIMIT) {
  return memory.slice(-limit);
}

export function clearMemory() {
  memory.length = 0;
}
