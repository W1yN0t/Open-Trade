import { Provider, type Balance, type Order, type ProviderCredentials } from '../base.ts';

interface PaperBalance {
  free: number;
  locked: number;
}

const DEFAULT_PRICES: Record<string, number> = {
  'BTC/USDT': 65000,
  'ETH/USDT': 3200,
  'SOL/USDT': 150,
  'BNB/USDT': 600,
  'XRP/USDT': 0.5,
};

export class PaperProvider extends Provider {
  readonly name = 'paper';

  private balances = new Map<string, PaperBalance>([
    ['USDT', { free: 10_000, locked: 0 }],
  ]);
  private orders: Order[] = [];
  private prices: Record<string, number>;

  constructor(prices: Record<string, number> = DEFAULT_PRICES) {
    super();
    this.prices = prices;
  }

  async connect(_credentials: ProviderCredentials): Promise<boolean> {
    return true;
  }

  async getBalance(): Promise<Balance[]> {
    const result: Balance[] = [];
    for (const [asset, bal] of this.balances) {
      if (bal.free + bal.locked > 0) {
        result.push({ asset, free: bal.free, locked: bal.locked, total: bal.free + bal.locked });
      }
    }
    return result;
  }

  async getPrice(symbol: string): Promise<number> {
    const price = this.prices[symbol];
    if (!price) throw new Error(`[PAPER] No price for ${symbol}`);
    return price;
  }

  async marketOrder(symbol: string, side: 'buy' | 'sell', amount: number): Promise<Order> {
    const price = await this.getPrice(symbol);
    const [base, quote] = symbol.split('/');

    if (side === 'buy') {
      const cost = amount * price;
      this.debit(quote, cost);
      this.credit(base, amount);
    } else {
      this.debit(base, amount);
      this.credit(quote, amount * price);
    }

    const order: Order = {
      id: `paper-${Date.now()}`,
      symbol, side, amount, price,
      type: 'market',
      status: 'filled',
      createdAt: new Date(),
    };
    this.orders.push(order);
    return order;
  }

  async limitOrder(symbol: string, side: 'buy' | 'sell', amount: number, price: number): Promise<Order> {
    const [base, quote] = symbol.split('/');

    // Reserve funds
    if (side === 'buy') {
      this.debit(quote, amount * price);
      this.lock(quote, amount * price);
    } else {
      this.debit(base, amount);
      this.lock(base, amount);
    }

    const order: Order = {
      id: `paper-${Date.now()}`,
      symbol, side, amount, price,
      type: 'limit',
      status: 'open',
      createdAt: new Date(),
    };
    this.orders.push(order);
    return order;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.find(o => o.id === orderId && o.status === 'open');
    if (!order) return false;

    const [base, quote] = order.symbol.split('/');
    if (order.side === 'buy') {
      this.unlock(quote, order.amount * (order.price ?? 0));
      this.credit(quote, order.amount * (order.price ?? 0));
    } else {
      this.unlock(base, order.amount);
      this.credit(base, order.amount);
    }

    order.status = 'cancelled';
    return true;
  }

  async getOrders(): Promise<Order[]> {
    return this.orders.filter(o => o.status === 'open');
  }

  private get(asset: string): PaperBalance {
    if (!this.balances.has(asset)) this.balances.set(asset, { free: 0, locked: 0 });
    return this.balances.get(asset)!;
  }

  private debit(asset: string, amount: number): void {
    const b = this.get(asset);
    if (b.free < amount) throw new Error(`[PAPER] Insufficient ${asset}: have ${b.free.toFixed(4)}, need ${amount.toFixed(4)}`);
    b.free -= amount;
  }

  private credit(asset: string, amount: number): void {
    this.get(asset).free += amount;
  }

  private lock(asset: string, amount: number): void {
    const b = this.get(asset);
    b.locked += amount;
  }

  private unlock(asset: string, amount: number): void {
    const b = this.get(asset);
    b.locked = Math.max(0, b.locked - amount);
  }
}
