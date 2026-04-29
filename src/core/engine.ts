import { Provider } from '../providers/base.ts';
import type { TradeIntent } from './intent_parser.ts';
import type { CredentialService } from './credentials.ts';
import { RiskManager } from './risk.ts';
import { PaperProvider } from '../providers/paper/provider.ts';
import type { DcaService } from './dca.ts';
import type { AlertService } from './alerts.ts';
import type { AnalyticsService } from './analytics.ts';
import type { PostgresStorage } from '../storage/postgres.ts';

const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD', 'TUSD']);
const TRADE_ACTIONS = new Set(['buy', 'sell', 'swap', 'limit', 'stop']);

interface CachedProvider {
  provider: Provider;
  // Snapshot of UserCredentials.updatedAt at the time we connected; if the
  // current value differs we know the keys were rotated and the cached
  // connection is stale.
  credsUpdatedAt: number;
}

export class Engine {
  // key: `${userId}:${providerName}` to support multiple exchanges per user
  private cache = new Map<string, CachedProvider>();
  private risk: RiskManager;
  // paper-mode balances are per-user — sharing one PaperProvider across
  // users would let them see and spend each other's simulated funds.
  private paperProviders = new Map<string, PaperProvider>();

  constructor(
    private readonly credentialService: CredentialService,
    private readonly providerRegistry: Map<string, typeof Provider>,
    private readonly masterPassword: string,
    private readonly options: { paperMode?: boolean; storage?: PostgresStorage } = {},
    private readonly dcaService?: DcaService,
    private readonly alertService?: AlertService,
    private readonly analyticsService?: AnalyticsService,
  ) {
    this.risk = new RiskManager({}, options.storage);
  }

  async execute(intent: TradeIntent, userId: string, chatId?: string): Promise<string> {
    const provider = await this.getProvider(userId);
    const paper = this.options.paperMode ? '[PAPER] ' : '';

    let estimatedUsd = 0;
    if (TRADE_ACTIONS.has(intent.action as string)) {
      // Fail-closed: if we cannot estimate the order's USD value (price/balance
      // fetch failed), refuse the trade rather than letting it bypass risk
      // limits with an implicit value of $0.
      const estimate = await this.estimateUsdStrict(provider, intent);
      if (estimate === null) {
        return '⚠️ Could not verify order size (price unavailable). Trade refused for safety.';
      }
      estimatedUsd = estimate;
      const blocked = await this.risk.check(userId, intent, estimatedUsd);
      if (blocked) return blocked;
    }

    switch (intent.action) {
      case 'portfolio':
      case 'balance': {
        const all = await this.getAllProviders(userId);
        return this.portfolio(all, paper);
      }
      case 'price':    return this.price(provider, intent);
      case 'orders':   return this.openOrders(provider, paper);
      case 'buy':
      case 'swap':     return this.buy(provider, intent, userId, chatId ?? '', paper, estimatedUsd);
      case 'sell':     return this.sell(provider, intent, userId, chatId ?? '', paper, estimatedUsd);
      case 'limit':    return this.limitOrder(provider, intent, userId, chatId ?? '', paper, estimatedUsd);
      case 'cancel':    return this.cancelOrder(provider, intent);
      case 'stop':      return '⚠️ Stop orders are not yet supported by this provider.';
      case 'dca':       return this.handleDca(intent, userId, chatId ?? '');
      case 'alert':     return this.handleAlert(intent, userId, chatId ?? '');
      case 'analytics': return this.handleAnalytics(userId);
      default:          throw new Error(`Unsupported action: ${intent.action}`);
    }
  }

  get isPaperMode(): boolean {
    return !!this.options.paperMode;
  }

  // Returns null when the USD value cannot be determined (callers must treat
  // that as "unknown" rather than "$0"). Used by the confirmation flow to pick
  // a confirmation level — when unknown, the caller should escalate to critical.
  async estimateUsdForIntent(intent: TradeIntent, userId: string): Promise<number | null> {
    try {
      const provider = await this.getProvider(userId);
      return await this.estimateUsdStrict(provider, intent);
    } catch {
      return null;
    }
  }

