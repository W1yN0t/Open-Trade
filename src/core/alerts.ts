import type { PostgresStorage } from '../storage/postgres.ts';
import type { TradeIntent } from './intent_parser.ts';

export class AlertService {
  constructor(private readonly storage: PostgresStorage) {}

  async create(userId: string, chatId: string, intent: TradeIntent): Promise<string> {
    if (!intent.limitPrice) {
      return '❌ Please specify a target price. Example: "notify when ETH drops below 2000"';
    }

    const condition = deriveCondition(intent.condition ?? '');
    const alert = await this.storage.createAlert({
      userId,
      chatId,
      asset: intent.asset,
      quoteCurrency: intent.quoteCurrency,
      condition,
      targetPrice: intent.limitPrice,
    });

    const condLabel = condition === 'above' ? 'rises above' : 'drops below';
    return `🔔 Alert set\n${intent.asset} ${condLabel} $${intent.limitPrice.toLocaleString()}\nID: ${alert.id.slice(0, 8)}`;
  }

  async createTpSl(
    userId: string,
    chatId: string,
    asset: string,
    quoteCurrency: string,
    entryPrice: number,
    takeProfitPct: number | null,
    stopLossPct: number | null,
  ): Promise<string[]> {
    const messages: string[] = [];

    if (takeProfitPct !== null) {
      const tpPrice = entryPrice * (1 + takeProfitPct / 100);
      const triggerAction: TradeIntent = {
        type: 'trade',
        action: 'sell',
        asset,
        quoteCurrency,
        amount: 100,
        amountType: 'percent',
        confidence: 1,
        limitPrice: null,
        orderId: null,
        side: 'sell',
        condition: null,
        interval: null,
        takeProfitPct: null,
        stopLossPct: null,
      };
      await this.storage.createAlert({
        userId,
        chatId,
        asset,
        quoteCurrency,
        condition: 'above',
        targetPrice: tpPrice,
        triggerAction,
      });
      messages.push(`📈 Take-profit set at $${tpPrice.toFixed(2)} (+${takeProfitPct}%)`);
    }

    if (stopLossPct !== null) {
      const slPrice = entryPrice * (1 - stopLossPct / 100);
      const triggerAction: TradeIntent = {
        type: 'trade',
        action: 'sell',
        asset,
        quoteCurrency,
        amount: 100,
        amountType: 'percent',
        confidence: 1,
        limitPrice: null,
        orderId: null,
        side: 'sell',
        condition: null,
        interval: null,
        takeProfitPct: null,
        stopLossPct: null,
      };
      await this.storage.createAlert({
        userId,
        chatId,
        asset,
        quoteCurrency,
        condition: 'below',
        targetPrice: slPrice,
        triggerAction,
      });
      messages.push(`📉 Stop-loss set at $${slPrice.toFixed(2)} (-${stopLossPct}%)`);
    }

    return messages;
  }

  async list(userId: string): Promise<string> {
    const alerts = await this.storage.listAlerts(userId);
    if (alerts.length === 0) return '🔔 No active price alerts.';

    const lines = ['🔔 Active Price Alerts\n'];
    for (const a of alerts) {
      const condLabel = a.condition === 'above' ? '↑ above' : '↓ below';
      const autoLabel = a.triggerAction ? ' [auto-sell]' : '';
      lines.push(`• ${a.asset} ${condLabel} $${a.targetPrice.toLocaleString()}${autoLabel} [${a.id.slice(0, 8)}]`);
    }
    return lines.join('\n');
  }

  async cancel(id: string, userId: string): Promise<string> {
    const ok = await this.storage.cancelAlert(id, userId);
    return ok
      ? `✅ Alert ${id.slice(0, 8)} cancelled.`
      : `❌ Alert not found or already triggered.`;
  }
}

function deriveCondition(conditionStr: string): 'above' | 'below' {
  const s = conditionStr.toLowerCase();
  if (s.includes('above') || s.includes('over') || s.includes('rises') || s.includes('>')) return 'above';
  return 'below';
}
