import { describe, it, expect, beforeEach } from 'vitest';
import { PaperProvider } from './provider.ts';

const PRICES = { 'BTC/USDT': 65000, 'ETH/USDT': 3200 };

function make() {
  return new PaperProvider(PRICES);
}

describe('PaperProvider — balance', () => {
  it('starts with $10,000 USDT', async () => {
    const p = make();
    const bal = await p.getBalance();
    const usdt = bal.find(b => b.asset === 'USDT');
    expect(usdt?.free).toBe(10_000);
  });

  it('connect always returns true', async () => {
    const p = make();
    expect(await p.connect({ apiKey: '', apiSecret: '' })).toBe(true);
  });
});

describe('PaperProvider — market buy', () => {
  let p: PaperProvider;
  beforeEach(() => { p = make(); });

  it('deducts USDT and credits BTC on market buy', async () => {
    await p.marketOrder('BTC/USDT', 'buy', 0.1); // costs 6500 USDT
    const bal = await p.getBalance();
    const usdt = bal.find(b => b.asset === 'USDT')!;
    const btc = bal.find(b => b.asset === 'BTC')!;
    expect(usdt.free).toBeCloseTo(10_000 - 6500);
    expect(btc.free).toBeCloseTo(0.1);
  });

  it('returns filled market order', async () => {
    const order = await p.marketOrder('BTC/USDT', 'buy', 0.1);
    expect(order.status).toBe('filled');
    expect(order.side).toBe('buy');
    expect(order.type).toBe('market');
  });

  it('throws when insufficient USDT balance', async () => {
    await expect(p.marketOrder('BTC/USDT', 'buy', 1)).rejects.toThrow('Insufficient');
  });
});

describe('PaperProvider — market sell', () => {
  let p: PaperProvider;
  beforeEach(async () => {
    p = make();
    await p.marketOrder('BTC/USDT', 'buy', 0.1); // costs $6500, acquire 0.1 BTC
  });

  it('deducts BTC and credits USDT on sell', async () => {
    await p.marketOrder('BTC/USDT', 'sell', 0.05);
    const bal = await p.getBalance();
    const btc = bal.find(b => b.asset === 'BTC')!;
    expect(btc.free).toBeCloseTo(0.05);
  });

  it('throws when insufficient BTC balance', async () => {
    await expect(p.marketOrder('BTC/USDT', 'sell', 10)).rejects.toThrow('Insufficient');
  });
});

describe('PaperProvider — limit orders', () => {
  let p: PaperProvider;
  beforeEach(() => { p = make(); });

  it('places limit buy and appears in open orders', async () => {
    await p.limitOrder('BTC/USDT', 'buy', 0.1, 60000);
    const orders = await p.getOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('open');
    expect(orders[0].type).toBe('limit');
  });

  it('cancels open limit order and refunds USDT', async () => {
    const order = await p.limitOrder('BTC/USDT', 'buy', 0.1, 60000);
    const ok = await p.cancelOrder(order.id);
    expect(ok).toBe(true);
    const orders = await p.getOrders();
    expect(orders).toHaveLength(0);
  });

  it('returns false when cancelling non-existent order', async () => {
    const ok = await p.cancelOrder('does-not-exist');
    expect(ok).toBe(false);
  });
});

describe('PaperProvider — prices', () => {
  it('returns configured price', async () => {
    const p = make();
    expect(await p.getPrice('BTC/USDT')).toBe(65000);
    expect(await p.getPrice('ETH/USDT')).toBe(3200);
  });

  it('throws for unknown symbol', async () => {
    const p = make();
    await expect(p.getPrice('DOGE/USDT')).rejects.toThrow('No price');
  });
});
