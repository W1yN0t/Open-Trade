import { PrismaClient } from '@prisma/client';
import { TelegramAdapter } from './messengers/telegram.ts';
import { DiscordAdapter } from './messengers/discord.ts';
import { MessengerHub } from './messengers/hub.ts';
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
import { DcaService } from './core/dca.ts';
import { AlertService } from './core/alerts.ts';
import { AnalyticsService } from './core/analytics.ts';
import { Scheduler } from './core/scheduler.ts';
import { discoverProviders } from './providers/registry.ts';
import { Config } from './config.ts';
import { checkLlmHealth } from './llm/health.ts';

const prisma = new PrismaClient();
const storage = new PostgresStorage(prisma);
const confirmationService = new ConfirmationService();
const credentialService = new CredentialService(prisma);

const providerRegistry = await discoverProviders();
const dcaService = new DcaService(storage);
const alertService = new AlertService(storage);
const analyticsService = new AnalyticsService(storage);
const engine = new Engine(
  credentialService, providerRegistry, Config.credentials.masterPassword,
  { paperMode: Config.paper.enabled, storage },
  dcaService, alertService, analyticsService,
);

// ── Messenger hub ─────────────────────────────────────────────────────────────
//
// Each adapter is registered conditionally on its token being set, so a
// deploy that only configures Telegram still boots cleanly. The hub tags
// every userId with its source ("telegram:123", "discord:456") so the DB
// stays in one namespace while replies route back to the right platform.

const hub = new MessengerHub();
if (Config.telegram.token) hub.register(new TelegramAdapter());
if (Config.discord.token) hub.register(new DiscordAdapter(Config.discord.token));
if (hub.size() === 0) {
  console.error('No messenger adapters configured. Set TELEGRAM_BOT_TOKEN or DISCORD_BOT_TOKEN.');
  process.exit(1);
}
console.log(`Messengers: ${hub.sources().join(', ')}`);

const scheduler = new Scheduler(storage, engine, hub);

if (Config.paper.enabled) {
  console.log('⚠️  PAPER TRADING MODE — no real orders will be placed');
}
await checkLlmHealth();
scheduler.start();

// ── Helpers ───────────────────────────────────────────────────────────────────

// Recover the messenger source from a fully-qualified userId. Legacy rows
// (pre-multi-messenger) are unprefixed — assume Telegram for those.
function sourceOf(userId: string): string {
  return MessengerHub.parseSource(userId)?.source ?? 'telegram';
}

