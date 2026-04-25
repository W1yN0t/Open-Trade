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

      // Advance next run regardless of success/failure
      const nextRunAt = new Date(schedule.nextRunAt.getTime() + schedule.intervalMs);
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

        await this.storage.markAlertTriggered(alert.id);

        if (alert.triggerAction) {
          // TP/SL auto-execute
          const intent = alert.triggerAction as unknown as TradeIntent;
          try {
            const result = await this.engine.execute(intent, userId, chatId);
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
              text: `❌ Auto-sell failed for ${asset}: ${msg}`,
            }).catch(() => {});
          }
        } else {
          // Plain price notification
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
