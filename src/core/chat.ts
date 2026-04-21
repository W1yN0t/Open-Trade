import { generateText } from 'ai';
import { Config } from '../config.ts';
import { getModel } from '../llm/provider.ts';
import type { PostgresStorage } from '../storage/postgres.ts';

export async function chat(userId: string, text: string, storage: PostgresStorage): Promise<string> {
  const history = await storage.getHistory(userId);
  const model = await storage.getUserModel(userId);

  const { text: response } = await generateText({
    model: getModel(model),
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
