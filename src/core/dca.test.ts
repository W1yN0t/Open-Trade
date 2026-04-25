import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseInterval, DcaService } from './dca.ts';
import type { TradeIntent } from './intent_parser.ts';

// ── parseInterval ─────────────────────────────────────────────────────────────

describe('parseInterval', () => {
  it('parses hourly', () => {
    expect(parseInterval('hourly')).toBe(60 * 60 * 1000);
    expect(parseInterval('every hour')).toBe(60 * 60 * 1000);
  });

  it('parses daily', () => {
    expect(parseInterval('daily')).toBe(24 * 60 * 60 * 1000);
    expect(parseInterval('every day')).toBe(24 * 60 * 60 * 1000);
  });

  it('parses weekly', () => {
    expect(parseInterval('weekly')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseInterval('every week')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseInterval('every Monday')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('parses monthly', () => {
    expect(parseInterval('monthly')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(parseInterval('every month')).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('parses every N days', () => {
    expect(parseInterval('every 3 days')).toBe(3 * 24 * 60 * 60 * 1000);
    expect(parseInterval('every 2 weeks')).toBe(2 * 7 * 24 * 60 * 60 * 1000);
  });

  it('defaults to daily for unknown input', () => {
    expect(parseInterval('biannually')).toBe(24 * 60 * 60 * 1000);
  });
});

// ── DcaService ────────────────────────────────────────────────────────────────

function makeIntent(overrides: Partial<TradeIntent> = {}): TradeIntent {
  return {
    type: 'trade',
    action: 'dca',
    asset: 'BTC',
    quoteCurrency: 'USDT',
    amount: 100,
    amountType: 'quote',
    limitPrice: null,
    orderId: null,
    side: 'buy',
    condition: null,
    interval: 'weekly',
    takeProfitPct: null,
    stopLossPct: null,
    confidence: 0.95,
    ...overrides,
  };
}

describe('DcaService.create', () => {
  let storage: any;
  let service: DcaService;

  beforeEach(() => {
    storage = {
      createDca: vi.fn().mockResolvedValue({ id: 'dca-123' }),
    };
    service = new DcaService(storage);
  });

  it('stores correct intervalMs for weekly', async () => {
    await service.create('u1', 'c1', makeIntent({ interval: 'weekly' }));
    const call = storage.createDca.mock.calls[0][0];
    expect(call.intervalMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('stores correct intervalMs for daily', async () => {
    await service.create('u1', 'c1', makeIntent({ interval: 'daily' }));
    const call = storage.createDca.mock.calls[0][0];
    expect(call.intervalMs).toBe(24 * 60 * 60 * 1000);
  });

  it('sets nextRunAt in the future', async () => {
    const before = Date.now();
    await service.create('u1', 'c1', makeIntent());
    const call = storage.createDca.mock.calls[0][0];
    expect(call.nextRunAt.getTime()).toBeGreaterThan(before);
  });

  it('returns confirmation message with asset and interval', async () => {
    const msg = await service.create('u1', 'c1', makeIntent());
    expect(msg).toContain('BTC');
    expect(msg).toContain('DCA');
  });

  it('defaults interval to daily when null', async () => {
    await service.create('u1', 'c1', makeIntent({ interval: null }));
    const call = storage.createDca.mock.calls[0][0];
    expect(call.intervalMs).toBe(24 * 60 * 60 * 1000);
  });
});

describe('DcaService.list', () => {
  it('returns no-schedules message when empty', async () => {
    const storage = { listDca: vi.fn().mockResolvedValue([]) };
    const service = new DcaService(storage as any);
    const result = await service.list('u1');
    expect(result).toContain('No active DCA');
  });

  it('lists schedules with asset and interval', async () => {
    const storage = {
      listDca: vi.fn().mockResolvedValue([{
        id: 'abc123',
        asset: 'ETH',
        quoteCurrency: 'USDT',
        amount: 50,
        intervalMs: 7 * 24 * 60 * 60 * 1000,
        nextRunAt: new Date('2026-05-01T12:00:00Z'),
      }]),
    };
    const service = new DcaService(storage as any);
    const result = await service.list('u1');
    expect(result).toContain('ETH');
    expect(result).toContain('50');
  });
});

describe('DcaService.cancel', () => {
  it('returns success when cancelled', async () => {
    const storage = { cancelDca: vi.fn().mockResolvedValue(true) };
    const service = new DcaService(storage as any);
    const result = await service.cancel('id1', 'u1');
    expect(result).toContain('cancelled');
  });

  it('returns error when not found', async () => {
    const storage = { cancelDca: vi.fn().mockResolvedValue(false) };
    const service = new DcaService(storage as any);
    const result = await service.cancel('id1', 'u1');
    expect(result).toContain('not found');
  });
});
