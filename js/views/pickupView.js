// Phase 10 & Platform 2.0 — Counter Pickup & Dispatch View with Hardware Barcode/QR Scanner Engine
import { fetchPickupOrders, updateOrderStatus, unlockOrder } from '../firebase.js?v=4';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { escapeHtml } from './escapeHtml.js';

let pollInterval = null;
let currentOrders = [];
let searchFilter = '';
let showCollectedHistory = false;
let scannerBuffer = '';
let lastKeypressTime = 0;
let scannerFeedbackMessage = null;
let scannerFeedbackType = 'success'; // 'success' | 'error'
let keydownListener = null;

// Synthesize pleasant POS scanner feedback tones
function playScanSound(isSuccess = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (isSuccess) {
      // High double-beep for success
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.setValueAtTime(1600, now + 0.08);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } else {
      // Low buzz for rejection
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(250, now);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    }
  } catch (_) {}
}

export function renderPickupView(container) {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (keydownListener) {
    window.removeEventListener('keydown', keydownListener);
    keydownListener = null;
  }

  // ═══════════════════════════════════════════════════════════════
  // HARDWARE 2D BARCODE & QR SCANNER ENGINE (HID Keystroke Stream)
  // ═══════════════════════════════════════════════════════════════
  async function handleScannedPayload(payload) {
    const cleanPayload = payload.trim();
    if (!cleanPayload) return;

    // Check if it's a signed QR Token (orderId.studentId.nonce.expiresAt.sig)
    if (cleanPayload.includes('.')) {
      const parts = cleanPayload.split('.');
      const orderId = parts[0];

      try {
        const functions = getFunctions();
        const verifyFn = httpsCallable(functions, 'verifyPickup');
        const res = await verifyFn({ orderId, qrToken: cleanPayload });

        playScanSound(true);
        scannerFeedbackMessage = `✅ Order ${res.data?.tokenNumber || orderId} Verified & Collected!`;
        scannerFeedbackType = 'success';
        render();

        setTimeout(() => {
          scannerFeedbackMessage = null;
          render();
        }, 4000);
      } catch (err) {
        playScanSound(false);
        scannerFeedbackMessage = `❌ Scan Error: ${err.message || 'Invalid or already consumed QR Token'}`;
        scannerFeedbackType = 'error';
        render();

        setTimeout(() => {
          scannerFeedbackMessage = null;
          render();
        }, 5000);
      }
    } else if (/^\d{4,6}$/.test(cleanPayload)) {
      // 4 to 6 digit PIN scan / keypress
      searchFilter = cleanPayload;
      render();
    }
  }

  keydownListener = (e) => {
    // Ignore input if user is actively typing in a normal text input
    if (e.target && e.target.tagName === 'INPUT' && e.target.id === 'pickup-filter-input') {
      return;
    }

    const currentTime = Date.now();
    const interval = currentTime - lastKeypressTime;
    lastKeypressTime = currentTime;

    if (e.key === 'Enter') {
      if (scannerBuffer.length > 2) {
        const scanned = scannerBuffer;
        scannerBuffer = '';
        handleScannedPayload(scanned);
      }
      scannerBuffer = '';
    } else if (e.key.length === 1) {
      // If typing speed is high (< 50ms interval), it's a hardware scanner stream
      if (interval < 50 || scannerBuffer.length === 0) {
        scannerBuffer += e.key;
      } else {
        // Human typing reset
        scannerBuffer = e.key;
      }
    }
  };

  window.addEventListener('keydown', keydownListener);

  function render() {
    const cleanSearch = searchFilter.trim().toLowerCase().replace('#', '');

    // Filter active orders
    const activeOrders = currentOrders.filter(o => o.status !== 'collected');
    const collectedOrders = currentOrders.filter(o => o.status === 'collected');

    // Split active into Ready (top priority) and In-Kitchen/Placed
    const readyOrders = activeOrders.filter(o => o.status === 'ready');
    const kitchenOrders = activeOrders.filter(o => o.status === 'preparing' || o.status === 'placed' || o.status === 'confirmed');

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
              <span style="background: #0284C7; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px; display: flex; align-items: center; gap: 4px;">
                📟 2D SCANNER ACTIVE
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Scan customer QR code or enter PIN to mark collected. Hardware USB/Bluetooth barcode scanner supported.
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

        <!-- Scanner Feedback Notification Banner -->
        ${scannerFeedbackMessage ? `
          <div style="background: ${scannerFeedbackType === 'success' ? '#F0FDF4' : '#FEF2F2'}; border: 1.5px solid ${scannerFeedbackType === 'success' ? '#86EFAC' : '#FCA5A5'}; border-radius: 12px; padding: 1rem 1.2rem; margin-bottom: 1.5rem; font-family: var(--font-mono); font-size: 1rem; font-weight: 700; color: ${scannerFeedbackType === 'success' ? '#15803D' : '#DC2626'}; display: flex; align-items: center; justify-content: space-between;">
            <span>${scannerFeedbackMessage}</span>
            <span style="font-size: 0.75rem; color: var(--ink-secondary);">AUTO-DISPATCHED</span>
          </div>
        ` : ''}

        <!-- Quick Filter Input -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 0.7rem 1.2rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <span style="font-size: 1.2rem;">🔍</span>
          <input 
            type="text" 
            id="pickup-filter-input" 
            placeholder="Filter by Token #, PIN, or Student Name..." 
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
          <h3 style="font-family: var(--font-display); font-size: 1.4rem; letter-spacing: 0.03em; margin: 0 0 1rem 0; display: flex; align-items: center; gap: 8px;">
            <span>READY FOR COLLECTION</span>
            <span style="background: #DCFCE7; color: #166534; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; padding: 2px 8px; border-radius: 6px;">
              ${displayReady.length} Orders
            </span>
          </h3>

          ${displayReady.length === 0 ? `
            <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 3rem; text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.9rem;">
              No orders ready for collection right now.
            </div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem;">
              ${displayReady.map(order => renderOrderCard(order, true)).join('')}
            </div>
          `}
        </div>

        <!-- SECTION 2: IN KITCHEN / PLACED -->
        <div style="margin-bottom: 2rem;">
          <h3 style="font-family: var(--font-display); font-size: 1.3rem; letter-spacing: 0.03em; margin: 0 0 1rem 0; color: var(--ink-secondary); display: flex; align-items: center; gap: 8px;">
            <span>IN KITCHEN / PREPARING</span>
            <span style="background: var(--bg-surface); color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 6px;">
              ${displayKitchen.length} Orders
            </span>
          </h3>

          ${displayKitchen.length === 0 ? `
            <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 2rem; text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.85rem;">
              No pending kitchen orders matching filter.
            </div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0.8rem;">
              ${displayKitchen.map(order => renderOrderCard(order, false)).join('')}
            </div>
          `}
        </div>

        <!-- SECTION 3: COLLECTED HISTORY -->
        <div>
          <button id="toggle-history-btn" style="background: transparent; border: 1.5px solid var(--border-light); border-radius: 8px; padding: 8px 14px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; color: var(--ink-secondary); margin-bottom: 1rem;">
            ${showCollectedHistory ? '▼ Hide Collected History' : '▶ Show Recently Collected History (' + displayCollected.length + ')'}
          </button>

          ${showCollectedHistory ? `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0.8rem;">
              ${displayCollected.map(order => renderCollectedCard(order)).join('')}
            </div>
          ` : ''}
        </div>

      </div>
    `;

    // Event Listeners
    const filterInput = container.querySelector('#pickup-filter-input');
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        searchFilter = e.target.value;
        render();
        const newInput = container.querySelector('#pickup-filter-input');
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(newInput.value.length, newInput.value.length);
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
        playScanSound(true);
        await loadPickupData();
      });
    });

    container.querySelectorAll('.unlock-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        const reason = prompt('Enter manager verification note for unlocking order:', 'Student verified with physical College ID');
        if (reason) {
          btn.textContent = 'Unlocking...';
          btn.disabled = true;
          try {
            await unlockOrder(orderId, reason);
            await loadPickupData();
          } catch (e) {
            console.error("Unlock order error:", e);
            btn.disabled = false;
            btn.textContent = 'Retry Unlock';
          }
        }
      });
    });
  }

  async function loadPickupData() {
    try {
      const orders = await fetchPickupOrders();
      currentOrders = (orders || []).map(o => ({
        ...o,
        id: o.orderId || o.id,
      }));
      render();
    } catch (err) {
      console.warn("Pickup operational fetch notice:", err);
    }
  }

  loadPickupData();
  pollInterval = setInterval(loadPickupData, 5000);
}

function renderOrderCard(order, isReady) {
  const isLocked = order.isLockedForInvestigation || (order.failedPinAttempts >= 3);
  const items = order.items || [];
  const totalQty = items.reduce((s, i) => s + (i.quantity || 1), 0);

  return `
    <div style="background: #FFF; border: 1.5px solid ${isReady ? '#86EFAC' : 'var(--border-light)'}; border-radius: 14px; padding: 1.2rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03); display: flex; flex-direction: column; justify-content: space-between;">
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem;">
          <div>
            <div style="font-family: var(--font-mono); font-size: 1.4rem; font-weight: 800; color: var(--ink-primary);">
              ${escapeHtml(order.tokenNumber || 'TB-???')}
            </div>
            <div style="font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; color: var(--ink-secondary); margin-top: 2px;">
              ${escapeHtml(order.studentName || 'Student')}
            </div>
          </div>

          <div style="text-align: right;">
            <div style="background: ${isReady ? '#DCFCE7' : '#FEF3C7'}; color: ${isReady ? '#15803D' : '#B45309'}; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; text-transform: uppercase;">
              ${escapeHtml(order.status)}
            </div>
            ${order.pinCode ? `
              <div style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: #2563EB; margin-top: 4px;">
                PIN: ${escapeHtml(order.pinCode)}
              </div>
            ` : ''}
          </div>
        </div>

        <div style="border-top: 1px dashed var(--border-light); padding-top: 0.6rem; margin-bottom: 1rem;">
          <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-bottom: 4px;">
            ITEMS (${totalQty}):
          </div>
          ${items.map(item => `
            <div style="display: flex; justify-content: space-between; font-family: var(--font-sans); font-size: 0.85rem; margin-bottom: 2px;">
              <span>${item.quantity}x ${escapeHtml(item.name || item.itemId)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div>
        ${isLocked ? `
          <div style="background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 8px; padding: 8px; margin-bottom: 8px; text-align: center;">
            <span style="color: #DC2626; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700;">🔒 LOCKED: 3 Failed PIN Attempts</span>
          </div>
          <button class="unlock-action-btn" data-order-id="${escapeHtml(order.orderId || order.id)}" style="width: 100%; background: #DC2626; color: #FFF; border: none; border-radius: 8px; padding: 10px; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;">
            Manager Override Unlock
          </button>
        ` : (isReady ? `
          <button class="collect-action-btn" data-order-id="${escapeHtml(order.orderId || order.id)}" style="width: 100%; background: #16A34A; color: #FFF; border: none; border-radius: 8px; padding: 10px; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <span>✓ Mark Collected</span>
          </button>
        ` : `
          <div style="text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.8rem; padding: 6px;">
            Waiting on Kitchen prep
          </div>
        `)}
      </div>
    </div>
  `;
}

function renderCollectedCard(order) {
  return `
    <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: 10px; padding: 0.8rem 1rem; opacity: 0.75;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-family: var(--font-mono); font-weight: 800; font-size: 1rem;">${escapeHtml(order.tokenNumber || 'TB-???')}</span>
        <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #16A34A; font-weight: 700;">COLLECTED</span>
      </div>
      <div style="font-family: var(--font-sans); font-size: 0.8rem; color: var(--ink-secondary); margin-top: 2px;">
        ${escapeHtml(order.studentName || 'Student')}
      </div>
    </div>
  `;
}
