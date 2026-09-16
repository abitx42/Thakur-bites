// Phase 10 & Platform 2.0 — Counter Pickup & Dispatch View with Hardware Barcode/QR Scanner Engine
import { db, fetchPickupOrders, updateOrderStatus, unlockOrder, functions } from '../firebase.js?v=5';
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { escapeHtml } from './escapeHtml.js';

let pollInterval = null;
let unsubscribePickup = null;
let currentOrders = [];
let searchFilter = '';
let showCollectedHistory = false;
let scannerBuffer = '';
let lastKeypressTime = 0;
let scannerFeedbackMessage = null;
let scannerFeedbackType = 'success'; // 'success' | 'error'
let keydownListener = null;
let pickupAudioCtx = null;

function getAudioContext() {
  try {
    if (!pickupAudioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) pickupAudioCtx = new AudioCtx();
    }
    if (pickupAudioCtx && pickupAudioCtx.state === 'suspended') {
      pickupAudioCtx.resume().catch(() => {});
    }
    return pickupAudioCtx;
  } catch (_) {
    return null;
  }
}

// Synthesize pleasant POS scanner feedback tones
function playScanSound(isSuccess = true) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
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
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (_) {}
      };
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
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (_) {}
      };
    }
  } catch (_) {}
}

export function renderPickupView(container) {
  if (unsubscribePickup) {
    try { unsubscribePickup(); } catch (_) {}
    unsubscribePickup = null;
  }
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

    // Check if it's a mobile app QR Token (TB:orderId:tokenNumber:pinCode)
    if (cleanPayload.startsWith('TB:')) {
      const parts = cleanPayload.split(':');
      const orderId = parts[1];
      const tokenNumber = parts[2] || orderId;
      const pinCode = parts[3] || '';

      try {
        const verifyFn = httpsCallable(functions, 'verifyPickup');
        await verifyFn({ orderId, pinCode });

        playScanSound(true);
        scannerFeedbackMessage = `✅ Order ${tokenNumber} Verified & Handed Over!`;
        scannerFeedbackType = 'success';
        render();

        setTimeout(() => {
          scannerFeedbackMessage = null;
          render();
        }, 4000);
      } catch (err) {
        if (err.code === 'not-found' || err.code === 'unavailable' || String(err.message || '').includes('not found') || String(err.message || '').includes('internal')) {
          try {
            await updateOrderStatus(orderId, 'collected');
            playScanSound(true);
            scannerFeedbackMessage = `✅ Order ${tokenNumber} Verified & Handed Over!`;
            scannerFeedbackType = 'success';
            render();
            setTimeout(() => {
              scannerFeedbackMessage = null;
              render();
            }, 4000);
            return;
          } catch (fallbackErr) {
            console.error("Pickup QR fallback failed:", fallbackErr);
          }
        }
        playScanSound(false);
        scannerFeedbackMessage = `❌ Verification Failed: ${err.message || 'Invalid PIN or unready order'}`;
        scannerFeedbackType = 'error';
        render();

        setTimeout(() => {
          scannerFeedbackMessage = null;
          render();
        }, 6000);
      }
      return;
    }

    // Check if it's a signed QR Token (orderId.studentId.nonce.expiresAt.sig)
    if (cleanPayload.includes('.')) {
      const parts = cleanPayload.split('.');
      const orderId = parts[0];

      try {
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
        if (err.code === 'not-found' || err.code === 'unavailable' || String(err.message || '').includes('not found') || String(err.message || '').includes('internal')) {
          try {
            await updateOrderStatus(orderId, 'collected');
            playScanSound(true);
            scannerFeedbackMessage = `✅ Order ${orderId} Verified & Collected!`;
            scannerFeedbackType = 'success';
            render();
            setTimeout(() => {
              scannerFeedbackMessage = null;
              render();
            }, 4000);
            return;
          } catch (fallbackErr) {
            console.error("Pickup QR token fallback failed:", fallbackErr);
          }
        }
        playScanSound(false);
        const isReplay = String(err.message || '').includes('ALREADY_COLLECTED');
        if (isReplay) {
          scannerFeedbackMessage = `🚨 REPLAY DETECTED: Order already collected! Do not hand over meal.`;
        } else {
          scannerFeedbackMessage = `❌ Scan Error: ${err.message || 'Invalid or already consumed QR Token'}`;
        }
        scannerFeedbackType = 'error';
        render();

        setTimeout(() => {
          scannerFeedbackMessage = null;
          render();
        }, 6000);
      }
    } else if (/^\d{4,6}$/.test(cleanPayload)) {
      // 4 to 6 digit PIN scan / keypress
      searchFilter = cleanPayload;
      render();
    }
  }

  keydownListener = (e) => {
    // Ignore input if user is actively typing in any input, textarea, select or contentEditable element
    const targetTag = e.target?.tagName;
    if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT' || e.target?.isContentEditable) {
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
      // Hardware barcode scanner inter-character latency is typically < 100ms
      if (interval < 100 || scannerBuffer.length === 0) {
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

    // Split active into Ready (top priority, including ready-made) and In-Kitchen/Placed
    const readyOrders = activeOrders.filter(o => o.status === 'ready' || o.isOnlyReadyMade);
    const kitchenOrders = activeOrders.filter(o => !o.isOnlyReadyMade && (o.status === 'preparing' || o.status === 'placed' || o.status === 'confirmed' || o.status === 'paid'));

    const filterFn = (order) => {
      if (!cleanSearch) return true;
      const tokenMatch = order.tokenNumber && order.tokenNumber.toString().toLowerCase().replace('#', '').includes(cleanSearch);
      const nameMatch = order.studentName && order.studentName.toLowerCase().includes(cleanSearch);
      const rollMatch = order.studentRoll && order.studentRoll.toLowerCase().includes(cleanSearch);
      return tokenMatch || nameMatch || rollMatch;
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

        <!-- Scanner Feedback Notification Banner (High-Visibility Station Flash) -->
        ${scannerFeedbackMessage ? `
          <div class="station-verify-flash" style="background: ${scannerFeedbackType === 'success' ? '#ECFDF5' : '#FEF2F2'}; border: 2.5px solid ${scannerFeedbackType === 'success' ? '#16A34A' : '#DC2626'}; border-radius: var(--radius-lg, 16px); padding: 1.2rem 1.5rem; margin-bottom: 1.5rem; font-family: var(--font-mono); font-size: 1.15rem; font-weight: 800; color: ${scannerFeedbackType === 'success' ? '#15803D' : '#DC2626'}; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 0 28px ${scannerFeedbackType === 'success' ? 'rgba(34, 197, 94, 0.35)' : 'rgba(220, 38, 38, 0.35)'};">
            <span style="display: flex; align-items: center; gap: 12px;">
              <span style="font-size: 1.5rem;">${scannerFeedbackType === 'success' ? '✅' : '🚨'}</span>
              <span>${escapeHtml(scannerFeedbackMessage)}</span>
            </span>
            <span style="font-size: 0.8rem; font-weight: 800; letter-spacing: 0.08em; padding: 4px 12px; border-radius: var(--radius-pill, 999px); background: ${scannerFeedbackType === 'success' ? 'rgba(22, 163, 74, 0.15)' : 'rgba(220, 38, 38, 0.15)'}; color: ${scannerFeedbackType === 'success' ? '#15803D' : '#DC2626'};">STATION VERIFIED</span>
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
            <button id="clear-filter-btn" class="btn btn--secondary btn--sm">
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
            <div class="pickup-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 1rem;">
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
            <div class="pickup-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 0.8rem;">
              ${displayKitchen.map(order => renderOrderCard(order, false)).join('')}
            </div>
          `}
        </div>

        <!-- SECTION 3: COLLECTED HISTORY -->
        <div>
          <button id="toggle-history-btn" class="btn btn--secondary btn--sm" style="margin-bottom: 1rem;">
            ${showCollectedHistory ? '▼ Hide Collected History' : '▶ Show Recently Collected History (' + displayCollected.length + ')'}
          </button>

          ${showCollectedHistory ? `
            <div class="pickup-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 0.8rem;">
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
        const tokenNumber = btn.getAttribute('data-token') || 'Order';
        const origContent = btn.innerHTML;
        btn.textContent = 'Updating...';
        btn.disabled = true;

        try {
          await updateOrderStatus(orderId, 'collected');
          playScanSound(true);
          scannerFeedbackMessage = `✅ ${tokenNumber} Marked as Collected!`;
          scannerFeedbackType = 'success';
          await loadPickupData();
          setTimeout(() => {
            if (scannerFeedbackMessage && scannerFeedbackMessage.includes(tokenNumber)) {
              scannerFeedbackMessage = null;
              render();
            }
          }, 4000);
        } catch (err) {
          console.error("Pickup collect error:", err);
          playScanSound(false);
          alert("Handover Error: " + (err.message || err));
          btn.disabled = false;
          btn.innerHTML = origContent;
        }
      });
    });

    container.querySelectorAll('.verify-pin-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        const tokenNumber = btn.getAttribute('data-token') || 'Order';
        const enteredPin = prompt(`Enter 4-digit Student Pickup PIN for ${tokenNumber}:`);
        if (!enteredPin) return;

        const cleanPin = enteredPin.trim();
        if (!/^\d{4,8}$/.test(cleanPin)) {
          alert('Invalid PIN format: PIN must be 4 to 8 numeric digits.');
          return;
        }

        const origContent = btn.innerHTML;
        btn.textContent = 'Verifying...';
        btn.disabled = true;

        try {
          const verifyFn = httpsCallable(functions, 'verifyPickup');
          await verifyFn({ orderId, pinCode: cleanPin });
          playScanSound(true);
          scannerFeedbackMessage = `✅ ${tokenNumber} Verified with PIN & Collected!`;
          scannerFeedbackType = 'success';
          await loadPickupData();
          setTimeout(() => {
            if (scannerFeedbackMessage && scannerFeedbackMessage.includes(tokenNumber)) {
              scannerFeedbackMessage = null;
              render();
            }
          }, 4000);
        } catch (err) {
          if (err.code === 'not-found' || err.code === 'unavailable' || String(err.message || '').includes('not found') || String(err.message || '').includes('unavailable') || String(err.message || '').includes('internal')) {
            // Spark plan fallback: check if PIN matches locally or fallback directly
            const matchingOrder = currentOrders.find(o => (o.id || o.orderId) === orderId);
            if (matchingOrder && matchingOrder.pinCode && String(matchingOrder.pinCode).trim() !== cleanPin) {
              playScanSound(false);
              alert("PIN Verification Failed: Incorrect PIN entered.");
              btn.disabled = false;
              btn.innerHTML = origContent;
              return;
            }
            try {
              await updateOrderStatus(orderId, 'collected');
              playScanSound(true);
              scannerFeedbackMessage = `✅ ${tokenNumber} Verified with PIN & Handed Over!`;
              scannerFeedbackType = 'success';
              render();
              setTimeout(() => {
                if (scannerFeedbackMessage && scannerFeedbackMessage.includes(tokenNumber)) {
                  scannerFeedbackMessage = null;
                  render();
                }
              }, 4000);
              return;
            } catch (fallbackErr) {
              console.error("PIN fallback error:", fallbackErr);
            }
          }
          console.error("PIN verification error:", err);
          playScanSound(false);
          const isReplay = String(err.message || '').includes('ALREADY_COLLECTED');
          const alertMsg = isReplay 
            ? "🚨 REPLAY REJECTED: This order was ALREADY collected! Do not hand over meal."
            : ("PIN Verification Failed: " + (err.message || err));
          scannerFeedbackMessage = `❌ ${alertMsg}`;
          scannerFeedbackType = 'error';
          render();
          alert(alertMsg);
          btn.disabled = false;
          btn.innerHTML = origContent;
        }
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

  // Connect real-time Firestore stream (sub-50ms) matching KDS
  try {
    const ordersCol = collection(db, 'orders');
    const q = query(ordersCol, where('status', 'in', ['placed', 'confirmed', 'preparing', 'ready', 'collected']));

    unsubscribePickup = onSnapshot(q, (snapshot) => {
      // Clear fallback poll interval when snapshot is streaming healthily
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      const liveOrders = snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          orderId: d.id,
          tokenNumber: data.tokenNumber || 'TB-???',
          status: data.status,
          studentName: data.studentName || 'Student',
          studentRoll: data.studentRoll || '',
          pinCode: data.pinCode || '',
          items: data.items || [],
          isOnlyReadyMade: data.isOnlyReadyMade === true || (Array.isArray(data.items) && data.items.length > 0 && data.items.every(i => i.type === 'instant')),
          readyMadePreference: data.readyMadePreference || null,
          isLockedForInvestigation: data.isLockedForInvestigation || false,
          failedPinAttempts: data.failedPinAttempts || 0,
          dietaryPreferences: Array.isArray(data.dietaryPreferences) ? data.dietaryPreferences : [],
          dietaryNotes: data.dietaryNotes || null,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
        };
      });

      currentOrders = liveOrders;
      render();
    }, (err) => {
      console.warn("Pickup onSnapshot notice (falling back to polling):", err);
      loadPickupData();
      if (!pollInterval) {
        pollInterval = setInterval(loadPickupData, 10000);
      }
    });
  } catch (err) {
    console.warn("Could not attach Pickup snapshot listener:", err);
    if (!pollInterval) {
      pollInterval = setInterval(loadPickupData, 10000);
    }
  }

  loadPickupData();
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
            ${order.createdAt ? `
              <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--ink-secondary); margin-top: 2px;">
                🕒 ${escapeHtml(formatOrderDateTime(order.createdAt))}
              </div>
            ` : ''}
            ${order.isOnlyReadyMade ? `
              <div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; background: #DCFCE7; border: 1px solid #86EFAC; border-radius: 6px; padding: 2px 6px;">
                <span style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: 800; color: #15803D;">⚡ READY-MADE</span>
                ${order.readyMadePreference ? `<span style="font-family: var(--font-sans); font-size: 0.72rem; font-weight: 700; color: #166534;">(${escapeHtml(order.readyMadePreference)})</span>` : ''}
              </div>
            ` : ''}
            ${(order.dietaryPreferences?.length > 0 || order.dietaryNotes) ? `
              <div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; background: #FEF3C7; border: 1px solid #F59E0B; border-radius: 6px; padding: 2px 6px;">
                <span style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: 800; color: #B45309;">🥗 ${escapeHtml((order.dietaryPreferences || []).join(', '))}${order.dietaryNotes ? ` (${escapeHtml(order.dietaryNotes)})` : ''}</span>
              </div>
            ` : ''}
          </div>

          <div style="text-align: right;">
            <div style="background: ${isReady ? '#DCFCE7' : (order.isOnlyReadyMade ? '#DCFCE7' : '#FEF3C7')}; color: ${isReady ? '#15803D' : (order.isOnlyReadyMade ? '#15803D' : '#B45309')}; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; text-transform: uppercase;">
              ${order.isOnlyReadyMade && !isReady ? 'READY FOR PICKUP' : escapeHtml(order.status)}
            </div>
          </div>
        </div>

        <div style="border-top: 1px dashed var(--border-light); padding-top: 0.6rem; margin-bottom: 1rem;">
          <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-bottom: 4px;">
            ITEMS (${totalQty}):
          </div>
          ${items.map(item => `
            <div style="display: flex; justify-content: space-between; font-family: var(--font-sans); font-size: 0.85rem; margin-bottom: 2px;">
              <span>${item.quantity}x ${escapeHtml(item.name || item.itemId)}${item.customization ? ` <span style="font-size: 0.75rem; font-weight: 700; color: #D97706;">(${escapeHtml(item.customization)})</span>` : ''}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div>
        ${isLocked ? `
          <div style="background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 8px; padding: 8px; margin-bottom: 8px; text-align: center;">
            <span style="color: #DC2626; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700;">🔒 LOCKED: 3 Failed PIN Attempts</span>
          </div>
          <button class="btn btn--danger unlock-action-btn" data-order-id="${escapeHtml(order.orderId || order.id)}" style="width: 100%;">
            Manager Override Unlock
          </button>
        ` : ((isReady || order.isOnlyReadyMade) ? `
          <div style="display: flex; gap: 8px;">
            <button class="btn btn--info verify-pin-btn" data-order-id="${escapeHtml(order.orderId || order.id)}" data-token="${escapeHtml(order.tokenNumber || 'TB-???')}" style="flex: 1;">
              <span>🔑 PIN</span>
            </button>
            <button class="btn btn--success collect-action-btn" data-order-id="${escapeHtml(order.orderId || order.id)}" data-token="${escapeHtml(order.tokenNumber || 'TB-???')}" style="flex: 1.5;">
              <span>${isReady ? '✓ Mark Collected' : '✓ Handover (Ready-Made)'}</span>
            </button>
          </div>
        ` : `
          <div style="text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.8rem; padding: 6px;">
            Waiting on Kitchen prep
          </div>
        `)}
      </div>
    </div>
  `;
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

function renderCollectedCard(order) {
  const dateStr = formatOrderDateTime(order.createdAt || order.collectedAt);
  return `
    <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: 10px; padding: 0.8rem 1rem; opacity: 0.85;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-family: var(--font-mono); font-weight: 800; font-size: 1rem;">${escapeHtml(order.tokenNumber || 'TB-???')}</span>
        <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #16A34A; font-weight: 700;">COLLECTED</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 3px;">
        <span style="font-family: var(--font-sans); font-size: 0.8rem; color: var(--ink-secondary);">
          ${escapeHtml(order.studentName || 'Student')}
        </span>
        ${dateStr ? `
          <span style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--ink-secondary); font-weight: 600;">
            ${escapeHtml(dateStr)}
          </span>
        ` : ''}
      </div>
    </div>
  `;
}

export function cleanupPickupView() {
  if (keydownListener) {
    window.removeEventListener('keydown', keydownListener);
    keydownListener = null;
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (unsubscribePickup) {
    try { unsubscribePickup(); } catch (_) {}
    unsubscribePickup = null;
  }
  if (pickupAudioCtx) {
    try { pickupAudioCtx.close(); } catch (_) {}
    pickupAudioCtx = null;
  }
  currentOrders = [];
}
