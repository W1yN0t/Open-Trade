import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Interaction,
  type Message,
} from 'discord.js';
import {
  MessengerAdapter,
  type CallbackHandler,
  type ConfirmationButton,
  type MessageHandler,
  type OutgoingMessage,
} from './base.ts';

// Discord parity for the same primitives Telegram exposes:
//   • DMs and explicit @mentions in guild channels become IncomingMessages.
//   • Inline buttons are encoded as a single ActionRow of up to 5 buttons.
//   • `editMessage` mutates the original bot message; `sendWithKeyboard`
//     posts a new one and returns its message-id so the rest of the
//     confirmation flow can edit it later.
//
// Auth: requires `DISCORD_BOT_TOKEN`. The bot also needs the "Message
// Content Intent" enabled in the Developer Portal, otherwise message text
// arrives empty in guild channels.
export class DiscordAdapter extends MessengerAdapter {
  readonly source = 'discord';

  private client: Client;

  constructor(private readonly token: string) {
    super();
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      // DM channels are not cached by default; partials let us receive them.
      partials: [Partials.Channel, Partials.Message],
    });
  }

  async start(messageHandler: MessageHandler, callbackHandler: CallbackHandler): Promise<void> {
    this.client.on(Events.MessageCreate, async (msg: Message) => {
      try {
        if (msg.author.bot) return;

        // In a guild channel only react when explicitly addressed — avoids
        // the bot answering every line of a regular conversation. DMs always
        // count as direct user input.
        const isDm = msg.channel.type === ChannelType.DM;
        const mentioned = this.client.user ? msg.mentions.users.has(this.client.user.id) : false;
        if (!isDm && !mentioned) return;

        const text = this.client.user ? msg.content.replace(`<@${this.client.user.id}>`, '').trim() : msg.content.trim();
        if (!text) return;

        await messageHandler({
          source: this.source,
          userId: msg.author.id,
          chatId: msg.channelId,
          text,
          messageId: msg.id,
        });
      } catch (err) {
        console.error('Discord message handler error:', err);
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      try {
        if (!interaction.isButton()) return;
        // Acknowledge immediately — Discord only gives 3s before the
        // interaction expires. Equivalent to Telegram's answerCallbackQuery.
        await interaction.deferUpdate();

        await callbackHandler(
          this.source,
          interaction.user.id,
          interaction.channelId ?? '',
          interaction.message.id,
          interaction.customId,
        );
      } catch (err) {
        console.error('Discord interaction error:', err);
      }
    });

    this.client.once(Events.ClientReady, c => {
      console.log(`Discord adapter started as ${c.user.tag}`);
    });

    await this.client.login(this.token);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  async sendMessage(message: OutgoingMessage): Promise<void> {
    const channel = await this.fetchChannel(message.chatId);
    await channel.send({
      content: message.text,
      reply: message.replyToMessageId
        ? { messageReference: message.replyToMessageId, failIfNotExists: false }
        : undefined,
    });
  }

  async sendWithKeyboard(chatId: string, text: string, buttons: ConfirmationButton[]): Promise<string> {
    const channel = await this.fetchChannel(chatId);
    const sent = await channel.send({
      content: text,
      components: buttons.length > 0 ? [buildButtonRow(buttons)] : [],
    });
    return sent.id;
  }

  async editMessage(chatId: string, messageId: string, text: string, buttons?: ConfirmationButton[]): Promise<void> {
    const channel = await this.fetchChannel(chatId);
    const message = await channel.messages.fetch(messageId);
    await message.edit({
      content: text,
      components: buttons && buttons.length > 0 ? [buildButtonRow(buttons)] : [],
    });
  }

  private async fetchChannel(channelId: string) {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      throw new Error(`Discord channel ${channelId} is not text-sendable`);
    }
    return channel;
  }
}

// Discord allows up to 5 buttons in a single ActionRow. The confirmation
// flow only ever uses 2–3, so we keep things simple with a single row.
function buildButtonRow(buttons: ConfirmationButton[]): ActionRowBuilder<ButtonBuilder> {
  if (buttons.length > 5) {
    throw new Error('DiscordAdapter: at most 5 buttons per row are supported');
  }
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const btn of buttons) {
    row.addComponents(
      new ButtonBuilder()
        // Discord caps customId at 100 chars. callbackData here is well under.
        .setCustomId(btn.callbackData)
        .setLabel(btn.label.slice(0, 80))
        .setStyle(pickStyle(btn.label)),
    );
  }
  return row;
}

function pickStyle(label: string): ButtonStyle {
  if (label.startsWith('✅')) return ButtonStyle.Success;
  if (label.startsWith('❌')) return ButtonStyle.Danger;
  return ButtonStyle.Primary;
}
