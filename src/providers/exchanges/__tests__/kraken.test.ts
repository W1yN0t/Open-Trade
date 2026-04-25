import { describe, it, expect, beforeAll } from 'vitest';
import { KrakenProvider } from '../kraken/provider.ts';

// Set to enable: KRAKEN_API_KEY, KRAKEN_API_SECRET
// Note: Kraken has no official testnet — these tests use real credentials.
const hasTestnetCreds =
  !!process.env.KRAKEN_API_KEY &&
  !!process.env.KRAKEN_API_SECRET;

describe.skipIf(!hasTestnetCreds)('KrakenProvider — integration', () => {
  let provider: KrakenProvider;

  beforeAll(async () => {
    provider = new KrakenProvider();
    const connected = await provider.connect({
      apiKey: process.env.KRAKEN_API_KEY!,
      apiSecret: process.env.KRAKEN_API_SECRET!,
    });
    if (!connected) throw new Error('Could not connect to Kraken');
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

describe('KrakenProvider — unit', () => {
  it('is instantiable', () => {
    const p = new KrakenProvider();
    expect(p.name).toBe('kraken');
  });

  it('throws when calling exchange methods before connect()', async () => {
    const p = new KrakenProvider();
    await expect(p.getBalance()).rejects.toThrow('connect()');
  });

  it('throws on price fetch before connect()', async () => {
    const p = new KrakenProvider();
    await expect(p.getPrice('BTC/USDT')).rejects.toThrow('connect()');
  });
});
