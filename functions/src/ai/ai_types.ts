/**
 * Thakur Bites Platform 2.0 — Read-Only AI Business Copilot Types
 * 
 * Strict data contracts for factual business context, AI responses,
 * and swappable model providers (Gemini, OpenRouter, Rule-based Fallback).
 */

export type AnalyticsPeriod = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days';

export interface TopProductMetric {
  name: string;
  category: string;
  unitsSold: number;
  revenuePaise: number;
  shareOfUnitsPercent: number;
}

export interface InventoryDepletionAlert {
  itemId: string;
  name: string;
  category: string;
  availableStock: number;
  reservedStock: number;
  burnRatePerHour: number;
  estimatedHoursRemaining: number | null;
  isStockoutWarning: boolean;
  suggestedAction: string;
}

export interface HourlySalesBucket {
  hourFormatted: string; // e.g., '12:00 PM'
  orderCount: number;
  revenuePaise: number;
}

export interface BusinessContext {
  period: AnalyticsPeriod;
  periodLabel: string;
  startDateIso: string;
  endDateIso: string;
  timezone: 'Asia/Kolkata';
  
  // Financial & Volume Ground Truth
  totalOrdersCount: number;
  paidOrdersCount: number;
  cancelledOrdersCount: number;
  grossRevenuePaise: number;
  netRevenuePaise: number;
  refundsPaise: number;
  cashRevenuePaise: number;
  digitalRevenuePaise: number;
  averagePaidOrderPaise: number;
  
  // Product & Inventory Facts
  topSellers: TopProductMetric[];
  leastOrderedItems: TopProductMetric[];
  inventoryAlerts: InventoryDepletionAlert[];
  hourlyDemand: HourlySalesBucket[];
  
  // Data Integrity & Cost Accounting Disclaimers
  costsAvailable: false;
  costDataNotice: string;
  dataQuality: 'ACTUAL' | 'INSUFFICIENT_DATA';
  zeroPiiEnforced: true;
  generatedAtIso: string;
}

export interface AIAnswerEvidence {
  ordersAnalyzed: number;
  period: string;
  dataQuality: 'ACTUAL' | 'INSUFFICIENT_DATA';
  keyMetrics: {
    grossRevenue: string;
    netRevenue: string;
    refunds: string;
    paidOrders: number;
    cashSharePercent: number;
  };
  disclaimers: string[];
  providerUsed: 'gemini' | 'openrouter' | 'rule_based_engine';
  executionLatencyMs: number;
}

export interface AIAnswer {
  answerMarkdown: string;
  evidence: AIAnswerEvidence;
  suggestedFollowUps: string[];
}

export interface AIProvider {
  readonly providerName: 'gemini' | 'openrouter' | 'rule_based_engine';
  isConfigured(): boolean;
  generateBusinessAnswer(context: BusinessContext, question: string): Promise<AIAnswer>;
}
