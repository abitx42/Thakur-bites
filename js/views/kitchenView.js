// Phase 8 — Kitchen Display System (KDS) with Smart Batching Intelligence & Station Capacity
import { fetchKitchenOrders, updateOrderStatus } from '../firebase.js?v=4';
import { escapeHtml } from './escapeHtml.js';

let pollInterval = null;
let currentOrders = [];
let selectedCategoryFilter = 'all';

export function renderKitchenView(container) {
  // Clean up any prior polling
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  function renderKDS() {
    // Filter active orders
    const activeOrders = currentOrders.filter(o => o.status !== 'collected');

    // Cook Queue: placed or preparing
    const cookOrders = activeOrders.filter(o => {
      const isCookingState = o.status === 'placed' || o.status === 'preparing' || o.status === 'confirmed';
      if (!isCookingState) return false;
      if (selectedCategoryFilter === 'all') return true;
      return o.items && o.items.some(i => i.name.toLowerCase().includes(selectedCategoryFilter));
    });

    // Dynamic Effective Priority Score calculation: Base + (WaitMinutes * 5)
    function computeEffectiveScore(order) {
      if (typeof order.effectivePriority === 'number') {
        return order.effectivePriority;
      }
      const base = (order.priorityLevel || 1) * 100;
      const createdAtMs = order.createdAt ? new Date(order.createdAt).getTime() : Date.now();
      const waitMinutes = Math.max(0, (Date.now() - createdAtMs) / 60000);
      return base + Math.floor(waitMinutes * 5);
    }

    // Sort: Highest effective priority first, then earliest created
    cookOrders.sort((a, b) => {
      const scoreA = computeEffectiveScore(a);
      const scoreB = computeEffectiveScore(b);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Ready Queue: ready for pickup
    const readyOrders = activeOrders.filter(o => o.status === 'ready');

    // Smart Kitchen Batching Intelligence: Aggregate item totals across tickets
    const batchCounts = {};
    cookOrders.forEach(o => {
      (o.items || []).forEach(i => {
        batchCounts[i.name] = (batchCounts[i.name] || 0) + (i.quantity || 1);
      });
    });
    const batchEntries = Object.entries(batchCounts);

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1300px; margin: 0 auto; padding: 1.5rem 1rem;">
        <!-- KDS Control Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.2rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; line-height: 1; margin: 0;">
                KITCHEN DISPLAY SYSTEM (KDS)
              </h2>
              <span class="live-badge" style="background: #22C55E; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 999px;">
                ● LIVE SYNC
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Least-privilege operational view. Station-filtered tickets with dynamic priority ranking.
            </p>
          </div>

          <!-- Station Quick Stats -->
          <div style="display: flex; gap: 12px; align-items: center;">
            <div style="background: #FFF; border: 1.5px solid var(--border-light); padding: 8px 16px; border-radius: 10px; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 1.4rem; font-weight: 800; color: var(--brand-red); line-height: 1;">
                ${cookOrders.length}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); text-transform: uppercase;">
                To Cook
              </div>
            </div>

            <div style="background: #FFF; border: 1.5px solid var(--border-light); padding: 8px 16px; border-radius: 10px; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 1.4rem; font-weight: 800; color: #22C55E; line-height: 1;">
                ${readyOrders.length}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); text-transform: uppercase;">
                At Counter
              </div>
            </div>
          </div>
        </div>

        <!-- Smart Cooking Batches Bar -->
        ${batchEntries.length > 0 ? `
          <div style="background: #FFFBEB; border: 1.5px solid #FDE68A; border-radius: 12px; padding: 12px 16px; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: #92400E; display: flex; align-items: center; gap: 6px;">
                <span>🔥 SMART COOKING BATCHES</span>
                <span style="font-size: 0.75rem; font-weight: 400; color: #B45309;">(Consolidated item quantities across waiting tickets)</span>
              </div>
            </div>

            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              ${batchEntries.map(([name, qty]) => `
                <div style="background: #FFF; border: 1.5px solid #FCD34D; padding: 6px 12px; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
                  <span style="font-family: var(--font-mono); font-size: 1rem; font-weight: 800; color: #92400E;">${qty}x</span>
                  <span style="font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; color: var(--ink-primary);">${escapeHtml(name)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Filter Chips -->
        <div style="display: flex; gap: 8px; margin-bottom: 1.5rem; overflow-x: auto; padding-bottom: 4px;">
          ${['all', 'dosa', 'sandwich', 'snack', 'beverage'].map(cat => `
            <button 
              class="kds-filter-btn ${selectedCategoryFilter === cat ? 'active' : ''}" 
              data-cat="${cat}"
              style="padding: 6px 14px; border-radius: 999px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; cursor: pointer; border: 1.5px solid ${selectedCategoryFilter === cat ? 'var(--brand-red)' : 'var(--border-light)'}; background: ${selectedCategoryFilter === cat ? 'var(--brand-red)' : '#FFF'}; color: ${selectedCategoryFilter === cat ? '#FFF' : 'var(--ink-secondary)'};"
            >
              ${cat === 'all' ? '🍽️ All Stations' : cat.toUpperCase()}
            </button>
          `).join('')}
        </div>

        <!-- KDS Ticket Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.2rem;">
          ${cookOrders.length === 0 ? `
            <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; background: #FFF; border: 2px dashed var(--border-light); border-radius: 16px;">
              <div style="font-size: 3rem; margin-bottom: 0.5rem;">🍳</div>
              <h3 style="font-family: var(--font-display); font-size: 1.8rem; color: var(--ink-primary); margin: 0;">ALL CAUGHT UP!</h3>
              <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
                No pending kitchen tickets. Standing by for incoming orders.
              </p>
            </div>
          ` : cookOrders.map(order => {
            const isCooking = order.status === 'preparing';
            const elapsedMins = order.createdAt ? Math.floor(Math.max(0, (Date.now() - new Date(order.createdAt).getTime()) / 60000)) : 0;
            const isDelayed = elapsedMins >= 15;
            const effectiveScore = computeEffectiveScore(order);
            const orderId = order.orderId || order.id;

            return `
              <div class="kds-ticket-card" style="background: #FFF; border: 2px solid ${isDelayed ? '#EF4444' : (isCooking ? '#F59E0B' : 'var(--border-light)')}; border-radius: 14px; padding: 1.2rem; box-shadow: 0 4px 12px rgba(0,0,0,0.04); display: flex; flex-direction: column; justify-content: space-between;">
                
                <div>
                  <!-- Header: Token & Priority Score -->
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; border-bottom: 1.5px solid var(--border-light); padding-bottom: 0.8rem;">
                    <div>
                      <div style="font-family: var(--font-mono); font-size: 1.6rem; font-weight: 800; color: var(--ink-primary); line-height: 1;">
                        ${escapeHtml(order.tokenNumber || 'TB-???')}
                      </div>
                      <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                        <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: #6366F1; background: #EEF2FF; padding: 2px 6px; border-radius: 4px;">
                          Score: ${effectiveScore}
                        </span>
                        ${order.priorityLevel > 1 ? `
                          <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: #D97706; background: #FEF3C7; padding: 2px 6px; border-radius: 4px;">
                            Priority ⭐️
                          </span>
                        ` : ''}
                      </div>
                    </div>

                    <div style="text-align: right;">
                      <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: ${isCooking ? '#FEF3C7' : '#F3F4F6'}; color: ${isCooking ? '#92400E' : 'var(--ink-secondary)'};">
                        ${isCooking ? '🔥 COOKING' : '⏳ PLACED'}
                      </span>
                      <div style="font-family: var(--font-mono); font-size: 0.75rem; color: ${isDelayed ? '#EF4444' : 'var(--ink-secondary)'}; margin-top: 4px; font-weight: ${isDelayed ? '700' : '400'};">
                        ⏱️ ${elapsedMins}m ago
                      </div>
                    </div>
                  </div>

                  <!-- Order Items Checklist -->
                  <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 1.2rem;">
                    ${(order.items || []).map(item => `
                      <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface); padding: 8px 12px; border-radius: 8px; font-family: var(--font-mono);">
                        <span style="font-size: 1rem; font-weight: 700; color: var(--ink-primary);">
                          ${escapeHtml(item.quantity)}x ${escapeHtml(item.name)}
                        </span>
                        ${item.station ? `<span style="font-size: 0.75rem; color: var(--ink-secondary); text-transform: uppercase;">${escapeHtml(item.station)}</span>` : ''}
                      </div>
                    `).join('')}
                  </div>
                </div>

                <!-- Action Buttons -->
                <div style="display: grid; grid-template-columns: ${isCooking ? '1fr' : '1fr 1fr'}; gap: 8px;">
                  ${!isCooking ? `
                    <button 
                      class="kds-action-btn" 
                      data-order-id="${orderId}" 
                      data-target-status="preparing"
                      style="padding: 10px; border-radius: 8px; border: 1.5px solid #F59E0B; background: #FEF3C7; color: #92400E; font-family: var(--font-sans); font-size: 0.9rem; font-weight: 700; cursor: pointer;"
                    >
                      Start Cooking 🔥
                    </button>
                  ` : ''}

                  <button 
                    class="kds-action-btn" 
                    data-order-id="${orderId}" 
                    data-target-status="ready"
                    style="padding: 10px; border-radius: 8px; border: none; background: #16A34A; color: #FFF; font-family: var(--font-sans); font-size: 0.9rem; font-weight: 800; cursor: pointer; box-shadow: 0 2px 6px rgba(22,163,74,0.3);"
                  >
                    Mark Ready 🔔
                  </button>
                </div>

              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Attach KDS Filter Listeners
    container.querySelectorAll('.kds-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedCategoryFilter = btn.getAttribute('data-cat');
        renderKDS();
      });
    });

    // Attach Status Update Listeners
    container.querySelectorAll('.kds-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        const targetStatus = btn.getAttribute('data-target-status');
        btn.textContent = 'Updating...';
        btn.disabled = true;

        try {
          await updateOrderStatus(orderId, targetStatus);
          await loadKitchenData();
        } catch (e) {
          console.error("Status update error:", e);
          btn.disabled = false;
          btn.textContent = 'Error - Retry';
        }
      });
    });
  }

  async function loadKitchenData() {
    try {
      const orders = await fetchKitchenOrders();
      currentOrders = (orders || []).map(o => ({
        ...o,
        id: o.orderId || o.id,
      }));
      renderKDS();
    } catch (err) {
      console.warn("KDS operational fetch notice:", err);
    }
  }

  // Initial fetch and 5-second polling loop
  loadKitchenData();
  pollInterval = setInterval(loadKitchenData, 5000);
}
