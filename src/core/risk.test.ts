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
    side: null,
    condition: null,
    interval: null,
    takeProfitPct: null,
    stopLossPct: null,
    confidence: 0.95,
    ...overrides,
  };
}

describe('RiskManager — max order size', () => {
  it('allows order within limit', async () => {
    const rm = new RiskManager({ maxOrderUsd: 1000 });
    expect(await rm.check('u1', intent(), 500)).toBeNull();
  });

  it('blocks order exceeding limit', async () => {
    const rm = new RiskManager({ maxOrderUsd: 1000 });
    const result = await rm.check('u1', intent(), 1500);
    expect(result).toContain('exceeds the limit');
  });

  it('allows order exactly at limit', async () => {
    const rm = new RiskManager({ maxOrderUsd: 1000 });
    expect(await rm.check('u1', intent(), 1000)).toBeNull();
  });
});

describe('RiskManager — rate limiting', () => {
  it('allows up to max orders per minute', async () => {
    const rm = new RiskManager({ maxOrdersPerMinute: 3, maxOrderUsd: 99999 });
    await rm.recordOrder('u1', 100);
    await rm.recordOrder('u1', 100);
    expect(await rm.check('u1', intent(), 100)).toBeNull();
  });

  it('blocks when rate limit exceeded', async () => {
    const rm = new RiskManager({ maxOrdersPerMinute: 2, maxOrderUsd: 99999 });
    await rm.recordOrder('u1', 100);
    await rm.recordOrder('u1', 100);
    const result = await rm.check('u1', intent(), 100);
    expect(result).toContain('Rate limit');
  });

  it('rate limits are per-user', async () => {
    const rm = new RiskManager({ maxOrdersPerMinute: 1, maxOrderUsd: 99999 });
    await rm.recordOrder('u1', 100);
    // u2 has clean slate
    expect(await rm.check('u2', intent(), 100)).toBeNull();
  });
});

describe('RiskManager — large order cooldown', () => {
  it('triggers cooldown after large order', async () => {
    const rm = new RiskManager({ largeOrderThresholdUsd: 500, largOrderCooldownMs: 60_000, maxOrderUsd: 99999 });
    await rm.recordOrder('u1', 600); // large order
    const result = await rm.check('u1', intent(), 100);
    expect(result).toContain('Cooldown');
  });

  it('no cooldown after small order', async () => {
    const rm = new RiskManager({ largeOrderThresholdUsd: 500, largOrderCooldownMs: 60_000, maxOrderUsd: 99999 });
    await rm.recordOrder('u1', 100); // small order
    expect(await rm.check('u1', intent(), 100)).toBeNull();
  });

  it('cooldown expires after configured time', async () => {
    vi.useFakeTimers();
    const rm = new RiskManager({ largeOrderThresholdUsd: 500, largOrderCooldownMs: 1000, maxOrderUsd: 99999 });
    await rm.recordOrder('u1', 600);
    expect(await rm.check('u1', intent(), 100)).toContain('Cooldown');
    vi.advanceTimersByTime(1001);
    expect(await rm.check('u1', intent(), 100)).toBeNull();
    vi.useRealTimers();
  });
});

describe('RiskManager — margin/futures block', () => {
  it('blocks perp/swap quote currencies', async () => {
    const rm = new RiskManager({ maxOrderUsd: 99999 });
    const result = await rm.check('u1', intent({ asset: 'BTC', quoteCurrency: 'USDT-PERP' }), 100);
    expect(result).toContain('Margin and futures');
  });

  it('blocks margin keyword in asset', async () => {
    const rm = new RiskManager({ maxOrderUsd: 99999 });
    const result = await rm.check('u1', intent({ asset: 'BTC-MARGIN', quoteCurrency: 'USDT' }), 100);
    expect(result).toContain('Margin and futures');
  });

  it('allows stop orders through risk (engine handles unsupported)', async () => {
    const rm = new RiskManager();
    const result = await rm.check('u1', intent({ action: 'stop' }), 100);
    expect(result).toBeNull();
  });

  it('allows spot actions', async () => {
    const rm = new RiskManager({ maxOrderUsd: 99999 });
    expect(await rm.check('u1', intent({ action: 'buy' }), 100)).toBeNull();
    expect(await rm.check('u1', intent({ action: 'sell' }), 100)).toBeNull();
    expect(await rm.check('u1', intent({ action: 'limit' }), 100)).toBeNull();
  });
});

describe('RiskManager — persistence', () => {
  it('hydrates state from storage on first check', async () => {
    const fakeStorage = {
      getRiskState: vi.fn().mockResolvedValue({
        recentOrderTimestamps: [Date.now() - 1000, Date.now() - 500],
        lastLargeOrderAt: null,
      }),
      saveRiskState: vi.fn().mockResolvedValue(undefined),
    } as any;
    const rm = new RiskManager({ maxOrdersPerMinute: 2, maxOrderUsd: 99999 }, fakeStorage);
    const result = await rm.check('u1', intent(), 100);
    expect(result).toContain('Rate limit');
    expect(fakeStorage.getRiskState).toHaveBeenCalledWith('u1');
  });

  it('persists state on recordOrder', async () => {
    const fakeStorage = {
      getRiskState: vi.fn().mockResolvedValue({ recentOrderTimestamps: [], lastLargeOrderAt: null }),
      saveRiskState: vi.fn().mockResolvedValue(undefined),
    } as any;
    const rm = new RiskManager({ largeOrderThresholdUsd: 500 }, fakeStorage);
    await rm.recordOrder('u1', 600);
    expect(fakeStorage.saveRiskState).toHaveBeenCalled();
    const saved = fakeStorage.saveRiskState.mock.calls[0][1];
    expect(saved.lastLargeOrderAt).toBeInstanceOf(Date);
    expect(saved.recentOrderTimestamps.length).toBe(1);
  });
});
