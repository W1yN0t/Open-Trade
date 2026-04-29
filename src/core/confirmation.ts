import type { PostgresStorage } from '../storage/postgres.ts';
import type { TradeIntent } from './intent_parser.ts';

export type ConfirmationState =
  | 'CREATED' | 'SHOWN' | 'CONFIRMED' | 'EXECUTING'
  | 'DONE' | 'CANCELLED' | 'EXPIRED' | 'FAILED';

export type ConfirmationSubState = 'WAITING_AMOUNT' | 'WAITING_RECONFIRM' | null;
export type ConfirmationLevel = 'normal' | 'large' | 'critical';

export const CONFIRMATION_TIMEOUT_MS = 60_000;

export interface StoredConfirmation {
  id: string;
  userId: string;
  chatId: string;
  messageId: string | null;
  intent: TradeIntent;
  state: ConfirmationState;
  subState: ConfirmationSubState;
  expectedInput: string | null;
  createdAt: Date;
  expiresAt: Date;
}

// `estimatedUsd === null` means "could not determine USD value" — escalate to
// critical so a non-quote trade (e.g. "sell 50 ETH") cannot slip through with
// a single tap when its true USD value is unknown.
export function getConfirmationLevel(intent: TradeIntent, estimatedUsd: number | null = null): ConfirmationLevel {
  // DCA is judged by its monthly commitment, not the per-tick amount.
  if (intent.action === 'dca') {
    const monthly = estimateDcaMonthlyUsd(intent);
    if (monthly === null || monthly > 5000) return 'critical';
    if (monthly > 500) return 'large';
    return 'normal';
  }

  if (intent.amountType === 'percent' && (intent.amount ?? 0) >= 100) return 'critical';
  if (intent.amountType === 'quote' && (intent.amount ?? 0) > 5000) return 'critical';
  if (intent.amountType === 'quote' && (intent.amount ?? 0) > 500) return 'large';
  if (estimatedUsd === null && intent.amountType !== 'quote') return 'critical';
  if (estimatedUsd !== null && estimatedUsd > 5000) return 'critical';
  if (estimatedUsd !== null && estimatedUsd > 500) return 'large';
  return 'normal';
}

// Approximate monthly spend for a DCA schedule. Returns null when we cannot
// derive it (unknown interval / non-quote amount) — getConfirmationLevel
// treats that as critical so the user always sees the strictest gate.
function estimateDcaMonthlyUsd(intent: TradeIntent): number | null {
  if (intent.amountType !== 'quote' || intent.amount === null) return null;
  const intervalMs = intervalToMs(intent.interval ?? 'daily');
  if (intervalMs === null) return null;
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  return intent.amount * (monthMs / intervalMs);
}

function intervalToMs(spec: string): number | null {
  const s = spec.toLowerCase().trim();
  if (s === 'hourly' || s === 'every hour') return 60 * 60 * 1000;
  if (s === 'daily' || s === 'every day') return 24 * 60 * 60 * 1000;
  if (s === 'weekly' || s === 'every week' || s === 'every monday') return 7 * 24 * 60 * 60 * 1000;
  if (s === 'monthly' || s === 'every month') return 30 * 24 * 60 * 60 * 1000;
  const everyN = s.match(/every\s+(\d+)\s+(hour|day|week|month)s?/);
  if (everyN) {
    const n = parseInt(everyN[1], 10);
    const unit = everyN[2];
    if (unit === 'hour') return n * 60 * 60 * 1000;
    if (unit === 'day') return n * 24 * 60 * 60 * 1000;
    if (unit === 'week') return n * 7 * 24 * 60 * 60 * 1000;
    if (unit === 'month') return n * 30 * 24 * 60 * 60 * 1000;
  }
  return null;
}

