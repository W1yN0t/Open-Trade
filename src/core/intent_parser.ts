import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { Config } from '../config.ts';

const openrouter = createOpenAI({
  baseURL: Config.llm.baseUrl,
  apiKey: Config.llm.apiKey,
  compatibility: 'compatible',
});

export const IntentSchema = z.object({
  type: z.enum(['trade', 'chat']),
  confidence: z.number().min(0).max(1).describe('Confidence score for the classification'),
  action: z
    .enum(['buy', 'sell', 'swap', 'limit', 'stop', 'portfolio', 'balance', 'price', 'orders', 'cancel'])
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
  condition: z.string().nullable().describe('Conditional trigger e.g. "when price drops to 150"'),
});

export type RawIntent = z.infer<typeof IntentSchema>;

export interface TradeIntent extends RawIntent {
  type: 'trade';
  action: NonNullable<RawIntent['action']>;
  asset: NonNullable<RawIntent['asset']>;
  quoteCurrency: NonNullable<RawIntent['quoteCurrency']>;
}

export const READ_ONLY_ACTIONS = new Set(['portfolio', 'balance', 'price', 'orders'] as const);

export interface ChatIntent extends RawIntent {
  type: 'chat';
}

export type Intent = TradeIntent | ChatIntent;

export function isTradeIntent(intent: RawIntent): intent is TradeIntent {
  return intent.type === 'trade' && intent.action !== null && intent.asset !== null;
}

const SYSTEM_PROMPT = `You are a financial intent classifier for a trading bot.
Analyze the user's message and classify it as "trade" or "chat".

TRADE: buying/selling assets, price checks, portfolio/balance queries, limit/stop orders, token swaps.
CHAT: general questions, greetings, market analysis requests, news, explanations, anything ambiguous.

CRITICAL SAFETY RULE: Only classify as "trade" if confidence >= 0.8. When in doubt → "chat".
Never trigger a trade on ambiguous input. A wrong trade costs real money.

For trade intents: extract all parameters you can determine from the message.
Default quoteCurrency to "USDT" if not specified.`;

export async function parseIntent(text: string, model: string): Promise<Intent> {
  const { object } = await generateObject({
    model: openrouter(model),
    schema: IntentSchema,
    system: SYSTEM_PROMPT,
    prompt: text,
  });

  return object as Intent;
}

export function formatClarification(intent: RawIntent): string {
  const action = intent.action ?? 'trade';
  const asset = intent.asset ?? 'the asset';
  return `I think you want to ${action} ${asset}, but I need more details.\n\nExample: "buy BTC for $500" or "sell 0.1 ETH"`;
}
