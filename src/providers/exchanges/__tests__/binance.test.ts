import { describe, it, expect, beforeAll } from 'vitest';
import { BinanceProvider } from '../binance/provider.ts';

// Set to enable: BINANCE_API_KEY, BINANCE_API_SECRET
const hasTestnetCreds =
  !!process.env.BINANCE_API_KEY &&
  !!process.env.BINANCE_API_SECRET;

describe.skipIf(!hasTestnetCreds)('BinanceProvider — integration', () => {
  let provider: BinanceProvider;

  beforeAll(async () => {
    provider = new BinanceProvider();
    const connected = await provider.connect({
      apiKey: process.env.BINANCE_API_KEY!,
      apiSecret: process.env.BINANCE_API_SECRET!,
    });
    if (!connected) throw new Error('Could not connect to Binance');
  });

  it('connects successfully', () => {
    expect(provider).toBeDefined();
  });

  it('fetches BTC/USDT price', async () => {
    const price = await provider.getPrice('BTC/USDT');
    expect(price).toBeGreaterThan(0);
  });

  it('fetches ETH/USDT price', async () => {
    const price = await provider.getPrice('ETH/USDT');
    expect(price).toBeGreaterThan(0);
  });

  it('fetches balance without throwing', async () => {
    const balances = await provider.getBalance();
    expect(Array.isArray(balances)).toBe(true);
    for (const b of balances) {
      expect(b.asset).toBeTruthy();
      expect(b.total).toBeGreaterThanOrEqual(0);
    }
  });

  it('fetches open orders without throwing', async () => {
    const orders = await provider.getOrders();
    expect(Array.isArray(orders)).toBe(true);
  });
});

describe('BinanceProvider — unit', () => {
  it('is instantiable', () => {
    const p = new BinanceProvider();
    expect(p.name).toBe('binance');
  });

  it('throws when calling exchange methods before connect()', async () => {
    const p = new BinanceProvider();
    await expect(p.getBalance()).rejects.toThrow('connect()');
  });

  it('throws on price fetch before connect()', async () => {
    const p = new BinanceProvider();
    await expect(p.getPrice('BTC/USDT')).rejects.toThrow('connect()');
  });
});