export function formatConfirmationCard(intent: TradeIntent, level: ConfirmationLevel): string {
  if (intent.action === 'dca') return formatDcaCard(intent, level);

  const header =
    level === 'critical' ? '🚨 Trade Confirmation — CRITICAL'
    : level === 'large'  ? '⚠️  Trade Confirmation — Large Order'
    :                      '📋 Trade Confirmation';

  const lines = [header, ''];
  lines.push(`Action: ${intent.action.toUpperCase()}`);
  lines.push(`Asset:  ${intent.asset}/${intent.quoteCurrency}`);

  if (intent.amount !== null) {
    const unit =
      intent.amountType === 'quote'   ? `$${intent.amount}`
      : intent.amountType === 'percent' ? `${intent.amount}%`
      : `${intent.amount} ${intent.asset}`;
    lines.push(`Amount: ${unit}`);
  }

  if (intent.limitPrice !== null) {
    lines.push(`Limit Price: $${intent.limitPrice.toLocaleString()}`);
  }

  if (intent.condition) lines.push(`Condition: ${intent.condition}`);

  // TP/SL is attached to a buy as an auto-sell trigger that fires without a
  // further confirmation — surface it on the card so the user sees what they
  // are agreeing to in advance.
  if (intent.takeProfitPct !== null || intent.stopLossPct !== null) {
    lines.push('');
    lines.push('Auto-exit triggers (sells 100% of position when hit):');
    if (intent.takeProfitPct !== null) lines.push(`  • Take-profit: +${intent.takeProfitPct}%`);
    if (intent.stopLossPct !== null) lines.push(`  • Stop-loss:   -${intent.stopLossPct}%`);
    lines.push('⚠️ Triggers fire as market sells with no extra prompt.');
  }

  lines.push('');
  if (level === 'normal') {
    lines.push('Press ✅ to confirm or ❌ to cancel.');
  } else if (level === 'large') {
    lines.push('Press ✅ then type the exact amount to confirm.');
  } else {
    lines.push('⚠️  Extra confirmation required for this trade size.');
    lines.push('Press ✅ then type the amount, then confirm again.');
  }

  return lines.join('\n');
}

function formatDcaCard(intent: TradeIntent, level: ConfirmationLevel): string {
  const header =
    level === 'critical' ? '🚨 DCA Schedule — CRITICAL commitment'
    : level === 'large'  ? '⚠️  DCA Schedule — Large commitment'
    :                      '📅 DCA Schedule';

  const lines = [header, ''];
  lines.push(`Action: BUY ${intent.asset}/${intent.quoteCurrency}`);

  if (intent.amount !== null && intent.amountType === 'quote') {
    lines.push(`Per run: $${intent.amount}`);
  } else if (intent.amount !== null) {
    lines.push(`Per run: ${intent.amount} ${intent.amountType === 'percent' ? '%' : intent.asset}`);
  }

  const interval = intent.interval ?? 'daily';
  lines.push(`Interval: ${interval}`);

  const monthly = estimateDcaMonthlyUsd(intent);
  if (monthly !== null) {
    lines.push(`Est. monthly cost: ~$${monthly.toFixed(2)}`);
    lines.push(`Est. yearly cost:  ~$${(monthly * 12).toFixed(2)}`);
  }

  lines.push('');
  lines.push('⚠️ After confirmation, orders execute automatically');
  lines.push('   on every tick without further prompts.');
  lines.push('');

  if (level === 'normal') {
    lines.push('Press ✅ to create or ❌ to cancel.');
  } else if (level === 'large') {
    lines.push('Press ✅ then retype the per-run amount to confirm.');
  } else {
    lines.push('Press ✅, retype the amount, then confirm again.');
  }
  return lines.join('\n');
}

export class ConfirmationService {
  async create(
    userId: string,
    chatId: string,
    intent: TradeIntent,
    storage: PostgresStorage,
  ): Promise<StoredConfirmation> {
    const expiresAt = new Date(Date.now() + CONFIRMATION_TIMEOUT_MS);
    return storage.createConfirmation({ userId, chatId, intent, expiresAt });
  }

  async markShown(id: string, messageId: string, storage: PostgresStorage): Promise<void> {
    await storage.updateConfirmation(id, { state: 'SHOWN', messageId });
  }

