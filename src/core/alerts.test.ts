import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertService } from './alerts.ts';
import type { TradeIntent } from './intent_parser.ts';

function makeIntent(overrides: Partial<TradeIntent> = {}): TradeIntent {
  return {
    type: 'trade',
    action: 'alert',
    asset: 'ETH',
    quoteCurrency: 'USDT',
    amount: null,
    amountType: null,
    limitPrice: 2000,
    orderId: null,
    side: null,
    condition: 'below',
    interval: null,
    takeProfitPct: null,
    stopLossPct: null,
    confidence: 0.95,
    ...overrides,
  };
}

describe('AlertService.create', () => {
  let storage: any;
  let service: AlertService;

  beforeEach(() => {
    storage = {
      createAlert: vi.fn().mockResolvedValue({ id: 'alert-abc' }),
    };
    service = new AlertService(storage);
  });

  it('stores condition=below for "drops below"', async () => {
    await service.create('u1', 'c1', makeIntent({ condition: 'drops below 2000' }));
    const call = storage.createAlert.mock.calls[0][0];
    expect(call.condition).toBe('below');
  });

  it('stores condition=above for "rises above"', async () => {
    await service.create('u1', 'c1', makeIntent({ condition: 'rises above 3000', limitPrice: 3000 }));
    const call = storage.createAlert.mock.calls[0][0];
    expect(call.condition).toBe('above');
  });

  it('stores correct targetPrice', async () => {
    await service.create('u1', 'c1', makeIntent({ limitPrice: 1500 }));
    const call = storage.createAlert.mock.calls[0][0];
    expect(call.targetPrice).toBe(1500);
  });

  it('returns error when limitPrice is missing', async () => {
    const result = await service.create('u1', 'c1', makeIntent({ limitPrice: null }));
    expect(result).toContain('❌');
    expect(storage.createAlert).not.toHaveBeenCalled();
  });

  it('returns confirmation message with asset and price', async () => {
    const msg = await service.create('u1', 'c1', makeIntent());
    expect(msg).toContain('ETH');
    expect(msg).toMatch(/2[\s,.]?000/);
  });
});

describe('AlertService.createTpSl', () => {
  let storage: any;
  let service: AlertService;

  beforeEach(() => {
    storage = {
      createAlert: vi.fn().mockResolvedValue({ id: 'alert-xyz' }),
    };
    service = new AlertService(storage);
  });

  it('creates two alerts when both TP and SL are set', async () => {
    await service.createTpSl('u1', 'c1', 'SOL', 'USDT', 100, 20, 10);
    expect(storage.createAlert).toHaveBeenCalledTimes(2);
  });

  it('creates only TP alert when SL is null', async () => {
    await service.createTpSl('u1', 'c1', 'SOL', 'USDT', 100, 20, null);
    expect(storage.createAlert).toHaveBeenCalledTimes(1);
    const call = storage.createAlert.mock.calls[0][0];
    expect(call.condition).toBe('above');
  });

  it('creates only SL alert when TP is null', async () => {
    await service.createTpSl('u1', 'c1', 'SOL', 'USDT', 100, null, 10);
    expect(storage.createAlert).toHaveBeenCalledTimes(1);
    const call = storage.createAlert.mock.calls[0][0];
    expect(call.condition).toBe('below');
  });

  it('sets TP price above entry price', async () => {
    await service.createTpSl('u1', 'c1', 'SOL', 'USDT', 100, 20, null);
    const call = storage.createAlert.mock.calls[0][0];
    expect(call.targetPrice).toBeCloseTo(120, 1);
  });

  it('sets SL price below entry price', async () => {
    await service.createTpSl('u1', 'c1', 'SOL', 'USDT', 100, null, 10);
    const call = storage.createAlert.mock.calls[0][0];
    expect(call.targetPrice).toBeCloseTo(90, 1);
  });

  it('includes triggerAction for auto-sell', async () => {
    await service.createTpSl('u1', 'c1', 'BTC', 'USDT', 50000, 10, null);
    const call = storage.createAlert.mock.calls[0][0];
    expect(call.triggerAction).toBeDefined();
    expect(call.triggerAction.action).toBe('sell');
  });
});

describe('AlertService.list', () => {
  it('returns no-alerts message when empty', async () => {
    const storage = { listAlerts: vi.fn().mockResolvedValue([]) };
    const service = new AlertService(storage as any);
    const result = await service.list('u1');
    expect(result).toContain('No active');
  });

  it('shows asset and price', async () => {
    const storage = {
      listAlerts: vi.fn().mockResolvedValue([{
        id: 'abc12345',
        asset: 'BTC',
        quoteCurrency: 'USDT',
        condition: 'below',
        targetPrice: 40000,
        triggerAction: null,
      }]),
    };
    const service = new AlertService(storage as any);
    const result = await service.list('u1');
    expect(result).toContain('BTC');
    expect(result).toMatch(/40[\s,.]?000/);
  });
});
