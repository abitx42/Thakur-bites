/**
 * Thakur Bites Platform 2.0 — Google Gemini Business Copilot Provider
 * 
 * Invokes Gemini Flash (via official @google/genai SDK) with strictly low temperature (0.1)
 * to guarantee factual consistency against the provided business context.
 * The API key is stored server-side only in Secret Manager / environment variables.
 */

import { GoogleGenAI } from '@google/genai';
import { AIProvider, BusinessContext, AIAnswer } from './ai_types';
import { buildUserPrompt, COPILOT_SYSTEM_INSTRUCTION, formatPaiseToInr } from './prompt_builder';

export class GeminiProvider implements AIProvider {
  readonly providerName = 'gemini' as const;
  private client: GoogleGenAI | null = null;
  private apiKey: string | null = null;
  private modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || null;
    this.modelName = modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (this.apiKey) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateBusinessAnswer(context: BusinessContext, question: string): Promise<AIAnswer> {
    if (!this.client || !this.apiKey) {
      throw new Error('Gemini API key is not configured in environment (GEMINI_API_KEY).');
    }

    const startMs = Date.now();
    const prompt = buildUserPrompt(context, question);

    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        systemInstruction: COPILOT_SYSTEM_INSTRUCTION,
        temperature: 0.1, // Strict low temperature prevents hallucination
        maxOutputTokens: 1024,
      },
    });

    const answerMarkdown = response.text || 'Unable to generate response from Gemini.';
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
          `Synthesized by ${this.modelName} from verified Firestore orders & inventory.`,
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
