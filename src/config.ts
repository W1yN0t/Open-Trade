import 'dotenv/config';

export const Config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN!,
  },
  database: {
    url: process.env.DATABASE_URL!,
  },
  credentials: {
    masterPassword: process.env.MASTER_PASSWORD ?? '',
  },
  paper: {
    enabled: process.env.PAPER_TRADING === 'true',
  },
  llm: {
    apiKey: process.env.LLM_API_KEY!,
    model: process.env.LLM_MODEL ?? 'anthropic/claude-3.5-sonnet',
    baseUrl: process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1',
    systemPrompt: `You are OpenTrade — an AI financial assistant that helps users trade crypto, stocks, and DeFi assets through natural language. Be concise and precise. When a user expresses trading intent, confirm you understood the details before acting.`,
  },
} as const;
