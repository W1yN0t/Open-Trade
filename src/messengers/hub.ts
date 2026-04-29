import {
  type MessengerAdapter,
  type CallbackHandler,
  type ConfirmationButton,
  type IncomingMessage,
  type MessageHandler,
  type OutgoingMessage,
} from './base.ts';

// Multi-adapter fan-in/fan-out:
//   • Inbound — every adapter forwards events through one shared
//     MessageHandler / CallbackHandler. Each event is tagged with the
//     adapter's `source`, and userIds are prefixed (`telegram:123`,
//     `discord:456`) so the DB stays in one namespace.
//   • Outbound — `sendMessage`/`sendWithKeyboard`/`editMessage` take an
//     explicit source; the hub looks up the adapter and delegates.
//
// The hub does not extend MessengerAdapter — its outbound API needs a
// `source` parameter, which the platform-agnostic ABC deliberately does not.
export class MessengerHub {
  private adapters = new Map<string, MessengerAdapter>();

  register(adapter: MessengerAdapter): void {
    if (this.adapters.has(adapter.source)) {
      throw new Error(`Messenger source "${adapter.source}" already registered`);
    }
    this.adapters.set(adapter.source, adapter);
  }

  size(): number {
    return this.adapters.size;
  }

  sources(): string[] {
    return Array.from(this.adapters.keys());
  }

  // Returns the source prefix encoded in a fully-qualified userId, or null
  // if the id is unprefixed. Code that mixes prefixed and bare ids should
  // treat null as "fallback to default adapter".
  static parseSource(userId: string): { source: string; localId: string } | null {
    const m = userId.match(/^([a-z][a-z0-9_-]*):(.+)$/i);
    return m ? { source: m[1], localId: m[2] } : null;
  }

  static prefix(source: string, localId: string): string {
    return `${source}:${localId}`;
  }

  async start(messageHandler: MessageHandler, callbackHandler: CallbackHandler): Promise<void> {
    if (this.adapters.size === 0) {
      throw new Error('MessengerHub.start: no adapters registered');
    }

    const wrappedMessage: MessageHandler = async (msg: IncomingMessage) => {
      // Re-stamp userId with its source prefix so downstream code (engine,
      // confirmation, scheduler) can persist a single global identity per
      // user without confusing platforms with overlapping numeric ids.
      const prefixed = MessengerHub.prefix(msg.source, msg.userId);
      await messageHandler({ ...msg, userId: prefixed });
    };

    const wrappedCallback: CallbackHandler = async (source, userId, chatId, messageId, data) => {
      await callbackHandler(source, MessengerHub.prefix(source, userId), chatId, messageId, data);
    };

    await Promise.all(
      Array.from(this.adapters.values()).map(a => a.start(wrappedMessage, wrappedCallback)),
    );
  }

  async stop(): Promise<void> {
    await Promise.all(Array.from(this.adapters.values()).map(a => a.stop().catch(() => {})));
  }

  // Outbound APIs require a `source` so the hub knows which adapter to use.
  // Two convenience overloads are also provided that take a fully-qualified
  // userId and look the source up automatically.

  async sendMessage(message: OutgoingMessage & { source: string }): Promise<void> {
    this.requireAdapter(message.source);
    await this.adapters.get(message.source)!.sendMessage(message);
  }

  async sendWithKeyboard(source: string, chatId: string, text: string, buttons: ConfirmationButton[]): Promise<string> {
    this.requireAdapter(source);
    return this.adapters.get(source)!.sendWithKeyboard(chatId, text, buttons);
  }

  async editMessage(source: string, chatId: string, messageId: string, text: string, buttons?: ConfirmationButton[]): Promise<void> {
    this.requireAdapter(source);
    await this.adapters.get(source)!.editMessage(chatId, messageId, text, buttons);
  }

  // Convenience for callers that already hold a fully-qualified userId.
  async sendToUser(prefixedUserId: string, message: OutgoingMessage): Promise<void> {
    const parsed = MessengerHub.parseSource(prefixedUserId);
    if (!parsed) throw new Error(`sendToUser: missing messenger prefix on userId "${prefixedUserId}"`);
    this.requireAdapter(parsed.source);
    await this.adapters.get(parsed.source)!.sendMessage(message);
  }

  private requireAdapter(source: string): void {
    if (!this.adapters.has(source)) {
      throw new Error(`No messenger adapter registered for source "${source}"`);
    }
  }
}
