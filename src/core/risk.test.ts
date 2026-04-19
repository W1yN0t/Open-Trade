import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RiskManager } from './risk.ts';
import type { TradeIntent } from './intent_parser.ts';

function intent(overrides: Partial<TradeIntent> = {}): TradeIntent {
  return {
    type: 'trade',
    action: 'buy',
    asset: 'BTC',
    quoteCurrency: 'USDT',
    amount: 100,
    amountType: 'quote',
    limitPrice: null,
    orderId: null,
    condition: null,
    confidence: 0.95,
    ...overrides,
  };
}

describe('RiskManager — max order size', () => {
  it('allows order within limit', () => {
    const rm = new RiskManager({ maxOrderUsd: 1000 });
    expect(rm.check('u1', intent(), 500)).toBeNull();
  });

  it('blocks order exceeding limit', () => {
    const rm = new RiskManager({ maxOrderUsd: 1000 });
    const result = rm.check('u1', intent(), 1500);
    expect(result).toContain('exceeds the limit');
  });

  it('allows order exactly at limit', () => {
    const rm = new RiskManager({ maxOrderUsd: 1000 });
    expect(rm.check('u1', intent(), 1000)).toBeNull();
  });
});

describe('RiskManager — rate limiting', () => {
  it('allows up to max orders per minute', () => {
    const rm = new RiskManager({ maxOrdersPerMinute: 3, maxOrderUsd: 99999 });
    rm.recordOrder('u1', 100);
    rm.recordOrder('u1', 100);
    expect(rm.check('u1', intent(), 100)).toBeNull();
  });

  it('blocks when rate limit exceeded', () => {
    const rm = new RiskManager({ maxOrdersPerMinute: 2, maxOrderUsd: 99999 });
    rm.recordOrder('u1', 100);
    rm.recordOrder('u1', 100);
    const result = rm.check('u1', intent(), 100);
    expect(result).toContain('Rate limit');
  });

  it('rate limits are per-user', () => {
    const rm = new RiskManager({ maxOrdersPerMinute: 1, maxOrderUsd: 99999 });
    rm.recordOrder('u1', 100);
    // u2 has clean slate
    expect(rm.check('u2', intent(), 100)).toBeNull();
  });
});

describe('RiskManager — large order cooldown', () => {
  it('triggers cooldown after large order', () => {
    const rm = new RiskManager({ largeOrderThresholdUsd: 500, largOrderCooldownMs: 60_000, maxOrderUsd: 99999 });
    rm.recordOrder('u1', 600); // large order
    const result = rm.check('u1', intent(), 100);
    expect(result).toContain('Cooldown');
  });

  it('no cooldown after small order', () => {
    const rm = new RiskManager({ largeOrderThresholdUsd: 500, largOrderCooldownMs: 60_000, maxOrderUsd: 99999 });
    rm.recordOrder('u1', 100); // small order
    expect(rm.check('u1', intent(), 100)).toBeNull();
  });

  it('cooldown expires after configured time', () => {
    vi.useFakeTimers();
    const rm = new RiskManager({ largeOrderThresholdUsd: 500, largOrderCooldownMs: 1000, maxOrderUsd: 99999 });
    rm.recordOrder('u1', 600);
    expect(rm.check('u1', intent(), 100)).toContain('Cooldown');
    vi.advanceTimersByTime(1001);
    expect(rm.check('u1', intent(), 100)).toBeNull();
    vi.useRealTimers();
  });
});

describe('RiskManager — margin/futures block', () => {
  it('blocks stop orders', () => {
    const rm = new RiskManager();
    const result = rm.check('u1', intent({ action: 'stop' }), 100);
    expect(result).toContain('Margin');
  });

  it('allows spot actions', () => {
    const rm = new RiskManager({ maxOrderUsd: 99999 });
    expect(rm.check('u1', intent({ action: 'buy' }), 100)).toBeNull();
    expect(rm.check('u1', intent({ action: 'sell' }), 100)).toBeNull();
    expect(rm.check('u1', intent({ action: 'limit' }), 100)).toBeNull();
  });
});
