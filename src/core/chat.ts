import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { Config } from '../config.ts';
import type { PostgresStorage } from '../storage/postgres.ts';

const openrouter = createOpenAI({
  baseURL: Config.llm.baseUrl,
  apiKey: Config.llm.apiKey,
  compatibility: 'compatible',
});

export async function chat(userId: string, text: string, storage: PostgresStorage): Promise<string> {
  const history = await storage.getHistory(userId);
  const model = await storage.getUserModel(userId);

  const { text: response } = await generateText({
    model: openrouter(model),
    messages: [
      { role: 'system', content: Config.llm.systemPrompt },
      ...history,
      { role: 'user', content: text },
    ],
  });

  await storage.addMessage(userId, 'user', text);
  await storage.addMessage(userId, 'assistant', response);

  return response;
}
