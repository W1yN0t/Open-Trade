import type { PostgresStorage } from '../storage/postgres.ts';
import type { TradeIntent } from './intent_parser.ts';

export function parseInterval(interval: string): number {
  const s = interval.toLowerCase().trim();
  if (s === 'hourly' || s === 'every hour') return 60 * 60 * 1000;
  if (s === 'daily' || s === 'every day') return 24 * 60 * 60 * 1000;
  if (s === 'weekly' || s === 'every week' || s === 'every monday') return 7 * 24 * 60 * 60 * 1000;
  if (s === 'monthly' || s === 'every month') return 30 * 24 * 60 * 60 * 1000;

  const everyN = s.match(/every\s+(\d+)\s+(hour|day|week|month)s?/);
  if (everyN) {
    const n = parseInt(everyN[1], 10);
    const unit = everyN[2];
    if (unit === 'hour') return n * 60 * 60 * 1000;
    if (unit === 'day') return n * 24 * 60 * 60 * 1000;
    if (unit === 'week') return n * 7 * 24 * 60 * 60 * 1000;
    if (unit === 'month') return n * 30 * 24 * 60 * 60 * 1000;
  }

  // Default: daily
  return 24 * 60 * 60 * 1000;
}

export class DcaService {
  constructor(private readonly storage: PostgresStorage) {}

  async create(userId: string, chatId: string, intent: TradeIntent): Promise<string> {
    const intervalMs = parseInterval(intent.interval ?? 'daily');
    const nextRunAt = new Date(Date.now() + intervalMs);

    const schedule = await this.storage.createDca({
      userId,
      chatId,
      asset: intent.asset,
      quoteCurrency: intent.quoteCurrency,
      amount: intent.amount ?? 0,
      intervalMs,
      nextRunAt,
    });

    const intervalLabel = formatInterval(intervalMs);
    const nextRun = nextRunAt.toISOString().slice(0, 16).replace('T', ' ');
    return `✅ DCA scheduled\nBuy ${intent.asset} for $${intent.amount} ${intervalLabel}\nNext run: ${nextRun} UTC\nID: ${schedule.id}`;
  }

  async list(userId: string): Promise<string> {
    const schedules = await this.storage.listDca(userId);
    if (schedules.length === 0) return '📅 No active DCA schedules.';

    const lines = ['📅 Active DCA Schedules\n'];
    for (const s of schedules) {
      const nextRun = s.nextRunAt.toISOString().slice(0, 16).replace('T', ' ');
      const intervalLabel = formatInterval(s.intervalMs);
      lines.push(`• Buy ${s.asset} $${s.amount} ${intervalLabel} — next: ${nextRun} UTC [${s.id.slice(0, 8)}]`);
    }
    return lines.join('\n');
  }

  async cancel(id: string, userId: string): Promise<string> {
    const ok = await this.storage.cancelDca(id, userId);
    return ok
      ? `✅ DCA schedule ${id.slice(0, 8)} cancelled.`
      : `❌ DCA schedule not found or already cancelled.`;
  }
}

function formatInterval(ms: number): string {
  const h = ms / (60 * 60 * 1000);
  if (h < 24) return `every ${h}h`;
  const d = h / 24;
  if (d === 1) return 'daily';
  if (d === 7) return 'weekly';
  if (d === 30) return 'monthly';
  return `every ${d} days`;
}
