import { createOpenAiCompatibleEngine, createOpenAiCompatibleChat } from './openai-compatible.js';

// Groq expone una API compatible con OpenAI bajo /openai/v1.
const BASE_URL = 'https://api.groq.com/openai/v1';

export const transcribeChunk = createOpenAiCompatibleEngine({
  baseUrl: BASE_URL,
  providerName: 'Groq',
});

export const streamChat = createOpenAiCompatibleChat({
  baseUrl: BASE_URL,
  providerName: 'Groq',
});
