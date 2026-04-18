import { Provider, type Balance, type Order, type ProviderCredentials } from './base.ts';

export class MockProvider extends Provider {
  readonly name = 'mock';
  private orders: Order[] = [];

  async connect(_credentials: ProviderCredentials): Promise<boolean> {
    return true;
  }

  async getBalance(): Promise<Balance[]> {
    return [
      { asset: 'BTC', free: 0.5, locked: 0, total: 0.5 },
      { asset: 'ETH', free: 2.0, locked: 0, total: 2.0 },
      { asset: 'USDT', free: 1000, locked: 0, total: 1000 },
    ];
  }

  async getPrice(symbol: string): Promise<number> {
    const prices: Record<string, number> = {
      'BTC/USDT': 65000,
      'ETH/USDT': 3200,
      'SOL/USDT': 150,
    };
    return prices[symbol] ?? 0;
  }

  async marketOrder(symbol: string, side: 'buy' | 'sell', amount: number): Promise<Order> {
    const order: Order = {
      id: `mock-${Date.now()}`,
      symbol, side, amount,
      type: 'market',
      status: 'filled',
      createdAt: new Date(),
    };
    this.orders.push(order);
    return order;
  }

  async limitOrder(symbol: string, side: 'buy' | 'sell', amount: number, price: number): Promise<Order> {
    const order: Order = {
      id: `mock-${Date.now()}`,
      symbol, side, amount, price,
      type: 'limit',
      status: 'open',
      createdAt: new Date(),
    };
    this.orders.push(order);
    return order;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.find(o => o.id === orderId);
    if (order) order.status = 'cancelled';
    return !!order;
  }

  async getOrders(): Promise<Order[]> {
    return [...this.orders];
  }
}
