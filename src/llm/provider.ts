import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

export type LlmProvider = 'ollama' | 'lmstudio' | 'openrouter' | 'openai' | 'anthropic' | 'gemini';

export function detectProvider(): LlmProvider {
  const raw = process.env.LLM_PROVIDER?.toLowerCase();
  if (
    raw === 'ollama' || raw === 'lmstudio' ||
    raw === 'openai' || raw === 'anthropic' || raw === 'gemini'
  ) return raw as LlmProvider;
  return 'openrouter';
}

export function getModel(modelName: string): LanguageModel {
  const provider = detectProvider();

  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY! })(modelName);
    case 'anthropic':
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })(modelName);
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! })(modelName);
    case 'ollama':
      return createOpenAI({
        baseURL: (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434') + '/v1',
        apiKey: 'ollama',
        compatibility: 'compatible',
      })(modelName);
    case 'lmstudio':
      return createOpenAI({
        baseURL: process.env.LM_STUDIO_BASE_URL ?? 'http://localhost:1234/v1',
        apiKey: 'lmstudio',
        compatibility: 'compatible',
      })(modelName);
    default:
      return createOpenAI({
        baseURL: process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1',
        apiKey: process.env.LLM_API_KEY!,
        compatibility: 'compatible',
      })(modelName);
  }
}
