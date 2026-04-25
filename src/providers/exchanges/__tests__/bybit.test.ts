import { describe, it, expect, beforeAll } from 'vitest';
import { BybitProvider } from '../bybit/provider.ts';

// Set to enable: BYBIT_API_KEY, BYBIT_API_SECRET
const hasTestnetCreds =
  !!process.env.BYBIT_API_KEY &&
  !!process.env.BYBIT_API_SECRET;

describe.skipIf(!hasTestnetCreds)('BybitProvider — integration', () => {
  let provider: BybitProvider;

  beforeAll(async () => {
    provider = new BybitProvider();
    const connected = await provider.connect({
      apiKey: process.env.BYBIT_API_KEY!,
      apiSecret: process.env.BYBIT_API_SECRET!,
    });
    if (!connected) throw new Error('Could not connect to Bybit');
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

describe('BybitProvider — unit', () => {
  it('is instantiable', () => {
    const p = new BybitProvider();
    expect(p.name).toBe('bybit');
  });

  it('throws when calling exchange methods before connect()', async () => {
    const p = new BybitProvider();
    await expect(p.getBalance()).rejects.toThrow('connect()');
  });

  it('throws on price fetch before connect()', async () => {
    const p = new BybitProvider();
    await expect(p.getPrice('BTC/USDT')).rejects.toThrow('connect()');
  });
});
