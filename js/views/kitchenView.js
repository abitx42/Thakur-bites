// Phase 9 — Kitchen Display System (KDS) connected live to Firestore
import { subscribeOrders, updateOrderStatus } from '../firebase.js';

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
      const isCookingState = o.status === 'placed' || o.status === 'preparing';
      if (!isCookingState) return false;
      if (selectedCategoryFilter === 'all') return true;
      return o.items && o.items.some(i => i.name.toLowerCase().includes(selectedCategoryFilter));
    });

    // Ready Queue: ready for pickup
    const readyOrders = activeOrders.filter(o => o.status === 'ready');

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1300px; margin: 0 auto; padding: 1.5rem 1rem;">
        <!-- KDS Control Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
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
            ${['all', 'dosa', 'roti', 'chai', 'snack'].map(cat => `
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

        <!-- KDS Dual Column Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 1.5rem; align-items: start;">
          
          <!-- COLUMN 1: TO COOK (Placed & Preparing) -->
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
                  <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🎉</div>
                  <div style="font-weight: 600; font-size: 1.1rem; color: var(--ink-primary);">Kitchen Queue Clear</div>
                  <div style="font-size: 0.85rem; margin-top: 4px;">Incoming orders from the student app will appear here instantly.</div>
                </div>
              ` : cookOrders.map(order => {
                const isPreparing = order.status === 'preparing';
                const timeAgo = formatTimeAgo(order.createdAtDate);

                return `
                  <div class="kds-order-card" style="background: ${isPreparing ? '#FFFDF5' : '#FFF'}; border: 2px solid ${isPreparing ? '#EFA727' : 'var(--border-light)'}; border-radius: 10px; padding: 1.1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.04);">
                    <!-- Header: Token, PIN, Elapsed -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem;">
                      <div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <span style="font-family: var(--font-mono); font-size: 1.6rem; font-weight: 700; color: var(--brand-red);">
                            ${order.tokenNumber || '#---'}
                          </span>
                          <span style="font-family: var(--font-mono); font-size: 0.75rem; background: var(--bg-surface); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-light);">
                            PIN: ${order.pinCode || '----'}
                          </span>
                        </div>
                        ${order.studentName ? `
                          <div style="font-family: var(--font-sans); font-size: 0.8rem; font-weight: 600; color: var(--ink-primary); margin-top: 2px;">
                            👤 ${order.studentName} ${order.studentRoll ? `(${order.studentRoll})` : ''}
                          </div>
                        ` : ''}
                      </div>

                      <div style="text-align: right;">
                        <span style="display: inline-block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: ${isPreparing ? '#FBE7BE' : '#FEE2E2'}; color: ${isPreparing ? '#6B4408' : '#991B1B'};">
                          ${isPreparing ? '🔥 PREPARING' : '⏳ PLACED'}
                        </span>
                        <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 3px;">
                          ${timeAgo}
                        </div>
                      </div>
                    </div>

                    <!-- Items List -->
                    <div style="background: var(--bg-surface); border-radius: 8px; padding: 0.8rem; margin-bottom: 1rem;">
                      ${(order.items || []).map(item => `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-family: var(--font-mono); font-size: 0.95rem;">
                          <span style="font-weight: 700; color: var(--ink-primary);">
                            ${item.quantity}x ${item.name}
                          </span>
                          <span style="font-size: 0.8rem; color: var(--ink-secondary);">
                            ₹${item.price * item.quantity}
                          </span>
                        </div>
                      `).join('')}
                    </div>

                    <!-- Action Button -->
                    <div style="display: flex; gap: 8px;">
                      ${!isPreparing ? `
                        <button 
                          class="kds-action-btn start-cook-btn" 
                          data-order-id="${order.id}"
                          style="flex: 1; padding: 10px; background: #EFA727; color: #6B4408; border: none; border-radius: 8px; font-family: var(--font-sans); font-weight: 700; font-size: 0.9rem; cursor: pointer;"
                        >
                          Start Cooking 👨‍🍳
                        </button>
                      ` : `
                        <button 
                          class="kds-action-btn mark-ready-btn" 
                          data-order-id="${order.id}"
                          style="flex: 1; padding: 10px; background: #4F7A3C; color: #FFF; border: none; border-radius: 8px; font-family: var(--font-sans); font-weight: 700; font-size: 0.9rem; cursor: pointer;"
                        >
                          Mark Ready for Pickup 🔔
                        </button>
                      `}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- COLUMN 2: READY FOR PICKUP (At Counter) -->
          <div class="kds-column" style="background: #FFF; border: 2px solid var(--border-light); border-radius: 12px; overflow: hidden; border-top: 6px solid #4F7A3C;">
            <div style="padding: 1rem 1.2rem; background: #F4FBF1; border-bottom: 1.5px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; color: #2C4A1E;">
                  🔔 READY FOR PICKUP (${readyOrders.length})
                </h3>
                <span style="font-family: var(--font-sans); font-size: 0.8rem; color: var(--ink-secondary);">Waiting for student collection</span>
              </div>
              <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; background: #DCEACB; color: #2C4A1E; padding: 3px 8px; border-radius: 6px;">
                COUNTER NOTIFIED
              </span>
            </div>

            <div style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem; max-height: 70vh; overflow-y: auto;">
              ${readyOrders.length === 0 ? `
                <div style="text-align: center; padding: 3rem 1rem; color: var(--ink-secondary); font-family: var(--font-sans);">
                  <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🥗</div>
                  <div style="font-weight: 600; font-size: 1.1rem; color: var(--ink-primary);">No Orders Waiting</div>
                  <div style="font-size: 0.85rem; margin-top: 4px;">Orders marked ready will appear here until collected.</div>
                </div>
              ` : readyOrders.map(order => `
                <div class="kds-order-card" style="background: #F9FDF7; border: 2px solid #DCEACB; border-radius: 10px; padding: 1.1rem;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem;">
                    <div>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-family: var(--font-mono); font-size: 1.6rem; font-weight: 700; color: #4F7A3C;">
                          ${order.tokenNumber}
                        </span>
                        <span style="font-family: var(--font-mono); font-size: 0.8rem; background: #FFF; padding: 2px 6px; border-radius: 4px; border: 1px solid #DCEACB; font-weight: 700;">
                          PIN: ${order.pinCode}
                        </span>
                      </div>
                      ${order.studentName ? `
                        <div style="font-family: var(--font-sans); font-size: 0.85rem; font-weight: 600; color: var(--ink-primary); margin-top: 2px;">
                          👤 ${order.studentName} ${order.studentRoll ? `(${order.studentRoll})` : ''}
                        </div>
                      ` : ''}
                    </div>

                    <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: #DCEACB; color: #2C4A1E;">
                      ✓ READY
                    </span>
                  </div>

                  <!-- Items Summary -->
                  <div style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--ink-primary); background: #FFF; padding: 0.6rem 0.8rem; border-radius: 6px; border: 1px solid #E2EED4; margin-bottom: 0.8rem;">
                    ${(order.items || []).map(i => `${i.quantity}x ${i.name}`).join(' · ')}
                  </div>

                  <!-- Quick Handover Button -->
                  <button 
                    class="kds-action-btn mark-collected-btn" 
                    data-order-id="${order.id}"
                    style="width: 100%; padding: 10px; background: var(--ink-primary); color: #FFF; border: none; border-radius: 8px; font-family: var(--font-sans); font-weight: 700; font-size: 0.9rem; cursor: pointer;"
                  >
                    Handover & Mark Collected ✓
                  </button>
                </div>
              `).join('')}
            </div>
          </div>

        </div>
      </div>
    `;

    // Attach Action Listeners
    container.querySelectorAll('.start-cook-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        btn.textContent = 'Updating...';
        btn.disabled = true;
        await updateOrderStatus(orderId, 'preparing');
      });
    });

    container.querySelectorAll('.mark-ready-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        btn.textContent = 'Notifying Student...';
        btn.disabled = true;
        await updateOrderStatus(orderId, 'ready');
      });
    });

    container.querySelectorAll('.mark-collected-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        btn.textContent = 'Closing Order...';
        btn.disabled = true;
        await updateOrderStatus(orderId, 'collected');
      });
    });

    // Category Filter Buttons
    container.querySelectorAll('.category-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedCategoryFilter = btn.getAttribute('data-category');
        renderKDS();
      });
    });
  }

  // Subscribe to live Firestore stream
  unsubscribeOrders = subscribeOrders((orders) => {
    currentOrders = orders;
    renderKDS();
  });
}

function formatTimeAgo(date) {
  if (!date) return '';
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
