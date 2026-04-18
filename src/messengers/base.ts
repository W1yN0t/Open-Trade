export interface IncomingMessage {
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
export type CallbackHandler = (userId: string, chatId: string, messageId: string, data: string) => Promise<void>;

export abstract class MessengerAdapter {
  abstract start(messageHandler: MessageHandler, callbackHandler: CallbackHandler): Promise<void>;
  abstract stop(): Promise<void>;
  abstract sendMessage(message: OutgoingMessage): Promise<void>;
  abstract sendWithKeyboard(chatId: string, text: string, buttons: ConfirmationButton[]): Promise<string>;
  abstract editMessage(chatId: string, messageId: string, text: string, buttons?: ConfirmationButton[]): Promise<void>;
}
