import 'dotenv/config';
import * as readline from 'node:readline';
import { PrismaClient } from '@prisma/client';
import { CredentialService } from './core/credentials.ts';
import { discoverProviders } from './providers/registry.ts';
import { runSmokeTest } from './llm/smoke_test.ts';
import type { Provider } from './providers/base.ts';

const OPERATOR_ID = process.env.OPERATOR_USER_ID ?? 'operator';

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Suppress echoed characters
  (rl as unknown as { _writeToOutput(s: string): void; output?: NodeJS.WritableStream })._writeToOutput = function (s: string) {
    const self = this as { output?: NodeJS.WritableStream };
    if (s === '\r\n' || s === '\n' || s === '\r') self.output?.write('\n');
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function cmdConnect(providerName: string, creds: CredentialService): Promise<void> {
  console.log(`Connecting to ${providerName}...`);
  const apiKey = await prompt('  API key: ');
  const apiSecret = await promptHidden('  API secret: ');
  const needsPass = ['okx', 'kucoin', 'bitget'].includes(providerName.toLowerCase());
  const password = needsPass ? await promptHidden('  Passphrase: ') : undefined;
  const masterPassword = await promptHidden('  Master password (for encryption): ');

  await creds.store(OPERATOR_ID, providerName, { apiKey, apiSecret, password }, masterPassword);
  console.log(`✅ Credentials for "${providerName}" saved and encrypted.`);
}

async function cmdDisconnect(providerName: string, creds: CredentialService): Promise<void> {
  const removed = await creds.remove(OPERATOR_ID, providerName);
  if (removed) {
    console.log(`✅ Credentials for "${providerName}" removed.`);
  } else {
    console.log(`❌ No credentials found for "${providerName}".`);
  }
}

async function cmdConnections(creds: CredentialService): Promise<void> {
  const providers = await creds.list(OPERATOR_ID);
  if (providers.length === 0) {
    console.log('No exchanges connected.');
  } else {
    console.log('Connected exchanges:');
    for (const p of providers) {
      console.log(`  • ${p}`);
    }
  }
}

async function cmdModels(flags: string[]): Promise<void> {
  const useLmStudio = flags.includes('--lmstudio');

  if (useLmStudio) {
    const base = process.env.LM_STUDIO_BASE_URL ?? 'http://localhost:1234';
    let res: Response;
    try {
      res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(3000) });
    } catch {
      console.log(`❌ LM Studio unreachable at ${base}`);
      return;
    }
    if (!res.ok) { console.log(`❌ LM Studio returned HTTP ${res.status}`); return; }
    const data = await res.json() as { data: Array<{ id: string }> };
    if (!data.data?.length) { console.log('No models loaded in LM Studio.'); return; }
    console.log('LM Studio loaded models:');
    for (const m of data.data) console.log(`  • ${m.id}`);
    return;
  }

  const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  let res: Response;
  try {
    res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.log(`❌ Ollama unreachable at ${base}`);
    return;
  }
  if (!res.ok) { console.log(`❌ Ollama returned HTTP ${res.status}`); return; }
  const data = await res.json() as { models: Array<{ name: string; size: number; details?: { quantization_level?: string } }> };
  if (!data.models?.length) { console.log('No models installed in Ollama.'); return; }
  console.log('Ollama installed models:');
  for (const m of data.models) {
    const gb = (m.size / 1e9).toFixed(1);
    const quant = m.details?.quantization_level ?? '?';
    console.log(`  • ${m.name}  ${gb} GB  [${quant}]`);
  }
}

async function cmdModelUse(modelName: string, prisma: PrismaClient): Promise<void> {
  console.log(`Running smoke test for "${modelName}"...`);
  const result = await runSmokeTest(modelName);

  if (!result.ok) {
    console.log(`❌ Smoke test failed (${result.latencyMs}ms):`);
    for (const f of result.failures) console.log(`   ${f}`);
    console.log('Model NOT activated. Fix the issues above or check that the provider is running.');
    return;
  }

  console.log(`✅ Smoke test passed (${result.latencyMs}ms)`);
  await prisma.userSettings.upsert({
    where: { userId: OPERATOR_ID },
    update: { model: modelName },
    create: { userId: OPERATOR_ID, model: modelName },
  });
  console.log(`✅ Active model set to "${modelName}"`);
}