async function runTrade(
  confirmation: { id: string; intent: import('./core/intent_parser.ts').TradeIntent },
  userId: string,
  chatId: string,
  messageId: string,
  edit: boolean,
): Promise<void> {
  const source = sourceOf(userId);
  const send = edit
    ? (text: string) => hub.editMessage(source, chatId, messageId, text)
    : (text: string) => hub.sendMessage({ source, chatId, text });

  // Atomically claim this confirmation for execution. If another concurrent
  // handler (double-click, retry) already moved it past CONFIRMED, bail out
  // before placing a duplicate order.
  const claimed = await storage.tryTransitionConfirmation(
    confirmation.id,
    { state: 'CONFIRMED' },
    { state: 'EXECUTING' },
  );
  if (!claimed) return;

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

const messageHandler = async (msg: { source?: string; userId: string; chatId: string; text: string; messageId: string }) => {
  // The hub always stamps source onto the message; tolerate a missing field
  // so unit tests can construct one without bothering with the prefix.
  const source = msg.source ?? sourceOf(msg.userId);

  try {
    // Check if user has a pending confirmation waiting for text input
    const active = await confirmationService.getActiveForUser(msg.userId, storage);

    if (active?.subState === 'WAITING_AMOUNT') {
      const { valid, nextAction } = await confirmationService.handleAmountInput(active, msg.text, storage);

      if (nextAction === 'already_handled') {
        if (!valid) {
          await hub.sendMessage({ source, chatId: msg.chatId, text: '❌ Amount doesn\'t match. Confirmation cancelled.' });
          await storage.logTrade({ userId: msg.userId, action: active.intent.action, intent: active.intent, result: 'Invalid amount input — confirmation cancelled', status: 'cancelled' });
        }
        return;
      }

      if (nextAction === 'ask_reconfirm') {
        await hub.sendWithKeyboard(
          source,
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
      await hub.sendMessage({ source, chatId: msg.chatId, text: 'Please press the ✅ Execute button to proceed.' });
      return;
    }

    // ── Normal intent flow ──────────────────────────────────────────────────
    const model = await storage.getUserModel(msg.userId);
    const intent = await parseIntent(msg.text, model);

    if (intent.type === 'chat' || intent.confidence < 0.5) {
      const response = await chat(msg.userId, msg.text, storage);
      await hub.sendMessage({ source, chatId: msg.chatId, text: response });
      return;
    }

    // Read-only and history actions don't need asset/quoteCurrency — check before isTradeIntent
    if (intent.action === 'history' && intent.confidence >= 0.8) {
      const rows = await storage.getTradeHistory(msg.userId);
      if (rows.length === 0) {
        await hub.sendMessage({ source, chatId: msg.chatId, text: '📋 No trades yet.' });
      } else {
        const lines = ['📋 Trade History\n'];
        for (const r of rows) {
          const date = r.executedAt.toISOString().slice(0, 16).replace('T', ' ');
          const icon = r.status === 'success' ? '✅' : '❌';
          const action = r.intent.action?.toUpperCase() ?? 'TRADE';
          const summary = `${action} ${r.intent.asset ?? ''}${r.intent.amount ? ` ${r.intent.amount}` : ''}`.trim();
          lines.push(`${icon} ${date} — ${summary}`);
        }
        await hub.sendMessage({ source, chatId: msg.chatId, text: lines.join('\n') });
      }
      return;
    }

    // Read-only actions: execute immediately, no confirmation needed
    if (intent.action !== null && READ_ONLY_ACTIONS.has(intent.action as never) && intent.confidence >= 0.8) {
      try {
        const result = await engine.execute(intent, msg.userId, msg.chatId);
        await hub.sendMessage({ source, chatId: msg.chatId, text: result });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        await hub.sendMessage({ source, chatId: msg.chatId, text: `❌ ${errMsg}` });
      }
      return;
    }

    if (!isTradeIntent(intent) || intent.confidence < 0.8) {
      await hub.sendMessage({ source, chatId: msg.chatId, text: formatClarification(intent) });
      return;
    }

    // High-confidence trade → create confirmation and show card with buttons
    const estimatedUsd = await engine.estimateUsdForIntent(intent, msg.userId);
    const confirmation = await confirmationService.create(msg.userId, msg.chatId, intent, storage);
    const level = getConfirmationLevel(intent, estimatedUsd);
    const cardText = formatConfirmationCard(intent, level);

    const messageId = await hub.sendWithKeyboard(source, msg.chatId, cardText, [
      { label: '✅ Confirm', callbackData: `confirm:${confirmation.id}` },
      { label: '❌ Cancel', callbackData: `cancel:${confirmation.id}` },
    ]);

    await confirmationService.markShown(confirmation.id, messageId, storage);
  } catch (err) {
    console.error('Error handling message:', err);
    await hub.sendMessage({ source, chatId: msg.chatId, text: 'Something went wrong. Please try again.' }).catch(() => {});
  }
};

// ── Callback handler (inline button clicks) ───────────────────────────────────

// Cross-user-hijack guard: a clicker in a group/forwarded thread must not be
// able to act on someone else's confirmation. Owner check happens first.
async function isOwnedBy(id: string, userId: string): Promise<boolean> {
  const c = await storage.getConfirmationById(id);
  return !!c && c.userId === userId;
}

const callbackHandler = async (source: string, userId: string, chatId: string, messageId: string, data: string) => {
  try {
    if (data.startsWith('confirm:')) {
      const id = data.slice(8);
      if (!(await isOwnedBy(id, userId))) return;
      const { action, confirmation } = await confirmationService.handleConfirmButton(id, storage);

      if (action === 'already_handled' || !confirmation) return;

      if (action === 'ask_amount') {
        await hub.editMessage(
          source, chatId, messageId,
          `To confirm, type the exact amount (${confirmation.intent.amount}):`,
        );
        return;
      }

      await runTrade(confirmation, userId, chatId, messageId, true);
      return;
    }

    if (data.startsWith('reconfirm:')) {
      const id = data.slice(10);
      if (!(await isOwnedBy(id, userId))) return;
      const { action } = await confirmationService.handleReconfirmButton(id, storage);
      if (action !== 'confirmed') return;

      const confirmation = await storage.getConfirmationById(id);
      if (!confirmation) return;

      await runTrade(confirmation, userId, chatId, messageId, true);
      return;
    }

    if (data.startsWith('cancel:')) {
      const id = data.slice(7);
      if (!(await isOwnedBy(id, userId))) return;
      const cancelled = await confirmationService.handleCancelButton(id, storage);
      if (cancelled) {
        const confirmation = await storage.getConfirmationById(id);
        if (confirmation) {
          await storage.logTrade({ userId, action: confirmation.intent.action, intent: confirmation.intent, result: 'Cancelled by user', status: 'cancelled' });
        }
        await hub.editMessage(source, chatId, messageId, '❌ Trade cancelled.');
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
      await hub.editMessage(sourceOf(c.userId), c.chatId, c.messageId, '⏰ Confirmation expired.');
    } catch {
      // Message too old to edit — ignore
    }
  }
}, 10_000);

// ── Shutdown ──────────────────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  clearInterval(expiryInterval);
  scheduler.stop();
  await hub.stop();
  await storage.disconnect();
  await prisma.$disconnect();
  process.exit(0);
});

await hub.start(messageHandler, callbackHandler);
