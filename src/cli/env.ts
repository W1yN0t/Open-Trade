import * as fs from 'node:fs';
import * as path from 'node:path';

const ENV_PATH = path.resolve(process.cwd(), '.env');

type EnvLine = { type: 'comment' | 'blank' | 'entry'; raw: string; key?: string; value?: string };

function parse(): EnvLine[] {
  if (!fs.existsSync(ENV_PATH)) return [];
  return fs.readFileSync(ENV_PATH, 'utf8').split('\n').map(raw => {
    if (!raw.trim() || raw.trim().startsWith('#')) return { type: raw.trim().startsWith('#') ? 'comment' : 'blank', raw } as EnvLine;
    const eq = raw.indexOf('=');
    if (eq === -1) return { type: 'blank', raw } as EnvLine;
    return { type: 'entry', raw, key: raw.slice(0, eq).trim(), value: raw.slice(eq + 1).trim() } as EnvLine;
  });
}

function serialize(lines: EnvLine[]): string {
  return lines.map(l => l.raw).join('\n');
}

export function readEnvFile(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of parse()) {
    if (line.type === 'entry' && line.key) map.set(line.key, line.value ?? '');
  }
  return map;
}

export function getEnvKey(key: string): string | undefined {
  return readEnvFile().get(key);
}

export function setEnvKey(key: string, value: string): { prev: string | undefined } {
  const lines = parse();
  const existing = lines.find(l => l.type === 'entry' && l.key === key);
  const prev = existing?.value;

  if (existing) {
    existing.raw = `${key}=${value}`;
    existing.value = value;
  } else {
    lines.push({ type: 'entry', raw: `${key}=${value}`, key, value });
  }

  fs.writeFileSync(ENV_PATH, serialize(lines), 'utf8');
  return { prev };
}

export function removeEnvKeys(keys: string[]): void {
  const keySet = new Set(keys);
  const lines = parse().filter(l => !(l.type === 'entry' && l.key && keySet.has(l.key)));
  fs.writeFileSync(ENV_PATH, serialize(lines), 'utf8');
}

export const RESETTABLE_KEYS = [
  'LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_BASE_URL',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
  'OLLAMA_BASE_URL', 'LM_STUDIO_BASE_URL',
  'RISK_MAX_ORDER_USD', 'RISK_MAX_ORDERS_PER_MINUTE', 'RISK_LARGE_ORDER_COOLDOWN_MS',
  'PAPER_TRADING',
];
