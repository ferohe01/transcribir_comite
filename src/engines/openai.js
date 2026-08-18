import { createOpenAiCompatibleEngine, createOpenAiCompatibleChat } from './openai-compatible.js';

const BASE_URL = 'https://api.openai.com/v1';

export const transcribeChunk = createOpenAiCompatibleEngine({
  baseUrl: BASE_URL,
  providerName: 'OpenAI',
});

export const streamChat = createOpenAiCompatibleChat({
  baseUrl: BASE_URL,
  providerName: 'OpenAI',
});
