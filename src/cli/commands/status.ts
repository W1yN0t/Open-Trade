import { PrismaClient } from '@prisma/client';
import { CredentialService } from '../../core/credentials.ts';
import { header, divider, c } from '../ui.ts';

const OPERATOR_ID = process.env.OPERATOR_USER_ID ?? 'operator';

function row(label: string, status: string, detail = ''): void {
  const pad = label.padEnd(18);
  console.log(`   ${c.bold(pad)}  ${status}${detail ? '  ' + c.dim(detail) : ''}`);
}

export async function cmdStatus(prisma: PrismaClient): Promise<void> {
  header('OpenTrade Status');

  // DB
  try {
    await prisma.$connect();
    const url = process.env.DATABASE_URL ?? '';
    const host = url.match(/@([^/]+)/)?.[1] ?? 'unknown';
    row('Database', `${c.green('✅')} Connected`, host);
  } catch {
    row('Database', `${c.red('❌')} Unreachable`);
  }

  // Exchanges
  try {
    const creds = new CredentialService(prisma);
    const exchanges = await creds.list(OPERATOR_ID);
    if (exchanges.length > 0) {
      row('Exchanges', `${c.green('✅')} ${exchanges.join(', ')}`, `[${exchanges.length} connected]`);
    } else {
      row('Exchanges', c.dim('none connected'));
    }
  } catch {
    row('Exchanges', c.dim('unavailable'));
  }

  // Active model
  try {
    const settings = await prisma.userSettings.findUnique({ where: { userId: OPERATOR_ID } });
    const model = settings?.model ?? (process.env.LLM_MODEL ?? 'default');
    const provider = process.env.LLM_PROVIDER ?? 'openrouter';
    row('Active model', c.cyan(model), `(${provider})`);
  } catch {
    row('Active model', c.dim('unavailable'));
  }

  // Paper trading
  const paperMode = process.env.PAPER_TRADING === 'true';
  row('Paper mode', paperMode ? `${c.yellow('⚠️')}  enabled` : c.green('disabled'));

  // Risk limits
  const maxOrder = process.env.RISK_MAX_ORDER_USD ?? '1000';
  const maxPerMin = process.env.RISK_MAX_ORDERS_PER_MINUTE ?? '5';
  const cooldown = Math.round(parseInt(process.env.RISK_LARGE_ORDER_COOLDOWN_MS ?? '60000') / 1000);
  row('Risk limits', c.dim(`max $${maxOrder} · ${maxPerMin}/min · ${cooldown}s cooldown`));

  // Scheduler stats
  try {
    const [dcaCount, alertCount] = await Promise.all([
      prisma.dcaSchedule.count({ where: { isActive: true } }),
      prisma.priceAlert.count({ where: { isTriggered: false } }),
    ]);
    row('Scheduler', c.dim(`DCA: ${dcaCount} active · Alerts: ${alertCount} active`));
  } catch {
    row('Scheduler', c.dim('unavailable'));
  }

  console.log('');
  divider();
  console.log('');
}
