import { PrismaClient } from '@prisma/client';
import { TelegramAdapter } from './messengers/telegram.ts';
import { PostgresStorage } from './storage/postgres.ts';
import { chat } from './core/chat.ts';
import { parseIntent, isTradeIntent, formatClarification, READ_ONLY_ACTIONS } from './core/intent_parser.ts';
import {
  ConfirmationService,
  formatConfirmationCard,
  getConfirmationLevel,
} from './core/confirmation.ts';
import { CredentialService } from './core/credentials.ts';
import { Engine } from './core/engine.ts';
import { discoverProviders } from './providers/registry.ts';
import { Config } from './config.ts';

const prisma = new PrismaClient();
const storage = new PostgresStorage(prisma);
const telegram = new TelegramAdapter();
const confirmationService = new ConfirmationService();
const credentialService = new CredentialService(prisma);

const providerRegistry = await discoverProviders();
const engine = new Engine(credentialService, providerRegistry, Config.credentials.masterPassword, { paperMode: Config.paper.enabled });

if (Config.paper.enabled) {
  console.log('⚠️  PAPER TRADING MODE — no real orders will be placed');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runTrade(
  confirmation: { id: string; intent: import('./core/intent_parser.ts').TradeIntent },
  userId: string,
  chatId: string,
  messageId: string,
  edit: boolean,
): Promise<void> {
  const send = edit
    ? (text: string) => telegram.editMessage(chatId, messageId, text)
    : (text: string) => telegram.sendMessage({ chatId, text }).then(() => {});

  await send('⏳ Executing...');
  try {
    const result = await engine.execute(confirmation.intent, userId);
    await storage.updateConfirmation(confirmation.id, { state: 'DONE' });
    await storage.logTrade({ userId, action: confirmation.intent.action, intent: confirmation.intent, result, status: 'success' });
    await send(result);
  } catch (err) {
    await storage.updateConfirmation(confirmation.id, { state: 'FAILED' });
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await storage.logTrade({ userId, action: confirmation.intent.action, intent: confirmation.intent, result: msg, status: 'failed' });
    await send(`❌ Trade failed: ${msg}`);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

const messageHandler = async (msg: { userId: string; chatId: string; text: string; messageId: string }) => {
  try {
    // Check if user has a pending confirmation waiting for text input
    const active = await confirmationService.getActiveForUser(msg.userId, storage);

    if (active?.subState === 'WAITING_AMOUNT') {
      const { valid, nextAction } = await confirmationService.handleAmountInput(active, msg.text, storage);

      if (!valid) {
        await telegram.sendMessage({ chatId: msg.chatId, text: '❌ Amount doesn\'t match. Confirmation cancelled.' });
        await storage.logTrade({ userId: msg.userId, action: active.intent.action, intent: active.intent, result: 'Invalid amount input — confirmation cancelled', status: 'cancelled' });
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

      // Large order confirmed — execute
      await runTrade(active, msg.userId, msg.chatId, msg.messageId, false);
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

    // Read-only and history actions don't need asset/quoteCurrency — check before isTradeIntent
    if (intent.action === 'history' && intent.confidence >= 0.8) {
      const rows = await storage.getTradeHistory(msg.userId);
      if (rows.length === 0) {
        await telegram.sendMessage({ chatId: msg.chatId, text: '📋 No trades yet.' });
      } else {
        const lines = ['📋 Trade History\n'];
        for (const r of rows) {
          const date = r.executedAt.toISOString().slice(0, 16).replace('T', ' ');
          const icon = r.status === 'success' ? '✅' : '❌';
          const action = r.intent.action?.toUpperCase() ?? 'TRADE';
          const summary = `${action} ${r.intent.asset ?? ''}${r.intent.amount ? ` ${r.intent.amount}` : ''}`.trim();
          lines.push(`${icon} ${date} — ${summary}`);
        }
        await telegram.sendMessage({ chatId: msg.chatId, text: lines.join('\n') });
      }
      return;
    }

    // Read-only actions: execute immediately, no confirmation needed
    if (intent.action !== null && READ_ONLY_ACTIONS.has(intent.action as never) && intent.confidence >= 0.8) {
      try {
        const result = await engine.execute(intent, msg.userId);
        await telegram.sendMessage({ chatId: msg.chatId, text: result });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        await telegram.sendMessage({ chatId: msg.chatId, text: `❌ ${errMsg}` });
      }
      return;
    }

    if (!isTradeIntent(intent) || intent.confidence < 0.8) {
      await telegram.sendMessage({ chatId: msg.chatId, text: formatClarification(intent) });
      return;
    }

    // High-confidence trade → create confirmation and show card with buttons
    const estimatedUsd = await engine.estimateUsdForIntent(intent, msg.userId);
    const confirmation = await confirmationService.create(msg.userId, msg.chatId, intent, storage);
    const level = getConfirmationLevel(intent, estimatedUsd);
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

      // Normal trade confirmed — execute
      await runTrade(confirmation, userId, chatId, messageId, true);
      return;
    }

    if (data.startsWith('reconfirm:')) {
      const id = data.slice(10);
      const { action } = await confirmationService.handleReconfirmButton(id, storage);
      if (action !== 'confirmed') return;

      const confirmation = await storage.getConfirmationById(id);
      if (!confirmation) return;

      await runTrade(confirmation, userId, chatId, messageId, true);
      return;
    }

    if (data.startsWith('cancel:')) {
      const id = data.slice(7);
      const cancelled = await confirmationService.handleCancelButton(id, storage);
      if (cancelled) {
        const confirmation = await storage.getConfirmationById(id);
        if (confirmation) {
          await storage.logTrade({ userId, action: confirmation.intent.action, intent: confirmation.intent, result: 'Cancelled by user', status: 'cancelled' });
        }
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
    await storage.logTrade({ userId: c.userId, action: c.intent.action, intent: c.intent, result: 'Confirmation expired', status: 'expired' }).catch(() => {});
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
  await prisma.$disconnect();
  process.exit(0);
});

await telegram.start(messageHandler, callbackHandler);
