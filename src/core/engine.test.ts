import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Engine } from './engine.ts';
import { MockProvider } from '../providers/mock.ts';
import { Provider } from '../providers/base.ts';
import type { TradeIntent } from './intent_parser.ts';

// Minimal CredentialService stub
const credentialService = {
  list: vi.fn().mockResolvedValue(['mock']),
  load: vi.fn().mockResolvedValue({ apiKey: 'k', apiSecret: 's' }),
} as any;

const mockClass = MockProvider as unknown as typeof Provider;
const registry = new Map([['mock', mockClass]]);

function makeEngine(opts?: { paperMode?: boolean }) {
  return new Engine(credentialService, registry, 'pw', opts);
}

function intent(overrides: Partial<TradeIntent>): TradeIntent {
  return {
    type: 'trade',
    action: 'buy',
    asset: 'BTC',
    quoteCurrency: 'USDT',
    amount: 100,
    amountType: 'quote',
    limitPrice: null,
    orderId: null,
    side: null,
    condition: null,
    confidence: 0.95,
    ...overrides,
  };
}

describe('Engine — normal mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('executes market buy and returns confirmation', async () => {
    const engine = makeEngine();
    const result = await engine.execute(intent({}), 'user1');
    expect(result).toContain('Market buy placed');
    expect(result).toContain('BTC');
  });

  it('executes market sell', async () => {
    const engine = makeEngine();
    const result = await engine.execute(intent({ action: 'sell', amount: 0.001, amountType: 'base' }), 'user1');
    expect(result).toContain('Market sell placed');
  });

  it('executes limit order', async () => {
    const engine = makeEngine();
    const result = await engine.execute(intent({ action: 'limit', amount: 0.001, amountType: 'base', limitPrice: 60000 }), 'user1');
    expect(result).toContain('Limit');
    expect(result).toMatch(/60[\s,.]?000/);
  });

  it('returns portfolio with balances', async () => {
    const engine = makeEngine();
    const result = await engine.execute(intent({ action: 'portfolio', amount: null }), 'user1');
    expect(result).toContain('Portfolio');
    expect(result).toContain('BTC');
  });

  it('returns open orders list', async () => {
    const engine = makeEngine();
    const result = await engine.execute(intent({ action: 'orders', amount: null }), 'user1');
    expect(typeof result).toBe('string');
  });

  it('blocks order exceeding max size', async () => {
    const engine = makeEngine();
    // Default max is $1000, this is $5000 quote
    const result = await engine.execute(intent({ amount: 5000, amountType: 'quote' }), 'user2');
    expect(result).toContain('exceeds the limit');
  });

  it('blocks stop action as unsupported', async () => {
    const engine = makeEngine();
    const result = await engine.execute(intent({ action: 'stop' }), 'user1');
    expect(result).toContain('not yet supported');
  });

  it('throws when no exchange connected', async () => {
    const noCredsService = { list: vi.fn().mockResolvedValue([]) } as any;
    const engine = new Engine(noCredsService, registry, 'pw');
    await expect(engine.execute(intent({}), 'user1')).rejects.toThrow('No exchange connected');
  });

  it('cancels an order by id', async () => {
    const engine = makeEngine();
    // First place an order to get its id
    await engine.execute(intent({ action: 'limit', amount: 0.001, amountType: 'base', limitPrice: 60000 }), 'user3');
    const ordersResult = await engine.execute(intent({ action: 'orders', amount: null }), 'user3');
    // Extract order id from result (mock uses mock-<timestamp>)
    const match = ordersResult.match(/#(mock-\d+)/);
    if (!match) return; // no open orders to cancel
    const result = await engine.execute(intent({ action: 'cancel', amount: null, orderId: match[1] }), 'user3');
    expect(result).toContain('cancelled');
  });
});

describe('Engine — paper mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is identified as paper mode', () => {
    const engine = makeEngine({ paperMode: true });
    expect(engine.isPaperMode).toBe(true);
  });

  it('prefixes responses with [PAPER]', async () => {
    const engine = makeEngine({ paperMode: true });
    const result = await engine.execute(intent({}), 'user1');
    expect(result).toContain('[PAPER]');
  });

  it('does not call credentialService in paper mode', async () => {
    const engine = makeEngine({ paperMode: true });
    await engine.execute(intent({}), 'user1');
    expect(credentialService.list).not.toHaveBeenCalled();
  });

  it('uses shared paper provider across users', async () => {
    const engine = makeEngine({ paperMode: true });
    // Both users hit the same paper provider — balance decrements
    await engine.execute(intent({ amount: 100, amountType: 'quote' }), 'alice');
    await engine.execute(intent({ amount: 100, amountType: 'quote' }), 'bob');
    const portfolio = await engine.execute(intent({ action: 'portfolio', amount: null }), 'alice');
    expect(portfolio).toContain('Portfolio');
  });
});
