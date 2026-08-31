// Phase 8 — Kitchen Display System (KDS) with Smart Batching Intelligence & Station Capacity
import { subscribeOrders, updateOrderStatus } from '../firebase.js?v=4';

let unsubscribeOrders = null;
let currentOrders = [];
let selectedCategoryFilter = 'all';

export function renderKitchenView(container) {
  // Clean up any prior subscription
  if (unsubscribeOrders) {
    unsubscribeOrders();
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
            <div style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Active Kitchen Load: ${cookOrders.length} to cook · ${readyOrders.length} ready at counter
            </div>
          </div>

          <!-- Category Quick Filters -->
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            ${['all', 'dosa', 'snack', 'chinese', 'chai'].map(cat => `
              <button 
                class="category-filter-btn ${selectedCategoryFilter === cat ? 'active' : ''}"
                data-category="${cat}"
                style="padding: 6px 14px; border-radius: 999px; border: 1.5px solid ${selectedCategoryFilter === cat ? 'var(--brand-red)' : 'var(--border-light)'}; background: ${selectedCategoryFilter === cat ? 'var(--brand-red)' : '#FFF'}; color: ${selectedCategoryFilter === cat ? '#FFF' : 'var(--ink-primary)'}; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; cursor: pointer;"
              >
                ${cat.toUpperCase()}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- 🍳 BATCHING INTELLIGENCE BAR -->
        <div style="background: #FFFBEB; border: 1.5px solid #FDE68A; border-radius: 12px; padding: 0.9rem 1.2rem; margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.3rem;">⚡️</span>
            <div>
              <div style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: #92400E; text-transform: uppercase;">
                Smart Cooking Batches (Aggregate)
              </div>
              <div style="font-family: var(--font-sans); font-size: 0.75rem; color: #B45309;">
                Cook these items simultaneously across all active tickets:
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${batchEntries.length === 0 ? `
              <span style="font-family: var(--font-mono); font-size: 0.85rem; color: #92400E;">No active items in queue</span>
            ` : batchEntries.map(([name, qty]) => `
              <span style="background: #FFF; border: 1.5px solid #FCD34D; color: #92400E; padding: 4px 10px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800;">
                ${qty}x ${name}
              </span>
            `).join('')}
          </div>
        </div>

        <!-- KDS Dual Column Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 1.5rem; align-items: start;">
          
          <!-- COLUMN 1: TO COOK (Placed, Confirmed & Preparing) -->
          <div class="kds-column" style="background: #FFF; border: 2px solid var(--border-light); border-radius: 12px; overflow: hidden; border-top: 6px solid #EFA727;">
            <div style="padding: 1rem 1.2rem; background: #FDFBF7; border-bottom: 1.5px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; color: #6B4408;">
                  🍳 COOK QUEUE (${cookOrders.length})
                </h3>
                <span style="font-family: var(--font-sans); font-size: 0.8rem; color: var(--ink-secondary);">Orders requiring preparation</span>
              </div>
              <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; background: #FBE7BE; color: #6B4408; padding: 3px 8px; border-radius: 6px;">
                STATION ACTIVE
              </span>
            </div>

            <div style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem; max-height: 70vh; overflow-y: auto;">
              ${cookOrders.length === 0 ? `
                <div style="text-align: center; padding: 3rem 1rem; color: var(--ink-secondary); font-family: var(--font-sans);">
                  🎉 All orders prepared! No active tickets in cook queue.
                </div>
              ` : cookOrders.map(order => `
                <div class="kds-ticket" style="background: #FFFDF8; border: 1.5px solid #FCE4B8; border-radius: 10px; padding: 1rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                  
                  <!-- Ticket Top -->
                  <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #F5D495; padding-bottom: 0.6rem; margin-bottom: 0.8rem;">
                    <div>
                      <span style="font-family: var(--font-mono); font-size: 1.6rem; font-weight: 900; color: var(--brand-red);">
                        ${order.tokenNumber}
                      </span>
                      <span style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary); margin-left: 8px;">
                        PIN: ${order.pinCode}
                      </span>
                    </div>
                    <span style="font-family: var(--font-mono); font-size: 0.75rem; background: ${order.status === 'preparing' ? '#FEF3C7' : '#FEE2E2'}; color: ${order.status === 'preparing' ? '#92400E' : '#991B1B'}; padding: 2px 8px; border-radius: 4px; font-weight: 700;">
                      ${order.status === 'preparing' ? '🔥 PREPARING' : '⏳ PLACED'}
                    </span>
                  </div>

                  <!-- Dishes -->
                  <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 1rem;">
                    ${(order.items || []).map(item => `
                      <div style="display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; color: var(--ink-primary);">
                        <span>${item.quantity}x ${item.name}</span>
                      </div>
                    `).join('')}
                  </div>

                  <!-- Action Buttons -->
                  <div style="display: flex; gap: 8px;">
                    ${order.status !== 'preparing' ? `
                      <button 
                        class="kds-action-btn" 
                        data-order-id="${order.id}" 
                        data-action="preparing"
                        style="flex: 1; padding: 8px; border-radius: 6px; border: 1.5px solid #F59E0B; background: #FEF3C7; color: #92400E; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; cursor: pointer;"
                      >
                        Start Cooking 🔥
                      </button>
                    ` : ''}
                    <button 
                      class="kds-action-btn" 
                      data-order-id="${order.id}" 
                      data-action="ready"
                      style="flex: 1; padding: 8px; border-radius: 6px; border: none; background: #16A34A; color: #FFF; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; cursor: pointer;"
                    >
                      Mark Ready 🔔
                    </button>
                  </div>

                </div>
              `).join('')}
            </div>
          </div>

          <!-- COLUMN 2: READY AT COUNTER -->
          <div class="kds-column" style="background: #FFF; border: 2px solid var(--border-light); border-radius: 12px; overflow: hidden; border-top: 6px solid #22C55E;">
            <div style="padding: 1rem 1.2rem; background: #F7FDF9; border-bottom: 1.5px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; color: #166534;">
                  🔔 READY FOR PICKUP (${readyOrders.length})
                </h3>
                <span style="font-family: var(--font-sans); font-size: 0.8rem; color: var(--ink-secondary);">Waiting for student handover</span>
              </div>
            </div>

            <div style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem; max-height: 70vh; overflow-y: auto;">
              ${readyOrders.length === 0 ? `
                <div style="text-align: center; padding: 3rem 1rem; color: var(--ink-secondary); font-family: var(--font-sans);">
                  No orders currently waiting at the pickup counter.
                </div>
              ` : readyOrders.map(order => `
                <div class="kds-ticket" style="background: #F9FDF7; border: 1.5px solid #BBF7D0; border-radius: 10px; padding: 1rem;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem;">
                    <span style="font-family: var(--font-mono); font-size: 1.6rem; font-weight: 900; color: #15803D;">
                      ${order.tokenNumber}
                    </span>
                    <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: #166534;">
                      PIN: ${order.pinCode}
                    </span>
                  </div>

                  <div style="font-family: var(--font-mono); font-size: 0.9rem; color: var(--ink-secondary); margin-bottom: 0.8rem;">
                    ${(order.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ')}
                  </div>

                  <button 
                    class="kds-action-btn" 
                    data-order-id="${order.id}" 
                    data-action="collected"
                    style="width: 100%; padding: 8px; border-radius: 6px; border: 1.5px solid #22C55E; background: #DCFCE7; color: #15803D; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; cursor: pointer;"
                  >
                    Handover / Complete ✓
                  </button>
                </div>
              `).join('')}
            </div>
          </div>

        </div>
      </div>
    `;

    // Filter Buttons
    container.querySelectorAll('.category-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedCategoryFilter = btn.getAttribute('data-category');
        renderKDS();
      });
    });

    // Action Buttons
    container.querySelectorAll('.kds-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        const targetAction = btn.getAttribute('data-action');
        btn.textContent = 'Updating...';
        btn.disabled = true;

        await updateOrderStatus(orderId, targetAction);
      });
    });
  }

  unsubscribeOrders = subscribeOrders((orders) => {
    currentOrders = orders;
    renderKDS();
  });
}
