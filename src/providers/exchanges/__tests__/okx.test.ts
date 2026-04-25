import { describe, it, expect, beforeAll } from 'vitest';
import { OkxProvider } from '../okx/provider.ts';

// Set to enable: OKX_TESTNET_KEY, OKX_TESTNET_SECRET, OKX_TESTNET_PASSWORD
const hasTestnetCreds =
  !!process.env.OKX_TESTNET_KEY &&
  !!process.env.OKX_TESTNET_SECRET &&
  !!process.env.OKX_TESTNET_PASSWORD;

describe.skipIf(!hasTestnetCreds)('OkxProvider — testnet integration', () => {
  let provider: OkxProvider;

  beforeAll(async () => {
    provider = new OkxProvider();
    const connected = await provider.connect({
      apiKey: process.env.OKX_TESTNET_KEY!,
      apiSecret: process.env.OKX_TESTNET_SECRET!,
      password: process.env.OKX_TESTNET_PASSWORD!,
    });
    if (!connected) throw new Error('Could not connect to OKX testnet');
  });

  it('connects to testnet', () => {
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

describe('OkxProvider — unit', () => {
  it('is instantiable', () => {
    const p = new OkxProvider();
    expect(p.name).toBe('okx');
  });

  it('throws when calling exchange methods before connect()', async () => {
    const p = new OkxProvider();
    await expect(p.getBalance()).rejects.toThrow('connect()');
  });

  it('throws on price fetch before connect()', async () => {
    const p = new OkxProvider();
    await expect(p.getPrice('BTC/USDT')).rejects.toThrow('connect()');
  });
});
