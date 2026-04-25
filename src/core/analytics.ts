import type { PostgresStorage } from '../storage/postgres.ts';
import type { Provider } from '../providers/base.ts';

const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD', 'TUSD']);

export class AnalyticsService {
  constructor(private readonly storage: PostgresStorage) {}

  async getPortfolioAnalytics(userId: string, providers: Provider[]): Promise<string> {
    // Gather current balances and prices
    const assets: Record<string, { total: number; valueUsd: number; avgBuyPrice: number | null }> = {};
    let totalUsd = 0;

    for (const provider of providers) {
      const balances = await provider.getBalance();
      for (const b of balances) {
        if (b.total <= 0) continue;
        if (STABLECOINS.has(b.asset)) {
          assets[b.asset] = { total: b.total, valueUsd: b.total, avgBuyPrice: 1 };
          totalUsd += b.total;
        } else {
          try {
            const price = await provider.getPrice(`${b.asset}/USDT`);
            const valueUsd = b.total * price;
            assets[b.asset] = { total: b.total, valueUsd, avgBuyPrice: null };
            totalUsd += valueUsd;
          } catch {
            assets[b.asset] = { total: b.total, valueUsd: 0, avgBuyPrice: null };
          }
        }
      }
    }

    if (totalUsd === 0 && Object.keys(assets).length === 0) {
      return '📊 No portfolio data available.';
    }

    // Calculate average buy prices from last 90 days of audit log
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const history = await this.storage.getTradeHistorySince(userId, since);

    const buyCosts: Record<string, { totalCost: number; totalAmount: number }> = {};
    for (const row of history) {
      if (row.status !== 'success') continue;
      const { action, intent } = row;
      if ((action === 'buy' || action === 'swap') && intent.asset && intent.amount) {
        const asset = intent.asset;
        if (!buyCosts[asset]) buyCosts[asset] = { totalCost: 0, totalAmount: 0 };
        if (intent.amountType === 'quote' && intent.amount) {
          buyCosts[asset].totalCost += intent.amount;
          // Estimate base amount from limitPrice or derive later
        } else if (intent.amountType === 'base' && intent.amount) {
          if (intent.limitPrice) {
            buyCosts[asset].totalCost += intent.amount * intent.limitPrice;
            buyCosts[asset].totalAmount += intent.amount;
          }
        }
      }
    }

    for (const [asset, costs] of Object.entries(buyCosts)) {
      if (costs.totalAmount > 0 && assets[asset]) {
        assets[asset].avgBuyPrice = costs.totalCost / costs.totalAmount;
      }
    }

    // Format output
    const lines: string[] = ['📊 Portfolio Analytics\n'];
    const sorted = Object.entries(assets).sort((a, b) => b[1].valueUsd - a[1].valueUsd);

    for (const [asset, data] of sorted) {
      const pct = totalUsd > 0 ? (data.valueUsd / totalUsd * 100).toFixed(1) : '0.0';
      let line = `${asset}: ${data.total.toFixed(4)} (~$${data.valueUsd.toFixed(2)}, ${pct}%)`;

      if (data.avgBuyPrice && !STABLECOINS.has(asset) && data.valueUsd > 0) {
        const currentPrice = data.valueUsd / data.total;
        const pnlPct = ((currentPrice - data.avgBuyPrice) / data.avgBuyPrice * 100).toFixed(1);
        const pnlSign = parseFloat(pnlPct) >= 0 ? '+' : '';
        line += ` PnL: ${pnlSign}${pnlPct}%`;
      }

      lines.push(`• ${line}`);
    }

    lines.push(`\n💰 Total: ~$${totalUsd.toFixed(2)}`);

    return lines.join('\n');
  }
}
