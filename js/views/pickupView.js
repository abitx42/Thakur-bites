// Phase 10 & Platform 2.0 — Counter Pickup & Dispatch View with Hardware Barcode/QR Scanner Engine
import { db, fetchPickupOrders, unlockOrder, functions, cancelStaffOrder, processStaffRefund } from '../firebase.js?v=5';
import { collection, query, where, onSnapshot, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { escapeHtml } from './escapeHtml.js';
import { getFriendlyErrorMessage } from '../networkSentinel.js';

const inFlightOrderIds = new Set();
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

function displayQuantity(value) {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100 ? quantity : 1;
}

function isOrderReadyForPickup(order) {
  const isPaid = order.paymentStatus === 'paid' || order.paymentStatus === 'captured';
  return isPaid && (order.status === 'ready' ||
    (order.isOnlyReadyMade === true && ['placed', 'paid', 'confirmed', 'preparing'].includes(order.status)));
}

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

  // Deterministic 32-bit FNV-1a Hash (100% binary matching Dart client)
  function computeFnv1a32(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  async function verifyPickupCredential(orderId, credential) {
    const verifyFn = httpsCallable(functions, 'verifyPickup');
    const result = await verifyFn({ orderId, ...credential });
    if (result.data?.success !== true || result.data?.status !== 'collected') {
      throw new Error('Pickup verification was not confirmed. Do not hand over the meal.');
    }
    return result.data;
  }

  // ═══════════════════════════════════════════════════════════════
  // HARDWARE 2D BARCODE & QR SCANNER ENGINE (HID Keystroke Stream)
  // ═══════════════════════════════════════════════════════════════
  async function handleScannedPayload(payload) {
    if (typeof payload !== 'string' || payload.length > 2048) return;
    const cleanPayload = payload.trim();
    if (!cleanPayload) return;

    // 1. Check if it's a mobile app QR Token (TB:orderId:tokenNumber:pinCode[:timeBlock:totpHash])
    if (cleanPayload.startsWith('TB:')) {
      const parts = cleanPayload.split(':');
      const orderId = parts[1];
      const tokenNumber = parts[2] || orderId;
      const pinCode = parts[3] || '';
      const timeBlock = parts.length === 6 ? Number(parts[4]) : null;
      const totpHash = parts[5] || null;

      if (![4, 6].includes(parts.length) || !orderId || orderId.length > 128 || orderId.includes('/') ||
          !/^\d{4,8}$/.test(pinCode) ||
          (parts.length === 6 && (!Number.isSafeInteger(timeBlock) || !/^[A-F0-9]{8}$/.test(totpHash || '')))) {
        playScanSound(false);
        scannerFeedbackMessage = '❌ Invalid pickup pass. Scan the customer QR or enter their pickup PIN.';
        scannerFeedbackType = 'error';
        render();
        return;
      }

      // Anti-Fraud 30-Second Dynamic Rotating TOTP Verification (Anti-Screenshot)
      if (timeBlock !== null && totpHash) {
        const currentTimeBlock = Math.floor(Date.now() / 30000);
        // Allow +/- 1 window (approx 60s total validity window) to prevent false rejections from slight clock difference
        if (Math.abs(currentTimeBlock - timeBlock) > 1) {
          playScanSound(false);
          const secondsDiff = Math.abs(currentTimeBlock - timeBlock) * 30;
          scannerFeedbackMessage = `🚨 EXPIRED PASS: Stale QR scanned (~${secondsDiff}s old)! Screenshots are prohibited. Please scan the live app screen.`;
          scannerFeedbackType = 'error';
          render();
          setTimeout(() => { scannerFeedbackMessage = null; render(); }, 6000);
          return;
        }

        const expectedHash = computeFnv1a32(`${orderId}:${pinCode}:${timeBlock}`);
        if (expectedHash !== totpHash) {
          playScanSound(false);
          scannerFeedbackMessage = `🚨 SECURITY ALERT: QR Code integrity hash mismatch! Potential counterfeit QR ticket.`;
          scannerFeedbackType = 'error';
          render();
          setTimeout(() => { scannerFeedbackMessage = null; render(); }, 6000);
          return;
        }
      }

      if (inFlightOrderIds.has(orderId)) return;
      inFlightOrderIds.add(orderId);
      scannerFeedbackMessage = `⚡ Verifying Order ${tokenNumber}...`;
      scannerFeedbackType = 'success';
      render();

      try {
        await verifyPickupCredential(orderId, { pinCode });
        playScanSound(true);

        // Update local state immediately
        const idx = currentOrders.findIndex(o => (o.orderId || o.id) === orderId);
        if (idx !== -1) {
          currentOrders[idx].status = 'collected';
          currentOrders[idx].collectedAt = new Date();
        }

        scannerFeedbackMessage = `✅ Order ${tokenNumber} Verified & Handed Over!`;
        scannerFeedbackType = 'success';
        render();

        setTimeout(() => {
          scannerFeedbackMessage = null;
          render();
        }, 4000);
      } catch (err) {
        playScanSound(false);
        scannerFeedbackMessage = `❌ Verification Failed: ${getFriendlyErrorMessage(err, 'Invalid PIN or unready order')}`;
        scannerFeedbackType = 'error';
        render();

        setTimeout(() => {
          scannerFeedbackMessage = null;
          render();
        }, 6000);
      } finally {
        inFlightOrderIds.delete(orderId);
      }
      return;
    }

    // 2. Check if it's a signed QR Token (orderId.studentId.nonce.expiresAt.sig)
    if (cleanPayload.includes('.')) {
      const parts = cleanPayload.split('.');
      const orderId = parts[0];
      if (parts.length !== 5 || !orderId || orderId.length > 128 || orderId.includes('/')) {
        playScanSound(false);
        scannerFeedbackMessage = '❌ Invalid signed pickup QR. Please scan the customer pickup pass again.';
        scannerFeedbackType = 'error';
        render();
        return;
      }
      if (inFlightOrderIds.has(orderId)) return;
      inFlightOrderIds.add(orderId);

      try {
        const result = await verifyPickupCredential(orderId, { qrToken: cleanPayload });
        playScanSound(true);

        const idx = currentOrders.findIndex(o => (o.orderId || o.id) === orderId);
        if (idx !== -1) {
          currentOrders[idx].status = 'collected';
          currentOrders[idx].collectedAt = new Date();
        }

        scannerFeedbackMessage = `✅ Order ${result.tokenNumber || orderId} Verified & Collected!`;
        scannerFeedbackType = 'success';
        render();

        setTimeout(() => {
          scannerFeedbackMessage = null;
          render();
        }, 4000);
      } catch (err) {
        playScanSound(false);
        const isReplay = String(err.message || '').includes('ALREADY_COLLECTED');
        if (isReplay) {
          scannerFeedbackMessage = `🚨 REPLAY DETECTED: Order already collected! Do not hand over meal.`;
        } else {
          scannerFeedbackMessage = `❌ Scan Error: ${getFriendlyErrorMessage(err, 'Invalid or already consumed QR Token')}`;
        }
        scannerFeedbackType = 'error';
        render();

        setTimeout(() => {
          scannerFeedbackMessage = null;
          render();
        }, 6000);
      } finally {
        inFlightOrderIds.delete(orderId);
      }
      return;
    }

    // 3. Exact Token Number or Barcode Scan (e.g. "TB-042", "042", "42")
    const normalizedToken = cleanPayload.replace(/^#/, '').toUpperCase();
    const matchedReadyOrder = currentOrders.find(o => 
      isOrderReadyForPickup(o) &&
      (o.tokenNumber?.toUpperCase() === normalizedToken || 
       o.tokenNumber?.toUpperCase() === `TB-${normalizedToken}` ||
       String(o.tokenNumber || '').endsWith(normalizedToken))
    );
    if (matchedReadyOrder) {
      searchFilter = matchedReadyOrder.tokenNumber || cleanPayload;
      render();
      playScanSound(true);
      return;
    }

    // A token number only finds an order; it never authorizes handover.
    if (/^\d{4,8}$/.test(cleanPayload)) {
      scannerFeedbackMessage = '🔑 PIN-only scan: find the order by token, then choose Verify PIN & Collect, or scan the full pickup QR.';
      scannerFeedbackType = 'error';
      render();
    }
  }

  keydownListener = (e) => {
    const targetTag = e.target?.tagName;
    const isFilterInput = e.target?.id === 'pickup-filter-input';

    // Ignore input if user is actively typing in another input (like refund modal, textarea, etc.)
    if ((targetTag === 'INPUT' && !isFilterInput) || targetTag === 'TEXTAREA' || targetTag === 'SELECT' || e.target?.isContentEditable) {
      return;
    }

    const currentTime = Date.now();
    const interval = currentTime - lastKeypressTime;
    lastKeypressTime = currentTime;

    if (e.key === 'Enter') {
      let scanned = scannerBuffer.trim();
      // If focused on filter input and input starts with TB: or was rapid scan
      if (isFilterInput && e.target && e.target.value) {
        const val = e.target.value.trim();
        if (val.startsWith('TB:') || val.includes('.') || (scanned.length > 2 && val.includes(scanned))) {
          scanned = val;
          e.target.value = '';
          searchFilter = '';
        }
      }
      scannerBuffer = '';
      if (scanned.length > 2) {
        handleScannedPayload(scanned);
      }
    } else if (e.key.length === 1) {
      // Hardware barcode scanner inter-character latency is typically < 75ms
      if (interval < 75 || scannerBuffer.length === 0) {
        scannerBuffer = scannerBuffer.length < 2048 ? scannerBuffer + e.key : '';
      } else {
        // Human typing reset
        scannerBuffer = e.key;
      }
    }
  };

  window.addEventListener('keydown', keydownListener);

  function openRefundModal(orderId, tokenNumber, maxAmount) {
    const existing = document.getElementById('tb-refund-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'tb-refund-modal';
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
            <span>💸</span> Issue Refund (${escapeHtml(tokenNumber)})
          </h3>
          <button id="close-refund-modal-btn" style="background: none; border: none; font-size: 1.4rem; cursor: pointer; color: var(--ink-secondary);">&times;</button>
        </div>
        
        <p style="font-size: 0.85rem; color: var(--ink-secondary); margin-bottom: 1.2rem; line-height: 1.4;">
          Authoritatively issue a refund for order <strong>${escapeHtml(tokenNumber)}</strong> via Cloud Function ledger.
        </p>

        <div style="margin-bottom: 1rem;">
          <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-primary); margin-bottom: 4px;">
            REFUND AMOUNT (₹):
          </label>
          <input 
            type="number" 
            id="refund-amount-input" 
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
            id="refund-reason-input" 
            value="Customer requested refund at counter" 
            placeholder="e.g. Item unavailable, wrong order, quality issue" 
            style="width: 100%; padding: 8px 12px; border: 1.5px solid var(--border-light); border-radius: 8px; font-family: var(--font-sans); font-size: 0.9rem; box-sizing: border-box;"
          />
        </div>

        <div style="display: flex; gap: 10px;">
          <button id="cancel-refund-modal-btn" class="btn btn--secondary" style="flex: 1;">Cancel</button>
          <button id="confirm-refund-modal-btn" class="btn btn--danger" style="flex: 1.5;">Confirm Refund</button>
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
    modal.querySelector('#close-refund-modal-btn')?.addEventListener('click', close);
    modal.querySelector('#cancel-refund-modal-btn')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    modal.querySelector('#confirm-refund-modal-btn')?.addEventListener('click', async () => {
      const confirmBtn = modal.querySelector('#confirm-refund-modal-btn');
      const amtStr = modal.querySelector('#refund-amount-input').value.trim();
      const reason = modal.querySelector('#refund-reason-input').value.trim() || 'Counter refund';
      const amt = parseFloat(amtStr);

      if (isNaN(amt) || amt <= 0) {
        alert('Please enter a valid refund amount in ₹');
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Processing...';

      try {
        inFlightOrderIds.add(orderId);
        const amountPaise = Math.round(amt * 100);
        await processStaffRefund({ orderId, reason, amountPaise });
        playScanSound(true);
        close();
        scannerFeedbackMessage = `💸 Refund of ₹${amt.toFixed(2)} processed for ${tokenNumber}!`;
        scannerFeedbackType = 'success';
        await loadPickupData();
        setTimeout(() => {
          if (scannerFeedbackMessage && scannerFeedbackMessage.includes(tokenNumber)) {
            scannerFeedbackMessage = null;
            render();
          }
        }, 5000);
      } catch (err) {
        console.error('Refund processing error:', err);
        playScanSound(false);
        alert('Refund Failed: ' + (err.message || err));
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm Refund';
      } finally {
        inFlightOrderIds.delete(orderId);
      }
    });
  }

  function buildOrdersSectionsHtml(readyOrders, kitchenOrders, collectedOrders, cleanSearch) {
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

    return `
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
    `;
  }

  function attachOrderListeners(scopeEl) {
    const historyToggle = scopeEl.querySelector('#toggle-history-btn');
    if (historyToggle) {
      historyToggle.addEventListener('click', () => {
        showCollectedHistory = !showCollectedHistory;
        updateOrdersSection();
      });
    }

    scopeEl.querySelectorAll('.verify-pin-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        const tokenNumber = btn.getAttribute('data-token') || 'Order';
        if (inFlightOrderIds.has(orderId)) return;

        const enteredPin = prompt(`Enter the customer's 4-8 digit pickup PIN for ${tokenNumber}:`);
        if (!enteredPin) return;

        const cleanPin = enteredPin.trim();
        if (!/^\d{4,8}$/.test(cleanPin)) {
          alert('Invalid PIN format: PIN must be 4 to 8 numeric digits.');
          return;
        }

        inFlightOrderIds.add(orderId);
        const origContent = btn.innerHTML;
        btn.textContent = 'Verifying...';
        btn.disabled = true;

        try {
          await verifyPickupCredential(orderId, { pinCode: cleanPin });

          playScanSound(true);
          scannerFeedbackMessage = `✅ ${tokenNumber} Verified with PIN & Collected!`;
          scannerFeedbackType = 'success';
          await loadPickupData();
          render();
          setTimeout(() => {
            if (scannerFeedbackMessage && scannerFeedbackMessage.includes(tokenNumber)) {
              scannerFeedbackMessage = null;
              render();
            }
          }, 4000);
        } catch (err) {
          console.error("PIN verification error:", err);
          playScanSound(false);
          const isReplay = String(err.message || '').includes('ALREADY_COLLECTED');
          const alertMsg = isReplay 
            ? "🚨 REPLAY REJECTED: This order was ALREADY collected! Do not hand over meal."
            : ("PIN Verification Failed: " + getFriendlyErrorMessage(err, 'Incorrect PIN or unready order.'));
          scannerFeedbackMessage = `❌ ${alertMsg}`;
          scannerFeedbackType = 'error';
          render();
          alert(alertMsg);
          btn.disabled = false;
          btn.innerHTML = origContent;
        } finally {
          inFlightOrderIds.delete(orderId);
        }
      });
    });

    scopeEl.querySelectorAll('.unlock-action-btn').forEach(btn => {
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

    scopeEl.querySelectorAll('.pickup-cancel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        const tokenNumber = btn.getAttribute('data-token') || 'Order';
        if (inFlightOrderIds.has(orderId)) return;

        const reason = prompt(`Enter cancellation reason for ${tokenNumber}:`, 'Customer requested cancellation at counter');
        if (!reason) return;

        const confirmed = confirm(`Are you sure you want to CANCEL ${tokenNumber}?\nThis will release reserved stock and notify the customer.`);
        if (!confirmed) return;

        inFlightOrderIds.add(orderId);
        const origContent = btn.innerHTML;
        btn.textContent = 'Cancelling...';
        btn.disabled = true;

        try {
          await cancelStaffOrder(orderId, reason);
          playScanSound(true);
          scannerFeedbackMessage = `🚫 Order ${tokenNumber} has been Cancelled.`;
          scannerFeedbackType = 'success';
          await loadPickupData();
          setTimeout(() => {
            if (scannerFeedbackMessage && scannerFeedbackMessage.includes(tokenNumber)) {
              scannerFeedbackMessage = null;
              render();
            }
          }, 4000);
        } catch (err) {
          console.error("Staff cancellation error:", err);
          playScanSound(false);
          alert("Cancellation Failed: " + (err.message || err));
          btn.disabled = false;
          btn.innerHTML = origContent;
        } finally {
          inFlightOrderIds.delete(orderId);
        }
      });
    });

    scopeEl.querySelectorAll('.pickup-refund-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const orderId = btn.getAttribute('data-order-id');
        const tokenNumber = btn.getAttribute('data-token') || 'Order';
        const rawAmt = btn.getAttribute('data-amount');
        const maxAmount = rawAmt ? parseFloat(rawAmt) : 0;
        openRefundModal(orderId, tokenNumber, maxAmount);
      });
    });
  }

  function updateOrdersSection() {
    const ordersContainer = container.querySelector('#pickup-orders-container');
    if (!ordersContainer) {
      render();
      return;
    }
    const cleanSearch = searchFilter.trim().toLowerCase().replace('#', '');
    const activeOrders = currentOrders.filter(o => o.status !== 'collected' && o.status !== 'cancelled');
    const collectedOrders = currentOrders.filter(o => o.status === 'collected');
    const readyOrders = activeOrders.filter(isOrderReadyForPickup);
    const kitchenOrders = activeOrders.filter(o => !isOrderReadyForPickup(o));

    ordersContainer.innerHTML = buildOrdersSectionsHtml(readyOrders, kitchenOrders, collectedOrders, cleanSearch);
    attachOrderListeners(ordersContainer);

    // Update clear button visibility
    const clearBtnWrapper = container.querySelector('#filter-clear-wrapper');
    if (clearBtnWrapper) {
      clearBtnWrapper.innerHTML = searchFilter ? `
        <button id="clear-filter-btn" class="btn btn--secondary btn--sm">
          Clear
        </button>
      ` : '';
      const newClearBtn = container.querySelector('#clear-filter-btn');
      if (newClearBtn) {
        newClearBtn.addEventListener('click', () => {
          searchFilter = '';
          const filterInput = container.querySelector('#pickup-filter-input');
          if (filterInput) filterInput.value = '';
          updateOrdersSection();
        });
      }
    }
  }

  function render() {
    const filterInputNow = container.querySelector('#pickup-filter-input');
    if (filterInputNow && document.activeElement === filterInputNow) {
      updateOrdersSection();
      return;
    }

    const cleanSearch = searchFilter.trim().toLowerCase().replace('#', '');
    const activeOrders = currentOrders.filter(o => o.status !== 'collected' && o.status !== 'cancelled');
    const collectedOrders = currentOrders.filter(o => o.status === 'collected');
    const readyOrders = activeOrders.filter(isOrderReadyForPickup);
    const kitchenOrders = activeOrders.filter(o => !isOrderReadyForPickup(o));

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1200px; margin: 0 auto; padding: 1.5rem 1rem;">
        
        <!-- Header with Live Stats -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.04em; margin: 0; line-height: 1;">
                FOOD PICKUP COUNTER
              </h2>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.9rem; color: var(--ink-secondary); margin-top: 4px; font-weight: 500;">
              Scan the customer's pickup QR or <strong>verify their PIN</strong> before handing over food.
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
              <span style="font-size: 0.8rem; font-weight: 800; letter-spacing: 0.08em; padding: 4px 12px; border-radius: var(--radius-pill, 999px); background: ${scannerFeedbackType === 'success' ? 'rgba(22, 163, 74, 0.15)' : 'rgba(220, 38, 38, 0.15)'}; color: ${scannerFeedbackType === 'success' ? '#15803D' : '#DC2626'};">${scannerFeedbackMessage.startsWith('⚡') ? 'VERIFYING' : scannerFeedbackType === 'success' ? 'CONFIRMED' : 'REJECTED'}</span>
          </div>
        ` : ''}

        <!-- Quick Filter Input (Isolated from re-render thrash) -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 0.7rem 1.2rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <span style="font-size: 1.2rem;">🔍</span>
          <input 
            type="text" 
            id="pickup-filter-input" 
            placeholder="Scan pickup QR, or filter by Token # / Student Name..."
            value="${escapeHtml(searchFilter)}"
            style="flex: 1; border: none; outline: none; font-family: var(--font-mono); font-size: 1rem; font-weight: 600; color: var(--ink-primary); background: transparent;"
          />
          <div id="filter-clear-wrapper">
            ${searchFilter ? `
              <button id="clear-filter-btn" class="btn btn--secondary btn--sm">
                Clear
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Orders Container (Updated seamlessly on filter typing) -->
        <div id="pickup-orders-container">
          ${buildOrdersSectionsHtml(readyOrders, kitchenOrders, collectedOrders, cleanSearch)}
        </div>

      </div>
    `;

    // Attach search filter listener (debounced for high volume performance)
    const filterInput = container.querySelector('#pickup-filter-input');
    let filterDebounceTimer = null;
    if (filterInput) {
      filterInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const val = filterInput.value.trim();
          if (val.startsWith('TB:') || val.includes('.') || val.length >= 2) {
            e.preventDefault();
            e.stopPropagation();
            scannerBuffer = '';
            filterInput.value = '';
            searchFilter = '';
            handleScannedPayload(val);
          }
        }
      });
      filterInput.addEventListener('input', (e) => {
        if (filterDebounceTimer) clearTimeout(filterDebounceTimer);
        filterDebounceTimer = setTimeout(() => {
          searchFilter = e.target.value;
          updateOrdersSection();
        }, 180);
      });
    }

    const clearBtn = container.querySelector('#clear-filter-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        searchFilter = '';
        const input = container.querySelector('#pickup-filter-input');
        if (input) input.value = '';
        updateOrdersSection();
      });
    }

    const ordersContainer = container.querySelector('#pickup-orders-container');
    if (ordersContainer) {
      attachOrderListeners(ordersContainer);
    }
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
    const q = query(ordersCol, where('status', 'in', ['placed', 'confirmed', 'preparing', 'ready', 'collected']), limit(100));

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
          paymentStatus: data.paymentStatus,
          studentName: data.studentName || 'Student',
          studentRoll: data.studentRoll || '',
          items: data.items || [],
          isOnlyReadyMade: data.isOnlyReadyMade === true,
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
  const totalQty = items.reduce((s, i) => s + displayQuantity(i.quantity), 0);

  return `
    <div class="pickup-order-card" style="background: #FFF; border: 1.5px solid ${isReady ? '#86EFAC' : 'var(--border-light)'}; border-radius: 14px; padding: 1.2rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03); display: flex; flex-direction: column; justify-content: space-between;">
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem;">
          <div>
            <div style="font-family: var(--font-mono); font-size: 1.4rem; font-weight: 800; color: var(--ink-primary);">
              ${escapeHtml(order.tokenNumber || 'TB-???')}
            </div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 3px; flex-wrap: wrap;">
              <span style="font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; color: var(--ink-secondary);">
                ${escapeHtml(order.studentName || 'Student')}
              </span>
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
            <div style="background: ${isReady ? '#DCFCE7' : '#FEF3C7'}; color: ${isReady ? '#15803D' : '#B45309'}; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; text-transform: uppercase;">
              ${escapeHtml(order.status)}
            </div>
          </div>
        </div>

        <div style="border-top: 1px dashed var(--border-light); padding-top: 0.6rem; margin-bottom: 1rem;">
          <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-bottom: 4px;">
            ITEMS (${totalQty}):
          </div>
          ${items.map(item => {
            const isInstant = item.type === 'instant' || (!item.type && ((item.category || '').toLowerCase().includes('drink') || (item.category || '').toLowerCase().includes('bottle')));
            const quantity = displayQuantity(item.quantity);
            return `
            <div style="display: flex; justify-content: space-between; align-items: center; font-family: var(--font-sans); font-size: 0.85rem; margin-bottom: 3px;">
              <span><strong>${quantity}x</strong> ${escapeHtml(item.name || item.itemId)}${item.customization ? ` <span style="font-size: 0.75rem; font-weight: 700; color: #D97706;">(${escapeHtml(item.customization)})</span>` : ''}</span>
              ${isInstant ? `<span style="font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; color: #0284C7; background: #E0F2FE; padding: 1px 6px; border-radius: 4px;">📦 Packaged</span>` : ''}
            </div>
          `;
          }).join('')}
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
        ` : (isReady ? `
          <div style="display: flex; gap: 8px;">
            <button class="btn btn--success verify-pin-btn" data-order-id="${escapeHtml(order.orderId || order.id)}" data-token="${escapeHtml(order.tokenNumber || 'TB-???')}" title="Enter the customer's pickup PIN, or scan their QR" style="flex: 1; font-size: 0.95rem; font-weight: 800; padding: 10px 14px; border-radius: 8px;">
              <span>🔑 Verify PIN & Collect</span>
            </button>
          </div>
        ` : `
          <div style="text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.8rem; padding: 6px;">
            ${order.paymentStatus === 'paid' || order.paymentStatus === 'captured' ? 'Waiting on Kitchen prep' : 'Waiting for confirmed payment'}
          </div>
        `)}

        <!-- Quick Staff Overrides (Cancel & Refund) -->
        <div style="display: flex; gap: 8px; margin-top: 8px; border-top: 1px solid var(--border-light); padding-top: 8px;">
          <button class="btn btn--outline-danger btn--sm pickup-cancel-btn" data-order-id="${escapeHtml(order.orderId || order.id)}" data-token="${escapeHtml(order.tokenNumber || 'TB-???')}" style="flex: 1; font-size: 0.8rem; font-weight: 700; padding: 6px 8px; border-radius: 8px;">
            🚫 Cancel Order
          </button>
          <button class="btn btn--secondary btn--sm pickup-refund-btn" data-order-id="${escapeHtml(order.orderId || order.id)}" data-token="${escapeHtml(order.tokenNumber || 'TB-???')}" data-amount="${escapeHtml(order.totalAmount || (order.totalAmountPaise ? order.totalAmountPaise / 100 : ''))}" style="flex: 1; font-size: 0.8rem; font-weight: 700; padding: 6px 8px; border-radius: 8px;">
            💸 Issue Refund
          </button>
        </div>
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
    <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: 10px; padding: 0.8rem 1rem; opacity: 0.9;">
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
      <div style="display: flex; justify-content: flex-end; margin-top: 6px; border-top: 1px dashed var(--border-light); padding-top: 4px;">
        <button class="btn btn--secondary btn--sm pickup-refund-btn" data-order-id="${escapeHtml(order.orderId || order.id)}" data-token="${escapeHtml(order.tokenNumber || 'TB-???')}" data-amount="${escapeHtml(order.totalAmount || (order.totalAmountPaise ? order.totalAmountPaise / 100 : ''))}" style="font-size: 0.72rem; padding: 2px 8px;">
          💸 Issue Refund
        </button>
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
