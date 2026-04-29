export interface IncomingMessage {
  // Adapter that produced this event (e.g. "telegram", "discord"). Used by
  // the hub to route outbound replies back to the right platform.
  source: string;
  userId: string;
  chatId: string;
  text: string;
  messageId: string;
}

export interface OutgoingMessage {
  chatId: string;
  text: string;
  replyToMessageId?: string;
  parseMode?: 'Markdown' | 'HTML';
}

export interface ConfirmationButton {
  label: string;
  callbackData: string;
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>;
export type CallbackHandler = (
  source: string,
  userId: string,
  chatId: string,
  messageId: string,
  data: string,
) => Promise<void>;

export abstract class MessengerAdapter {
  // Stable identifier for this adapter — used as the `source` tag on
  // IncomingMessage and as the prefix in fully-qualified userIds so two
  // platforms can share one DB namespace without collisions.
  abstract readonly source: string;

  abstract start(messageHandler: MessageHandler, callbackHandler: CallbackHandler): Promise<void>;
  abstract stop(): Promise<void>;
  abstract sendMessage(message: OutgoingMessage): Promise<void>;
  abstract sendWithKeyboard(chatId: string, text: string, buttons: ConfirmationButton[]): Promise<string>;
  abstract editMessage(chatId: string, messageId: string, text: string, buttons?: ConfirmationButton[]): Promise<void>;
}
