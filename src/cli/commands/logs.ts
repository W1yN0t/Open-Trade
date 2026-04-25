import { PrismaClient } from '@prisma/client';
import { header, divider, c } from '../ui.ts';

export async function cmdLogs(prisma: PrismaClient, flags: string[]): Promise<void> {
  const tailIdx = flags.indexOf('--tail');
  const limit = tailIdx !== -1 ? parseInt(flags[tailIdx + 1] ?? '10', 10) : 10;

  header(`Audit Log  ${c.dim('(last ' + limit + ' entries)')}`);

  let rows: any[];
  try {
    rows = await prisma.auditLog.findMany({
      orderBy: { executedAt: 'desc' },
      take: limit,
    });
  } catch {
    console.log(c.red('  ❌  Database unavailable'));
    return;
  }

  if (rows.length === 0) {
    console.log(c.dim('  No trade history yet.'));
    console.log('');
    return;
  }

  const termWidth = process.stdout.columns ?? 100;
  const maxResult = Math.max(termWidth - 70, 20);

  for (const r of rows.reverse()) {
    const date = r.executedAt.toISOString().slice(0, 16).replace('T', ' ');
    const icon = r.status === 'success' ? c.green('✅') : r.status === 'failed' ? c.red('❌') : c.yellow('⊘');
    const action = c.bold((r.action ?? '').toUpperCase().padEnd(8));
    const intent = r.intent as any;
    const asset = intent?.asset ? c.cyan(intent.asset.padEnd(5)) : '     ';
    const amount = intent?.amount ? c.dim('$' + intent.amount) : '';
    const result = (r.result ?? '').slice(0, maxResult);
    const resultStr = r.status === 'success' ? c.dim(result) : c.red(result);

    console.log(`  ${icon}  ${c.dim(date)}  ${action}  ${asset}  ${amount.padEnd(10)}  ${resultStr}`);
  }

  divider();
  console.log(c.dim(`  ${rows.length} entries shown`));
  console.log('');
}