  // Tracks which (userId, providerName) pairs we've already warned about so
  // the same multi-exchange notice doesn't spam logs on every trade.
  private multiExchangeWarned = new Set<string>();

  private async getProvider(userId: string): Promise<Provider> {
    if (this.options.paperMode) return this.getPaperProvider(userId);

    const names = await this.credentialService.list(userId);
    if (names.length === 0) {
      throw new Error('No exchange connected. Run: pnpm cli connect <exchange>');
    }

    if (names.length > 1) {
      const warnKey = `${userId}:${names[0]}`;
      if (!this.multiExchangeWarned.has(warnKey)) {
        this.multiExchangeWarned.add(warnKey);
        console.warn(
          `[engine] User ${userId} has multiple exchanges connected (${names.join(', ')}). ` +
          `Routing trades to "${names[0]}" until per-trade exchange selection is supported.`,
        );
      }
    }

    return this.loadProvider(userId, names[0]);
  }

  private async getAllProviders(userId: string): Promise<Provider[]> {
    if (this.options.paperMode) return [this.getPaperProvider(userId)];

    const names = await this.credentialService.list(userId);
    if (names.length === 0) {
      throw new Error('No exchange connected. Run: pnpm cli connect <exchange>');
    }

    // Don't let one broken API key wipe out the entire portfolio aggregation —
    // log + skip failing exchanges instead of rejecting the whole call.
    const settled = await Promise.allSettled(names.map(name => this.loadProvider(userId, name)));
    const ok: Provider[] = [];
    settled.forEach((res, i) => {
      if (res.status === 'fulfilled') ok.push(res.value);
      else console.warn(`[engine] Skipping provider "${names[i]}" for user ${userId}: ${res.reason instanceof Error ? res.reason.message : res.reason}`);
    });
    if (ok.length === 0) throw new Error('All connected exchanges failed to load. Run: pnpm cli test <exchange>');
    return ok;
  }

  private getPaperProvider(userId: string): PaperProvider {
    let provider = this.paperProviders.get(userId);
    if (!provider) {
      provider = new PaperProvider();
      this.paperProviders.set(userId, provider);
    }
    return provider;
  }

