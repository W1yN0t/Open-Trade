import Enquirer from 'enquirer';
import { PrismaClient } from '@prisma/client';
import { runSmokeTest } from '../../llm/smoke_test.ts';
import { success, error, c } from '../ui.ts';

const OPERATOR_ID = process.env.OPERATOR_USER_ID ?? 'operator';

export async function cmdModels(flags: string[]): Promise<void> {
  const useLmStudio = flags.includes('--lmstudio');

  if (useLmStudio) {
    const base = process.env.LM_STUDIO_BASE_URL ?? 'http://localhost:1234';
    let res: Response;
    try {
      res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(3000) });
    } catch {
      error(`LM Studio unreachable at ${base}`); return;
    }
    if (!res.ok) { error(`LM Studio returned HTTP ${res.status}`); return; }
    const data = await res.json() as { data: Array<{ id: string }> };
    if (!data.data?.length) { console.log(c.dim('  No models loaded in LM Studio.')); return; }
    console.log('');
    console.log(c.bold('  LM Studio loaded models'));
    for (const m of data.data) console.log(`  ${c.green('●')}  ${m.id}`);
    console.log('');
    return;
  }

  const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  let res: Response;
  try {
    res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
  } catch {
    error(`Ollama unreachable at ${base}`); return;
  }
  if (!res.ok) { error(`Ollama returned HTTP ${res.status}`); return; }
  const data = await res.json() as { models: Array<{ name: string; size: number; details?: { quantization_level?: string } }> };
  if (!data.models?.length) { console.log(c.dim('  No models installed in Ollama.')); return; }

  console.log('');
  console.log(c.bold('  Ollama installed models'));
  for (const m of data.models) {
    const gb = (m.size / 1e9).toFixed(1);
    const quant = m.details?.quantization_level ?? '?';
    console.log(`  ${c.green('●')}  ${c.cyan(m.name.padEnd(40))}  ${c.dim(gb + ' GB')}  ${c.dim('[' + quant + ']')}`);
  }
  console.log('');
}

export async function cmdModelUse(modelName: string | undefined, prisma: PrismaClient): Promise<void> {
  if (!modelName) {
    const { value } = await (new (Enquirer as any)()).prompt({
      type: 'input',
      name: 'value',
      message: 'Model name',
      hint: 'e.g. llama3.2 or anthropic/claude-3-5-sonnet',
    }) as { value: string };
    modelName = value.trim();
  }

  console.log(c.dim(`  Running smoke test for "${modelName}"...`));
  const result = await runSmokeTest(modelName);

  if (!result.ok) {
    error(`Smoke test failed (${result.latencyMs}ms)`);
    for (const f of result.failures) console.log(`   ${c.red(f)}`);
    console.log(c.dim('  Model NOT activated.'));
    return;
  }

  success(`Smoke test passed (${result.latencyMs}ms)`);
  await prisma.userSettings.upsert({
    where: { userId: OPERATOR_ID },
    update: { model: modelName },
    create: { userId: OPERATOR_ID, model: modelName },
  });
  success(`Active model set to "${modelName}"`);
}

export async function cmdModelPull(modelName: string | undefined): Promise<void> {
  if (!modelName) {
    const { value } = await (new (Enquirer as any)()).prompt({
      type: 'input',
      name: 'value',
      message: 'Model name to pull',
      hint: 'e.g. llama3.2',
    }) as { value: string };
    modelName = value.trim();
  }

  const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  console.log(c.dim(`  Pulling "${modelName}" from Ollama at ${base}...`));

  let res: Response;
  try {
    res = await fetch(`${base}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
      signal: AbortSignal.timeout(600_000),
    });
  } catch (err) {
    error(`Ollama unreachable: ${err instanceof Error ? err.message : String(err)}`); return;
  }

  if (!res.ok || !res.body) { error(`Failed to start pull: HTTP ${res.status}`); return; }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { status: string; completed?: number; total?: number };
        if (obj.total && obj.completed) {
          const pct = Math.round((obj.completed / obj.total) * 100);
          process.stdout.write(`\r  ${c.cyan(obj.status)}  ${c.bold(pct + '%')}   `);
        } else {
          process.stdout.write(`\r  ${c.dim(obj.status)}               `);
        }
      } catch { /* incomplete JSON */ }
    }
  }

  process.stdout.write('\n');
  success(`"${modelName}" pulled successfully`);
}
