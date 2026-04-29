import type { PostgresStorage } from '../storage/postgres.ts';
import type { Engine } from './engine.ts';
import type { MessengerAdapter } from '../messengers/base.ts';
import type { TradeIntent } from './intent_parser.ts';

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly storage: PostgresStorage,
    private readonly engine: Engine,
    private readonly messenger: MessengerAdapter,
  ) {}

  start(): void {
    this.timer = setInterval(() => { void this.tick(); }, 60_000);
    console.log('⏰ Scheduler started (DCA + price alerts, 60s interval)');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    await this.runDueSchedules();
    await this.checkAlerts();
  }

  private async runDueSchedules(): Promise<void> {
    const due = await this.storage.getDueDcaSchedules();
    for (const schedule of due) {
      try {
        const intent: TradeIntent = {
          type: 'trade',
          action: 'buy',
          asset: schedule.asset,
          quoteCurrency: schedule.quoteCurrency,
          amount: schedule.amount,
          amountType: 'quote',
          confidence: 1,
          limitPrice: null,
          orderId: null,
          side: 'buy',
          condition: null,
          interval: null,
          takeProfitPct: null,
          stopLossPct: null,
        };

        const result = await this.engine.execute(intent, schedule.userId, schedule.chatId);

        await this.storage.logTrade({
          userId: schedule.userId,
          action: 'buy',
          intent,
          result,
          status: 'success',
        });

        await this.messenger.sendMessage({
          chatId: schedule.chatId,
          text: `📅 DCA executed\n${result}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        await this.messenger.sendMessage({
          chatId: schedule.chatId,
          text: `❌ DCA failed for ${schedule.asset}: ${msg}`,
        }).catch(() => {});
      }

      // Advance next run regardless of success/failure. If the bot was offline
      // and the schedule is far in the past, naïvely adding intervalMs would
      // still leave us in the past, causing this same schedule to re-fire on
      // every tick until catch-up. Instead, anchor to "now + interval" once we
      // detect the proposed slot is already stale.
      const nextRunAt = computeNextRun(schedule.nextRunAt, schedule.intervalMs, schedule.intervalSpec);
      await this.storage.updateDcaNextRun(schedule.id, nextRunAt);
    }
  }

  private async checkAlerts(): Promise<void> {
    const alerts = await this.storage.getActiveAlerts();

    // Group by userId to avoid fetching the same price multiple times
    const byUserAsset = new Map<string, typeof alerts>();
    for (const alert of alerts) {
      const key = `${alert.userId}:${alert.asset}:${alert.quoteCurrency}`;
      if (!byUserAsset.has(key)) byUserAsset.set(key, []);
      byUserAsset.get(key)!.push(alert);
    }

    for (const [, group] of byUserAsset) {
      const { userId, asset, quoteCurrency, chatId } = group[0];
      let price: number;
      try {
        price = await this.engine.fetchPrice(asset, quoteCurrency, userId);
      } catch {
        continue;
      }
      if (price <= 0) continue;

      for (const alert of group) {
        const triggered =
          (alert.condition === 'above' && price >= alert.targetPrice) ||
          (alert.condition === 'below' && price <= alert.targetPrice);

        if (!triggered) continue;

        if (alert.triggerAction) {
          // TP/SL auto-execute. Mark the alert triggered ONLY after the trade
          // succeeds — if execute fails (network, balance, exchange error)
          // we leave the alert active so the next tick retries the auto-sell.
          // The previous order (mark-then-execute) silently consumed stop
          // losses on transient failures.
          const intent = alert.triggerAction as unknown as TradeIntent;
          try {
            const result = await this.engine.execute(intent, userId, chatId);
            await this.storage.markAlertTriggered(alert.id);
            const label = alert.condition === 'above' ? '📈 Take-profit' : '📉 Stop-loss';
            await this.messenger.sendMessage({
              chatId,
              text: `${label} triggered @ $${price.toLocaleString()}\n${result}`,
            });
            await this.storage.logTrade({
              userId,
              action: intent.action,
              intent,
              result,
              status: 'success',
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            await this.messenger.sendMessage({
              chatId,
              text: `❌ Auto-sell failed for ${asset}: ${msg}\n   Alert remains active and will retry next tick.`,
            }).catch(() => {});
          }
        } else {
          // Plain price notification — mark triggered, no retry semantics needed.
          await this.storage.markAlertTriggered(alert.id);
          const condLabel = alert.condition === 'above' ? 'rose above' : 'dropped below';
          await this.messenger.sendMessage({
            chatId,
            text: `🔔 Alert: ${asset} ${condLabel} $${alert.targetPrice.toLocaleString()} (now $${price.toLocaleString()})`,
          }).catch(() => {});
        }
      }
    }
  }
}

// Anchors the next run to a sensible slot:
//  • "monthly" specs use calendar-month arithmetic so the schedule does not
//    drift by ~5 days/year compared to the user's expectation.
//  • If the naïvely-advanced slot is still in the past (e.g. the bot was down
//    for several intervals), we anchor to now + interval to avoid firing the
//    same schedule on every tick until catch-up.
export function computeNextRun(prev: Date, intervalMs: number, intervalSpec: string | null = null): Date {
  const now = Date.now();
  let next: number;

  if (intervalSpec && /\bmonth(ly)?\b/i.test(intervalSpec)) {
    const months = intervalSpec.match(/every\s+(\d+)\s+month/i);
    const n = months ? parseInt(months[1], 10) : 1;
    const d = new Date(prev);
    d.setUTCMonth(d.getUTCMonth() + n);
    next = d.getTime();
  } else {
    next = prev.getTime() + intervalMs;
  }

  if (next <= now) {
    // Bot was offline for >= one interval. Don't catch up by replaying every
    // missed tick — anchor to now + interval and move on.
    return new Date(now + intervalMs);
  }
  return new Date(next);
}
