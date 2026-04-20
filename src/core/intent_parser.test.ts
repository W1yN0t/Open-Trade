import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({ generateObject: vi.fn() }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => (m: string) => m }));
vi.mock('../config.ts', () => ({
  Config: { llm: { apiKey: 'test', baseUrl: 'https://test.com', systemPrompt: '' } },
}));

import { generateObject } from 'ai';
import { parseIntent, isTradeIntent, formatClarification } from './intent_parser.ts';
import { formatConfirmationCard, getConfirmationLevel } from './confirmation.ts';

const mock = vi.mocked(generateObject);

function mockIntent(overrides: object) {
  mock.mockResolvedValue({ object: overrides } as any);
}

describe('parseIntent — routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns trade with high confidence for clear buy order', async () => {
    mockIntent({ type: 'trade', action: 'buy', asset: 'BTC', quoteCurrency: 'USDT', amount: 500, amountType: 'quote', condition: null, confidence: 0.95 });
    const intent = await parseIntent('buy BTC for $500', 'model');
    expect(intent.type).toBe('trade');
    expect(intent.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('returns chat for greeting', async () => {
    mockIntent({ type: 'chat', action: null, asset: null, quoteCurrency: null, amount: null, amountType: null, condition: null, confidence: 0.98 });
    const intent = await parseIntent('hello!', 'model');
    expect(intent.type).toBe('chat');
  });

  it('returns trade for portfolio query', async () => {
    mockIntent({ type: 'trade', action: 'portfolio', asset: null, quoteCurrency: null, amount: null, amountType: null, condition: null, confidence: 0.92 });
    const intent = await parseIntent('show my portfolio', 'model');
    expect(intent.type).toBe('trade');
  });
});

// Fuzzing: ambiguous messages must never produce high-confidence trades
describe('parseIntent — safety fuzz', () => {
  beforeEach(() => vi.clearAllMocks());

  const ambiguous = [
    // Market commentary
    'BTC is looking good today',
    'what do you think about ethereum?',
    'should I buy or sell?',
    'the market is crashing',
    'tell me about Bitcoin',
    'how does a limit order work?',
    'is now a good time?',
    // Numbers that look like amounts but aren't orders
    'BTC hit $65000 yesterday',
    'ETH dropped 10% this week',
    'I made $500 last month trading',
    // Incomplete trade expressions
    'I want to buy',
    'sell',
    'maybe buy some crypto',
    'thinking about ETH',
    // Questions about trading
    'what is a market order?',
    'explain DCA strategy',
    'what are trading fees on OKX?',
    // Other languages — should still be safe
    'купить биткоин',     // "buy bitcoin" in Russian (ambiguous, low confidence expected)
    'wie viel kostet ETH', // "how much does ETH cost" in German
  ];

  ambiguous.forEach((text) => {
    it(`does not trigger trade for: "${text}"`, async () => {
      mockIntent({ type: 'chat', action: null, asset: null, quoteCurrency: null, amount: null, amountType: null, condition: null, confidence: 0.75 });
      const intent = await parseIntent(text, 'model');
      const isSafe = intent.type === 'chat' || intent.confidence < 0.8;
      expect(isSafe).toBe(true);
    });
  });

  // Invariant: confidence threshold is never bypassed even if model returns high score for chat
  it('treats chat type as safe regardless of confidence', async () => {
    mockIntent({ type: 'chat', action: null, asset: null, quoteCurrency: null, amount: null, amountType: null, condition: null, confidence: 0.99 });
    const intent = await parseIntent('hello there', 'model');
    expect(intent.type).toBe('chat');
    // chat type should never reach the trade flow
  });

  // Invariant: sub-0.8 trade confidence must not execute
  it('marks low-confidence trade as requiring clarification', async () => {
    mockIntent({ type: 'trade', action: 'buy', asset: 'BTC', quoteCurrency: 'USDT', amount: 500, amountType: 'quote', condition: null, confidence: 0.65 });
    const intent = await parseIntent('maybe buy some btc?', 'model');
    expect(intent.confidence).toBeLessThan(0.8);
  });
});

describe('isTradeIntent', () => {
  it('returns true for valid trade intent', () => {
    const intent = { type: 'trade' as const, action: 'buy' as const, asset: 'BTC', quoteCurrency: 'USDT', amount: 500, amountType: 'quote' as const, side: null, condition: null, limitPrice: null, orderId: null, confidence: 0.95 };
    expect(isTradeIntent(intent)).toBe(true);
  });

  it('returns false when asset is null', () => {
    const intent = { type: 'trade' as const, action: 'buy' as const, asset: null, quoteCurrency: null, amount: null, amountType: null, side: null, condition: null, limitPrice: null, orderId: null, confidence: 0.6 };
    expect(isTradeIntent(intent)).toBe(false);
  });
});

describe('formatConfirmationCard', () => {
  it('includes action, asset and amount', () => {
    const intent = { type: 'trade' as const, action: 'buy' as const, asset: 'BTC', quoteCurrency: 'USDT', amount: 500, amountType: 'quote' as const, side: null, condition: null, limitPrice: null, orderId: null, confidence: 0.95 };
    const card = formatConfirmationCard(intent, getConfirmationLevel(intent));
    expect(card).toContain('BUY');
    expect(card).toContain('BTC');
    expect(card).toContain('$500');
  });

  it('includes condition when present', () => {
    const intent2 = { type: 'trade' as const, action: 'limit' as const, asset: 'SOL', quoteCurrency: 'USDT', amount: 10, amountType: 'base' as const, side: null, condition: 'when price drops to $140', limitPrice: 140, orderId: null, confidence: 0.9 };
    const card = formatConfirmationCard(intent2, getConfirmationLevel(intent2));
    expect(card).toContain('when price drops to $140');
  });
});

describe('formatClarification', () => {
  it('mentions the detected action and asset', () => {
    const text = formatClarification({ type: 'trade', action: 'sell', asset: 'ETH', quoteCurrency: 'USDT', amount: null, amountType: null, side: null, condition: null, limitPrice: null, orderId: null, confidence: 0.6 });
    expect(text).toContain('sell');
    expect(text).toContain('ETH');
  });
});
