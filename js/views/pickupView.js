// Phase 10 — Pickup Counter & Code Redeem Verification View
import { subscribeOrders, updateOrderStatus } from '../firebase.js';

let unsubscribeOrders = null;
let currentOrders = [];
let searchCode = '';

export function renderPickupView(container) {
  if (unsubscribeOrders) {
    unsubscribeOrders();
  }

  function render() {
    // Find matching order if code entered
    const cleanSearch = searchCode.trim().replace('#', '');
    let matchedOrder = null;

    if (cleanSearch) {
      matchedOrder = currentOrders.find(o => {
        const pinMatch = o.pinCode && o.pinCode.toString() === cleanSearch;
        const tokenMatch = o.tokenNumber && o.tokenNumber.toString().replace('#', '') === cleanSearch;
        return pinMatch || tokenMatch;
      });
    }

    // Recent collected orders (last 5)
    const recentCollected = currentOrders.filter(o => o.status === 'collected').slice(0, 5);

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 900px; margin: 0 auto; padding: 1.5rem 1rem;">
        <!-- Header -->
        <div style="margin-bottom: 1.5rem;">
          <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; line-height: 1;">
            COUNTER PICKUP & CODE VERIFICATION
          </h2>
          <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
            Enter the student's 4-digit PIN or Token Number to verify and dispense order.
          </p>
        </div>

        <!-- Search / PIN Keypad Card -->
        <div style="background: #FFF; border: 2px solid var(--border-light); border-radius: 14px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 6px rgba(0,0,0,0.04);">
          <div style="display: flex; gap: 10px;">
            <input 
              type="text" 
              id="pickup-code-input" 
              placeholder="Enter 4-digit PIN or Token #..." 
              value="${searchCode}"
              autofocus
              style="flex: 1; padding: 14px 18px; border-radius: 10px; border: 2px solid var(--border-light); font-family: var(--font-mono); font-size: 1.2rem; font-weight: 700; color: var(--ink-primary); outline: none; background: var(--bg-surface);"
            />
            <button 
              id="clear-search-btn"
              style="padding: 0 20px; border-radius: 10px; border: 1.5px solid var(--border-light); background: var(--bg-surface); font-family: var(--font-mono); font-size: 0.9rem; font-weight: 600; cursor: pointer;"
            >
              Clear
            </button>
          </div>

          <!-- Quick NumPad Row -->
          <div style="display: flex; gap: 6px; margin-top: 10px; overflow-x: auto; padding-bottom: 4px;">
            <span style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary); align-self: center; margin-right: 4px;">Quick:</span>
            ${currentOrders.filter(o => o.status === 'ready').map(o => `
              <button 
                class="quick-token-btn" 
                data-code="${o.pinCode || o.tokenNumber}"
                style="padding: 6px 12px; border-radius: 999px; border: 1.5px solid #DCEACB; background: #F4FBF1; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: #2C4A1E; cursor: pointer;"
              >
                ${o.tokenNumber} (PIN: ${o.pinCode})
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Matched Order Result Card -->
        ${cleanSearch && !matchedOrder ? `
          <div style="background: #FFF; border: 2px dashed #F87171; border-radius: 14px; padding: 2rem; text-align: center; margin-bottom: 1.5rem;">
            <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔍</div>
            <h3 style="font-family: var(--font-display); font-size: 1.4rem; color: var(--brand-red); margin: 0;">NO MATCHING ORDER FOUND</h3>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              No active order found with PIN or Token <strong>"${searchCode}"</strong>. Please check again.
            </p>
          </div>
        ` : ''}

        ${matchedOrder ? `
          <div style="background: #FFF; border: 2px solid ${matchedOrder.status === 'collected' ? '#9CA3AF' : '#22C55E'}; border-radius: 14px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
            <!-- Top Status Banner -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; padding-bottom: 1rem; border-bottom: 1.5px solid var(--border-light);">
              <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-family: var(--font-mono); font-size: 2.2rem; font-weight: 800; color: var(--brand-red);">
                  ${matchedOrder.tokenNumber}
                </span>
                <span style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700; background: var(--bg-surface); padding: 4px 10px; border-radius: 6px; border: 1.5px solid var(--border-light);">
                  VERIFIED PIN: ${matchedOrder.pinCode}
                </span>
              </div>

              <div>
                <span style="display: inline-block; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; padding: 4px 12px; border-radius: 999px; background: ${getStatusBadgeBg(matchedOrder.status)}; color: ${getStatusBadgeColor(matchedOrder.status)};">
                  ${matchedOrder.status.toUpperCase()}
                </span>
              </div>
            </div>

            <!-- Student Info -->
            <div style="background: var(--bg-surface); border-radius: 10px; padding: 1rem; margin-bottom: 1.2rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-family: var(--font-sans); font-size: 1.1rem; font-weight: 700; color: var(--ink-primary);">
                  👤 ${matchedOrder.studentName || 'Student (Walk-in)'}
                </div>
                <div style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 2px;">
                  Roll No: ${matchedOrder.studentRoll || 'N/A'} · Placed at ${matchedOrder.createdAtDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: var(--ink-primary);">
                ₹${matchedOrder.totalAmount}
              </div>
            </div>

            <!-- Items List -->
            <div style="margin-bottom: 1.5rem;">
              <div style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 0.5rem;">
                ORDER ITEMS (${(matchedOrder.items || []).length}):
              </div>
              ${(matchedOrder.items || []).map(i => `
                <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed var(--border-light); font-family: var(--font-mono); font-size: 0.95rem;">
                  <span style="font-weight: 700;">${i.quantity}x ${i.name}</span>
                  <span style="color: var(--ink-secondary);">₹${i.price * i.quantity}</span>
                </div>
              `).join('')}
            </div>

            <!-- Action Button / Lock Guard -->
            ${matchedOrder.status === 'collected' ? `
              <div style="background: #FEE2E2; border: 1.5px solid #FCA5A5; border-radius: 10px; padding: 1rem; text-align: center; color: #991B1B; font-family: var(--font-sans);">
                <div style="font-weight: 700; font-size: 1rem;">⚠️ ORDER ALREADY COLLECTED</div>
                <div style="font-size: 0.85rem; margin-top: 2px;">
                  This order was already marked collected at ${matchedOrder.collectedAtDate ? matchedOrder.collectedAtDate.toLocaleTimeString() : 'earlier'}. Duplicate redemption prevented.
                </div>
              </div>
            ` : `
              <button 
                id="confirm-collect-btn"
                data-order-id="${matchedOrder.id}"
                style="width: 100%; padding: 14px; background: #22C55E; color: #FFF; border: none; border-radius: 10px; font-family: var(--font-sans); font-weight: 800; font-size: 1.1rem; cursor: pointer; box-shadow: 0 4px 8px rgba(34,197,94,0.25);"
              >
                ✓ VERIFY & MARK COLLECTED
              </button>
            `}
          </div>
        ` : ''}

        <!-- Recent Collected History -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 1.2rem;">
          <h4 style="font-family: var(--font-display); font-size: 1.2rem; margin: 0 0 0.8rem 0;">
            RECENTLY COLLECTED ORDERS
          </h4>
          ${recentCollected.length === 0 ? `
            <div style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary);">No orders collected yet today.</div>
          ` : recentCollected.map(o => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-light); font-family: var(--font-mono); font-size: 0.85rem;">
              <div>
                <span style="font-weight: 700; color: var(--ink-primary);">${o.tokenNumber}</span>
                <span style="color: var(--ink-secondary); margin-left: 8px;">👤 ${o.studentName || 'Student'} (${o.studentRoll || 'N/A'})</span>
              </div>
              <span style="color: #22C55E; font-weight: 600;">✓ Collected</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Listeners
    const input = container.querySelector('#pickup-code-input');
    if (input) {
      input.addEventListener('input', (e) => {
        searchCode = e.target.value;
        render();
        // keep focus at end
        const freshInput = container.querySelector('#pickup-code-input');
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

    container.querySelectorAll('.quick-token-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        searchCode = btn.getAttribute('data-code');
        render();
      });
    });

    const confirmCollectBtn = container.querySelector('#confirm-collect-btn');
    if (confirmCollectBtn) {
      confirmCollectBtn.addEventListener('click', async () => {
        const orderId = confirmCollectBtn.getAttribute('data-order-id');
        confirmCollectBtn.textContent = 'Marking Collected...';
        confirmCollectBtn.disabled = true;
        await updateOrderStatus(orderId, 'collected');
        searchCode = '';
        render();
      });
    }
  }

  unsubscribeOrders = subscribeOrders((orders) => {
    currentOrders = orders;
    render();
  });
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
