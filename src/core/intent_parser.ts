import { generateObject } from 'ai';
import { z } from 'zod';
import { getModel } from '../llm/provider.ts';

export const IntentSchema = z.object({
  type: z.enum(['trade', 'chat']),
  confidence: z.number().min(0).max(1).describe('Confidence score for the classification'),
  action: z
    .enum(['buy', 'sell', 'swap', 'limit', 'stop', 'portfolio', 'balance', 'price', 'orders', 'cancel', 'history'])
    .nullable()
    .describe('Trade action type, null for chat'),
  asset: z.string().nullable().describe('Asset symbol e.g. BTC, ETH, SOL. Null for chat'),
  quoteCurrency: z.string().nullable().describe('Quote currency, default USDT. Null for chat'),
  amount: z.number().nullable().describe('Numeric amount to trade. Null if not specified'),
  amountType: z
    .enum(['quote', 'base', 'percent'])
    .nullable()
    .describe('quote=in USD/USDT, base=in asset units, percent=% of holdings'),
  limitPrice: z.number().nullable().describe('Limit/stop price for limit and stop orders'),
  orderId: z.string().nullable().describe('Order ID for cancel operations'),
  side: z.enum(['buy', 'sell']).nullable().describe('Trade side: buy or sell. For action=limit/stop derive from context.'),
  condition: z.string().nullable().describe('Conditional trigger e.g. "when price drops to 150"'),
});

export type RawIntent = z.infer<typeof IntentSchema>;

export interface TradeIntent extends RawIntent {
  type: 'trade';
  action: NonNullable<RawIntent['action']>;
  asset: NonNullable<RawIntent['asset']>;
  quoteCurrency: NonNullable<RawIntent['quoteCurrency']>;
}

export const READ_ONLY_ACTIONS = new Set(['portfolio', 'balance', 'price', 'orders', 'history'] as const);

export interface ChatIntent extends RawIntent {
  type: 'chat';
}

export type Intent = TradeIntent | ChatIntent;

export function isTradeIntent(intent: RawIntent): intent is TradeIntent {
  return intent.type === 'trade' && intent.action !== null && intent.asset !== null;
}

export const INTENT_SYSTEM_PROMPT = `You are a financial intent classifier for a trading bot.
Analyze the user's message and classify it as "trade" or "chat".

TRADE: buying/selling assets, price checks, portfolio/balance queries, limit/stop orders, token swaps.
CHAT: general questions, greetings, market analysis requests, news, explanations, anything ambiguous.

CRITICAL SAFETY RULE: Only classify as "trade" if confidence >= 0.8. When in doubt → "chat".
Never trigger a trade on ambiguous input. A wrong trade costs real money.

SIDE FIELD RULES (very important):
- Set "side" to "buy" when the user is buying, swapping into, or placing a buy limit order.
- Set "side" to "sell" when the user is selling, exiting, or placing a sell limit order.
- For action="limit" or action="stop", always infer side from context ("buy X at $Y" → buy, "sell X at $Y" → sell).
- Never leave side null for trade intents.

AMOUNT EXTRACTION RULES (very important):
- "amount" is HOW MUCH the user wants to spend or trade, NOT the price.
- "limitPrice" is the TARGET PRICE at which the order should execute.
- These are always two separate fields — never mix them.
- If the message contains a spend amount in USD/USDT (e.g. "for $100", "на $100", "worth $100", "на 100$"), set amount=100 and amountType="quote".
- If the message contains an asset quantity (e.g. "0.5 BTC", "10 ETH"), set amount=0.5 and amountType="base".
- If BOTH are present (e.g. "buy 0.5 BTC at $10000 for $100"), prefer the spend amount: amount=100, amountType="quote", limitPrice=10000.
- Phrases like "по цене", "at price", "at $X", "по $X" always indicate limitPrice, never amount.

Default quoteCurrency to "USDT" if not specified.`;

export async function parseIntent(text: string, model: string): Promise<Intent> {
  const { object } = await generateObject({
    model: getModel(model),
    schema: IntentSchema,
    system: INTENT_SYSTEM_PROMPT,
    prompt: text,
  });

  return object as Intent;
}

export function formatClarification(intent: RawIntent): string {
  const action = intent.action ?? 'trade';
  const asset = intent.asset ?? 'the asset';
  return `I think you want to ${action} ${asset}, but I need more details.\n\nExample: "buy BTC for $500" or "sell 0.1 ETH"`;
}
