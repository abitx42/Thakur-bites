// Thakur Bites Platform 2.0 — Cashier Counter POS & Atomic Ledger Settlement
import { db, functions, recordCashPayment, cancelStaffOrder, processStaffRefund } from '../firebase.js?v=5';
import { collection, query, where, onSnapshot, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { escapeHtml } from './escapeHtml.js';
import { getFriendlyErrorMessage } from '../networkSentinel.js';

let unsubscribeCashOrders = null;
let currentCashOrders = [];
let cashierSearchQuery = '';
let selectedOrder = null;
let tenderedAmount = null;
let isProcessingPayment = false;
let feedbackMessage = null;
let cashierAudioCtx = null;

function displayQuantity(value) {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100 ? quantity : 1;
}

function getCashierAudioContext() {
  if (!cashierAudioCtx || cashierAudioCtx.state === 'closed') {
    cashierAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (cashierAudioCtx.state === 'suspended') {
    cashierAudioCtx.resume().catch(() => {});
  }
  return cashierAudioCtx;
}

export function renderCashierView(container) {
  if (unsubscribeCashOrders) {
    try { unsubscribeCashOrders(); } catch (_) {}
    unsubscribeCashOrders = null;
  }

  function playSound(isSuccess) {
    try {
      const ctx = getCashierAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.onended = () => {
        try {
          gain.disconnect();
          osc.disconnect();
        } catch (_) {}
      };

      if (isSuccess) {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        osc.frequency.setValueAtTime(140, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      }
    } catch (_) {}
  }

  function openCashierRefundModal(orderId, tokenNumber, maxAmount) {
    const existing = document.getElementById('tb-cashier-refund-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'tb-cashier-refund-modal';
    modal.className = 'modal-overlay-fade-in';
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(15, 23, 42, 0.65);
      display: flex; align-items: center; justify-content: center; z-index: 9999;
      padding: 1rem; backdrop-filter: blur(4px);
    `;
    const defaultAmount = maxAmount > 0 ? maxAmount : '';
    modal.innerHTML = `
      <div class="modal-card-pop-in" style="background: #FFF; border-radius: 16px; padding: 1.5rem; max-width: 440px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2); font-family: var(--font-sans);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 style="margin: 0; font-family: var(--font-display); font-size: 1.3rem; color: #DC2626; display: flex; align-items: center; gap: 8px;">
            <span>💸</span> Cashier Refund (${escapeHtml(tokenNumber)})
          </h3>
          <button id="close-cashier-refund-btn" style="background: none; border: none; font-size: 1.4rem; cursor: pointer; color: var(--ink-secondary);">&times;</button>
        </div>
        
        <p style="font-size: 0.85rem; color: var(--ink-secondary); margin-bottom: 1.2rem; line-height: 1.4;">
          Authoritatively issue a counter refund for order <strong>${escapeHtml(tokenNumber)}</strong> via Cloud Function ledger.
        </p>

        <div style="margin-bottom: 1rem;">
          <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-primary); margin-bottom: 4px;">
            REFUND AMOUNT (₹):
          </label>
          <input 
            type="number" 
            id="cashier-refund-amt-input" 
            step="1" 
            min="1" 
            max="${maxAmount > 0 ? maxAmount : 9999}" 
            value="${defaultAmount}" 
            placeholder="e.g. 50" 
            style="width: 100%; padding: 8px 12px; border: 1.5px solid var(--border-light); border-radius: 8px; font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; box-sizing: border-box;"
          />
          <div style="font-size: 0.75rem; color: var(--ink-secondary); margin-top: 3px;">
            ${maxAmount > 0 ? `Max order value: ₹${Number(maxAmount).toFixed(2)}` : 'Specify refund amount'}
          </div>
        </div>

        <div style="margin-bottom: 1.5rem;">
          <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-primary); margin-bottom: 4px;">
            REASON:
          </label>
          <input 
            type="text" 
            id="cashier-refund-reason-input" 
            value="Counter cash refund requested" 
            placeholder="e.g. Customer returned cash ticket, item out of stock" 
            style="width: 100%; padding: 8px 12px; border: 1.5px solid var(--border-light); border-radius: 8px; font-family: var(--font-sans); font-size: 0.9rem; box-sizing: border-box;"
          />
        </div>

        <div style="background: #FEF3C7; border: 1px solid #F59E0B; border-radius: 8px; padding: 8px 10px; margin-bottom: 1.2rem; font-size: 0.8rem; color: #92400E; line-height: 1.35;">
          ⚠️ <strong>Cash Drawer Note:</strong> If this was paid in cash, physically disburse the approved amount to the student from the counter register upon confirmation.
        </div>

        <div style="display: flex; gap: 10px;">
          <button id="cancel-cashier-refund-modal-btn" class="btn btn--secondary" style="flex: 1;">Cancel</button>
          <button id="confirm-cashier-refund-modal-btn" class="btn btn--danger" style="flex: 1.5;">Confirm Refund</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    const close = () => {
      const card = modal.querySelector('.modal-card-pop-in');
      if (card) {
        card.classList.add('modal-card-exit');
        setTimeout(() => modal.remove(), 120);
      } else {
        modal.remove();
      }
    };
    modal.querySelector('#close-cashier-refund-btn')?.addEventListener('click', close);
    modal.querySelector('#cancel-cashier-refund-modal-btn')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    modal.querySelector('#confirm-cashier-refund-modal-btn')?.addEventListener('click', async () => {
      const confirmBtn = modal.querySelector('#confirm-cashier-refund-modal-btn');
      const amtStr = modal.querySelector('#cashier-refund-amt-input').value.trim();
      const reason = modal.querySelector('#cashier-refund-reason-input').value.trim() || 'Counter refund';
      const amt = parseFloat(amtStr);

      if (isNaN(amt) || amt <= 0) {
        alert('Please enter a valid refund amount in ₹');
        return;
      }

      if (maxAmount > 0 && amt > maxAmount) {
        alert(`Refund amount cannot exceed the order total of ₹${Number(maxAmount).toFixed(2)}`);
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Processing...';

      try {
        const amountPaise = Math.round(amt * 100);
        await processStaffRefund({ orderId, reason, amountPaise });
        playSound(true);
        close();
        feedbackMessage = {
          type: 'success',
          text: `💸 Refund of ₹${amt.toFixed(2)} processed for ${tokenNumber}!`
        };
        render();
        setTimeout(() => {
          feedbackMessage = null;
          render();
        }, 5000);
      } catch (err) {
        playSound(false);
        const friendly = getFriendlyErrorMessage(err, 'Failed to process refund.');
        alert('Refund Failed: ' + friendly);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm Refund';
      }
    });
  }
  function formatOrderDateTime(dtInput) {
    if (!dtInput) return '';
    const dt = dtInput.toDate ? dtInput.toDate() : new Date(dtInput);
    if (isNaN(dt.getTime())) return '';

    const now = new Date();
    const isToday = dt.getFullYear() === now.getFullYear() &&
                    dt.getMonth() === now.getMonth() &&
                    dt.getDate() === now.getDate();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = dt.getFullYear() === yesterday.getFullYear() &&
                        dt.getMonth() === yesterday.getMonth() &&
                        dt.getDate() === yesterday.getDate();

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = months[dt.getMonth()];

    let hours = dt.getHours();
    const minutes = String(dt.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const timeStr = `${hours}:${minutes} ${ampm}`;

    if (isToday) return `Today, ${timeStr}`;
    if (isYesterday) return `Yesterday, ${timeStr}`;
    if (dt.getFullYear() === now.getFullYear()) return `${dt.getDate()} ${monthName}, ${timeStr}`;
    return `${dt.getDate()} ${monthName} ${dt.getFullYear()}, ${timeStr}`;
  }

  function renderCashierListHtml(orders, activeSelected) {
    if (!orders || orders.length === 0) {
      return `
        <div style="text-align: center; padding: 2.5rem 1rem; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.85rem;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🎉</div>
          <div style="font-weight: 700;">No pending cash orders</div>
          <div style="font-size: 0.75rem; color: var(--ink-muted); margin-top: 4px;">All counter cash payments are settled!</div>
        </div>
      `;
    }

    const selectedId = activeSelected ? (activeSelected.id || activeSelected.orderId) : null;

    return orders.map(o => {
      const orderId = o.id || o.orderId;
      const isSelected = Boolean(selectedId && orderId === selectedId);
      const total = Number(o.totalAmount) || (o.totalAmountPaise ? o.totalAmountPaise / 100 : 0);
       const itemsCount = Array.isArray(o.items) ? o.items.reduce((sum, it) => sum + displayQuantity(it.quantity), 0) : 0;
      const timeDisplay = formatOrderDateTime(o.createdAt);

      return `
        <div 
          class="cash-order-card" 
          data-order-id="${escapeHtml(orderId)}"
          style="
            background: ${isSelected ? '#FEF2F2' : '#FFFFFF'};
            border: 1.5px solid ${isSelected ? 'var(--brand-red)' : 'var(--border-light)'};
            border-radius: 12px;
            padding: 12px 14px;
            cursor: pointer;
            transition: all 0.15s ease;
            box-shadow: ${isSelected ? '0 2px 8px rgba(220, 38, 38, 0.12)' : 'none'};
          "
        >
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <div>
              <span style="font-family: var(--font-display); font-size: 1.25rem; font-weight: 800; color: ${isSelected ? 'var(--brand-red)' : 'var(--ink-primary)'}; letter-spacing: 0.05em;">
                ${escapeHtml(o.tokenNumber || 'TB-???')}
              </span>
              <div style="font-family: var(--font-sans); font-size: 0.8rem; font-weight: 600; color: var(--ink-secondary);">
                ${escapeHtml(o.studentName || 'Counter Guest')}${o.studentRoll ? ` (${escapeHtml(o.studentRoll)})` : ''}
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-family: var(--font-mono); font-size: 1.15rem; font-weight: 800; color: #166534;">
                ₹${total.toFixed(2)}
              </div>
              <span style="display: inline-block; font-family: var(--font-mono); font-size: 0.65rem; font-weight: 800; background: #FEF3C7; color: #92400E; padding: 2px 6px; border-radius: 4px; border: 1px solid #FCD34D;">
                UNPAID
              </span>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-muted); padding-top: 4px; border-top: 1px dashed var(--border-light);">
            <span>${itemsCount} item${itemsCount === 1 ? '' : 's'}</span>
            <span>${timeDisplay}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function render() {
    const cleanSearch = (cashierSearchQuery || '').trim().toLowerCase();
    const filteredOrders = currentCashOrders.filter(o => {
      if (o.status === 'cancelled' || o.status === 'expired' || o.paymentStatus === 'cancelled' || o.paymentStatus === 'expired') {
        return false;
      }
      if (!cleanSearch) return true;
      const tokenMatch = (o.tokenNumber || '').toLowerCase().includes(cleanSearch);
      const idMatch = (o.id || o.orderId || '').toLowerCase().includes(cleanSearch);
      const rollMatch = (o.studentRoll || '').toLowerCase().includes(cleanSearch);
      return tokenMatch || idMatch || rollMatch;
    });

    const activeSelected = selectedOrder 
      ? filteredOrders.find(o => (o.id || o.orderId) === (selectedOrder.id || selectedOrder.orderId)) || filteredOrders[0]
      : filteredOrders[0];

    const orderTotal = activeSelected ? (Number(activeSelected.totalAmount) || (activeSelected.totalAmountPaise ? activeSelected.totalAmountPaise / 100 : 0)) : 0;
    const currentTendered = tenderedAmount !== null ? tenderedAmount : orderTotal;
    const changeToReturn = Math.max(0, currentTendered - orderTotal);
    const canSettle = activeSelected && currentTendered >= orderTotal && !isProcessingPayment;

    container.innerHTML = `
      <div style="max-width: 1400px; margin: 0 auto; padding: 1.2rem;">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; color: var(--ink-primary); display: flex; align-items: center; gap: 10px;">
              <span>💵</span>
              <span>CASHIER COUNTER POS & SETTLEMENT</span>
            </h2>
            <p style="font-family: var(--font-sans); font-size: 0.9rem; color: var(--ink-secondary); margin-top: 4px;">
              Authoritative counter cash settlement with atomic double-entry ledger capture (INV-004).
            </p>
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.85rem; background: #DCFCE7; color: #166534; padding: 6px 14px; border-radius: 999px; font-weight: 700; border: 1.5px solid #86EFAC;">
            ● PENDING CASH QUEUE: ${filteredOrders.length} ORDERS
          </div>
        </div>

        ${feedbackMessage ? `
          <div style="margin-bottom: 1.5rem; padding: 14px 18px; border-radius: 12px; font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700; background: ${feedbackMessage.type === 'error' ? '#FEE2E2' : '#DCFCE7'}; color: ${feedbackMessage.type === 'error' ? '#DC2626' : '#166534'}; border: 2px solid ${feedbackMessage.type === 'error' ? '#FCA5A5' : '#86EFAC'};">
            ${escapeHtml(feedbackMessage.text)}
          </div>
        ` : ''}

        <!-- Master Layout: 2 Columns on Desktop, 1 Column on Mobile -->
        <div class="cashier-master-grid">
          
          <!-- LEFT COLUMN: Pending Cash Queue -->
          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 16px; padding: 1.2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: var(--ink-secondary);">
                AWAITING CASH (${filteredOrders.length})
              </span>
            </div>

            <!-- Search input -->
            <div style="background: var(--bg-surface); border: 1px solid var(--border-light); border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; gap: 8px; margin-bottom: 1rem;">
              <span>🔍</span>
              <input 
                type="text" 
                id="cashier-search-input" 
                placeholder="Search token (e.g. TB-042) or roll..." 
                value="${escapeHtml(cashierSearchQuery)}"
                style="flex: 1; border: none; background: transparent; font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; outline: none;"
              />
              ${cashierSearchQuery ? `
                <button id="clear-cashier-search-btn" style="border: none; background: transparent; cursor: pointer; color: var(--ink-secondary); font-weight: 700;">✕</button>
              ` : ''}
            </div>

            <!-- List of Unpaid Cash Orders -->
            <div id="cash-orders-list-container" style="display: flex; flex-direction: column; gap: 8px; max-height: 540px; overflow-y: auto;">
              ${renderCashierListHtml(filteredOrders, activeSelected)}
            </div>
          </div>

          <!-- RIGHT COLUMN: Selected Order Settlement Terminal -->
          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 16px; padding: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.03); display: flex; flex-direction: column; justify-content: space-between;">
            
            ${!activeSelected ? `
              <div style="text-align: center; padding: 5rem 1rem; color: var(--ink-secondary); font-family: var(--font-mono);">
                <div style="font-size: 3rem; margin-bottom: 0.8rem;">👈</div>
                Select a pending order from the left to settle payment.
              </div>
            ` : `
              <div>
                <!-- Token Banner -->
                <div style="background: var(--bg-surface); border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem 1.2rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; color: var(--ink-secondary); text-transform: uppercase;">
                      SETTLING TICKET
                    </span>
                    <div style="font-family: var(--font-display); font-size: 2.2rem; color: var(--brand-red); line-height: 1.1;">
                      ${escapeHtml(activeSelected.tokenNumber || 'TB-???')}
                    </div>
                    <div style="font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; color: var(--ink-secondary); margin-top: 2px;">
                      Student: ${escapeHtml(activeSelected.studentName || 'Counter Guest')}${activeSelected.studentRoll ? ` (${escapeHtml(activeSelected.studentRoll)})` : ''}
                    </div>
                  </div>
                  <div style="text-align: right;">
                    <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: var(--ink-secondary);">
                      TOTAL DUE
                    </span>
                    <div style="font-family: var(--font-mono); font-size: 2.4rem; font-weight: 900; color: #166534; line-height: 1;">
                      ₹${orderTotal.toFixed(2)}
                    </div>
                  </div>
                </div>

                <!-- Item Breakdown -->
                <div style="margin-bottom: 1.5rem;">
                  <div style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; color: var(--ink-secondary); margin-bottom: 8px;">
                    ORDER ITEMS:
                  </div>
                  <div style="background: var(--bg-surface); border-radius: 10px; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto;">
                     ${(activeSelected.items || []).map(i => {
                       const quantity = displayQuantity(i.quantity);
                       return `
                       <div style="display: flex; justify-content: space-between; font-family: var(--font-sans); font-size: 0.88rem; font-weight: 600;">
                         <span>${quantity}x ${escapeHtml(i.name)}</span>
                         <span style="font-family: var(--font-mono);">₹${((Number(i.price) || 0) * quantity).toFixed(2)}</span>
                       </div>
                     `;
                     }).join('')}
                  </div>
                </div>

                <!-- Cash Tendered Keypad / Quick Chips -->
                <div style="margin-bottom: 1.5rem;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: var(--ink-secondary);">
                      CASH TENDERED:
                    </span>
                    <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #166534;">
                      Change: <strong id="cash-change-display">₹${changeToReturn.toFixed(2)}</strong>
                    </span>
                  </div>

                  <!-- Quick Chips -->
                  <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;">
                    ${[
                      { label: 'Exact', val: orderTotal },
                      { label: '₹50', val: 50 },
                      { label: '₹100', val: 100 },
                      { label: '₹200', val: 200 },
                      { label: '₹500', val: 500 },
                    ].filter(c => c.label === 'Exact' || c.val >= orderTotal).map(chip => `
                      <button 
                        class="btn ${currentTendered === chip.val ? 'btn--primary' : 'btn--secondary'} btn--sm quick-tender-btn" 
                        data-val="${chip.val}"
                      >
                        ${chip.label}
                      </button>
                    `).join('')}
                  </div>

                  <!-- Custom Input -->
                  <div style="display: flex; align-items: center; gap: 8px; background: var(--bg-surface); border: 1.5px solid var(--border-light); border-radius: 8px; padding: 8px 12px;">
                    <span style="font-family: var(--font-mono); font-size: 1.1rem; font-weight: 800; color: var(--ink-secondary);">₹</span>
                    <input 
                      type="number" 
                      id="custom-tendered-input" 
                      value="${currentTendered}" 
                      step="5" 
                      min="${orderTotal}"
                      style="flex: 1; border: none; background: transparent; font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; outline: none; color: #166534;"
                    />
                  </div>
                </div>
              </div>

              <!-- Settlement Action Buttons -->
              <div style="display: flex; flex-direction: column; gap: 10px;">
                <button 
                  id="confirm-cash-settle-btn" 
                  class="btn ${canSettle ? 'btn--success' : 'btn--secondary'} btn--xl ${isProcessingPayment ? 'is-loading' : ''}"
                  ${!canSettle ? 'disabled' : ''}
                  style="width: 100%; font-family: var(--font-display); font-size: 1.6rem; letter-spacing: 0.05em;"
                >
                  ${isProcessingPayment ? 'PROCESSING LEDGER COMMIT...' : `✓ CONFIRM CASH ₹${orderTotal.toFixed(2)} →`}
                </button>

                <button 
                  id="cancel-unpaid-cash-btn" 
                  class="btn btn--outline-danger btn--md"
                  ${isProcessingPayment ? 'disabled' : ''}
                  style="width: 100%; font-size: 0.92rem; font-weight: 700;"
                >
                  🚫 Cancel Unpaid Order
                </button>

                <button 
                  id="refund-cashier-btn" 
                  class="btn btn--outline-secondary btn--md"
                  ${isProcessingPayment ? 'disabled' : ''}
                  style="width: 100%; font-size: 0.92rem; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px;"
                >
                  💸 Issue Customer Refund
                </button>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    // Search input
    const searchInput = container.querySelector('#cashier-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        cashierSearchQuery = e.target.value;
        const cleanSearch = (cashierSearchQuery || '').trim().toLowerCase();
        const filtered = currentCashOrders.filter(o => {
          if (o.status === 'cancelled' || o.status === 'expired' || o.paymentStatus === 'cancelled' || o.paymentStatus === 'expired') {
            return false;
          }
          if (!cleanSearch) return true;
          const tokenMatch = (o.tokenNumber || '').toLowerCase().includes(cleanSearch);
          const idMatch = (o.id || o.orderId || '').toLowerCase().includes(cleanSearch);
          const rollMatch = (o.studentRoll || '').toLowerCase().includes(cleanSearch);
          return tokenMatch || idMatch || rollMatch;
        });
        const listContainer = container.querySelector('#cash-orders-list-container');
        if (listContainer) {
          listContainer.innerHTML = renderCashierListHtml(filtered, selectedOrder);
          bindCardClicks();
        }
      });
    }

    const clearBtn = container.querySelector('#clear-cashier-search-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        cashierSearchQuery = '';
        render();
      });
    }

    function bindCardClicks() {
      container.querySelectorAll('.cash-order-card').forEach(card => {
        card.addEventListener('click', () => {
          const orderId = card.getAttribute('data-order-id');
          selectedOrder = currentCashOrders.find(o => (o.id || o.orderId) === orderId) || null;
          tenderedAmount = null;
          render();
        });
      });
    }
    bindCardClicks();

    // Quick tender chips
    container.querySelectorAll('.quick-tender-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tenderedAmount = Number(btn.getAttribute('data-val'));
        render();
      });
    });

    // Custom tendered input (Live update without DOM destruction/focus loss)
    const customTender = container.querySelector('#custom-tendered-input');
    if (customTender && selectedOrder) {
      const orderTotal = Number(selectedOrder.totalAmount) || ((selectedOrder.totalAmountPaise || 0) / 100);
      customTender.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        tenderedAmount = isNaN(val) ? 0 : val;
        const change = Math.max(0, tenderedAmount - orderTotal);
        
        const changeEl = container.querySelector('#cash-change-display');
        if (changeEl) changeEl.textContent = `₹${change.toFixed(2)}`;

        // Update quick chips active style
        container.querySelectorAll('.quick-tender-btn').forEach(b => {
          const chipVal = Number(b.getAttribute('data-val'));
          if (chipVal === tenderedAmount) {
            b.classList.remove('btn--secondary');
            b.classList.add('btn--primary');
          } else {
            b.classList.remove('btn--primary');
            b.classList.add('btn--secondary');
          }
        });

        // Update settle button
        const settleBtn = container.querySelector('#confirm-cash-settle-btn');
        if (settleBtn) {
          const canSettleNow = tenderedAmount >= orderTotal && !isProcessingPayment;
          settleBtn.disabled = !canSettleNow;
          if (canSettleNow) {
            settleBtn.classList.remove('btn--secondary');
            settleBtn.classList.add('btn--success');
          } else {
            settleBtn.classList.remove('btn--success');
            settleBtn.classList.add('btn--secondary');
          }
        }
      });
    }

    // Cancel Unpaid Order button
    const cancelUnpaidBtn = container.querySelector('#cancel-unpaid-cash-btn');
    if (cancelUnpaidBtn) {
      cancelUnpaidBtn.addEventListener('click', async () => {
        if (!selectedOrder || isProcessingPayment) return;
        const orderId = selectedOrder.id || selectedOrder.orderId;
        const tokenNum = selectedOrder.tokenNumber || orderId;

        const reason = prompt(`Reason for cancelling unpaid order ${tokenNum}:`, 'Customer walked away / unpaid order abandoned');
        if (!reason) return;

        const confirmed = confirm(`Are you sure you want to CANCEL unpaid order ${tokenNum}?\nThis will release held stock and remove the order from the cash queue.`);
        if (!confirmed) return;

        isProcessingPayment = true;
        cancelUnpaidBtn.textContent = 'Cancelling...';
        cancelUnpaidBtn.disabled = true;

        try {
          await cancelStaffOrder(orderId, reason);
          playSound(true);
          feedbackMessage = {
            type: 'success',
            text: `🚫 Unpaid Order ${tokenNum} Cancelled.`
          };
          selectedOrder = null;
          tenderedAmount = null;
        } catch (err) {
          playSound(false);
          feedbackMessage = {
            type: 'error',
            text: `❌ Cancellation Failed: ${err.message || err}`
          };
        } finally {
          isProcessingPayment = false;
          render();
          setTimeout(() => {
            feedbackMessage = null;
            render();
          }, 5000);
        }
      });
    }

    // Refund button
    const refundBtn = container.querySelector('#refund-cashier-btn');
    if (refundBtn) {
      refundBtn.addEventListener('click', () => {
        if (!selectedOrder || isProcessingPayment) return;
        const orderId = selectedOrder.id || selectedOrder.orderId;
        const tokenNum = selectedOrder.tokenNumber || orderId;
        const orderTotal = Number(selectedOrder.totalAmount) || ((selectedOrder.totalAmountPaise || 0) / 100);
        openCashierRefundModal(orderId, tokenNum, orderTotal);
      });
    }

    // Settle button
    const settleBtn = container.querySelector('#confirm-cash-settle-btn');
    if (settleBtn) {
      settleBtn.addEventListener('click', async () => {
        if (!selectedOrder || isProcessingPayment) return;
        const orderId = selectedOrder.id || selectedOrder.orderId;
        const tokenNum = selectedOrder.tokenNumber || orderId;

        isProcessingPayment = true;
        render();

        try {
          await recordCashPayment(orderId);
          playSound(true);
          feedbackMessage = {
            type: 'success',
            text: `✅ Cash Payment Recorded! Order ${tokenNum} is CONFIRMED and routed to Kitchen/Pickup.`
          };
          selectedOrder = null;
          tenderedAmount = null;
        } catch (err) {
          playSound(false);
          feedbackMessage = {
            type: 'error',
            text: `❌ Settlement Failed: ${getFriendlyErrorMessage(err, 'Unable to record payment.')}`
          };
        } finally {
          isProcessingPayment = false;
          render();
          setTimeout(() => {
            feedbackMessage = null;
            render();
          }, 6000);
        }
      });
    }
  }

  // Subscribe to live pending cash orders
  const ordersRef = collection(db, 'orders');
  const q = query(
    ordersRef,
    where('paymentMethod', '==', 'counter_cash'),
    where('paymentStatus', '==', 'pending')
  );

  unsubscribeCashOrders = onSnapshot(q, (snapshot) => {
    currentCashOrders = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(o => o.status !== 'cancelled' && o.status !== 'expired' && o.paymentStatus !== 'cancelled' && o.paymentStatus !== 'expired');
    // Client-side fallback sort by creation time
    currentCashOrders.sort((a, b) => {
      const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return timeA - timeB;
    });
    if (selectedOrder && !currentCashOrders.some(o => (o.id || o.orderId) === (selectedOrder.id || selectedOrder.orderId))) {
      selectedOrder = null;
      tenderedAmount = null;
    }
    render();
  }, (err) => {
    console.warn('Cashier orders listener notice:', err);
  });

  render();
}

export function cleanupCashierView() {
  if (unsubscribeCashOrders) {
    unsubscribeCashOrders();
    unsubscribeCashOrders = null;
  }
  if (cashierAudioCtx) {
    try { cashierAudioCtx.close(); } catch (_) {}
    cashierAudioCtx = null;
  }
  currentCashOrders = [];
}
