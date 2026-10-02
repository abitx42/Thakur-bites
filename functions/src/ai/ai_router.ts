/**
 * Thakur Bites Platform 2.0 — AI Provider Router & Graceful Fallback Manager
 * 
 * Dynamically routes requests between Gemini and OpenRouter, seamlessly falling back
 * to the deterministic rule-based engine if external credentials are absent or remote APIs fail.
 */

import { AIAnswer, AIProvider, BusinessContext } from './ai_types';
import { GeminiProvider } from './gemini_provider';
import { OpenRouterProvider } from './openrouter_provider';
import { RuleBasedFallbackProvider } from './rule_based_fallback_provider';

export class AIRouter {
  private gemini: GeminiProvider;
  private openRouter: OpenRouterProvider;
  private fallback: RuleBasedFallbackProvider;
  private preferredProviderName: string;

  constructor() {
    this.gemini = new GeminiProvider();
    this.openRouter = new OpenRouterProvider();
    this.fallback = new RuleBasedFallbackProvider();
    this.preferredProviderName = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();
  }

  /**
   * Resolves the primary provider based on preference and active configuration.
   */
  getPrimaryProvider(): AIProvider {
    if (this.preferredProviderName === 'openrouter' && this.openRouter.isConfigured()) {
      return this.openRouter;
    }
    if (this.gemini.isConfigured()) {
      return this.gemini;
    }
    if (this.openRouter.isConfigured()) {
      return this.openRouter;
    }
    return this.fallback;
  }

  /**
   * Generates business answer with automatic failover across providers.
   */
  async generateAnswer(context: BusinessContext, question: string): Promise<AIAnswer> {
    const primary = this.getPrimaryProvider();

    // 1. Attempt Primary Provider
    if (primary.isConfigured() && primary !== this.fallback) {
      try {
        console.info(`[AIRouter] Routing query to primary provider: ${primary.providerName}`);
        return await primary.generateBusinessAnswer(context, question);
      } catch (err: any) {
        console.warn(`[AIRouter] Primary provider (${primary.providerName}) failed: ${err.message}. Attempting failover.`);
      }
    }

    // 2. Attempt Secondary Remote Provider
    const secondary = primary === this.gemini ? this.openRouter : this.gemini;
    if (secondary.isConfigured()) {
      try {
        console.info(`[AIRouter] Failover: Routing query to secondary provider: ${secondary.providerName}`);
        return await secondary.generateBusinessAnswer(context, question);
      } catch (err: any) {
        console.warn(`[AIRouter] Secondary provider (${secondary.providerName}) failed: ${err.message}.`);
      }
    }

    // 3. Guaranteed Deterministic Fallback
    console.info('[AIRouter] Using authoritative rule-based analytics engine.');
    return await this.fallback.generateBusinessAnswer(context, question);
  }
}

let globalAiRouterInstance: AIRouter | null = null;

export function getAIRouter(): AIRouter {
  if (!globalAiRouterInstance) {
    globalAiRouterInstance = new AIRouter();
  }
  return globalAiRouterInstance;
}
