import { Provider } from '../providers/base.ts';
import type { TradeIntent } from './intent_parser.ts';
import type { CredentialService } from './credentials.ts';
import { RiskManager } from './risk.ts';
import { PaperProvider } from '../providers/paper/provider.ts';

const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD', 'TUSD']);
const TRADE_ACTIONS = new Set(['buy', 'sell', 'swap', 'limit', 'stop']);

export class Engine {
  private cache = new Map<string, Provider>();
  private risk = new RiskManager();
  private paperProvider: PaperProvider | null = null;

  constructor(
    private readonly credentialService: CredentialService,
    private readonly providerRegistry: Map<string, typeof Provider>,
    private readonly masterPassword: string,
    private readonly options: { paperMode?: boolean } = {},
  ) {}

  async execute(intent: TradeIntent, userId: string): Promise<string> {
    const provider = await this.getProvider(userId);
    const paper = this.options.paperMode ? '[PAPER] ' : '';

    if (TRADE_ACTIONS.has(intent.action as string)) {
      const estimatedUsd = await this.estimateUsd(provider, intent);
      const blocked = this.risk.check(userId, intent, estimatedUsd);
      if (blocked) return blocked;
    }

    switch (intent.action) {
      case 'portfolio':
      case 'balance':  return this.portfolio(provider, paper);
      case 'price':    return this.price(provider, intent);
      case 'orders':   return this.openOrders(provider, paper);
      case 'buy':
      case 'swap':     return this.buy(provider, intent, userId, paper);
      case 'sell':     return this.sell(provider, intent, userId, paper);
      case 'limit':    return this.limitOrder(provider, intent, userId, paper);
      case 'cancel':   return this.cancelOrder(provider, intent);
      case 'stop':     return '⚠️ Stop orders are not yet supported by this provider.';
      default:         throw new Error(`Unsupported action: ${intent.action}`);
    }
  }

  get isPaperMode(): boolean {
    return !!this.options.paperMode;
  }

  private async getProvider(userId: string): Promise<Provider> {
    if (this.options.paperMode) {
      if (!this.paperProvider) this.paperProvider = new PaperProvider();
      return this.paperProvider;
    }

    const cached = this.cache.get(userId);
    if (cached) return cached;

    const names = await this.credentialService.list(userId);
    if (names.length === 0) {
      throw new Error('No exchange connected. Run: pnpm cli connect <exchange>');
    }

    const name = names[0];
    const ProviderClass = this.providerRegistry.get(name);
    if (!ProviderClass) throw new Error(`Provider "${name}" is not installed`);

    const provider = new (ProviderClass as new () => Provider)();
    const credentials = await this.credentialService.load(userId, name, this.masterPassword);
    const ok = await provider.connect(credentials);
    if (!ok) throw new Error(`Could not connect to ${name}. Check your API keys with: pnpm cli test ${name}`);

    this.cache.set(userId, provider);
    return provider;
  }

  private async portfolio(provider: Provider, paper = ''): Promise<string> {
    const balances = await provider.getBalance();
    if (balances.length === 0) return `${paper}💼 Your portfolio is empty.`;

    let totalUsd = 0;
    const lines: string[] = [`${paper}💼 Portfolio\n`];

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

    lines.push(`\n💰 Total: ~$${totalUsd.toFixed(2)}`);
    return lines.join('\n');
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

  private async estimateUsd(provider: Provider, intent: TradeIntent): Promise<number> {
    try {
      if (!intent.asset || !intent.quoteCurrency) return 0;
      if (intent.amountType === 'quote') return intent.amount ?? 0;
      if (intent.limitPrice && intent.amount) return intent.amount * intent.limitPrice;
      const price = await provider.getPrice(`${intent.asset}/${intent.quoteCurrency}`);
      return (intent.amount ?? 0) * price;
    } catch {
      return 0;
    }
  }

  private async buy(provider: Provider, intent: TradeIntent, userId: string, paper = ''): Promise<string> {
    const symbol = `${intent.asset}/${intent.quoteCurrency}`;
    let amount = intent.amount ?? 0;

    if (intent.amountType === 'quote') {
      const p = intent.limitPrice ?? await provider.getPrice(symbol);
      if (p === 0) throw new Error(`Cannot fetch price for ${symbol}`);
      amount = amount / p;
    }

    if (intent.limitPrice) {
      const order = await provider.limitOrder(symbol, 'buy', amount, intent.limitPrice);
      this.risk.recordOrder(userId, await this.estimateUsd(provider, intent));
      return `${paper}✅ Limit buy placed\n${order.amount} ${intent.asset} @ $${intent.limitPrice.toLocaleString()}\nOrder ID: ${order.id} — ${order.status}`;
    }

    const order = await provider.marketOrder(symbol, 'buy', amount);
    this.risk.recordOrder(userId, await this.estimateUsd(provider, intent));
    return `${paper}✅ Market buy placed\n${order.amount} ${intent.asset}\nOrder ID: ${order.id} — ${order.status}`;
  }

  private async sell(provider: Provider, intent: TradeIntent, userId: string, paper = ''): Promise<string> {
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
      this.risk.recordOrder(userId, await this.estimateUsd(provider, intent));
      return `${paper}✅ Limit sell placed\n${order.amount} ${intent.asset} @ $${intent.limitPrice.toLocaleString()}\nOrder ID: ${order.id} — ${order.status}`;
    }

    const order = await provider.marketOrder(symbol, 'sell', amount);
    this.risk.recordOrder(userId, await this.estimateUsd(provider, intent));
    return `${paper}✅ Market sell placed\n${order.amount} ${intent.asset}\nOrder ID: ${order.id} — ${order.status}`;
  }

  private async limitOrder(provider: Provider, intent: TradeIntent, userId: string, paper = ''): Promise<string> {
    if (!intent.limitPrice) throw new Error('Limit price not specified. Example: "buy BTC at $60000"');
    if (!intent.amount) throw new Error('Amount not specified. Example: "buy 0.1 BTC at $60000"');

    const symbol = `${intent.asset}/${intent.quoteCurrency}`;
    // Convert quote amount ($100 at $10000) → base units (0.01 BTC)
    const baseAmount = intent.amountType === 'quote'
      ? intent.amount / intent.limitPrice
      : intent.amount;
    const order = await provider.limitOrder(symbol, 'buy', baseAmount, intent.limitPrice);
    this.risk.recordOrder(userId, await this.estimateUsd(provider, intent));
    return `${paper}✅ Limit order placed\n${order.amount} ${intent.asset} @ $${intent.limitPrice.toLocaleString()}\nOrder ID: ${order.id} — ${order.status}`;
  }

  private async cancelOrder(provider: Provider, intent: TradeIntent): Promise<string> {
    if (!intent.orderId) throw new Error('Order ID not specified. Example: "cancel order 123456"');
    const ok = await provider.cancelOrder(intent.orderId);
    return ok
      ? `✅ Order #${intent.orderId} cancelled.`
      : `❌ Could not cancel order #${intent.orderId}. It may already be filled or cancelled.`;
  }
}
