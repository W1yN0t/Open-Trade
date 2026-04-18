import { TelegramAdapter } from './messengers/telegram.ts';
import { PostgresStorage } from './storage/postgres.ts';
import { chat } from './core/chat.ts';
import { parseIntent, isTradeIntent, formatClarification } from './core/intent_parser.ts';
import {
  ConfirmationService,
  formatConfirmationCard,
  getConfirmationLevel,
} from './core/confirmation.ts';

const storage = new PostgresStorage();
const telegram = new TelegramAdapter();
const confirmationService = new ConfirmationService();

// ── Message handler ───────────────────────────────────────────────────────────

const messageHandler = async (msg: { userId: string; chatId: string; text: string; messageId: string }) => {
  try {
    // Check if user has a pending confirmation waiting for text input
    const active = await confirmationService.getActiveForUser(msg.userId, storage);

    if (active?.subState === 'WAITING_AMOUNT') {
      const { valid, nextAction } = await confirmationService.handleAmountInput(active, msg.text, storage);

      if (!valid) {
        await telegram.sendMessage({ chatId: msg.chatId, text: '❌ Amount doesn\'t match. Confirmation cancelled.' });
        return;
      }

      if (nextAction === 'ask_reconfirm') {
        await telegram.sendWithKeyboard(
          msg.chatId,
          '⚠️ Amount confirmed. This is a critical trade — press Execute to proceed.',
          [
            { label: '✅ Execute', callbackData: `reconfirm:${active.id}` },
            { label: '❌ Cancel', callbackData: `cancel:${active.id}` },
          ],
        );
        return;
      }

      await telegram.sendMessage({ chatId: msg.chatId, text: '✅ Trade confirmed. Executing... (Phase 2)' });
      return;
    }

    if (active?.subState === 'WAITING_RECONFIRM') {
      await telegram.sendMessage({ chatId: msg.chatId, text: 'Please press the ✅ Execute button to proceed.' });
      return;
    }

    // ── Normal intent flow ──────────────────────────────────────────────────
    const model = await storage.getUserModel(msg.userId);
    const intent = await parseIntent(msg.text, model);

    if (intent.type === 'chat' || intent.confidence < 0.5) {
      const response = await chat(msg.userId, msg.text, storage);
      await telegram.sendMessage({ chatId: msg.chatId, text: response });
      return;
    }

    if (!isTradeIntent(intent) || intent.confidence < 0.8) {
      await telegram.sendMessage({ chatId: msg.chatId, text: formatClarification(intent) });
      return;
    }

    // High-confidence trade → create confirmation and show card with buttons
    const confirmation = await confirmationService.create(msg.userId, msg.chatId, intent, storage);
    const level = getConfirmationLevel(intent);
    const cardText = formatConfirmationCard(intent, level);

    const messageId = await telegram.sendWithKeyboard(msg.chatId, cardText, [
      { label: '✅ Confirm', callbackData: `confirm:${confirmation.id}` },
      { label: '❌ Cancel', callbackData: `cancel:${confirmation.id}` },
    ]);

    await confirmationService.markShown(confirmation.id, messageId, storage);
  } catch (err) {
    console.error('Error handling message:', err);
    await telegram.sendMessage({ chatId: msg.chatId, text: 'Something went wrong. Please try again.' });
  }
};

// ── Callback handler (inline button clicks) ───────────────────────────────────

const callbackHandler = async (userId: string, chatId: string, messageId: string, data: string) => {
  try {
    if (data.startsWith('confirm:')) {
      const id = data.slice(8);
      const { action, confirmation } = await confirmationService.handleConfirmButton(id, storage);

      if (action === 'already_handled' || !confirmation) return;

      if (action === 'ask_amount') {
        await telegram.editMessage(
          chatId, messageId,
          `To confirm, type the exact amount (${confirmation.intent.amount}):`,
        );
        return;
      }

      // Normal trade confirmed
      await telegram.editMessage(chatId, messageId, '✅ Trade confirmed. Executing... (Phase 2)');
      return;
    }

    if (data.startsWith('reconfirm:')) {
      const id = data.slice(10);
      const { action } = await confirmationService.handleReconfirmButton(id, storage);
      if (action === 'confirmed') {
        await telegram.editMessage(chatId, messageId, '✅ Trade confirmed. Executing... (Phase 2)');
      }
      return;
    }

    if (data.startsWith('cancel:')) {
      const id = data.slice(7);
      const cancelled = await confirmationService.handleCancelButton(id, storage);
      if (cancelled) {
        await telegram.editMessage(chatId, messageId, '❌ Trade cancelled.');
      }
    }
  } catch (err) {
    console.error('Error handling callback:', err);
  }
};

// ── Expiry check (every 10s) ──────────────────────────────────────────────────

const expiryInterval = setInterval(async () => {
  const expired = await confirmationService.expireStale(storage);
  for (const c of expired) {
    if (!c.messageId) continue;
    try {
      await telegram.editMessage(c.chatId, c.messageId, '⏰ Confirmation expired.');
    } catch {
      // Message too old to edit — ignore
    }
  }
}, 10_000);

// ── Shutdown ──────────────────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  clearInterval(expiryInterval);
  await telegram.stop();
  await storage.disconnect();
  process.exit(0);
});

await telegram.start(messageHandler, callbackHandler);
