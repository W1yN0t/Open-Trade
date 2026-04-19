import 'dotenv/config';
import * as readline from 'node:readline';
import { PrismaClient } from '@prisma/client';
import { CredentialService } from './core/credentials.ts';
import { discoverProviders } from './providers/registry.ts';
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
  const [,, command, providerName] = process.argv;
  const prisma = new PrismaClient();
  const creds = new CredentialService(prisma);

  try {
    switch (command) {
      case 'connect':
        if (!providerName) { console.log('Usage: opentrade connect <provider>'); break; }
        await cmdConnect(providerName, creds);
        break;

      case 'disconnect':
        if (!providerName) { console.log('Usage: opentrade disconnect <provider>'); break; }
        await cmdDisconnect(providerName, creds);
        break;

      case 'connections':
        await cmdConnections(creds);
        break;

      case 'test':
        if (!providerName) { console.log('Usage: opentrade test <provider>'); break; }
        await cmdTest(providerName, creds);
        break;

      default:
        console.log([
          'OpenTrade CLI',
          '',
          'Commands:',
          '  opentrade connect <provider>     Save API credentials (encrypted)',
          '  opentrade disconnect <provider>  Remove stored credentials',
          '  opentrade connections            List connected exchanges',
          '  opentrade test <provider>        Verify connection to exchange',
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
