// Phase 10 — Pickup Counter with Live Automatic Incoming Feed & Side-by-Side Collected Button
import { subscribeOrders, updateOrderStatus } from '../firebase.js';

let unsubscribeOrders = null;
let currentOrders = [];
let searchCode = '';
let activeFilter = 'active'; // 'active' | 'ready' | 'all'

export function renderPickupView(container) {
  if (unsubscribeOrders) {
    unsubscribeOrders();
  }

  function render() {
    const cleanSearch = searchCode.trim().toLowerCase().replace('#', '');

    // Filter orders based on search and active tab
    const filteredOrders = currentOrders.filter(order => {
      // Search filter
      if (cleanSearch) {
        const pinMatch = order.pinCode && order.pinCode.toString().includes(cleanSearch);
        const tokenMatch = order.tokenNumber && order.tokenNumber.toString().toLowerCase().replace('#', '').includes(cleanSearch);
        const nameMatch = order.studentName && order.studentName.toLowerCase().includes(cleanSearch);
        const rollMatch = order.studentRoll && order.studentRoll.toLowerCase().includes(cleanSearch);
        if (!pinMatch && !tokenMatch && !nameMatch && !rollMatch) return false;
      }

      // Tab filter
      if (activeFilter === 'active') {
        return order.status !== 'collected';
      } else if (activeFilter === 'ready') {
        return order.status === 'ready';
      }
      return true; // 'all'
    });

    const readyCount = currentOrders.filter(o => o.status === 'ready').length;
    const activeCount = currentOrders.filter(o => o.status !== 'collected').length;

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1200px; margin: 0 auto; padding: 1.5rem 1rem;">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; line-height: 1;">
                COUNTER PICKUP & DISPATCH QUEUE
              </h2>
              <span style="background: #22C55E; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: 999px;">
                ● LIVE AUTO-FEED
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Incoming orders stream automatically in sequence. Tap "Mark Collected" beside any order to complete handover.
            </p>
          </div>

          <!-- Tab Filter Buttons -->
          <div style="display: flex; gap: 6px; background: var(--bg-surface); padding: 4px; border-radius: 999px; border: 1.5px solid var(--border-light);">
            <button 
              class="pickup-tab-btn ${activeFilter === 'active' ? 'active' : ''}" 
              data-tab="active"
              style="padding: 6px 14px; border-radius: 999px; border: none; background: ${activeFilter === 'active' ? 'var(--brand-red)' : 'transparent'}; color: ${activeFilter === 'active' ? '#FFF' : 'var(--ink-secondary)'}; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;"
            >
              Active Queue (${activeCount})
            </button>
            <button 
              class="pickup-tab-btn ${activeFilter === 'ready' ? 'active' : ''}" 
              data-tab="ready"
              style="padding: 6px 14px; border-radius: 999px; border: none; background: ${activeFilter === 'ready' ? '#16A34A' : 'transparent'}; color: ${activeFilter === 'ready' ? '#FFF' : 'var(--ink-secondary)'}; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;"
            >
              🔔 Ready at Counter (${readyCount})
            </button>
            <button 
              class="pickup-tab-btn ${activeFilter === 'all' ? 'active' : ''}" 
              data-tab="all"
              style="padding: 6px 14px; border-radius: 999px; border: none; background: ${activeFilter === 'all' ? 'var(--ink-primary)' : 'transparent'}; color: ${activeFilter === 'all' ? '#FFF' : 'var(--ink-secondary)'}; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;"
            >
              All Orders
            </button>
          </div>
        </div>

        <!-- Quick PIN / Token Search Filter -->
        <div style="background: #FFF; border: 2px solid var(--border-light); border-radius: 12px; padding: 0.8rem 1.2rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 1.2rem;">🔍</span>
          <input 
            type="text" 
            id="pickup-filter-input" 
            placeholder="Search by 4-digit PIN, Token #, or Student Name..." 
            value="${searchCode}"
            style="flex: 1; border: none; outline: none; font-family: var(--font-mono); font-size: 1.05rem; font-weight: 600; color: var(--ink-primary); background: transparent;"
          />
          ${searchCode ? `
            <button id="clear-search-btn" style="background: var(--bg-surface); border: 1px solid var(--border-light); border-radius: 6px; padding: 4px 10px; font-family: var(--font-mono); font-size: 0.8rem; cursor: pointer;">
              Clear
            </button>
          ` : ''}
        </div>

        <!-- Live Orders List: One-by-One with Side Collected Button -->
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          ${filteredOrders.length === 0 ? `
            <div style="background: #FFF; border: 2px dashed var(--border-light); border-radius: 14px; padding: 3.5rem 1rem; text-align: center;">
              <div style="font-size: 3rem; margin-bottom: 0.5rem;">🎉</div>
              <h3 style="font-family: var(--font-display); font-size: 1.6rem; margin: 0; color: var(--ink-primary);">
                NO ORDERS IN THIS QUEUE
              </h3>
              <p style="font-family: var(--font-sans); font-size: 0.9rem; color: var(--ink-secondary); margin-top: 4px;">
                ${searchCode ? `No orders matching "${searchCode}". Try clearing your search.` : 'New orders placed on the student app will appear here automatically in real time.'}
              </p>
            </div>
          ` : filteredOrders.map(order => {
            const isReady = order.status === 'ready';
            const isCollected = order.status === 'collected';
            const isPreparing = order.status === 'preparing';

            const cardBorderColor = isReady ? '#4F7A3C' : isCollected ? 'var(--border-light)' : '#EFA727';
            const cardBg = isReady ? '#F9FDF7' : isCollected ? '#FAF8F5' : '#FFFDF7';

            return `
              <div class="pickup-order-row" style="background: ${cardBg}; border: 2px solid ${cardBorderColor}; border-radius: 14px; padding: 1.2rem 1.4rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.2rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03); transition: all 0.2s ease;">
                
                <!-- Left: Token Number, PIN & Student Details -->
                <div style="display: flex; align-items: center; gap: 1.2rem; min-width: 240px;">
                  <div>
                    <div style="font-family: var(--font-mono); font-size: 2.2rem; font-weight: 800; color: ${isReady ? '#4F7A3C' : 'var(--brand-red)'}; line-height: 1;">
                      ${order.tokenNumber || '#---'}
                    </div>
                    <div style="margin-top: 4px; display: flex; align-items: center; gap: 6px;">
                      <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; background: #FFF; border: 1.5px solid var(--border-light); padding: 2px 8px; border-radius: 6px; color: var(--ink-primary);">
                        PIN: ${order.pinCode || '----'}
                      </span>
                    </div>
                  </div>

                  <div style="border-left: 1.5px solid var(--border-light); padding-left: 1rem;">
                    <div style="font-family: var(--font-sans); font-size: 1.05rem; font-weight: 700; color: var(--ink-primary);">
                      👤 ${order.studentName || 'Student (Walk-in)'}
                    </div>
                    <div style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary); margin-top: 2px;">
                      Roll: ${order.studentRoll || 'N/A'} · ${formatTime(order.createdAtDate)}
                    </div>
                  </div>
                </div>

                <!-- Center: Items List & Total -->
                <div style="flex: 1; min-width: 260px; background: #FFF; border: 1px solid var(--border-light); border-radius: 10px; padding: 0.8rem 1rem;">
                  <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; color: var(--ink-primary); margin-bottom: 4px;">
                    ${(order.items || []).map(i => `${i.quantity}x ${i.name}`).join(' · ')}
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: var(--ink-secondary);">
                      Total: ₹${order.totalAmount}
                    </span>
                    <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: ${getStatusBadgeBg(order.status)}; color: ${getStatusBadgeColor(order.status)};">
                      ${order.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                <!-- Right Side Action: Collected Button -->
                <div style="display: flex; align-items: center; gap: 8px;">
                  ${isCollected ? `
                    <div style="padding: 10px 18px; border-radius: 10px; background: #E5E7EB; color: #4B5563; font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                      <span>✓</span>
                      <span>COLLECTED</span>
                    </div>
                  ` : `
                    <button 
                      class="row-collect-btn" 
                      data-order-id="${order.id}"
                      data-token="${order.tokenNumber}"
                      style="padding: 14px 24px; border-radius: 10px; border: none; background: ${isReady ? '#22C55E' : '#4F7A3C'}; color: #FFF; font-family: var(--font-sans); font-size: 1rem; font-weight: 800; cursor: pointer; box-shadow: 0 4px 10px rgba(34,197,94,0.3); display: flex; align-items: center; gap: 8px; transition: transform 0.1s ease;"
                    >
                      <span style="font-size: 1.1rem;">✓</span>
                      <span>Mark Collected</span>
                    </button>
                  `}
                </div>

              </div>
            `;
          }).join('')}
        </div>

      </div>
    `;

    // Listeners
    const searchInput = container.querySelector('#pickup-filter-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchCode = e.target.value;
        render();
        const freshInput = container.querySelector('#pickup-filter-input');
        if (freshInput) {
          freshInput.focus();
          freshInput.setSelectionRange(searchCode.length, searchCode.length);
        }
      });
    }

    const clearBtn = container.querySelector('#clear-search-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        searchCode = '';
        render();
      });
    }

    // Tab buttons
    container.querySelectorAll('.pickup-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.getAttribute('data-tab');
        render();
      });
    });

    // Side-by-side Mark Collected buttons
    container.querySelectorAll('.row-collect-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        const token = btn.getAttribute('data-token');
        btn.textContent = 'Updating...';
        btn.disabled = true;

        await updateOrderStatus(orderId, 'collected');
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
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getStatusBadgeBg(status) {
  switch (status) {
    case 'ready': return '#DCEACB';
    case 'preparing': return '#FBE7BE';
    case 'collected': return '#E5E7EB';
    default: return '#FEE2E2';
  }
}

function getStatusBadgeColor(status) {
  switch (status) {
    case 'ready': return '#2C4A1E';
    case 'preparing': return '#6B4408';
    case 'collected': return '#4B5563';
    default: return '#991B1B';
  }
}
