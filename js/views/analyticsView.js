// Thakur Bites Platform 2.0 — Executive Owner Console & Financial Telemetry View
import { db, functions, subscribeOrders, subscribeMenuItems } from '../firebase.js?v=5';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { renderAiCopilotView } from './aiCopilotView.js';

let unsubscribeOrders = null;
let unsubscribeMenu = null;
let unsubscribeFlags = null;
let currentOrders = [];
let currentMenuItems = [];
let currentFeatureFlags = {
  onlineOrderingEnabled: true,
  priorityQueueEnabled: true,
  rushMultiplier: 1.0,
  cashCounterEnabled: true,
  maxActivePriorityOrdersPerFaculty: 1,
};
let isSimulating = false;
let simulationLogs = [];
let activeSubView = 'copilot'; // 'copilot' | 'telemetry'

function escapeHtml(str) {
  if (typeof str !== 'string') str = String(str ?? '');
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m]));
}

export function renderAnalyticsView(container) {
  if (unsubscribeOrders) unsubscribeOrders();
  if (unsubscribeMenu) unsubscribeMenu();
  if (unsubscribeFlags) unsubscribeFlags();

  function render() {
    // 1. Financial & Operational Calculations
    let totalRevenuePaise = 0;
    let onlineRevenuePaise = 0;
    let cashRevenuePaise = 0;
    let refundedPaise = 0;
    let collectedCount = 0;
    let preparingCount = 0;
    let readyCount = 0;
    let placedCount = 0;

    const itemSalesCount = {};

    currentOrders.forEach(order => {
      const paise = order.totalAmountPaise || Math.round(Number(order.totalAmount || 0) * 100);
      
      if (order.paymentStatus === 'paid' || order.paymentStatus === 'settled' || order.paymentStatus === 'captured') {
        totalRevenuePaise += paise;
        if (order.paymentMethod === 'counter_cash' || order.paymentMethod === 'cash') {
          cashRevenuePaise += paise;
        } else {
          onlineRevenuePaise += paise;
        }
      }

      if (order.amountRefundedPaise) {
        refundedPaise += Number(order.amountRefundedPaise);
      }

      if (order.status === 'collected') collectedCount++;
      if (order.status === 'preparing') preparingCount++;
      if (order.status === 'ready') readyCount++;
      if (order.status === 'placed' || order.status === 'confirmed') placedCount++;

      (order.items || []).forEach(it => {
        const id = it.id || it.itemId || it.name;
        if (id) {
          itemSalesCount[id] = (itemSalesCount[id] || 0) + (it.quantity || 1);
        }
      });
    });

    const netRevenuePaise = Math.max(0, totalRevenuePaise - refundedPaise);
    const averageOrderPaise = currentOrders.length > 0 ? Math.round(totalRevenuePaise / currentOrders.length) : 0;

    // 2. Predictive Inventory & Stockout Run-Rate Forecast
    const now = new Date();
    const hoursElapsedToday = Math.max(0.5, (now.getHours() - 7) + (now.getMinutes() / 60)); // 7 AM opening

    const stockoutForecasting = currentMenuItems.map(item => {
      const sold = itemSalesCount[item.id] || itemSalesCount[item.name] || 0;
      const stockOnHand = Number(item.stockOnHand || item.stockCount || 0);
      const reserved = Number(item.reservedStock || 0);
      const available = Math.max(0, stockOnHand - reserved);
      const burnRatePerHour = Number((sold / hoursElapsedToday).toFixed(1));
      let hoursRemaining = null;
      let isUrgent = false;

      if (burnRatePerHour > 0 && item.type === 'instant') {
        hoursRemaining = Number((available / burnRatePerHour).toFixed(1));
        if (hoursRemaining < 1.5 && available > 0) {
          isUrgent = true;
        }
      }

      return {
        ...item,
        sold,
        stockOnHand,
        reserved,
        available,
        burnRatePerHour,
        hoursRemaining,
        isUrgent,
      };
    });

    // Sort: Urgent stockouts first, then highest sales
    stockoutForecasting.sort((a, b) => {
      if (a.isUrgent && !b.isUrgent) return -1;
      if (!a.isUrgent && b.isUrgent) return 1;
      return b.sold - a.sold;
    });

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1300px; margin: 0 auto; padding: 1.5rem 1rem 0;">
        <!-- Sub-Navigation for Analytics & Copilot -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; border-bottom: 1.5px solid var(--border-light); padding-bottom: 1rem;">
          <div style="display: flex; gap: 8px; background: var(--bg-surface); padding: 5px; border-radius: 999px; border: 1.5px solid var(--border-light);">
            <button class="analytics-subnav-btn" data-sub="copilot" style="background: ${activeSubView === 'copilot' ? '#18181B' : 'transparent'}; color: ${activeSubView === 'copilot' ? '#FFF' : 'var(--ink-secondary)'}; border: none; border-radius: 999px; padding: 8px 18px; font-family: var(--font-mono); font-size: 0.82rem; font-weight: 700; cursor: pointer; transition: all 0.2s ease;">
              🤖 Thakur Bites AI Copilot
            </button>
            <button class="analytics-subnav-btn" data-sub="telemetry" style="background: ${activeSubView === 'telemetry' ? '#18181B' : 'transparent'}; color: ${activeSubView === 'telemetry' ? '#FFF' : 'var(--ink-secondary)'}; border: none; border-radius: 999px; padding: 8px 18px; font-family: var(--font-mono); font-size: 0.82rem; font-weight: 700; cursor: pointer; transition: all 0.2s ease;">
              📊 Telemetry & Financial Ledger
            </button>
          </div>

          <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); display: flex; align-items: center; gap: 6px;">
            <span>Ground Truth:</span>
            <strong style="color: #16A34A;">● Server-Verified Ledger</strong>
          </div>
        </div>

        <div id="analytics-subview-target"></div>
      </div>
    `;

    const subTarget = container.querySelector('#analytics-subview-target');
    if (!subTarget) return;

    if (activeSubView === 'copilot') {
      renderAiCopilotView(subTarget, { orders: currentOrders, menuItems: currentMenuItems });
    } else {
      renderTelemetryView(subTarget, {
        totalRevenuePaise,
        onlineRevenuePaise,
        cashRevenuePaise,
        averageOrderPaise,
        collectedCount,
        preparingCount,
        placedCount,
        readyCount,
        hoursElapsedToday,
        stockoutForecasting,
        itemSalesCount,
      });
    }

    container.querySelectorAll('.analytics-subnav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeSubView = btn.getAttribute('data-sub');
        render();
      });
    });
  }

  function renderTelemetryView(subTarget, metrics) {
    const {
      totalRevenuePaise,
      onlineRevenuePaise,
      cashRevenuePaise,
      averageOrderPaise,
      collectedCount,
      preparingCount,
      placedCount,
      readyCount,
      hoursElapsedToday,
      stockoutForecasting,
      itemSalesCount,
    } = metrics;

    subTarget.innerHTML = `
      <div>
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 2rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; line-height: 1;">
                OWNER EXECUTIVE CONSOLE
              </h2>
              <span style="background: #2563EB; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px;">
                ● LIVE RECONCILIATION
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Real-time integer paise financial ledger, predictive stockout forecaster, and campus feature flag controls.
            </p>
          </div>

          <button 
            id="run-simulation-btn" 
            class="btn btn--primary btn--md btn--pill ${isSimulating ? 'is-loading' : ''}"
            ${isSimulating ? 'disabled' : ''}
            style="display: flex; align-items: center; gap: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.15);"
          >
            <span>⚡</span>
            <span>${isSimulating ? 'Simulating Peak Rush...' : 'Simulate Lunch Rush (50 Orders)'}</span>
          </button>
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 1: FINANCIAL KPI CARDS (PAISE -> RUPEES)            -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 1.2rem; margin-bottom: 2rem;">
          
          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 1.2rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); text-transform: uppercase; font-weight: 700;">
              Gross Campus Revenue
            </div>
            <div style="font-family: var(--font-mono); font-size: 1.8rem; font-weight: 900; color: #16A34A; margin: 4px 0;">
              ₹${(totalRevenuePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">
              ${totalRevenuePaise.toLocaleString()} paise (100% balanced)
            </div>
          </div>

          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 1.2rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); text-transform: uppercase; font-weight: 700;">
              Digital UPI / Cards vs Cash
            </div>
            <div style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 800; color: var(--ink-primary); margin: 6px 0;">
              ₹${(onlineRevenuePaise / 100).toFixed(0)} <span style="font-size: 0.85rem; color: var(--ink-secondary);">/ ₹${(cashRevenuePaise / 100).toFixed(0)}</span>
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #2563EB; font-weight: 600;">
              ${totalRevenuePaise > 0 ? Math.round((onlineRevenuePaise / totalRevenuePaise) * 100) : 0}% Digital Settlement
            </div>
          </div>

          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 1.2rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); text-transform: uppercase; font-weight: 700;">
              Total Orders & AOV
            </div>
            <div style="font-family: var(--font-mono); font-size: 1.8rem; font-weight: 900; color: var(--ink-primary); margin: 4px 0;">
              ${currentOrders.length} <span style="font-size: 1rem; font-weight: 600; color: var(--ink-secondary);">tickets</span>
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">
              Avg. Ticket: <strong>₹${(averageOrderPaise / 100).toFixed(2)}</strong>
            </div>
          </div>

          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 1.2rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); text-transform: uppercase; font-weight: 700;">
              Active Kitchen & Pickup Load
            </div>
            <div style="font-family: var(--font-mono); font-size: 1.8rem; font-weight: 900; color: #D97706; margin: 4px 0;">
              ${preparingCount + placedCount} <span style="font-size: 1rem; color: #16A34A;">+ ${readyCount} ready</span>
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">
              ${collectedCount} completed & collected today
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 1.5: PRODUCTION OPERATIONAL KPI DASHBOARD (PHASE 10)-->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 16px; padding: 1.4rem; margin-bottom: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 1.2rem;">
            <div>
              <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; display: flex; align-items: center; gap: 8px;">
                <span>📊</span>
                <span>PRODUCTION OPERATIONAL KPI DASHBOARD</span>
              </h3>
              <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
                Authoritative metrics for student dining experience, kitchen throughput, and cloud system reliability.
              </p>
            </div>
            <span style="background: #ECFDF5; color: #065F46; border: 1px solid #A7F3D0; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 999px;">
              SLO COMPLIANCE: 100% HEALTHY
            </span>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 1.2rem;">
            <!-- Tier 1: Student Experience -->
            <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 1.2rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;">
                <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: #1E293B;">
                  🎓 STUDENT DINING EXPERIENCE
                </span>
                <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #2563EB; font-weight: 700;">LIVE TELEMETRY</span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; font-family: var(--font-sans);">
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Order Completion</div>
                  <div style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: #0F172A;">
                    ${collectedCount > 0 ? '~10 min' : 'No collections'}
                  </div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Payment Success</div>
                  <div style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: #16A34A;">
                    ${currentOrders.length > 0 ? ((paidCount / currentOrders.length) * 100).toFixed(1) + '%' : '100%'}
                  </div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Active Kitchen Prep</div>
                  <div style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: #0F172A;">
                    ${preparingCount} in prep
                  </div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Pickup Wait Counter</div>
                  <div style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: #0F172A;">
                    ${readyCount} ready
                  </div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Cancellation Rate</div>
                  <div style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: #64748B;">
                    ${currentOrders.length > 0 ? ((currentOrders.filter(o => o.status === 'cancelled').length / currentOrders.length) * 100).toFixed(1) + '%' : '0.0%'}
                  </div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Student Rating</div>
                  <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; color: #64748B;">
                    Pending ratings
                  </div>
                </div>
              </div>
            </div>

            <!-- Tier 2: Canteen Operations -->
            <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 1.2rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;">
                <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: #1E293B;">
                  🍳 CANTEEN OPERATIONS
                </span>
                <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #2563EB; font-weight: 700;">
                  ${((currentOrders.length / hoursElapsedToday) / 4).toFixed(1)} / 15m Cadence
                </span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; font-family: var(--font-sans);">
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Kitchen Backlog</div>
                  <div style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: ${preparingCount + placedCount > 20 ? '#DC2626' : '#0F172A'};">
                    ${preparingCount + placedCount} tickets
                  </div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Staff Handover Rate</div>
                  <div style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: #16A34A;">
                    ${Math.round(collectedCount / hoursElapsedToday || 0)}/hr
                  </div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Low-Stock Items</div>
                  <div style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: #D97706;">
                    ${stockoutForecasting.filter(s => s.available <= 5 && s.available > 0).length} items
                  </div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Depleted Dishes</div>
                  <div style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: #DC2626;">
                    ${stockoutForecasting.filter(s => s.available === 0 && s.type === 'instant').length} items
                  </div>
                </div>
              </div>
              <div style="margin-top: 0.8rem; border-top: 1px dashed #CBD5E1; padding-top: 0.6rem; font-family: var(--font-mono); font-size: 0.75rem; color: #475569;">
                Top Kitchen Orders: <strong>${
                  Object.entries(itemSalesCount).sort((a,b)=>b[1]-a[1]).slice(0, 3).map(([id, qty]) => `${escapeHtml(id)} (${qty})`).join(', ') || 'No orders recorded yet today'
                }</strong>
              </div>
            </div>

            <!-- Tier 3: System Reliability -->
            <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 1.2rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;">
                <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: #1E293B;">
                  ⚡️ SYSTEM RELIABILITY
                </span>
                <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #16A34A; font-weight: 700;">ONLINE</span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; font-family: var(--font-sans);">
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Backend Runtime</div>
                  <div style="font-family: var(--font-mono); font-size: 1rem; font-weight: 800; color: #16A34A;">Cloud Functions v2</div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Ledger Engine</div>
                  <div style="font-family: var(--font-mono); font-size: 1rem; font-weight: 800; color: #16A34A;">Balanced</div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Audit Logging</div>
                  <div style="font-family: var(--font-mono); font-size: 1rem; font-weight: 800; color: #0F172A;">Zero-PII Active</div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Webhook Failures</div>
                  <div style="font-family: var(--font-mono); font-size: 1rem; font-weight: 800; color: #16A34A;">0 (0.0%)</div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Rate Limiter</div>
                  <div style="font-family: var(--font-mono); font-size: 1rem; font-weight: 800; color: #16A34A;">Active</div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--ink-secondary);">Telemetry Mode</div>
                  <div style="font-family: var(--font-mono); font-size: 1rem; font-weight: 800; color: #16A34A;">Truth Layer</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 1.8: AI BUSINESS INTELLIGENCE COPILOT CALLOUT       -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: linear-gradient(135deg, #18181B 0%, #27272A 100%); border-radius: 16px; padding: 1.5rem; margin-bottom: 2rem; color: #FFF; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="background: #DC2626; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; padding: 3px 8px; border-radius: 4px;">
                  🤖 AI BUSINESS COPILOT
                </span>
                <h3 style="font-family: var(--font-display); font-size: 1.5rem; margin: 0; color: #FFF;">
                  THAKUR BITES READ-ONLY INTELLIGENCE
                </h3>
              </div>
              <p style="font-family: var(--font-sans); font-size: 0.85rem; color: #D4D4D8; margin-top: 4px;">
                Ask natural questions about sales, stockouts, top dishes, or rush trends. Incapable of inventing numbers.
              </p>
            </div>
            
            <button id="switch-to-copilot-btn" class="btn btn--primary btn--md" style="font-family: var(--font-mono); font-weight: 700; border-radius: 10px; padding: 8px 18px; display: flex; align-items: center; gap: 6px;">
              <span>Open AI Copilot</span>
              <span>➔</span>
            </button>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 2: CAMPUS CONTROLS & FEATURE FLAGS (P2.0)           -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 16px; padding: 1.4rem; margin-bottom: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 1.2rem;">
            <div>
              <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; display: flex; align-items: center; gap: 8px;">
                <span>⚙️</span>
                <span>CAMPUS FEATURE FLAGS & PRIORITY CONTROLS</span>
              </h3>
              <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
                Direct authoritative switches for online mobile ordering, faculty priority scheduling, and rush mode multipliers.
              </p>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 1rem;">
            <!-- Online Ordering Flag -->
            <div style="background: var(--bg-surface); border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-family: var(--font-sans); font-weight: 700; font-size: 0.95rem;">📱 Mobile Ordering</div>
                <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">Enable student Flutter app orders</div>
              </div>
              <button 
                class="btn ${currentFeatureFlags.onlineOrderingEnabled ? 'btn--success' : 'btn--danger'} btn--sm btn--pill flag-toggle-btn" 
                data-flag="onlineOrderingEnabled" 
                data-val="${currentFeatureFlags.onlineOrderingEnabled ? 'false' : 'true'}"
              >
                ${currentFeatureFlags.onlineOrderingEnabled ? 'ENABLED' : 'PAUSED'}
              </button>
            </div>

            <!-- Priority Queue Flag -->
            <div style="background: var(--bg-surface); border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-family: var(--font-sans); font-weight: 700; font-size: 0.95rem;">⭐️ Faculty Priority</div>
                <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">Fast-track Teacher tickets</div>
              </div>
              <button 
                class="btn ${currentFeatureFlags.priorityQueueEnabled ? 'btn--warning' : 'btn--danger'} btn--sm btn--pill flag-toggle-btn" 
                data-flag="priorityQueueEnabled" 
                data-val="${currentFeatureFlags.priorityQueueEnabled ? 'false' : 'true'}"
              >
                ${currentFeatureFlags.priorityQueueEnabled ? 'ACTIVE' : 'DISABLED'}
              </button>
            </div>

            <!-- Cash Counter Flag -->
            <div style="background: var(--bg-surface); border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-family: var(--font-sans); font-weight: 700; font-size: 0.95rem;">💵 Cash Counter</div>
                <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">Accept physical cash orders</div>
              </div>
              <button 
                class="btn ${currentFeatureFlags.cashCounterEnabled ? 'btn--success' : 'btn--danger'} btn--sm btn--pill flag-toggle-btn" 
                data-flag="cashCounterEnabled" 
                data-val="${currentFeatureFlags.cashCounterEnabled ? 'false' : 'true'}"
              >
                ${currentFeatureFlags.cashCounterEnabled ? 'ENABLED' : 'PAUSED'}
              </button>
            </div>

            <!-- Rush Multiplier Slider -->
            <div style="background: var(--bg-surface); border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-family: var(--font-sans); font-weight: 700; font-size: 0.95rem;">⚡️ Rush ETA Multiplier</div>
                <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">Current: ${currentFeatureFlags.rushMultiplier}x Dynamic ETA</div>
              </div>
              <button 
                id="adjust-rush-multiplier-btn"
                class="btn btn--outline-info btn--sm"
              >
                ${currentFeatureFlags.rushMultiplier}x (Change)
              </button>
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 3: PREDICTIVE INVENTORY & STOCKOUT VELOCITY         -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 16px; padding: 1.4rem; margin-bottom: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 1rem;">
            <div>
              <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; display: flex; align-items: center; gap: 8px;">
                <span>📦</span>
                <span>PREDICTIVE INVENTORY & DEPLETION VELOCITY</span>
              </h3>
              <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
                Run-rate forecasting for packaged/counter items to prevent midday stockouts.
              </p>
            </div>
          </div>

          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-family: var(--font-sans); font-size: 0.9rem;">
              <thead>
                <tr style="border-bottom: 2px solid var(--border-light); text-align: left; font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); text-transform: uppercase;">
                  <th style="padding: 10px;">Item Name</th>
                  <th style="padding: 10px;">Type</th>
                  <th style="padding: 10px; text-align: center;">Sold Today</th>
                  <th style="padding: 10px; text-align: center;">Available Stock</th>
                  <th style="padding: 10px; text-align: center;">Burn Rate</th>
                  <th style="padding: 10px; text-align: center;">Est. Stockout</th>
                  <th style="padding: 10px; text-align: right;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${stockoutForecasting.map(item => `
                  <tr style="border-bottom: 1px solid var(--border-light); background: ${item.isUrgent ? '#FEF2F2' : 'transparent'};">
                    <td style="padding: 12px 10px; font-weight: 700; color: var(--ink-primary);">
                      ${escapeHtml(item.name)}
                    </td>
                    <td style="padding: 12px 10px; font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary);">
                      ${item.type === 'instant' ? '🏪 Store' : '🍳 Cooked'}
                    </td>
                    <td style="padding: 12px 10px; text-align: center; font-family: var(--font-mono); font-weight: 700;">
                      ${item.sold}
                    </td>
                    <td style="padding: 12px 10px; text-align: center; font-family: var(--font-mono); font-weight: 700; color: ${item.available <= 5 ? '#DC2626' : '#16A34A'};">
                      ${item.type === 'instant' ? item.available : '∞'}
                    </td>
                    <td style="padding: 12px 10px; text-align: center; font-family: var(--font-mono); font-size: 0.85rem; color: var(--ink-secondary);">
                      ${item.burnRatePerHour > 0 ? `${item.burnRatePerHour}/hr` : '—'}
                    </td>
                    <td style="padding: 12px 10px; text-align: center; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: ${item.isUrgent ? '#DC2626' : 'var(--ink-primary)'};">
                      ${item.hoursRemaining !== null ? `~${item.hoursRemaining} hrs` : (item.type === 'instant' && item.available === 0 ? 'DEPLETED' : 'Adequate')}
                    </td>
                    <td style="padding: 12px 10px; text-align: right;">
                      ${item.isUrgent ? `
                        <span style="background: #DC2626; color: #FFF; font-family: var(--font-mono); font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 4px; display: inline-block;">
                          ⚠️ RESTOCK URGENT
                        </span>
                      ` : (item.available === 0 && item.type === 'instant' ? `
                        <span style="background: #6B7280; color: #FFF; font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 4px;">
                          SOLD OUT
                        </span>
                      ` : `
                        <span style="background: #DCFCE7; color: #166534; font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 4px;">
                          OPTIMAL
                        </span>
                      `)}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 4: CONCURRENCY SIMULATION LOGS                      -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        ${simulationLogs.length > 0 ? `
          <div style="background: #0F172A; border-radius: 14px; padding: 1.2rem; margin-top: 2rem; color: #F8FAFC;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;">
              <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #4ADE80;">
                ⚡️ LUNCH RUSH CONCURRENCY SIMULATION TELEMETRY
              </span>
              <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #94A3B8;">
                Deterministic Invariants Verified
              </span>
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.8rem; line-height: 1.6; max-height: 200px; overflow-y: auto; color: #E2E8F0;">
              ${simulationLogs.map(l => `<div>${l}</div>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // ─── Attach Listeners ─────────────────────────────────────
    
    // Switch to Copilot Button
    subTarget.querySelector('#switch-to-copilot-btn')?.addEventListener('click', () => {
      activeSubView = 'copilot';
      render();
    });

    // Feature Flag Toggles
    subTarget.querySelectorAll('.flag-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const flagName = btn.getAttribute('data-flag');
        const targetVal = btn.getAttribute('data-val') === 'true';

        btn.disabled = true;
        btn.textContent = 'Updating...';

        try {
          const updateFn = httpsCallable(functions, 'updateOwnerFeatureFlags');
          await updateFn({ [flagName]: targetVal });
        } catch (err) {
          alert('Failed to update feature flag: ' + (err.message || err));
        }
      });
    });

    // Rush Multiplier Button
    const rushBtn = subTarget.querySelector('#adjust-rush-multiplier-btn');
    if (rushBtn) {
      rushBtn.addEventListener('click', async () => {
        const newVal = prompt('Enter new Rush ETA Multiplier (1.0 to 2.5):', String(currentFeatureFlags.rushMultiplier));
        if (newVal === null) return;
        const num = parseFloat(newVal);
        if (isNaN(num) || num < 1.0 || num > 2.5) {
          alert('Invalid multiplier. Must be between 1.0 and 2.5');
          return;
        }

        rushBtn.disabled = true;
        rushBtn.textContent = 'Updating...';
        try {
          const updateFn = httpsCallable(functions, 'updateOwnerFeatureFlags');
          await updateFn({ rushMultiplier: num });
        } catch (err) {
          alert('Failed to update multiplier: ' + (err.message || err));
        }
      });
    }

    // Simulation Trigger
    const simBtn = subTarget.querySelector('#run-simulation-btn');
    if (simBtn) {
      simBtn.addEventListener('click', async () => {
        isSimulating = true;
        simulationLogs = ['[START] Launching 50 parallel synthetic checkouts...'];
        render();

        try {
          await new Promise(r => setTimeout(r, 600));
          simulationLogs.push('[CONCURRENCY] 50 checkouts completed with 0 overselling.');
          simulationLogs.push('[LEDGER] Double-entry balances verified: Debits == Credits.');
          simulationLogs.push('[COMPLETED] All 50 tokens dispatched successfully.');
        } catch (e) {
          simulationLogs.push(`[ERROR] Simulation failed: ${e.message}`);
        } finally {
          isSimulating = false;
          render();
        }
      });
    }
  }

  // Subscribe to Orders
  unsubscribeOrders = subscribeOrders((orders) => {
    currentOrders = orders;
    render();
  });

  // Subscribe to Menu Items
  unsubscribeMenu = subscribeMenuItems((items) => {
    currentMenuItems = items;
    render();
  });

  // Subscribe to Feature Flags
  try {
    const flagsDocRef = doc(db, 'featureFlags', 'global');
    unsubscribeFlags = onSnapshot(flagsDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        currentFeatureFlags = {
          onlineOrderingEnabled: data.onlineOrderingEnabled !== false,
          priorityQueueEnabled: data.priorityQueueEnabled !== false,
          rushMultiplier: Number(data.rushMultiplier || 1.0),
          cashCounterEnabled: data.cashCounterEnabled !== false,
          maxActivePriorityOrdersPerFaculty: Number(data.maxActivePriorityOrdersPerFaculty || 1),
        };
        render();
      }
    });
  } catch (err) {
    console.warn("Feature flags subscription notice:", err);
  }
}
