import { generateObject } from 'ai';
import { IntentSchema, INTENT_SYSTEM_PROMPT } from '../core/intent_parser.ts';
import { getModel } from './provider.ts';

export interface SmokeResult {
  ok: boolean;
  failures: string[];
  latencyMs: number;
}

const SMOKE_CASES = [
  { prompt: 'buy BTC for $100', expect: { type: 'trade', action: 'buy', asset: 'BTC' } },
  { prompt: 'hello there', expect: { type: 'chat' } },
] as const;

export async function runSmokeTest(modelName: string): Promise<SmokeResult> {
  const failures: string[] = [];
  const start = Date.now();

  for (const tc of SMOKE_CASES) {
    try {
      const { object } = await generateObject({
        model: getModel(modelName),
        schema: IntentSchema,
        system: INTENT_SYSTEM_PROMPT,
        prompt: tc.prompt,
      });
      for (const [k, v] of Object.entries(tc.expect)) {
        if ((object as Record<string, unknown>)[k] !== v) {
          failures.push(`"${tc.prompt}": expected ${k}=${v}, got ${(object as Record<string, unknown>)[k]}`);
        }
      }
    } catch (err) {
      failures.push(`"${tc.prompt}": threw ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ok: failures.length === 0, failures, latencyMs: Date.now() - start };
}
