import Enquirer from 'enquirer';
import { header, success, warn, divider, table, c } from '../ui.ts';
import { readEnvFile, setEnvKey, removeEnvKeys, RESETTABLE_KEYS, getEnvKey } from '../env.ts';

const DEFAULTS: Record<string, string> = {
  LLM_PROVIDER: 'openrouter',
  LLM_MODEL: 'anthropic/claude-3-5-sonnet',
  LLM_BASE_URL: 'https://openrouter.ai/api/v1',
  OLLAMA_BASE_URL: 'http://localhost:11434',
  LM_STUDIO_BASE_URL: 'http://localhost:1234/v1',
  RISK_MAX_ORDER_USD: '1000',
  RISK_MAX_ORDERS_PER_MINUTE: '5',
  RISK_LARGE_ORDER_COOLDOWN_MS: '60000',
  PAPER_TRADING: 'false',
};

const CONFIG_KEYS = [
  'LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_BASE_URL',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
  'OLLAMA_BASE_URL', 'LM_STUDIO_BASE_URL',
  'PAPER_TRADING',
  'RISK_MAX_ORDER_USD', 'RISK_MAX_ORDERS_PER_MINUTE', 'RISK_LARGE_ORDER_COOLDOWN_MS',
  'TELEGRAM_BOT_TOKEN', 'DATABASE_URL', 'MASTER_PASSWORD',
];

const SENSITIVE = new Set(['LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'DATABASE_URL', 'MASTER_PASSWORD']);

export function cmdConfigShow(): void {
  header('Configuration');
  const envMap = readEnvFile();

  const rows = CONFIG_KEYS.map(key => {
    const envVal = envMap.get(key);
    const def = DEFAULTS[key];
    const source = envVal !== undefined ? c.green('.env') : c.dim('default');
    const rawVal = envVal ?? def ?? '';
    const display = SENSITIVE.has(key) && rawVal
      ? rawVal.slice(0, 4) + '••••'
      : (rawVal || c.dim('—'));
    return [key, display, source];
  });

  table(['Key', 'Value', 'Source'], rows);
  console.log('');
}

export function cmdConfigSet(key: string | undefined, value: string | undefined): void {
  if (!key || !value) {
    console.log(`Usage: ${c.bold('npm run cli config set KEY VALUE')}`);
    console.log(`Example: ${c.dim('npm run cli config set RISK_MAX_ORDER_USD 500')}`);
    return;
  }
  const { prev } = setEnvKey(key, value);
  const arrow = prev !== undefined
    ? `${c.dim(maskSensitive(key, prev))} → ${c.green(maskSensitive(key, value))}`
    : c.green(maskSensitive(key, value));
  success(`${c.bold(key)}  ${arrow}  ${c.dim('(written to .env)')}`);
}

export async function cmdConfigReset(): Promise<void> {
  header('Reset Configuration');
  warn('This will remove all resettable settings from .env');
  warn('Credentials (TELEGRAM_BOT_TOKEN, DATABASE_URL, MASTER_PASSWORD) are preserved');
  console.log('');

  const { confirmed } = await (new (Enquirer as any)()).prompt({
    type: 'confirm',
    name: 'confirmed',
    message: 'Restore defaults?',
    initial: false,
  }) as { confirmed: boolean };

  if (!confirmed) { console.log(c.dim('  Cancelled.')); return; }

  removeEnvKeys(RESETTABLE_KEYS);
  success('Configuration reset to defaults');
}

export async function cmdConfigWizard(): Promise<void> {
  header('Configuration Wizard');

  const enq = new (Enquirer as any)();

  // Step 1: LLM Provider
  const { provider } = await enq.prompt({
    type: 'select',
    name: 'provider',
    message: 'LLM Provider',
    hint: '↑↓ navigate, Enter select',
    initial: getEnvKey('LLM_PROVIDER') ?? 'openrouter',
    choices: [
      { name: 'openrouter', message: `openrouter  ${c.dim('(recommended — access to all models)')}` },
      { name: 'openai',     message: `openai      ${c.dim('(direct OpenAI API)')}` },
      { name: 'anthropic',  message: `anthropic   ${c.dim('(direct Anthropic API)')}` },
      { name: 'gemini',     message: `gemini      ${c.dim('(direct Google Gemini API)')}` },
      { name: 'ollama',     message: `ollama      ${c.dim('(local, free)')}` },
      { name: 'lmstudio',   message: `lmstudio    ${c.dim('(local, free)')}` },
    ],
  }) as { provider: string };

  const changes: Array<[string, string]> = [['LLM_PROVIDER', provider]];

  // Step 2: API key (cloud providers only)
  const cloudKeyMap: Record<string, string> = {
    openrouter: 'LLM_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
  };

  if (cloudKeyMap[provider]) {
    const envKey = cloudKeyMap[provider];
    const existing = getEnvKey(envKey);
    const hint = existing ? c.dim('leave blank to keep current') : '';
    const { apiKey } = await enq.prompt({
      type: 'password',
      name: 'apiKey',
      message: `API key for ${provider}`,
      hint,
    }) as { apiKey: string };
    if (apiKey.trim()) changes.push([envKey, apiKey.trim()]);
  }

  // Step 3: Model name
  const defaultModel = provider === 'openai' ? 'gpt-4o'
    : provider === 'anthropic' ? 'claude-3-5-sonnet-20241022'
    : provider === 'gemini' ? 'gemini-1.5-pro'
    : provider === 'ollama' || provider === 'lmstudio' ? 'llama3.2'
    : 'anthropic/claude-3-5-sonnet';

  const { model } = await enq.prompt({
    type: 'input',
    name: 'model',
    message: 'Model name',
    initial: getEnvKey('LLM_MODEL') ?? defaultModel,
  }) as { model: string };
  if (model.trim()) changes.push(['LLM_MODEL', model.trim()]);

  // Step 4: Risk limits
  const { maxOrder } = await enq.prompt({
    type: 'input',
    name: 'maxOrder',
    message: 'Max order size (USD)',
    initial: getEnvKey('RISK_MAX_ORDER_USD') ?? '1000',
    validate: (v: string) => /^\d+$/.test(v) || 'Must be a number',
  }) as { maxOrder: string };
  changes.push(['RISK_MAX_ORDER_USD', maxOrder]);

  // Step 5: Paper trading
  const { paper } = await enq.prompt({
    type: 'confirm',
    name: 'paper',
    message: 'Enable paper trading? (no real orders)',
    initial: getEnvKey('PAPER_TRADING') === 'true',
  }) as { paper: boolean };
  changes.push(['PAPER_TRADING', paper ? 'true' : 'false']);

  // Preview
  console.log('');
  divider();
  console.log(c.bold('  Changes to .env:'));
  console.log('');
  for (const [k, v] of changes) {
    const prev = getEnvKey(k);
    const arrow = prev ? `${c.dim(maskSensitive(k, prev))} → ` : '';
    console.log(`  ${c.cyan(k.padEnd(30))}  ${arrow}${c.green(maskSensitive(k, v))}`);
  }
  divider();
  console.log('');

  const { save } = await enq.prompt({
    type: 'confirm',
    name: 'save',
    message: 'Save these settings to .env?',
    initial: true,
  }) as { save: boolean };

  if (!save) { console.log(c.dim('  Cancelled.')); return; }

  for (const [k, v] of changes) setEnvKey(k, v);
  success('Settings saved to .env');
  console.log(c.dim('  Restart the bot for changes to take effect.'));
}

function maskSensitive(key: string, value: string): string {
  if (SENSITIVE.has(key) && value.length > 4) return value.slice(0, 4) + '••••';
  return value;
}
