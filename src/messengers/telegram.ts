import { Bot, InlineKeyboard, type Context } from 'grammy';
import {
  MessengerAdapter,
  type MessageHandler,
  type CallbackHandler,
  type OutgoingMessage,
  type ConfirmationButton,
} from './base.ts';
import { Config } from '../config.ts';

export class TelegramAdapter extends MessengerAdapter {
  private bot: Bot;

  constructor() {
    super();
    this.bot = new Bot(Config.telegram.token);
  }

  async start(messageHandler: MessageHandler, callbackHandler: CallbackHandler): Promise<void> {
    this.bot.on('message:text', async (ctx: Context) => {
      const msg = ctx.message!;
      await messageHandler({
        userId: String(msg.from!.id),
        chatId: String(msg.chat.id),
        text: msg.text!,
        messageId: String(msg.message_id),
      });
    });

    this.bot.on('callback_query:data', async (ctx) => {
      await ctx.answerCallbackQuery();
      const cq = ctx.callbackQuery;
      await callbackHandler(
        String(ctx.from.id),
        String(cq.message?.chat.id ?? ''),
        String(cq.message?.message_id ?? ''),
        cq.data,
      );
    });

    this.bot.catch((err) => console.error('Telegram error:', err));
    console.log('Bot started');
    await this.bot.start();
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  async sendMessage(message: OutgoingMessage): Promise<void> {
    await this.bot.api.sendMessage(message.chatId, message.text, {
      parse_mode: message.parseMode,
      reply_parameters: message.replyToMessageId
        ? { message_id: Number(message.replyToMessageId) }
        : undefined,
    });
  }

  async sendWithKeyboard(chatId: string, text: string, buttons: ConfirmationButton[]): Promise<string> {
    const keyboard = buttons.reduce(
      (kb, btn) => kb.text(btn.label, btn.callbackData),
      new InlineKeyboard(),
    );
    const msg = await this.bot.api.sendMessage(chatId, text, { reply_markup: keyboard });
    return String(msg.message_id);
  }

  async editMessage(chatId: string, messageId: string, text: string, buttons?: ConfirmationButton[]): Promise<void> {
    const keyboard = buttons?.reduce(
      (kb, btn) => kb.text(btn.label, btn.callbackData),
      new InlineKeyboard(),
    );
    await this.bot.api.editMessageText(chatId, Number(messageId), text, {
      reply_markup: keyboard,
    });
  }
}
