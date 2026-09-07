// Thakur Bites Platform 2.0 — Cashier Counter POS & Atomic Ledger Settlement
import { db, functions, recordCashPayment } from '../firebase.js?v=5';
import { collection, query, where, onSnapshot, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { escapeHtml } from './escapeHtml.js';

let unsubscribeCashOrders = null;
let currentCashOrders = [];
let cashierSearchQuery = '';
let selectedOrder = null;
let tenderedAmount = null;
let isProcessingPayment = false;
let feedbackMessage = null;

export function renderCashierView(container) {
  if (unsubscribeCashOrders) {
    try { unsubscribeCashOrders(); } catch (_) {}
    unsubscribeCashOrders = null;
  }

  function playSound(isSuccess) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
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

  function render() {
    const cleanSearch = (cashierSearchQuery || '').trim().toLowerCase();
    const filteredOrders = currentCashOrders.filter(o => {
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

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.5rem;">
          
          <!-- LEFT COLUMN: Pending Cash Queue & Search -->
          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 16px; padding: 1.2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
            
            <!-- Search Bar -->
            <div style="display: flex; align-items: center; gap: 8px; background: var(--bg-surface); border: 1.5px solid var(--border-light); border-radius: 10px; padding: 8px 14px; margin-bottom: 1rem;">
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
            <div style="display: flex; flex-direction: column; gap: 8px; max-height: 540px; overflow-y: auto;">
              ${filteredOrders.length === 0 ? `
                <div style="text-align: center; padding: 3rem 1rem; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.9rem;">
                  <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">✅</div>
                  <strong>No pending cash orders.</strong><br>
                  All counter cash checkouts have been settled.
                </div>
              ` : filteredOrders.map(order => {
                const isSelected = activeSelected && (activeSelected.id || activeSelected.orderId) === (order.id || order.orderId);
                const amt = Number(order.totalAmount) || ((order.totalAmountPaise || 0) / 100);
                const itemCount = (order.items || []).reduce((sum, i) => sum + (i.quantity || 1), 0);
                return `
                  <div 
                    class="cash-order-card ${isSelected ? 'selected' : ''}" 
                    data-order-id="${order.id || order.orderId}"
                    style="padding: 12px 16px; border-radius: 12px; border: 2px solid ${isSelected ? 'var(--brand-red)' : 'var(--border-light)'}; background: ${isSelected ? '#FEF2F2' : '#FFF'}; cursor: pointer; transition: all 0.15s ease;"
                  >
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div>
                        <span style="font-family: var(--font-display); font-size: 1.4rem; color: ${isSelected ? 'var(--brand-red)' : 'var(--ink-primary)'};">
                          ${escapeHtml(order.tokenNumber || 'TB-???')}
                        </span>
                        <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 2px;">
                          ${order.studentRoll ? `Roll: ${escapeHtml(order.studentRoll)} · ` : ''}${itemCount} Items
                        </div>
                      </div>
                      <div style="text-align: right;">
                        <div style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 800; color: #166534;">
                          ₹${amt.toFixed(2)}
                        </div>
                        <span style="font-family: var(--font-mono); font-size: 0.68rem; background: #FEF3C7; color: #B45309; padding: 2px 6px; border-radius: 4px; font-weight: 800;">
                          UNPAID CASH
                        </span>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
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
                <!-- Token Header -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 1rem; border-bottom: 1.5px solid var(--border-light); margin-bottom: 1.2rem;">
                  <div>
                    <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; color: var(--ink-secondary); text-transform: uppercase;">
                      SETTLEMENT TICKET
                    </span>
                    <h3 style="font-family: var(--font-display); font-size: 2.4rem; color: var(--brand-red); margin: 2px 0 0 0;">
                      ${escapeHtml(activeSelected.tokenNumber || 'TB-???')}
                    </h3>
                    <div style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary); margin-top: 4px;">
                      Order ID: <code>${escapeHtml(activeSelected.id || activeSelected.orderId)}</code>
                    </div>
                  </div>
                  <div style="text-align: right;">
                    <span style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary);">TOTAL DUE:</span>
                    <div style="font-family: var(--font-mono); font-size: 2.2rem; font-weight: 900; color: #166534;">
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
                    ${(activeSelected.items || []).map(i => `
                      <div style="display: flex; justify-content: space-between; font-family: var(--font-sans); font-size: 0.88rem; font-weight: 600;">
                        <span>${i.quantity || 1}x ${escapeHtml(i.name)}</span>
                        <span style="font-family: var(--font-mono);">₹${((Number(i.price) || 0) * (i.quantity || 1)).toFixed(2)}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>

                <!-- Cash Tendered Keypad / Quick Chips -->
                <div style="margin-bottom: 1.5rem;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: var(--ink-secondary);">
                      CASH TENDERED:
                    </span>
                    <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #166534;">
                      Change: <strong>₹${changeToReturn.toFixed(2)}</strong>
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
                        class="quick-tender-btn ${currentTendered === chip.val ? 'active' : ''}" 
                        data-val="${chip.val}"
                        style="padding: 6px 14px; border-radius: 8px; border: 1.5px solid ${currentTendered === chip.val ? 'var(--brand-red)' : 'var(--border-light)'}; background: ${currentTendered === chip.val ? 'var(--brand-red)' : 'var(--bg-surface)'}; color: ${currentTendered === chip.val ? '#FFF' : 'var(--ink-primary)'}; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;"
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

              <!-- Settle Button -->
              <div>
                <button 
                  id="confirm-cash-settle-btn" 
                  ${!canSettle ? 'disabled' : ''}
                  style="width: 100%; padding: 16px; border-radius: 12px; background: ${canSettle ? '#16A34A' : '#94A3B8'}; color: #FFF; border: none; font-family: var(--font-display); font-size: 1.6rem; letter-spacing: 0.05em; cursor: ${canSettle ? 'pointer' : 'not-allowed'}; box-shadow: ${canSettle ? '0 4px 12px rgba(22,163,74,0.3)' : 'none'}; transition: all 0.15s ease;"
                >
                  ${isProcessingPayment ? 'PROCESSING LEDGER COMMIT...' : `✓ CONFIRM CASH ₹${orderTotal.toFixed(2)} →`}
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
        render();
        const next = container.querySelector('#cashier-search-input');
        if (next) {
          next.focus();
          next.setSelectionRange(next.value.length, next.value.length);
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

    // Card select
    container.querySelectorAll('.cash-order-card').forEach(card => {
      card.addEventListener('click', () => {
        const orderId = card.getAttribute('data-order-id');
        selectedOrder = currentCashOrders.find(o => (o.id || o.orderId) === orderId) || null;
        tenderedAmount = null;
        render();
      });
    });

    // Quick tender chips
    container.querySelectorAll('.quick-tender-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tenderedAmount = Number(btn.getAttribute('data-val'));
        render();
      });
    });

    // Custom tendered input
    const customTender = container.querySelector('#custom-tendered-input');
    if (customTender) {
      customTender.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        tenderedAmount = isNaN(val) ? 0 : val;
        render();
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
            text: `❌ Settlement Failed: ${err.message || err}`
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
    currentCashOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Client-side fallback sort by creation time
    currentCashOrders.sort((a, b) => {
      const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return timeA - timeB;
    });
    render();
  }, (err) => {
    console.warn('Cashier orders listener notice:', err);
  });

  render();
}