async function cmdModelPull(modelName: string): Promise<void> {
  const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  console.log(`Pulling "${modelName}" from Ollama at ${base}...`);

  let res: Response;
  try {
    res = await fetch(`${base}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
      signal: AbortSignal.timeout(600_000),
    });
  } catch (err) {
    console.log(`❌ Ollama unreachable at ${base}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (!res.ok || !res.body) {
    console.log(`❌ Failed to start pull: HTTP ${res.status}`);
    return;
  }

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
          process.stdout.write(`\r  ${obj.status}  ${pct}%   `);
        } else {
          process.stdout.write(`\r  ${obj.status}               `);
        }
      } catch { /* ignore incomplete lines */ }
    }
  }

  process.stdout.write('\n');
  console.log(`✅ "${modelName}" pulled successfully`);
}

async function cmdTest(providerName: string, creds: CredentialService): Promise<void> {
  const masterPassword = await promptHidden('  Master password: ');
  const rawCreds = await creds.load(OPERATOR_ID, providerName, masterPassword);

  const registry = await discoverProviders();
  const ProviderClass = registry.get(providerName);
  if (!ProviderClass) {
    console.log(`❌ Unknown provider "${providerName}". Available: ${[...registry.keys()].join(', ')}`);
    return;
  }

  const provider = new (ProviderClass as new () => Provider)();
  console.log(`Testing connection to ${providerName}...`);
  const ok = await provider.connect(rawCreds);
  if (ok) {
    const balances = await provider.getBalance();
    console.log(`✅ Connection successful.`);
    console.log(`   Balances: ${balances.map(b => `${b.total} ${b.asset}`).join(', ') || 'none'}`);
  } else {
    console.log(`❌ Connection failed. Check your credentials.`);
  }
}

async function main(): Promise<void> {
  const [,, command, sub, ...rest] = process.argv;
  const prisma = new PrismaClient();
  const creds = new CredentialService(prisma);

  try {
    switch (command) {
      case 'connect':
        if (!sub) { console.log('Usage: opentrade connect <provider>'); break; }
        await cmdConnect(sub, creds);
        break;

      case 'disconnect':
        if (!sub) { console.log('Usage: opentrade disconnect <provider>'); break; }
        await cmdDisconnect(sub, creds);
        break;

      case 'connections':
        await cmdConnections(creds);
        break;

      case 'test':
        if (!sub) { console.log('Usage: opentrade test <provider>'); break; }
        await cmdTest(sub, creds);
        break;

      case 'models':
        await cmdModels(sub ? [sub, ...rest] : []);
        break;

      case 'model':
        if (sub === 'use') {
          const modelName = rest[0];
          if (!modelName) { console.log('Usage: opentrade model use <model-name>'); break; }
          await cmdModelUse(modelName, prisma);
        } else if (sub === 'pull') {
          const modelName = rest[0];
          if (!modelName) { console.log('Usage: opentrade model pull <model-name>'); break; }
          await cmdModelPull(modelName);
        } else {
          console.log('Usage: opentrade model <use|pull> <model-name>');
        }
        break;

      default:
        console.log([
          'OpenTrade CLI',
          '',
          'Commands:',
          '  opentrade connect <provider>          Save API credentials (encrypted)',
          '  opentrade disconnect <provider>       Remove stored credentials',
          '  opentrade connections                 List connected exchanges',
          '  opentrade test <provider>             Verify connection to exchange',
          '  opentrade models                      List installed Ollama models',
          '  opentrade models --lmstudio           List models loaded in LM Studio',
          '  opentrade model use <model-name>      Switch active LLM model (runs smoke test)',
          '  opentrade model pull <model-name>     Pull a model via Ollama',
          '',
          'Providers: okx, binance, bybit, mock',
        ].join('\n'));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
