import type { TradeIntent } from './intent_parser.ts';

export interface RiskConfig {
  maxOrderUsd: number;       // default 1000
  maxOrdersPerMinute: number; // default 5
  largOrderCooldownMs: number; // cooldown after large order, default 60s
  largeOrderThresholdUsd: number; // what counts as "large", default 500
}

const DEFAULT_CONFIG: RiskConfig = {
  maxOrderUsd: Number(process.env.RISK_MAX_ORDER_USD ?? 1000),
  maxOrdersPerMinute: Number(process.env.RISK_MAX_ORDERS_PER_MINUTE ?? 5),
  largOrderCooldownMs: Number(process.env.RISK_LARGE_ORDER_COOLDOWN_MS ?? 60_000),
  largeOrderThresholdUsd: 500,
};

interface UserState {
  orderTimestamps: number[];
  lastLargeOrderAt: number | null;
}

export class RiskManager {
  private state = new Map<string, UserState>();
  private config: RiskConfig;

  constructor(config: Partial<RiskConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // Returns error string if blocked, null if allowed
  check(userId: string, intent: TradeIntent, estimatedUsd: number): string | null {
    // Margin trading guard — block futures/margin actions
    if (this.isMarginAction(intent)) {
      return '⚠️ Margin and futures trading are disabled. Only spot orders are supported.';
    }

    // Max order size
    if (estimatedUsd > this.config.maxOrderUsd) {
      return `⚠️ Order size $${estimatedUsd.toFixed(2)} exceeds the limit of $${this.config.maxOrderUsd}. Adjust RISK_MAX_ORDER_USD to change.`;
    }

    const now = Date.now();
    const state = this.getState(userId);

    // Cooldown after large order
    if (
      state.lastLargeOrderAt !== null &&
      now - state.lastLargeOrderAt < this.config.largOrderCooldownMs
    ) {
      const remainSec = Math.ceil((this.config.largOrderCooldownMs - (now - state.lastLargeOrderAt)) / 1000);
      return `⏳ Cooldown active after large order. Wait ${remainSec}s before next trade.`;
    }

    // Rate limiting: max N orders per minute
    const oneMinuteAgo = now - 60_000;
    state.orderTimestamps = state.orderTimestamps.filter(t => t > oneMinuteAgo);
    if (state.orderTimestamps.length >= this.config.maxOrdersPerMinute) {
      return `⚠️ Rate limit: max ${this.config.maxOrdersPerMinute} orders per minute. Slow down.`;
    }

    return null;
  }

  // Call after a successful order execution
  recordOrder(userId: string, estimatedUsd: number): void {
    const state = this.getState(userId);
    state.orderTimestamps.push(Date.now());
    if (estimatedUsd >= this.config.largeOrderThresholdUsd) {
      state.lastLargeOrderAt = Date.now();
    }
  }

  private isMarginAction(intent: TradeIntent): boolean {
    // stop orders are the only margin-adjacent action currently parsed
    return intent.action === 'stop';
  }

  private getState(userId: string): UserState {
    if (!this.state.has(userId)) {
      this.state.set(userId, { orderTimestamps: [], lastLargeOrderAt: null });
    }
    return this.state.get(userId)!;
  }
}
