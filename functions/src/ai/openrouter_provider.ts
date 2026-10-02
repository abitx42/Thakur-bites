/**
 * Thakur Bites Platform 2.0 — OpenRouter Business Copilot Provider
 * 
 * Invokes OpenRouter (supporting 25+ models including openrouter/free router)
 * via native Node fetch using OpenAI-compatible chat completion payload.
 * Fully decoupled from specific vendor SDKs.
 */

import { AIProvider, BusinessContext, AIAnswer } from './ai_types';
import { buildUserPrompt, COPILOT_SYSTEM_INSTRUCTION, formatPaiseToInr } from './prompt_builder';

export class OpenRouterProvider implements AIProvider {
  readonly providerName = 'openrouter' as const;
  private apiKey: string | null = null;
  private modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || null;
    this.modelName = modelName || process.env.OPENROUTER_MODEL || 'openrouter/free';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateBusinessAnswer(context: BusinessContext, question: string): Promise<AIAnswer> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key is not configured in environment (OPENROUTER_API_KEY).');
    }

    const startMs = Date.now();
    const userPrompt = buildUserPrompt(context, question);

    const payload = {
      model: this.modelName,
      messages: [
        { role: 'system', content: COPILOT_SYSTEM_INSTRUCTION },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    };

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://thakurbites.com',
        'X-Title': 'Thakur Bites Canteen Business Copilot',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json: any = await res.json();
    const answerMarkdown = json.choices?.[0]?.message?.content || 'No response content returned by OpenRouter.';
    const executionLatencyMs = Date.now() - startMs;

    const cashShare = context.grossRevenuePaise > 0
      ? Math.round((context.cashRevenuePaise / context.grossRevenuePaise) * 100)
      : 0;

    return {
      answerMarkdown,
      evidence: {
        ordersAnalyzed: context.paidOrdersCount,
        period: context.periodLabel,
        dataQuality: context.dataQuality,
        keyMetrics: {
          grossRevenue: formatPaiseToInr(context.grossRevenuePaise),
          netRevenue: formatPaiseToInr(context.netRevenuePaise),
          refunds: formatPaiseToInr(context.refundsPaise),
          paidOrders: context.paidOrdersCount,
          cashSharePercent: cashShare,
        },
        disclaimers: [
          `Synthesized via OpenRouter (${this.modelName}) from verified Firestore orders & inventory.`,
          context.costDataNotice,
          'Zero PII transmitted: aggregations exclude student names, contact info, and token credentials.',
        ],
        providerUsed: this.providerName,
        executionLatencyMs,
      },
      suggestedFollowUps: [
        'What stock should I add?',
        'Which dishes are selling most?',
        'What were our busiest hours?',
      ],
    };
  }
}
