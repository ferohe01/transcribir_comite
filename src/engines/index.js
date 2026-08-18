import * as groq from './groq.js';
import * as openai from './openai.js';
import * as gemini from './gemini.js';

const ENGINES = { groq, openai, gemini };

export function getEngine(name) {
  const engine = ENGINES[name];
  if (!engine) throw new Error(`Motor desconocido: ${name}`);
  return engine;
}

export { mapWithConcurrency } from './http.js';
