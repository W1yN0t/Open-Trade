import type { TradeIntent } from './intent_parser.ts';
import type { PostgresStorage } from '../storage/postgres.ts';

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
  largeOrderThresholdUsd: Number(process.env.RISK_LARGE_ORDER_THRESHOLD_USD ?? 500),
};

interface UserState {
  orderTimestamps: number[];
  lastLargeOrderAt: number | null;
}

export class RiskManager {
  // In-memory cache, hydrated lazily from storage on first touch per user.
  // Tests construct without storage and rely on this map only.
  private state = new Map<string, UserState>();
  // Tracks userIds whose state has already been hydrated from the DB so we
  // don't re-read on every check.
  private hydrated = new Set<string>();
  private config: RiskConfig;

  constructor(
    config: Partial<RiskConfig> = {},
    private readonly storage?: PostgresStorage,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // Returns error string if blocked, null if allowed
  async check(userId: string, intent: TradeIntent, estimatedUsd: number): Promise<string | null> {
    // Margin trading guard — block futures/margin actions
    if (this.isMarginAction(intent)) {
      return '⚠️ Margin and futures trading are disabled. Only spot orders are supported.';
    }

    // Max order size
    if (estimatedUsd > this.config.maxOrderUsd) {
      return `⚠️ Order size $${estimatedUsd.toFixed(2)} exceeds the limit of $${this.config.maxOrderUsd}. Adjust RISK_MAX_ORDER_USD to change.`;
    }

    const now = Date.now();
    const state = await this.getState(userId);

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

  // Call after a successful order execution. Persists the updated state if
  // a storage backend is configured so cooldowns survive restarts.
  async recordOrder(userId: string, estimatedUsd: number): Promise<void> {
    const state = await this.getState(userId);
    state.orderTimestamps.push(Date.now());
    if (estimatedUsd >= this.config.largeOrderThresholdUsd) {
      state.lastLargeOrderAt = Date.now();
    }
    await this.persist(userId, state);
  }

  private isMarginAction(intent: TradeIntent): boolean {
    const haystack = `${intent.asset ?? ''} ${intent.quoteCurrency ?? ''}`.toUpperCase();
    return /(?:^|[^A-Z])(PERP|SWAP|FUT|FUTURES?|MARGIN|LEVERAGE|LEVERAGED|SHORT)(?:[^A-Z]|$)/.test(haystack);
  }

  private async getState(userId: string): Promise<UserState> {
    let cached = this.state.get(userId);
    if (cached && this.hydrated.has(userId)) return cached;

    if (this.storage && !this.hydrated.has(userId)) {
      const persisted = await this.storage.getRiskState(userId);
      cached = {
        orderTimestamps: persisted.recentOrderTimestamps,
        lastLargeOrderAt: persisted.lastLargeOrderAt?.getTime() ?? null,
      };
      this.state.set(userId, cached);
      this.hydrated.add(userId);
      return cached;
    }

    if (!cached) {
      cached = { orderTimestamps: [], lastLargeOrderAt: null };
      this.state.set(userId, cached);
    }
    this.hydrated.add(userId);
    return cached;
  }

  private async persist(userId: string, state: UserState): Promise<void> {
    if (!this.storage) return;
    await this.storage.saveRiskState(userId, {
      recentOrderTimestamps: state.orderTimestamps,
      lastLargeOrderAt: state.lastLargeOrderAt !== null ? new Date(state.lastLargeOrderAt) : null,
    });
  }
}
