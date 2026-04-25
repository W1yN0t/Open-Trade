import 'dotenv/config';
import Enquirer from 'enquirer';
import { PrismaClient } from '@prisma/client';
import { CredentialService } from '../core/credentials.ts';
import { c, header, version } from './ui.ts';
import { cmdConnect, cmdDisconnect, cmdConnections, cmdTest } from './commands/connect.ts';
import { cmdModels, cmdModelUse, cmdModelPull } from './commands/models.ts';
import { cmdConfigShow, cmdConfigSet, cmdConfigReset, cmdConfigWizard } from './commands/config.ts';
import { cmdStatus } from './commands/status.ts';
import { cmdLogs } from './commands/logs.ts';

const MENU_CHOICES = [
  { name: 'connect',      message: `connect exchange        ${c.dim('save API credentials')}` },
  { name: 'disconnect',   message: `disconnect exchange     ${c.dim('remove credentials')}` },
  { name: 'connections',  message: `show connections        ${c.dim('list connected exchanges')}` },
  { name: 'test',         message: `test connection         ${c.dim('verify exchange API keys')}` },
  { name: 'sep1',         message: c.dim('─────────────────────────────────────────'), role: 'separator' },
  { name: 'config',       message: `config wizard           ${c.dim('setup LLM provider, risk limits')}` },
  { name: 'config show',  message: `config show             ${c.dim('view all settings')}` },
  { name: 'config set',   message: `config set KEY VALUE    ${c.dim('update a setting')}` },
  { name: 'config reset', message: `config reset            ${c.dim('restore defaults')}` },
  { name: 'sep2',         message: c.dim('─────────────────────────────────────────'), role: 'separator' },
  { name: 'status',       message: `status                  ${c.dim('health dashboard')}` },
  { name: 'logs',         message: `logs                    ${c.dim('view trade history')}` },
  { name: 'sep3',         message: c.dim('─────────────────────────────────────────'), role: 'separator' },
  { name: 'models',       message: `models                  ${c.dim('list Ollama / LM Studio models')}` },
  { name: 'model use',    message: `model use               ${c.dim('switch active model')}` },
  { name: 'model pull',   message: `model pull              ${c.dim('pull model via Ollama')}` },
  { name: 'sep4',         message: c.dim('─────────────────────────────────────────'), role: 'separator' },
  { name: 'exit',         message: `exit` },
];

async function interactiveMenu(prisma: PrismaClient, creds: CredentialService): Promise<void> {
  console.log('');
  console.log(c.bold.cyan('◆  OpenTrade CLI') + c.dim(`  v${version()}`));
  console.log('');

  const { action } = await (new (Enquirer as any)()).prompt({
    type: 'autocomplete',
    name: 'action',
    message: 'What would you like to do?',
    hint: 'type to filter · ↑↓ navigate · Enter select',
    limit: 12,
    choices: MENU_CHOICES,
  }) as { action: string };

  console.log('');
  await dispatch(action, [], prisma, creds);
}

async function dispatch(command: string, args: string[], prisma: PrismaClient, creds: CredentialService): Promise<void> {
  switch (command) {
    case 'connect':
      await cmdConnect(args[0], creds); break;
    case 'disconnect':
      await cmdDisconnect(args[0], creds); break;
    case 'connections':
      await cmdConnections(creds); break;
    case 'test':
      await cmdTest(args[0], creds); break;
    case 'config':
      await cmdConfigWizard(); break;
    case 'config show':
      cmdConfigShow(); break;
    case 'config set':
      cmdConfigSet(args[0], args[1]); break;
    case 'config reset':
      await cmdConfigReset(); break;
    case 'status':
      await cmdStatus(prisma); break;
    case 'logs':
      await cmdLogs(prisma, args); break;
    case 'models':
      await cmdModels(args); break;
    case 'model use':
      await cmdModelUse(args[0], prisma); break;
    case 'model pull':
      await cmdModelPull(args[0]); break;
    case 'exit':
    case undefined:
      break;
    default:
      console.log(c.dim(`  Unknown command "${command}". Run without arguments for interactive menu.`));
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const creds = new CredentialService(prisma);
  const [,, cmd, sub, ...rest] = process.argv;

  try {
    if (!cmd) {
      await interactiveMenu(prisma, creds);
      return;
    }

    // sub-command routing: "config show" → command="config show", "model use" → "model use"
    const twoWord = sub && !sub.startsWith('-') ? `${cmd} ${sub}` : null;

    if (twoWord && ['config show', 'config set', 'config reset', 'model use', 'model pull'].includes(twoWord)) {
      await dispatch(twoWord, rest, prisma, creds);
    } else {
      await dispatch(cmd, sub ? [sub, ...rest] : rest, prisma, creds);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(c.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
