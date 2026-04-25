import Enquirer from 'enquirer';
import { PrismaClient } from '@prisma/client';
import { CredentialService } from '../../core/credentials.ts';
import { discoverProviders } from '../../providers/registry.ts';
import type { Provider } from '../../providers/base.ts';
import { success, error, header, c } from '../ui.ts';

const OPERATOR_ID = process.env.OPERATOR_USER_ID ?? 'operator';
const NEEDS_PASS = new Set(['okx', 'kucoin', 'bitget']);

async function ask(message: string, hidden = false): Promise<string> {
  const type = hidden ? 'password' : 'input';
  const { value } = await (new (Enquirer as any)()).prompt({
    type,
    name: 'value',
    message,
  }) as { value: string };
  return value.trim();
}

async function select(message: string, choices: string[]): Promise<string> {
  const { value } = await (new (Enquirer as any)()).prompt({
    type: 'select',
    name: 'value',
    message,
    choices,
  }) as { value: string };
  return value;
}

export async function cmdConnect(providerName: string | undefined, creds: CredentialService): Promise<void> {
  if (!providerName) {
    const registry = await discoverProviders();
    const choices = [...registry.keys()].filter(n => n !== 'mock' && n !== 'paper');
    providerName = await select('Which exchange?', choices);
  }

  header(`Connect  ${providerName.toUpperCase()}`);

  const apiKey = await ask('API key');
  const apiSecret = await ask('API secret', true);
  const password = NEEDS_PASS.has(providerName.toLowerCase())
    ? await ask('Passphrase', true)
    : undefined;
  const masterPassword = await ask(`Master password ${c.dim('(encrypts stored keys)')}`, true);

  await creds.store(OPERATOR_ID, providerName, { apiKey, apiSecret, password }, masterPassword);
  success(`Credentials for "${providerName}" saved and encrypted`);
}

export async function cmdDisconnect(providerName: string | undefined, creds: CredentialService): Promise<void> {
  if (!providerName) {
    const connected = await creds.list(OPERATOR_ID);
    if (connected.length === 0) { error('No exchanges connected'); return; }
    providerName = await select('Which exchange to disconnect?', connected);
  }

  const { confirmed } = await (new (Enquirer as any)()).prompt({
    type: 'confirm',
    name: 'confirmed',
    message: `Remove credentials for "${providerName}"?`,
    initial: false,
  }) as { confirmed: boolean };

  if (!confirmed) { console.log(c.dim('  Cancelled.')); return; }

  const removed = await creds.remove(OPERATOR_ID, providerName);
  removed ? success(`Credentials for "${providerName}" removed`) : error(`No credentials found for "${providerName}"`);
}

export async function cmdConnections(creds: CredentialService): Promise<void> {
  const providers = await creds.list(OPERATOR_ID);
  if (providers.length === 0) {
    console.log(c.dim('  No exchanges connected.'));
  } else {
    console.log('');
    for (const p of providers) console.log(`  ${c.green('●')}  ${p}`);
    console.log('');
  }
}

export async function cmdTest(providerName: string | undefined, creds: CredentialService): Promise<void> {
  if (!providerName) {
    const connected = await creds.list(OPERATOR_ID);
    if (connected.length === 0) { error('No exchanges connected'); return; }
    providerName = await select('Which exchange to test?', connected);
  }

  const masterPassword = await ask(`Master password ${c.dim('(for decryption)')}`, true);

  let rawCreds;
  try {
    rawCreds = await creds.load(OPERATOR_ID, providerName, masterPassword);
  } catch {
    error('Wrong master password or credentials not found');
    return;
  }

  const registry = await discoverProviders();
  const ProviderClass = registry.get(providerName);
  if (!ProviderClass) { error(`Unknown provider "${providerName}"`); return; }

  console.log(c.dim(`  Testing connection to ${providerName}...`));
  const provider = new (ProviderClass as new () => Provider)();
  const ok = await provider.connect(rawCreds);

  if (ok) {
    const balances = await provider.getBalance();
    success(`Connection successful`);
    if (balances.length > 0) {
      for (const b of balances) {
        console.log(`   ${c.cyan(b.asset.padEnd(6))}  ${b.total}`);
      }
    } else {
      console.log(c.dim('   Balance: empty'));
    }
  } else {
    error('Connection failed — check your credentials');
  }
}