  // Drop cached provider instances for a user — call this from CLI flows that
  // change the credentials (`connect`, `disconnect`) so the next request
  // re-authenticates with fresh keys instead of using a stale connection.
  invalidateProviderCache(userId: string, providerName?: string): void {
    if (providerName) {
      this.cache.delete(`${userId}:${providerName}`);
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}:`)) this.cache.delete(key);
    }
  }

  private async loadProvider(userId: string, name: string): Promise<Provider> {
    const cacheKey = `${userId}:${name}`;
    const credsUpdatedAt = (await this.credentialService.getUpdatedAt(userId, name))?.getTime() ?? 0;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.credsUpdatedAt === credsUpdatedAt) return cached.provider;

    const ProviderClass = this.providerRegistry.get(name);
    if (!ProviderClass) throw new Error(`Provider "${name}" is not installed`);

    const provider = new (ProviderClass as new () => Provider)();
    const credentials = await this.credentialService.load(userId, name, this.masterPassword);
    const ok = await provider.connect(credentials);
    if (!ok) throw new Error(`Could not connect to ${name}. Check your API keys with: pnpm cli test ${name}`);

    this.cache.set(cacheKey, { provider, credsUpdatedAt });
    return provider;
  }

  private async portfolio(providers: Provider[], paper = ''): Promise<string> {
    const multiExchange = providers.length > 1;
    let totalUsd = 0;
    const sections: string[] = [];

    for (const provider of providers) {
      const balances = await provider.getBalance();
      if (balances.length === 0) continue;

      const lines: string[] = [];
      if (multiExchange) lines.push(`🏦 ${provider.name.toUpperCase()}`);

      for (const b of balances) {
        if (STABLECOINS.has(b.asset)) {
          totalUsd += b.total;
          lines.push(`${b.asset}: ${b.total.toFixed(2)}`);
        } else {
          try {
            const p = await provider.getPrice(`${b.asset}/USDT`);
            const usd = b.total * p;
            totalUsd += usd;
            lines.push(`${b.asset}: ${b.total} (~$${usd.toFixed(2)} @ $${p.toLocaleString()})`);
          } catch {
            lines.push(`${b.asset}: ${b.total}`);
          }
        }
      }

      sections.push(lines.join('\n'));
    }

    if (sections.length === 0) return `${paper}💼 Your portfolio is empty.`;

    const header = `${paper}💼 Portfolio\n`;
    const body = sections.join('\n\n');
    return `${header}\n${body}\n\n💰 Total: ~$${totalUsd.toFixed(2)}`;
  }

  private async price(provider: Provider, intent: TradeIntent): Promise<string> {
    const symbol = `${intent.asset}/${intent.quoteCurrency}`;
    const p = await provider.getPrice(symbol);
    return `${intent.asset}: $${p.toLocaleString()}`;
  }

  private async openOrders(provider: Provider, paper = ''): Promise<string> {
    const orders = await provider.getOrders();
    if (orders.length === 0) return `${paper}📋 No open orders.`;
    const lines = [`${paper}📋 Open Orders\n`];
    for (const o of orders) {
      const priceStr = o.price ? ` @ $${o.price.toLocaleString()}` : '';
      lines.push(`• ${o.side.toUpperCase()} ${o.amount} ${o.symbol}${priceStr} [${o.status}] — #${o.id}`);
    }
    return lines.join('\n');
  }

  // Returns the USD value of `intent`, or null if it cannot be determined.
  // Never swallows price/balance errors as zero — that would silently disable
  // the risk-size check (see risk.check).
  private async estimateUsdStrict(provider: Provider, intent: TradeIntent): Promise<number | null> {
    if (!intent.asset || !intent.quoteCurrency) return null;
    if (intent.amountType === 'quote') return intent.amount ?? 0;

    if (intent.amountType === 'percent') {
      const balances = await provider.getBalance();
      const b = balances.find(bal => bal.asset === intent.asset);
      if (!b) return 0;
      const price = await provider.getPrice(`${intent.asset}/${intent.quoteCurrency}`);
      if (!price) return null;
      return b.free * ((intent.amount ?? 0) / 100) * price;
    }

    if (intent.limitPrice && intent.amount) return intent.amount * intent.limitPrice;

    const price = await provider.getPrice(`${intent.asset}/${intent.quoteCurrency}`);
    if (!price) return null;
    return (intent.amount ?? 0) * price;
  }

  private async buy(provider: Provider, intent: TradeIntent, userId: string, chatId = '', paper = '', estimatedUsd = 0): Promise<string> {
    const symbol = `${intent.asset}/${intent.quoteCurrency}`;
    let amount = intent.amount ?? 0;

    if (intent.amountType === 'quote') {
      const p = intent.limitPrice ?? await provider.getPrice(symbol);
      if (p === 0) throw new Error(`Cannot fetch price for ${symbol}`);
      amount = amount / p;
    }

    if (intent.limitPrice) {
      const order = await provider.limitOrder(symbol, 'buy', amount, intent.limitPrice);
      await this.risk.recordOrder(userId, estimatedUsd);
      return `${paper}✅ Limit buy placed\n${order.amount} ${intent.asset} @ $${intent.limitPrice.toLocaleString()}\nOrder ID: ${order.id} — ${order.status}`;
    }

    const order = await provider.marketOrder(symbol, 'buy', amount);
    await this.risk.recordOrder(userId, estimatedUsd);
    const result = `${paper}✅ Market buy placed\n${order.amount} ${intent.asset}\nOrder ID: ${order.id} — ${order.status}`;

    await this.attachTpSl(intent, userId, chatId, provider, symbol);
    return result;
  }

  private async sell(provider: Provider, intent: TradeIntent, userId: string, chatId = '', paper = '', estimatedUsd = 0): Promise<string> {
    const symbol = `${intent.asset}/${intent.quoteCurrency}`;
    let amount = intent.amount ?? 0;

    if (intent.amountType === 'quote') {
      const p = intent.limitPrice ?? await provider.getPrice(symbol);
      if (p === 0) throw new Error(`Cannot fetch price for ${symbol}`);
      amount = amount / p;
    } else if (intent.amountType === 'percent') {
      const balances = await provider.getBalance();
      const b = balances.find(bal => bal.asset === intent.asset);
      if (!b || b.free === 0) throw new Error(`No free ${intent.asset} to sell`);
      amount = b.free * (amount / 100);
    }

    if (intent.limitPrice) {
      const order = await provider.limitOrder(symbol, 'sell', amount, intent.limitPrice);
      await this.risk.recordOrder(userId, estimatedUsd);
      return `${paper}✅ Limit sell placed\n${order.amount} ${intent.asset} @ $${intent.limitPrice.toLocaleString()}\nOrder ID: ${order.id} — ${order.status}`;
    }

    const order = await provider.marketOrder(symbol, 'sell', amount);
    await this.risk.recordOrder(userId, estimatedUsd);
    return `${paper}✅ Market sell placed\n${order.amount} ${intent.asset}\nOrder ID: ${order.id} — ${order.status}`;
  }

  private async limitOrder(provider: Provider, intent: TradeIntent, userId: string, chatId = '', paper = '', estimatedUsd = 0): Promise<string> {
    if (!intent.limitPrice) throw new Error('Limit price not specified. Example: "buy BTC at $60000"');
    if (!intent.amount) throw new Error('Amount not specified. Example: "buy 0.1 BTC at $60000"');

    const symbol = `${intent.asset}/${intent.quoteCurrency}`;
    // Convert quote amount ($100 at $10000) → base units (0.01 BTC)
    const baseAmount = intent.amountType === 'quote'
      ? intent.amount / intent.limitPrice
      : intent.amount;
    const side = (intent.side ?? 'buy') as 'buy' | 'sell';
    const order = await provider.limitOrder(symbol, side, baseAmount, intent.limitPrice);
    await this.risk.recordOrder(userId, estimatedUsd);
    return `${paper}✅ Limit ${side} order placed\n${order.amount} ${intent.asset} @ $${intent.limitPrice.toLocaleString()}\nOrder ID: ${order.id} — ${order.status}`;
  }

  private async cancelOrder(provider: Provider, intent: TradeIntent): Promise<string> {
    if (!intent.orderId) throw new Error('Order ID not specified. Example: "cancel order 123456"');
    const ok = await provider.cancelOrder(intent.orderId);
    return ok
      ? `✅ Order #${intent.orderId} cancelled.`
      : `❌ Could not cancel order #${intent.orderId}. It may already be filled or cancelled.`;
  }

  // ── Advanced strategies ───────────────────────────────────────────────────

  private async handleDca(intent: TradeIntent, userId: string, chatId: string): Promise<string> {
    if (!this.dcaService) return '⚠️ DCA service not available.';
    return this.dcaService.create(userId, chatId, intent);
  }

  private async handleAlert(intent: TradeIntent, userId: string, chatId: string): Promise<string> {
    if (!this.alertService) return '⚠️ Alert service not available.';
    return this.alertService.create(userId, chatId, intent);
  }

  private async handleAnalytics(userId: string): Promise<string> {
    if (!this.analyticsService) return '⚠️ Analytics service not available.';
    const providers = await this.getAllProviders(userId);
    return this.analyticsService.getPortfolioAnalytics(userId, providers);
  }

  private async attachTpSl(
    intent: TradeIntent,
    userId: string,
    chatId: string,
    provider: Provider,
    symbol: string,
  ): Promise<void> {
    if (!this.alertService) return;
    if (!intent.takeProfitPct && !intent.stopLossPct) return;
    try {
      const entryPrice = await provider.getPrice(symbol);
      if (entryPrice <= 0) return;
      await this.alertService.createTpSl(
        userId, chatId, intent.asset, intent.quoteCurrency,
        entryPrice, intent.takeProfitPct ?? null, intent.stopLossPct ?? null,
      );
    } catch {
      // Non-fatal — don't block the buy response
    }
  }

  async fetchPrice(asset: string, quoteCurrency: string, userId: string): Promise<number> {
    const provider = await this.getProvider(userId);
    return provider.getPrice(`${asset}/${quoteCurrency}`);
  }
}
