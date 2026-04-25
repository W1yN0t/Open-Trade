import { PrismaClient, Prisma } from '@prisma/client';
import type { StoredConfirmation, ConfirmationState, ConfirmationSubState } from '../core/confirmation.ts';
import type { TradeIntent } from '../core/intent_parser.ts';
import { Config } from '../config.ts';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  role: MessageRole;
  content: string;
}

export class PostgresStorage {
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  // ── Chat history ──────────────────────────────────────────────────────────

  async getHistory(userId: string, limit = 20): Promise<Message[]> {
    const messages = await this.prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return messages.map((m: { role: string; content: string }) => ({ role: m.role as MessageRole, content: m.content }));
  }

  async addMessage(userId: string, role: MessageRole, content: string): Promise<void> {
    await this.prisma.chatMessage.create({ data: { userId, role, content } });
  }

  // ── User settings ─────────────────────────────────────────────────────────

  async getUserModel(userId: string): Promise<string> {
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    return settings?.model ?? Config.llm.model;
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
      where: { id: { in: stale.map((s: { id: string }) => s.id) } },
      data: { state: 'EXPIRED' },
    });

    return stale.map((r: object) => this.toConfirmation(r));
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  async logTrade(data: {
    userId: string;
    action: string;
    intent: TradeIntent;
    result: string;
    status: 'success' | 'failed' | 'cancelled' | 'expired';
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        intent: data.intent as object,
        result: data.result,
        status: data.status,
      },
    });
  }

  async getTradeHistory(userId: string, limit = 10): Promise<Array<{
    id: string;
    action: string;
    intent: TradeIntent;
    result: string;
    status: string;
    executedAt: Date;
  }>> {
    const rows = await this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { executedAt: 'desc' },
      take: limit,
    });
    return rows.map((r: any) => ({ ...r, intent: r.intent as TradeIntent }));
  }

  // ── DCA schedules ─────────────────────────────────────────────────────────

  async createDca(data: {
    userId: string;
    chatId: string;
    asset: string;
    quoteCurrency: string;
    amount: number;
    intervalMs: number;
    nextRunAt: Date;
  }) {
    return this.prisma.dcaSchedule.create({ data });
  }

  async listDca(userId: string) {
    return this.prisma.dcaSchedule.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async cancelDca(id: string, userId: string): Promise<boolean> {
    const result = await this.prisma.dcaSchedule.updateMany({
      where: { id, userId, isActive: true },
      data: { isActive: false },
    });
    return result.count > 0;
  }

  async getDueDcaSchedules() {
    return this.prisma.dcaSchedule.findMany({
      where: { isActive: true, nextRunAt: { lte: new Date() } },
    });
  }

  async updateDcaNextRun(id: string, nextRunAt: Date): Promise<void> {
    await this.prisma.dcaSchedule.update({ where: { id }, data: { nextRunAt } });
  }

  // ── Price alerts ──────────────────────────────────────────────────────────

  async createAlert(data: {
    userId: string;
    chatId: string;
    asset: string;
    quoteCurrency: string;
    condition: string;
    targetPrice: number;
    triggerAction?: object | null;
  }) {
    return this.prisma.priceAlert.create({
      data: {
        ...data,
        triggerAction: data.triggerAction ?? Prisma.JsonNull,
      },
    });
  }

  async listAlerts(userId: string) {
    return this.prisma.priceAlert.findMany({
      where: { userId, isTriggered: false },
      orderBy: { createdAt: 'asc' },
    });
  }

  async cancelAlert(id: string, userId: string): Promise<boolean> {
    const result = await this.prisma.priceAlert.updateMany({
      where: { id, userId, isTriggered: false },
      data: { isTriggered: true },
    });
    return result.count > 0;
  }

  async getActiveAlerts() {
    return this.prisma.priceAlert.findMany({
      where: { isTriggered: false },
    });
  }

  async markAlertTriggered(id: string): Promise<void> {
    await this.prisma.priceAlert.update({ where: { id }, data: { isTriggered: true } });
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async getTradeHistorySince(userId: string, since: Date): Promise<Array<{
    action: string;
    intent: import('../core/intent_parser.ts').TradeIntent;
    status: string;
    executedAt: Date;
  }>> {
    const rows = await this.prisma.auditLog.findMany({
      where: { userId, executedAt: { gte: since } },
      orderBy: { executedAt: 'asc' },
    });
    return rows.map((r: any) => ({ ...r, intent: r.intent as import('../core/intent_parser.ts').TradeIntent }));
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
