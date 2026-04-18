import { PrismaClient } from '@prisma/client';
import type { StoredConfirmation, ConfirmationState, ConfirmationSubState } from '../core/confirmation.ts';
import type { TradeIntent } from '../core/intent_parser.ts';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  role: MessageRole;
  content: string;
}

export class PostgresStorage {
  private prisma = new PrismaClient();

  // ── Chat history ──────────────────────────────────────────────────────────

  async getHistory(userId: string, limit = 20): Promise<Message[]> {
    const messages = await this.prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return messages.map(m => ({ role: m.role as MessageRole, content: m.content }));
  }

  async addMessage(userId: string, role: MessageRole, content: string): Promise<void> {
    await this.prisma.chatMessage.create({ data: { userId, role, content } });
  }

  // ── User settings ─────────────────────────────────────────────────────────

  async getUserModel(userId: string): Promise<string> {
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    return settings?.model ?? 'anthropic/claude-3-5-sonnet';
  }

  async setUserModel(userId: string, model: string): Promise<void> {
    await this.prisma.userSettings.upsert({
      where: { userId },
      update: { model },
      create: { userId, model },
    });
  }

  // ── Confirmations ─────────────────────────────────────────────────────────

  async createConfirmation(data: {
    userId: string;
    chatId: string;
    intent: TradeIntent;
    expiresAt: Date;
  }): Promise<StoredConfirmation> {
    const record = await this.prisma.pendingConfirmation.create({
      data: {
        userId: data.userId,
        chatId: data.chatId,
        intent: data.intent as object,
        expiresAt: data.expiresAt,
      },
    });
    return this.toConfirmation(record);
  }

  async updateConfirmation(
    id: string,
    data: Partial<{
      state: ConfirmationState;
      subState: ConfirmationSubState;
      messageId: string;
      expectedInput: string | null;
    }>,
  ): Promise<void> {
    await this.prisma.pendingConfirmation.update({ where: { id }, data });
  }

  async getConfirmationById(id: string): Promise<StoredConfirmation | null> {
    const record = await this.prisma.pendingConfirmation.findUnique({ where: { id } });
    return record ? this.toConfirmation(record) : null;
  }

  async getActiveConfirmation(userId: string): Promise<StoredConfirmation | null> {
    const record = await this.prisma.pendingConfirmation.findFirst({
      where: { userId, state: { in: ['CREATED', 'SHOWN'] } },
      orderBy: { createdAt: 'desc' },
    });
    return record ? this.toConfirmation(record) : null;
  }

  async expireStaleConfirmations(): Promise<StoredConfirmation[]> {
    const stale = await this.prisma.pendingConfirmation.findMany({
      where: { state: { in: ['CREATED', 'SHOWN'] }, expiresAt: { lt: new Date() } },
    });
    if (stale.length === 0) return [];

    await this.prisma.pendingConfirmation.updateMany({
      where: { id: { in: stale.map(s => s.id) } },
      data: { state: 'EXPIRED' },
    });

    return stale.map(r => this.toConfirmation(r));
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private toConfirmation(record: any): StoredConfirmation {
    return {
      ...record,
      intent: record.intent as TradeIntent,
      state: record.state as ConfirmationState,
      subState: (record.subState ?? null) as ConfirmationSubState,
    };
  }
}
