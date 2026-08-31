// Phase 10 — Counter Pickup & Dispatch View (Automatic Live Queue with Exact PIN & XSS Sanitization)
import { subscribeOrders, updateOrderStatus, unlockOrder } from '../firebase.js?v=4';
import { escapeHtml } from './escapeHtml.js';

let unsubscribeOrders = null;
let currentOrders = [];
let searchFilter = '';
let showCollectedHistory = false;

export function renderPickupView(container) {
  if (unsubscribeOrders) {
    unsubscribeOrders();
  }

  function render() {
    const cleanSearch = searchFilter.trim().toLowerCase().replace('#', '');

    // Filter active orders
    const activeOrders = currentOrders.filter(o => o.status !== 'collected');
    const collectedOrders = currentOrders.filter(o => o.status === 'collected');

    // Split active into Ready (top priority) and In-Kitchen/Placed
    const readyOrders = activeOrders.filter(o => o.status === 'ready');
    const kitchenOrders = activeOrders.filter(o => o.status === 'preparing' || o.status === 'placed' || o.status === 'confirmed');

    // Fix 13: Exact PIN prefix / token search filter
    const filterFn = (order) => {
      if (!cleanSearch) return true;
      const pin = order.pinCode ? order.pinCode.toString() : '';
      const pinMatch = cleanSearch.length === 4 ? pin === cleanSearch : pin.startsWith(cleanSearch);
      const tokenMatch = order.tokenNumber && order.tokenNumber.toString().toLowerCase().replace('#', '').includes(cleanSearch);
      const nameMatch = order.studentName && order.studentName.toLowerCase().includes(cleanSearch);
      const rollMatch = order.studentRoll && order.studentRoll.toLowerCase().includes(cleanSearch);
      return pinMatch || tokenMatch || nameMatch || rollMatch;
    };

    const displayReady = readyOrders.filter(filterFn);
    const displayKitchen = kitchenOrders.filter(filterFn);
    const displayCollected = collectedOrders.filter(filterFn);

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1200px; margin: 0 auto; padding: 1.5rem 1rem;">
        
        <!-- Header with Live Stats -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; line-height: 1;">
                COUNTER PICKUP & DISPATCH
              </h2>
              <span style="background: #22C55E; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px; display: flex; align-items: center; gap: 4px;">
                <span style="width: 6px; height: 6px; background: #FFF; border-radius: 50%;"></span>
                LIVE STREAM
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Orders ready for collection appear below in sequence. Verify token/PIN and tap "Mark Collected".
            </p>
          </div>

          <!-- Counter Quick Badges -->
          <div style="display: flex; gap: 10px;">
            <div style="background: #F0FDF4; border: 1.5px solid #86EFAC; padding: 8px 16px; border-radius: 12px; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 1.5rem; font-weight: 800; color: #15803D; line-height: 1;">
                ${readyOrders.length}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #166534; font-weight: 700; text-transform: uppercase;">
                Ready at Counter
              </div>
            </div>

            <div style="background: #FFFBEB; border: 1.5px solid #FDE68A; padding: 8px 16px; border-radius: 12px; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 1.5rem; font-weight: 800; color: #B45309; line-height: 1;">
                ${kitchenOrders.length}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #92400E; font-weight: 700; text-transform: uppercase;">
                In Kitchen
              </div>
            </div>
          </div>
        </div>

        <!-- Quick Filter Input -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 0.7rem 1.2rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <span style="font-size: 1.2rem;">🔍</span>
          <input 
            type="text" 
            id="pickup-filter-input" 
            placeholder="Filter by Token #, PIN, or Student Name (optional)..." 
            value="${escapeHtml(searchFilter)}"
            style="flex: 1; border: none; outline: none; font-family: var(--font-mono); font-size: 1rem; font-weight: 600; color: var(--ink-primary); background: transparent;"
          />
          ${searchFilter ? `
            <button id="clear-filter-btn" style="background: var(--bg-surface); border: 1px solid var(--border-light); border-radius: 6px; padding: 4px 10px; font-family: var(--font-mono); font-size: 0.8rem; cursor: pointer;">
              Clear
            </button>
          ` : ''}
        </div>

        <!-- SECTION 1: READY FOR PICKUP (PRIMARY QUEUE) -->
        <div style="margin-bottom: 2rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.8rem;">
            <h3 style="font-family: var(--font-display); font-size: 1.4rem; color: #166534; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>🔔</span>
              <span>READY FOR COLLECTION (${displayReady.length})</span>
            </h3>
            <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">
              Students notified · Handover ready
            </span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.9rem;">
            ${displayReady.length === 0 ? `
              <div style="background: #FFF; border: 2px dashed #86EFAC; border-radius: 14px; padding: 2.5rem 1rem; text-align: center;">
                <div style="font-size: 2.5rem; margin-bottom: 0.4rem;">☕️</div>
                <div style="font-family: var(--font-sans); font-size: 1.1rem; font-weight: 700; color: var(--ink-primary);">No Orders Waiting at Counter</div>
                <div style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 2px;">
                  Orders marked ready by the kitchen will appear here automatically.
                </div>
              </div>
            ` : displayReady.map(order => `
              <div class="pickup-card ready-card" style="background: #F9FDF7; border: 2.5px solid #22C55E; border-radius: 14px; padding: 1.2rem 1.4rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; box-shadow: 0 4px 12px rgba(34,197,94,0.12);">
                
                <!-- Left: Token Number & Verified PIN Box -->
                <div style="display: flex; align-items: center; gap: 1.2rem; min-width: 220px;">
                  <div style="background: #DCFCE7; border: 2px solid #22C55E; border-radius: 12px; padding: 8px 16px; text-align: center;">
                    <div style="font-family: var(--font-mono); font-size: 2.4rem; font-weight: 900; color: #15803D; line-height: 1;">
                      ${escapeHtml(order.tokenNumber || '#---')}
                    </div>
                    <div style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: #166534; margin-top: 4px; letter-spacing: 0.05em;">
                      PIN: ${escapeHtml(order.pinCode || '----')}
                    </div>
                  </div>

                  <div>
                    <div style="font-family: var(--font-sans); font-size: 1.15rem; font-weight: 800; color: var(--ink-primary);">
                      👤 ${escapeHtml(order.studentName || 'Student (Walk-in)')}
                    </div>
                    <div style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 2px;">
                      Roll: <strong style="color: var(--ink-primary);">${escapeHtml(order.studentRoll || 'N/A')}</strong> · ${formatTime(order.createdAt)}
                    </div>
                    <div style="margin-top: 4px; display: flex; gap: 6px; align-items: center;">
                      <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; background: #22C55E; color: #FFF; padding: 2px 8px; border-radius: 999px;">
                        READY FOR PICKUP 🔔
                      </span>
                      ${order.isLockedForInvestigation ? `
                        <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; background: #DC2626; color: #FFF; padding: 2px 8px; border-radius: 999px;">
                          🔒 PIN LOCKED
                        </span>
                      ` : ''}
                    </div>
                  </div>
                </div>

                <!-- Center: Order Dishes Checklist -->
                <div style="flex: 1; min-width: 260px; background: #FFF; border: 1.5px solid #BBF7D0; border-radius: 10px; padding: 0.9rem 1.1rem;">
                  <div style="font-family: var(--font-mono); font-size: 1.05rem; font-weight: 800; color: var(--ink-primary); line-height: 1.4;">
                    ${(order.items || []).map(i => `<span style="display: inline-block; background: #F0FDF4; padding: 2px 8px; border-radius: 6px; margin: 2px 4px 2px 0; border: 1px solid #DCFCE7;">${escapeHtml(i.quantity)}x ${escapeHtml(i.name)}</span>`).join('')}
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #DCFCE7;">
                    <span style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--ink-secondary);">
                      ${(order.items || []).length} item(s)
                    </span>
                    <span style="font-family: var(--font-mono); font-size: 1rem; font-weight: 800; color: var(--ink-primary);">
                      Total: ₹${escapeHtml(order.totalAmount)}
                    </span>
                  </div>
                </div>

                <!-- Right: Big Side-by-Side Collected Button / Unlock Button -->
                <div style="display: flex; gap: 8px;">
                  ${order.isLockedForInvestigation ? `
                    <button 
                      class="unlock-action-btn" 
                      data-order-id="${order.id}"
                      style="padding: 16px 20px; border-radius: 12px; border: none; background: #DC2626; color: #FFF; font-family: var(--font-sans); font-size: 1rem; font-weight: 900; cursor: pointer; box-shadow: 0 4px 14px rgba(220,38,38,0.35); display: flex; align-items: center; gap: 6px;"
                    >
                      <span>🔓</span>
                      <span>Manager Unlock</span>
                    </button>
                  ` : `
                    <button 
                      class="collect-action-btn" 
                      data-order-id="${order.id}"
                      data-token="${order.tokenNumber}"
                      style="padding: 16px 28px; border-radius: 12px; border: none; background: #16A34A; color: #FFF; font-family: var(--font-sans); font-size: 1.1rem; font-weight: 900; cursor: pointer; box-shadow: 0 4px 14px rgba(220,38,38,0.35); display: flex; align-items: center; gap: 8px; transition: transform 0.1s ease;"
                    >
                      <span style="font-size: 1.3rem;">✓</span>
                      <span>Mark Collected</span>
                    </button>
                  `}
                </div>

              </div>
            `).join('')}
          </div>
        </div>

        <!-- SECTION 2: IN-KITCHEN / PREPARING QUEUE -->
        <div style="margin-bottom: 2rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.8rem;">
            <h3 style="font-family: var(--font-display); font-size: 1.3rem; color: #B45309; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>⏳</span>
              <span>IN-KITCHEN & INCOMING ORDERS (${displayKitchen.length})</span>
            </h3>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.8rem;">
            ${displayKitchen.length === 0 ? `
              <div style="background: #FFF; border: 1.5px dashed var(--border-light); border-radius: 12px; padding: 1.5rem; text-align: center; font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary);">
                No pending kitchen orders in queue.
              </div>
            ` : displayKitchen.map(order => `
              <div class="pickup-card kitchen-card" style="background: #FFFDF7; border: 1.5px solid #FDE68A; border-radius: 12px; padding: 1rem 1.2rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
                
                <div style="display: flex; align-items: center; gap: 1rem; min-width: 200px;">
                  <div style="background: #FEF3C7; border: 1.5px solid #FCD34D; border-radius: 10px; padding: 6px 12px; text-align: center;">
                    <div style="font-family: var(--font-mono); font-size: 1.8rem; font-weight: 800; color: #B45309; line-height: 1;">
                      ${escapeHtml(order.tokenNumber || '#---')}
                    </div>
                    <div style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: #92400E; margin-top: 2px;">
                      PIN: ${escapeHtml(order.pinCode)}
                    </div>
                  </div>

                  <div>
                    <div style="font-family: var(--font-sans); font-size: 1rem; font-weight: 700; color: var(--ink-primary);">
                      👤 ${escapeHtml(order.studentName || 'Student')}
                    </div>
                    <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">
                      Roll: ${escapeHtml(order.studentRoll || 'N/A')} · ${formatTime(order.createdAt)}
                    </div>
                  </div>
                </div>

                <div style="flex: 1; min-width: 240px; font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700; color: var(--ink-primary);">
                  ${(order.items || []).map(i => `${escapeHtml(i.quantity)}x ${escapeHtml(i.name)}`).join(' · ')}
                </div>

                <div>
                  <button 
                    class="collect-action-btn" 
                    data-order-id="${order.id}"
                    data-token="${order.tokenNumber}"
                    style="padding: 10px 18px; border-radius: 8px; border: 1.5px solid #F59E0B; background: #FEF3C7; color: #92400E; font-family: var(--font-sans); font-size: 0.9rem; font-weight: 700; cursor: pointer;"
                  >
                    <span>✓</span>
                    <span>Quick Collect</span>
                  </button>
                </div>

              </div>
            `).join('')}
          </div>
        </div>

        <!-- SECTION 3: COLLECTED HISTORY -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1.2rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" id="toggle-history-btn">
            <h4 style="font-family: var(--font-display); font-size: 1.2rem; margin: 0; color: var(--ink-secondary); display: flex; align-items: center; gap: 8px;">
              <span>📁</span>
              <span>COLLECTED TODAY (${displayCollected.length})</span>
            </h4>
            <span style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--brand-red); font-weight: 600;">
              ${showCollectedHistory ? '▲ Hide' : '▼ Show History'}
            </span>
          </div>

          ${showCollectedHistory ? `
            <div style="margin-top: 1rem; border-top: 1px solid var(--border-light); padding-top: 0.8rem; display: flex; flex-direction: column; gap: 6px;">
              ${displayCollected.length === 0 ? `
                <div style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary);">No orders collected yet today.</div>
              ` : displayCollected.map(o => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: var(--bg-surface); border-radius: 8px; font-family: var(--font-mono); font-size: 0.85rem;">
                  <div>
                    <strong style="color: var(--ink-primary); font-size: 1rem;">${escapeHtml(o.tokenNumber)}</strong>
                    <span style="color: var(--ink-secondary); margin-left: 8px;">PIN: ${escapeHtml(o.pinCode)} · 👤 ${escapeHtml(o.studentName || 'Student')}</span>
                  </div>
                  <span style="color: #16A34A; font-weight: 700;">✓ Handed Over</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>

      </div>
    `;

    // Listeners
    const searchInput = container.querySelector('#pickup-filter-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchFilter = e.target.value;
        render();
        const freshInput = container.querySelector('#pickup-filter-input');
        if (freshInput) {
          freshInput.focus();
          freshInput.setSelectionRange(searchFilter.length, searchFilter.length);
        }
      });
    }

    const clearBtn = container.querySelector('#clear-filter-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        searchFilter = '';
        render();
      });
    }

    const historyToggle = container.querySelector('#toggle-history-btn');
    if (historyToggle) {
      historyToggle.addEventListener('click', () => {
        showCollectedHistory = !showCollectedHistory;
        render();
      });
    }

    container.querySelectorAll('.collect-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        btn.textContent = 'Updating...';
        btn.disabled = true;

        await updateOrderStatus(orderId, 'collected');
      });
    });

    container.querySelectorAll('.unlock-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        const reason = prompt('Enter manager verification note for unlocking order:', 'Student verified with physical College ID');
        if (reason) {
          btn.textContent = 'Unlocking...';
          btn.disabled = true;
          await unlockOrder(orderId, reason);
        }
      });
    });
  }

  unsubscribeOrders = subscribeOrders((orders) => {
    currentOrders = orders;
    render();
  });
}

function formatTime(date) {
  if (!date) return '';
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