  async getActiveForUser(userId: string, storage: PostgresStorage): Promise<StoredConfirmation | null> {
    return storage.getActiveConfirmation(userId);
  }

  // Returns next action for the caller to perform.
  // All state writes go through tryTransitionConfirmation so two concurrent
  // ✅ presses cannot both win the SHOWN→CONFIRMED transition.
  async handleConfirmButton(
    id: string,
    storage: PostgresStorage,
  ): Promise<{ action: 'confirmed' | 'ask_amount' | 'already_handled'; confirmation: StoredConfirmation | null }> {
    const confirmation = await storage.getConfirmationById(id);

    if (!confirmation || confirmation.state !== 'SHOWN' || confirmation.subState !== null) {
      return { action: 'already_handled', confirmation: null };
    }

    const level = getConfirmationLevel(confirmation.intent);

    if (level === 'normal') {
      const won = await storage.tryTransitionConfirmation(
        id,
        { state: 'SHOWN', subState: null },
        { state: 'CONFIRMED' },
      );
      return won
        ? { action: 'confirmed', confirmation }
        : { action: 'already_handled', confirmation: null };
    }

    const expected = String(confirmation.intent.amount ?? '');
    const won = await storage.tryTransitionConfirmation(
      id,
      { state: 'SHOWN', subState: null },
      { subState: 'WAITING_AMOUNT', expectedInput: expected },
    );
    return won
      ? { action: 'ask_amount', confirmation }
      : { action: 'already_handled', confirmation: null };
  }

  async handleAmountInput(
    confirmation: StoredConfirmation,
    input: string,
    storage: PostgresStorage,
  ): Promise<{ valid: boolean; nextAction: 'confirmed' | 'ask_reconfirm' | 'already_handled' }> {
    const normalize = (s: string) => s.trim().replace(/[$,%\s]/g, '');

    if (normalize(input) !== normalize(confirmation.expectedInput ?? '')) {
      await storage.tryTransitionConfirmation(
        confirmation.id,
        { state: 'SHOWN', subState: 'WAITING_AMOUNT' },
        { state: 'CANCELLED', subState: null },
      );
      return { valid: false, nextAction: 'already_handled' };
    }

    const level = getConfirmationLevel(confirmation.intent);

    if (level === 'critical') {
      const won = await storage.tryTransitionConfirmation(
        confirmation.id,
        { state: 'SHOWN', subState: 'WAITING_AMOUNT' },
        { subState: 'WAITING_RECONFIRM', expectedInput: null },
      );
      return won
        ? { valid: true, nextAction: 'ask_reconfirm' }
        : { valid: false, nextAction: 'already_handled' };
    }

    const won = await storage.tryTransitionConfirmation(
      confirmation.id,
      { state: 'SHOWN', subState: 'WAITING_AMOUNT' },
      { state: 'CONFIRMED', subState: null },
    );
    return won
      ? { valid: true, nextAction: 'confirmed' }
      : { valid: false, nextAction: 'already_handled' };
  }

  async handleReconfirmButton(
    id: string,
    storage: PostgresStorage,
  ): Promise<{ action: 'confirmed' | 'already_handled' }> {
    const won = await storage.tryTransitionConfirmation(
      id,
      { state: 'SHOWN', subState: 'WAITING_RECONFIRM' },
      { state: 'CONFIRMED', subState: null },
    );
    return won ? { action: 'confirmed' } : { action: 'already_handled' };
  }

  async handleCancelButton(id: string, storage: PostgresStorage): Promise<boolean> {
    // Cancel can race with confirm — try CREATED then SHOWN; either wins benignly.
    const cancelled =
      (await storage.tryTransitionConfirmation(id, { state: 'SHOWN' }, { state: 'CANCELLED', subState: null })) ||
      (await storage.tryTransitionConfirmation(id, { state: 'CREATED' }, { state: 'CANCELLED', subState: null }));
    return cancelled;
  }

  async expireStale(storage: PostgresStorage): Promise<StoredConfirmation[]> {
    return storage.expireStaleConfirmations();
  }
}
