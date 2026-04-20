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

export function getConfirmationLevel(intent: TradeIntent, estimatedUsd = 0): ConfirmationLevel {
  if (intent.amountType === 'percent' && (intent.amount ?? 0) >= 100) return 'critical';
  if (intent.amountType === 'quote' && (intent.amount ?? 0) > 5000) return 'critical';
  if (intent.amountType === 'quote' && (intent.amount ?? 0) > 500) return 'large';
  if (estimatedUsd > 5000) return 'critical';
  if (estimatedUsd > 500) return 'large';
  return 'normal';
}

export function formatConfirmationCard(intent: TradeIntent, level: ConfirmationLevel): string {
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

  // Returns next action for the caller to perform
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
      await storage.updateConfirmation(id, { state: 'CONFIRMED' });
      return { action: 'confirmed', confirmation };
    }

    const expected = String(confirmation.intent.amount ?? '');
    await storage.updateConfirmation(id, { subState: 'WAITING_AMOUNT', expectedInput: expected });
    return { action: 'ask_amount', confirmation };
  }

  async handleAmountInput(
    confirmation: StoredConfirmation,
    input: string,
    storage: PostgresStorage,
  ): Promise<{ valid: boolean; nextAction: 'confirmed' | 'ask_reconfirm' }> {
    const normalize = (s: string) => s.trim().replace(/[$,%\s]/g, '');

    if (normalize(input) !== normalize(confirmation.expectedInput ?? '')) {
      await storage.updateConfirmation(confirmation.id, { state: 'CANCELLED', subState: null });
      return { valid: false, nextAction: 'confirmed' };
    }

    const level = getConfirmationLevel(confirmation.intent);

    if (level === 'critical') {
      await storage.updateConfirmation(confirmation.id, { subState: 'WAITING_RECONFIRM', expectedInput: null });
      return { valid: true, nextAction: 'ask_reconfirm' };
    }

    await storage.updateConfirmation(confirmation.id, { state: 'CONFIRMED', subState: null });
    return { valid: true, nextAction: 'confirmed' };
  }

  async handleReconfirmButton(
    id: string,
    storage: PostgresStorage,
  ): Promise<{ action: 'confirmed' | 'already_handled' }> {
    const confirmation = await storage.getConfirmationById(id);
    if (!confirmation || confirmation.subState !== 'WAITING_RECONFIRM') {
      return { action: 'already_handled' };
    }
    await storage.updateConfirmation(id, { state: 'CONFIRMED', subState: null });
    return { action: 'confirmed' };
  }

  async handleCancelButton(id: string, storage: PostgresStorage): Promise<boolean> {
    const confirmation = await storage.getConfirmationById(id);
    if (!confirmation || !['SHOWN', 'CREATED'].includes(confirmation.state)) return false;
    await storage.updateConfirmation(id, { state: 'CANCELLED', subState: null });
    return true;
  }

  async expireStale(storage: PostgresStorage): Promise<StoredConfirmation[]> {
    return storage.expireStaleConfirmations();
  }
}
