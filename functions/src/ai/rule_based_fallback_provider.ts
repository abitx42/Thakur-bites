/**
 * Thakur Bites Platform 2.0 — Rule-Based Factual Fallback Provider
 * 
 * Generates authoritative, deterministic business summaries directly from
 * BusinessContext without hallucinating numbers. Serves as a reliable baseline
 * and fallback when external AI APIs are offline or unconfigured.
 */

import { AIProvider, BusinessContext, AIAnswer } from './ai_types';
import { formatPaiseToInr } from './prompt_builder';

export class RuleBasedFallbackProvider implements AIProvider {
  readonly providerName = 'rule_based_engine' as const;

  isConfigured(): boolean {
    return true; // Always available as local authoritative engine
  }

  async generateBusinessAnswer(context: BusinessContext, question: string): Promise<AIAnswer> {
    const startMs = Date.now();
    const q = question.toLowerCase();

    let answerMarkdown = '';
    const suggestedFollowUps: string[] = [];

    const cashShare = context.grossRevenuePaise > 0
      ? Math.round((context.cashRevenuePaise / context.grossRevenuePaise) * 100)
      : 0;

    // 1. Loss / Profit / Cost Inquiries
    if (q.includes('loss') || q.includes('profit') || q.includes('margin') || q.includes('cost')) {
      answerMarkdown = `### ⚠️ Cost & Profitability Analysis Notice\n\n` +
        `**Profit and loss cannot currently be calculated** for menu items because ingredient, procurement, and packaging costs are not recorded in the database.\n\n` +
        `**What is recorded:**\n` +
        `- Gross Revenue: **${formatPaiseToInr(context.grossRevenuePaise)}**\n` +
        `- Customer Refunds: **${formatPaiseToInr(context.refundsPaise)}**\n` +
        `- Net Revenue: **${formatPaiseToInr(context.netRevenuePaise)}** across **${context.paidOrdersCount}** paid orders\n\n` +
        `> **Important Notice:** To evaluate true dish-level contribution, recipe ingredient bills and packaging overheads must be linked in future cost-management modules. No speculative losses or margins are invented.`;
      
      suggestedFollowUps.push('What are our top revenue dishes?', 'How are today\'s sales doing?');
    }
    // 2. Inventory / Restock / Stockout Inquiries
    else if (q.includes('stock') || q.includes('restock') || q.includes('inventory') || q.includes('deplet') || q.includes('add')) {
      const urgentAlerts = context.inventoryAlerts.filter(a => a.isStockoutWarning || (a.estimatedHoursRemaining !== null && a.estimatedHoursRemaining < 2.0));

      if (urgentAlerts.length > 0) {
        answerMarkdown = `### 📦 Inventory Depletion & Restock Priorities\n\n` +
          `Based on current sales velocity and stock on hand, **${urgentAlerts.length} item(s)** require immediate kitchen attention:\n\n`;

        urgentAlerts.forEach(item => {
          const hours = item.estimatedHoursRemaining !== null ? `~${item.estimatedHoursRemaining} hrs` : 'Depleted/Imminent';
          answerMarkdown += `* 🔴 **${item.name}** (${item.category})\n` +
            `  * Available stock: **${item.availableStock}** units (Reserved: ${item.reservedStock})\n` +
            `  * Burn rate: **${item.burnRatePerHour}** units/hour\n` +
            `  * Projected depletion: **${hours}**\n` +
            `  * *Suggested action:* ${item.suggestedAction}\n\n`;
        });
      } else {
        answerMarkdown = `### 📦 Inventory Status: All Nominal\n\n` +
          `No critical stockout risks detected for the active catalog. All monitored instant dishes have sufficient available buffers for the current hourly demand rate.\n\n`;
      }

      suggestedFollowUps.push('Which dishes are selling fastest?', 'How are we doing today?');
    }
    // 3. Top Sellers / Best Dishes
    else if (q.includes('top') || q.includes('most') || q.includes('best') || q.includes('popular')) {
      if (context.topSellers.length > 0) {
        answerMarkdown = `### 🏆 Top Performing Menu Items (${context.periodLabel})\n\n`;
        context.topSellers.slice(0, 5).forEach((item, index) => {
          answerMarkdown += `${index + 1}. **${item.name}** — **${item.unitsSold} units** (${formatPaiseToInr(item.revenuePaise)}, ${item.shareOfUnitsPercent}% of volume)\n`;
        });
        answerMarkdown += `\n*Total volume:* **${context.topSellers.reduce((acc, it) => acc + it.unitsSold, 0)} items** ordered across ${context.paidOrdersCount} completed orders.`;
      } else {
        answerMarkdown = `### 🏆 Top Sellers: Insufficient Data\n\n` +
          `No completed orders recorded yet for ${context.periodLabel}. Once orders are confirmed at the counter or online, sales leaders will rank here in real time.`;
      }

      suggestedFollowUps.push('Which items are selling least?', 'What stock should I add?');
    }
    // 4. Least Ordered / Low Performers
    else if (q.includes('least') || q.includes('slow') || q.includes('worst') || q.includes('unpopular') || q.includes('remov') || q.includes('low') || q.includes('drop')) {
      if (context.leastOrderedItems.length > 0) {
        answerMarkdown = `### 📉 Low Sales Velocity Items (${context.periodLabel})\n\n` +
          `The following catalog items recorded the lowest sales volume during this period:\n\n`;
        context.leastOrderedItems.slice(0, 5).forEach((item, index) => {
          answerMarkdown += `${index + 1}. **${item.name}** (${item.category}) — **${item.unitsSold} units** (${formatPaiseToInr(item.revenuePaise)})\n`;
        });
        answerMarkdown += `\n*Evidence-based consideration:* If items consistently record low velocity over multiple weeks and carry perishable preparation costs, management may review menu placement or batch sizes.`;
      } else {
        answerMarkdown = `### 📉 Low Sellers: Insufficient Data\n\n` +
          `No active menu items met low-velocity review thresholds for ${context.periodLabel}.`;
      }

      suggestedFollowUps.push('What are our top sellers?', 'What stock should I add?');
    }
    // 5. Busiest Hours / Hourly Demand
    else if (q.includes('hour') || q.includes('busy') || q.includes('rush') || q.includes('time') || q.includes('lunch')) {
      const topHours = [...context.hourlyDemand].sort((a, b) => b.orderCount - a.orderCount).slice(0, 3);
      if (topHours.length > 0 && topHours[0].orderCount > 0) {
        answerMarkdown = `### ⏱️ Peak Operational Hours (${context.periodLabel})\n\n` +
          `The busiest ordering intervals recorded today were:\n\n`;
        topHours.forEach((h, idx) => {
          answerMarkdown += `${idx + 1}. **${h.hourFormatted}** — **${h.orderCount} orders** (${formatPaiseToInr(h.revenuePaise)})\n`;
        });
        answerMarkdown += `\n*Recommendation:* Ensure preparation counters and pickup windows are fully staffed ahead of peak rush intervals.`;
      } else {
        answerMarkdown = `### ⏱️ Hourly Demand: Insufficient Volume\n\n` +
          `No significant hourly clusters detected yet today. Peak intervals typically concentrate around 10:15 AM (Morning Tea) and 12:30 PM (Lunch Rush).`;
      }

      suggestedFollowUps.push('How are we doing today?', 'What stock should I add?');
    }
    // 6. Default: Overall Executive Business Summary
    else {
      answerMarkdown = `### 📊 Business Summary (${context.periodLabel})\n\n` +
        `* **Gross Revenue:** **${formatPaiseToInr(context.grossRevenuePaise)}**\n` +
        `* **Net Revenue:** **${formatPaiseToInr(context.netRevenuePaise)}**\n` +
        `* **Paid Orders:** **${context.paidOrdersCount}** (Total attempts: ${context.totalOrdersCount})\n` +
        `* **Average Paid Order:** **${formatPaiseToInr(context.averagePaidOrderPaise)}**\n` +
        `* **Refunds:** **${formatPaiseToInr(context.refundsPaise)}** (${context.cancelledOrdersCount} cancelled)\n` +
        `* **Cash vs Digital:** **${cashShare}%** Cash (${formatPaiseToInr(context.cashRevenuePaise)}) / **${100 - cashShare}%** Online (${formatPaiseToInr(context.digitalRevenuePaise)})\n\n`;

      if (context.topSellers.length > 0) {
        answerMarkdown += `**Top Sellers:**\n`;
        context.topSellers.slice(0, 3).forEach((item, i) => {
          answerMarkdown += `${i + 1}. ${item.name} — ${item.unitsSold} units (${formatPaiseToInr(item.revenuePaise)})\n`;
        });
        answerMarkdown += '\n';
      }

      const activeAlerts = context.inventoryAlerts.filter(a => a.isStockoutWarning);
      if (activeAlerts.length > 0) {
        answerMarkdown += `**⚠️ Inventory Alerts:**\n`;
        activeAlerts.slice(0, 3).forEach(alert => {
          const rem = alert.estimatedHoursRemaining !== null ? `~${alert.estimatedHoursRemaining} hrs` : 'Imminent';
          answerMarkdown += `* **${alert.name}**: ${alert.availableStock} available (projected stockout in ${rem})\n`;
        });
        answerMarkdown += '\n';
      }

      answerMarkdown += `*Important:* Profit/loss cannot currently be calculated because ingredient/procurement costs are not recorded in the database.`;

      suggestedFollowUps.push(
        'What stock should I add?',
        'Which dishes are selling most?',
        'What were our busiest hours?'
      );
    }

    const duration = Date.now() - startMs;

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
          'Calculated directly from verified Firestore orders and ledger records.',
          context.costDataNotice,
          'Zero PII transmitted: aggregations exclude student names, contact info, and token credentials.',
        ],
        providerUsed: this.providerName,
        executionLatencyMs: duration,
      },
      suggestedFollowUps,
    };
  }
}
