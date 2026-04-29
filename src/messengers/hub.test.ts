import { describe, it, expect, vi } from 'vitest';
import { MessengerHub } from './hub.ts';
import { MessengerAdapter, type CallbackHandler, type MessageHandler } from './base.ts';

class FakeAdapter extends MessengerAdapter {
  readonly source: string;
  sent: Array<{ chatId: string; text: string }> = [];
  edited: Array<{ chatId: string; messageId: string; text: string }> = [];
  private msgHandler: MessageHandler | null = null;
  private cbHandler: CallbackHandler | null = null;

  constructor(source: string) {
    super();
    this.source = source;
  }

  async start(messageHandler: MessageHandler, callbackHandler: CallbackHandler): Promise<void> {
    this.msgHandler = messageHandler;
    this.cbHandler = callbackHandler;
  }
  async stop(): Promise<void> {}
  async sendMessage({ chatId, text }: { chatId: string; text: string }): Promise<void> {
    this.sent.push({ chatId, text });
  }
  async sendWithKeyboard(chatId: string, text: string): Promise<string> {
    this.sent.push({ chatId, text });
    return 'msg-id';
  }
  async editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    this.edited.push({ chatId, messageId, text });
  }

  // Test helpers: simulate inbound events as if they came from the platform.
  emitMessage(userId: string, chatId: string, text: string): Promise<void> | void {
    return this.msgHandler!({ source: this.source, userId, chatId, text, messageId: '1' });
  }
  emitCallback(userId: string, data: string): Promise<void> | void {
    return this.cbHandler!(this.source, userId, 'channel', 'msg-id', data);
  }
}

describe('MessengerHub', () => {
  it('parses and produces source-prefixed userIds', () => {
    expect(MessengerHub.parseSource('telegram:123')).toEqual({ source: 'telegram', localId: '123' });
    expect(MessengerHub.parseSource('discord:456')).toEqual({ source: 'discord', localId: '456' });
    expect(MessengerHub.parseSource('plain')).toBeNull();
    expect(MessengerHub.prefix('discord', '789')).toBe('discord:789');
  });

  it('rejects duplicate source registration', () => {
    const hub = new MessengerHub();
    hub.register(new FakeAdapter('telegram'));
    expect(() => hub.register(new FakeAdapter('telegram'))).toThrow(/already registered/);
  });

  it('prefixes inbound userIds with the adapter source', async () => {
    const hub = new MessengerHub();
    const tg = new FakeAdapter('telegram');
    const dc = new FakeAdapter('discord');
    hub.register(tg);
    hub.register(dc);

    const messageHandler = vi.fn();
    const callbackHandler = vi.fn();
    await hub.start(messageHandler, callbackHandler);

    await tg.emitMessage('123', 'chat-a', 'hi from tg');
    await dc.emitMessage('456', 'chat-b', 'hi from dc');
    await tg.emitCallback('123', 'confirm:abc');

    expect(messageHandler).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'telegram', userId: 'telegram:123', text: 'hi from tg' }),
    );
    expect(messageHandler).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'discord', userId: 'discord:456', text: 'hi from dc' }),
    );
    expect(callbackHandler).toHaveBeenCalledWith('telegram', 'telegram:123', 'channel', 'msg-id', 'confirm:abc');
  });

  it('routes outbound calls to the adapter named by source', async () => {
    const hub = new MessengerHub();
    const tg = new FakeAdapter('telegram');
    const dc = new FakeAdapter('discord');
    hub.register(tg);
    hub.register(dc);

    await hub.sendMessage({ source: 'discord', chatId: 'c1', text: 'hello' });
    await hub.sendMessage({ source: 'telegram', chatId: 'c2', text: 'hi' });
    await hub.editMessage('discord', 'c1', 'm1', 'edited');

    expect(dc.sent).toEqual([{ chatId: 'c1', text: 'hello' }]);
    expect(tg.sent).toEqual([{ chatId: 'c2', text: 'hi' }]);
    expect(dc.edited).toEqual([{ chatId: 'c1', messageId: 'm1', text: 'edited' }]);
  });

  it('throws when sending to an unregistered source', async () => {
    const hub = new MessengerHub();
    hub.register(new FakeAdapter('telegram'));
    await expect(hub.sendMessage({ source: 'discord', chatId: 'c1', text: 'x' })).rejects.toThrow(/discord/);
  });

  it('sendToUser recovers the source from a prefixed userId', async () => {
    const hub = new MessengerHub();
    const dc = new FakeAdapter('discord');
    hub.register(dc);

    await hub.sendToUser('discord:99', { chatId: 'c1', text: 'routed' });
    expect(dc.sent).toEqual([{ chatId: 'c1', text: 'routed' }]);

    await expect(hub.sendToUser('plainuser', { chatId: 'c1', text: 'x' }))
      .rejects.toThrow(/missing messenger prefix/);
  });
});
