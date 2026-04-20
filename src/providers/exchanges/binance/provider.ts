import { binance, type Order as CcxtOrder } from 'ccxt';
import { Provider, type Balance, type Order, type ProviderCredentials } from '../../base.ts';

const STATUS_MAP: Record<string, Order['status']> = {
  open: 'open',
  closed: 'filled',
  canceled: 'cancelled',
  expired: 'cancelled',
  rejected: 'failed',
};

export class BinanceProvider extends Provider {
  readonly name = 'binance';

  private exchange: binance | null = null;
  private orderSymbols = new Map<string, string>();

  async connect(credentials: ProviderCredentials): Promise<boolean> {
    this.exchange = new binance({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
    });
    try {
      await this.exchange.loadMarkets();
      return true;
    } catch {
      this.exchange = null;
      return false;
    }
  }

  async getBalance(): Promise<Balance[]> {
    const raw = await this.ex().fetchBalance();
    const totals = raw.total as unknown as Record<string, number>;
    const free = raw.free as unknown as Record<string, number>;
    const used = raw.used as unknown as Record<string, number>;
    return Object.entries(totals)
      .filter(([, total]) => total > 0)
      .map(([asset, total]) => ({
        asset,
        free: free[asset] ?? 0,
        locked: used[asset] ?? 0,
        total,
      }));
  }

  async getPrice(symbol: string): Promise<number> {
    const ticker = await this.ex().fetchTicker(symbol);
    return ticker.last ?? 0;
  }

  async marketOrder(symbol: string, side: 'buy' | 'sell', amount: number): Promise<Order> {
    const raw = await this.ex().createOrder(symbol, 'market', side, amount);
    return this.mapOrder(raw);
  }

  async limitOrder(symbol: string, side: 'buy' | 'sell', amount: number, price: number): Promise<Order> {
    const raw = await this.ex().createOrder(symbol, 'limit', side, amount, price);
    return this.mapOrder(raw);
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.orderSymbols.has(orderId)) {
      try {
        const raw = await this.ex().fetchOpenOrders();
        raw.forEach((o: CcxtOrder) => this.mapOrder(o));
      } catch {
        return false;
      }
    }
    const symbol = this.orderSymbols.get(orderId);
    if (!symbol) return false;
    try {
      await this.ex().cancelOrder(orderId, symbol);
      this.orderSymbols.delete(orderId);
      return true;
    } catch {
      return false;
    }
  }

  async getOrders(): Promise<Order[]> {
    const raw = await this.ex().fetchOpenOrders();
    return raw.map((o: CcxtOrder) => this.mapOrder(o));
  }

  private ex(): binance {
    if (!this.exchange) throw new Error('BinanceProvider: call connect() first');
    return this.exchange;
  }

  private mapOrder(raw: CcxtOrder): Order {
    const order: Order = {
      id: raw.id,
      symbol: raw.symbol,
      side: raw.side as 'buy' | 'sell',
      type: raw.type === 'limit' ? 'limit' : 'market',
      amount: raw.amount,
      price: raw.price ?? undefined,
      status: STATUS_MAP[raw.status ?? ''] ?? 'open',
      createdAt: raw.timestamp ? new Date(raw.timestamp) : new Date(),
    };
    this.orderSymbols.set(order.id, order.symbol);
    return order;
  }
}
