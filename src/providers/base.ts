export interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface Order {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  amount: number;
  price?: number;
  status: 'open' | 'filled' | 'cancelled' | 'failed';
  createdAt: Date;
}

export interface Position {
  symbol: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
}

export interface ProviderCredentials {
  apiKey: string;
  apiSecret: string;
  password?: string;
  [key: string]: string | undefined;
}

export abstract class Provider {
  abstract readonly name: string;

  abstract connect(credentials: ProviderCredentials): Promise<boolean>;
  abstract getBalance(): Promise<Balance[]>;
  abstract getPrice(symbol: string): Promise<number>;
  abstract marketOrder(symbol: string, side: 'buy' | 'sell', amount: number): Promise<Order>;
  abstract limitOrder(symbol: string, side: 'buy' | 'sell', amount: number, price: number): Promise<Order>;
  abstract cancelOrder(orderId: string): Promise<boolean>;
  abstract getOrders(): Promise<Order[]>;
}
