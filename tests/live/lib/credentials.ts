const variables = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
} as const;

export function apiKey(id: keyof typeof variables) {
  return process.env[variables[id]] || undefined;
}

export function chatGPTToken() {
  return process.env.CHATGPT_ACCESS_TOKEN || undefined;
}
