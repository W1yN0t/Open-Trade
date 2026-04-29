import { detectProvider, type LlmProvider } from './provider.ts';

const CLOUD_PROVIDERS: LlmProvider[] = ['openrouter', 'openai', 'anthropic', 'gemini'];

// `.env.example` advertises `LM_STUDIO_BASE_URL=http://localhost:1234/v1`,
// so we need to tolerate both forms — with and without the `/v1` suffix —
// and not double it when building the `/models` ping URL.
function lmStudioModelsUrl(): string {
  const raw = (process.env.LM_STUDIO_BASE_URL ?? 'http://localhost:1234/v1').replace(/\/+$/, '');
  const base = raw.endsWith('/v1') ? raw : `${raw}/v1`;
  return `${base}/models`;
}

export async function checkLlmHealth(): Promise<void> {
  const provider = detectProvider();
  if (CLOUD_PROVIDERS.includes(provider)) return;

  const pingUrl =
    provider === 'ollama'
      ? (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434') + '/api/tags'
      : lmStudioModelsUrl();

  try {
    const res = await fetch(pingUrl, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`✅ ${provider} reachable at ${pingUrl}`);
  } catch {
    console.warn(`⚠️  ${provider} unreachable at ${pingUrl} — falling back to openrouter`);
    process.env.LLM_PROVIDER = 'openrouter';
  }
}
