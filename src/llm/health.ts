import { detectProvider, type LlmProvider } from './provider.ts';

const CLOUD_PROVIDERS: LlmProvider[] = ['openrouter', 'openai', 'anthropic', 'gemini'];

export async function checkLlmHealth(): Promise<void> {
  const provider = detectProvider();
  if (CLOUD_PROVIDERS.includes(provider)) return;

  const pingUrl =
    provider === 'ollama'
      ? (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434') + '/api/tags'
      : (process.env.LM_STUDIO_BASE_URL ?? 'http://localhost:1234') + '/v1/models';

  try {
    const res = await fetch(pingUrl, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`✅ ${provider} reachable at ${pingUrl}`);
  } catch {
    console.warn(`⚠️  ${provider} unreachable at ${pingUrl} — falling back to openrouter`);
    process.env.LLM_PROVIDER = 'openrouter';
  }
}
