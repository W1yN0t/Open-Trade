// Phase 1.2 — trade orchestrator
// Routes confirmed intents to the correct provider

import type { TradeIntent } from './intent_parser.ts';
import type { Provider, Order } from '../providers/base.ts';

export class Engine {
  constructor(private provider: Provider) {}

  async execute(_intent: TradeIntent): Promise<Order> {
    // TODO: Phase 1.2
    throw new Error('Engine not implemented yet');
  }
}
