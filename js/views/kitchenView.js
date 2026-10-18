// Thakur Bites Platform 2.0 — High-Performance Kitchen Display System (KDS)
// Features: Zero-Miss Order Stream (including payment_pending, placed, confirmed, preparing),
// Sequential One-by-One Queue Pipeline with "Now Cooking" Spotlight & "Up Next" Waiting Pile,
// Auto-Progression ("as one completes other gets up next"), Smart Cooking Batches,
// Station-Filtered Views, Dynamic Priority Aging, and Web Audio Alerts.

import { db, functions, fetchKitchenOrders, updateOrderStatus, syncPublicLiveQueue, cancelStaffOrder } from '../firebase.js?v=6';
import { collection, onSnapshot, query, where, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { escapeHtml } from './escapeHtml.js';
import { getFriendlyErrorMessage } from '../networkSentinel.js';

const inFlightOrderIds = new Set();
let pollInterval = null;
let unsubscribeOrders = null;
let currentOrders = [];
let selectedCategoryFilter = 'all';
let viewMode = 'pipeline'; // 'pipeline' (sequential pile) or 'grid' (all tickets)
let focusedOrderId = null; // User manual focus override if desired
let isInitialSyncDone = false;
let audioAlertsEnabled = localStorage.getItem('tb_kds_audio_enabled') !== 'false'; // default ON
let kitchenVoiceEnabled = localStorage.getItem('tb_kds_voice_enabled') !== 'false'; // default ON for 3 chefs
const announcedKitchenOrders = new Set();
let kitchenAudioCtx = null;
let kitchenKeydownHandler = null;
let autoCookTimeout = null;
let tokenKeyBuffer = '';
let tokenKeyTimer = null;

function speakKitchenOrder(order) {
  if (!kitchenVoiceEnabled || !('speechSynthesis' in window)) return;
  if (!order || !order.items || order.items.length === 0) return;

  setTimeout(() => {
    try {
      window.speechSynthesis.cancel();
      const token = (order.tokenNumber || '').replace(/^TB-?0*/i, 'Token ');
      const itemsList = (order.items || []).map(i => `${i.quantity || 1} ${i.name}`).join(', and ');
      const text = `New ${token}: ${itemsList}`;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.05;
      utterance.lang = 'en-IN';
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => v.lang.includes('en-IN') || v.lang.includes('hi-IN')) || voices.find(v => v.lang.startsWith('en'));
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    } catch (_) {}
  }, 700);
}

function showKdsToast(message) {
  let toastEl = document.getElementById('kds-toast-notification');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'kds-toast-notification';
    toastEl.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      background: #0F172A;
      color: #F8FAFC;
      font-family: var(--font-mono, monospace);
      font-size: 0.95rem;
      font-weight: 700;
      padding: 12px 20px;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      border: 1.5px solid #334155;
      display: flex;
      align-items: center;
      gap: 10px;
      opacity: 0;
      transform: translateY(12px);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
    `;
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.style.opacity = '1';
  toastEl.style.transform = 'translateY(0)';
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateY(12px)';
  }, 2500);
}

function getKitchenAudioContext() {
  try {
    if (!kitchenAudioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) kitchenAudioCtx = new AudioCtx();
    }
    if (kitchenAudioCtx && kitchenAudioCtx.state === 'suspended') {
      kitchenAudioCtx.resume().catch(() => {});
    }
    return kitchenAudioCtx;
  } catch (_) {
    return null;
  }
}

// Synthesize pleasant kitchen chime using Web Audio API (zero external assets needed)
function playKitchenOrderChime() {
  if (!audioAlertsEnabled) return;
  try {
    const ctx = getKitchenAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.12); // A5
    osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.24); // D6

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.onended = () => {
      try {
        gain.disconnect();
        osc.disconnect();
      } catch (_) {}
    };

    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) {
    // Audio contexts may require user interaction first
  }
}

export function renderKitchenView(container) {
  // Clean up any prior subscriptions & intervals
  if (unsubscribeOrders) {
    try { unsubscribeOrders(); } catch (_) {}
    unsubscribeOrders = null;
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  function renderKDS() {
    // 1. Filter all active uncompleted orders (never drop or miss any order)
    const activeOrders = currentOrders.filter(o => o.status !== 'collected' && o.status !== 'cancelled');

    // 2. Cook Queue: Only confirmed and paid orders that require kitchen cooking
    // (excludes payment_pending orders and 100% packaged store items)
    const cookOrders = activeOrders.filter(o => {
      const isCookingState = (o.status === 'placed' || o.status === 'preparing' || o.status === 'confirmed' || o.status === 'paid') && !o.isOnlyReadyMade;
      if (!isCookingState) return false;
      if (selectedCategoryFilter === 'all') return true;
      return o.items && o.items.some(i => {
        const name = (i.name || '').toLowerCase();
        const cat = (i.category || '').toLowerCase();
        const sub = (i.subCategory || '').toLowerCase();
        const station = (i.station || '').toLowerCase();
        return name.includes(selectedCategoryFilter) || cat.includes(selectedCategoryFilter) || sub.includes(selectedCategoryFilter) || station === selectedCategoryFilter;
      });
    });

    // Dynamic Effective Priority Score calculation: Base + (WaitMinutes * 5)
    function computeEffectiveScore(order) {
      if (typeof order.effectivePriority === 'number') {
        return order.effectivePriority;
      }
      const base = (order.priorityLevel || 1) * 100;
      const createdAtMs = order.createdAt ? new Date(order.createdAt).getTime() : Date.now();
      const waitMinutes = Math.max(0, (Date.now() - createdAtMs) / 60000);
      return base + Math.floor(waitMinutes * 5);
    }

    // 3. Sort: Manual focus pin first, then actively preparing, then highest effective priority, then earliest created (FIFO)
    cookOrders.sort((a, b) => {
      const aId = a.orderId || a.id;
      const bId = b.orderId || b.id;
      if (focusedOrderId && aId === focusedOrderId) return -1;
      if (focusedOrderId && bId === focusedOrderId) return 1;

      const isPrepA = a.status === 'preparing';
      const isPrepB = b.status === 'preparing';
      if (isPrepA && !isPrepB) return -1;
      if (isPrepB && !isPrepA) return 1;

      const scoreA = computeEffectiveScore(a);
      const scoreB = computeEffectiveScore(b);
      if (scoreB !== scoreA) return scoreB - scoreA;
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });

    // Clean up focus if that order is no longer in cook queue
    if (focusedOrderId && !cookOrders.some(o => (o.orderId || o.id) === focusedOrderId)) {
      focusedOrderId = null;
    }

    // 4. Split into Hero Spotlight (#1) and The Pile (#2, #3, ...)
    const heroOrder = cookOrders.length > 0 ? cookOrders[0] : null;
    const waitingPile = cookOrders.length > 1 ? cookOrders.slice(1) : [];

    // Ready Queue: ready for pickup at counter
    const readyOrders = activeOrders.filter(o => o.status === 'ready');

    // Smart Kitchen Batching Intelligence: Aggregate item totals across tickets (filtered to station if active)
    const batchCounts = {};
    cookOrders.forEach(o => {
      (o.items || []).forEach(i => {
        const name = (i.name || '').toLowerCase();
        const cat = (i.category || '').toLowerCase();
        const sub = (i.subCategory || '').toLowerCase();
        const station = (i.station || '').toLowerCase();
        if (selectedCategoryFilter !== 'all') {
          const matches = name.includes(selectedCategoryFilter) || cat.includes(selectedCategoryFilter) || sub.includes(selectedCategoryFilter) || station === selectedCategoryFilter;
          if (!matches) return;
        }
        const key = i.name || 'Item';
        batchCounts[key] = (batchCounts[key] || 0) + (i.quantity || 1);
      });
    });
    const batchEntries = Object.entries(batchCounts).sort((a, b) => b[1] - a[1]);
    const totalItemsOnStove = batchEntries.reduce((sum, [, q]) => sum + q, 0);

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1400px; margin: 0 auto; padding: 1.5rem 1rem;">
        
        <!-- KDS Control Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.2rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.04em; line-height: 1; margin: 0; color: var(--ink-primary);">
                KITCHEN ORDERS (TO COOK)
              </h2>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.9rem; color: var(--ink-secondary); margin-top: 4px; margin-bottom: 0; font-weight: 500;">
              Unified 3-chef production line. Tap <strong>+1 Done</strong> or <strong>All ✅</strong> to batch-plate!
            </p>
          </div>

          <!-- Controls: View Mode, Audio Alerts, Voice Toggle, Bump Bar & Quick Stats -->
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            
            <!-- Physical Bump Bar Keyboard Indicator -->
            <div style="display: flex; align-items: center; gap: 8px; background: #0F172A; color: #FFF; padding: 6px 14px; border-radius: 10px; font-family: var(--font-mono); font-size: 0.78rem; border: 1.5px solid #334155;">
              <span style="color: #94A3B8;">⌨️ BUMP BAR:</span>
              <span style="background: #22C55E; color: #FFF; font-weight: 800; padding: 2px 7px; border-radius: 5px; box-shadow: 0 1px 3px rgba(34,197,94,0.4);">[SPACE / ENTER]</span>
              <span style="color: #CBD5E1;">= Next Ready</span>
              <span style="color: #475569; margin: 0 2px;">|</span>
              <span style="background: #F59E0B; color: #FFF; font-weight: 800; padding: 2px 6px; border-radius: 4px;">[+]</span>
              <span style="color: #CBD5E1;">= Cook</span>
            </div>

            <!-- View Mode Switcher -->
            <div style="display: flex; background: #F4F4F5; padding: 3px; border-radius: 10px; border: 1.5px solid var(--border-light);">
              <button id="view-mode-pipeline-btn" class="btn btn--sm ${viewMode === 'pipeline' ? 'btn--secondary' : 'btn--ghost'}" style="${viewMode === 'pipeline' ? 'background: #FFF; color: var(--brand-red);' : ''}">
                📋 Queue Pile
              </button>
              <button id="view-mode-grid-btn" class="btn btn--sm ${viewMode === 'grid' ? 'btn--secondary' : 'btn--ghost'}" style="${viewMode === 'grid' ? 'background: #FFF; color: var(--brand-red);' : ''}">
                🔲 All Cards
              </button>
            </div>

            <button id="toggle-kds-audio-btn" class="btn btn--sm ${audioAlertsEnabled ? 'btn--info' : 'btn--secondary'}" title="Chime alert when new orders arrive">
              <span>${audioAlertsEnabled ? '🔔 Sound: ON' : '🔕 Sound: MUTED'}</span>
            </button>

            <button id="toggle-kds-voice-btn" class="btn btn--sm ${kitchenVoiceEnabled ? 'btn--info' : 'btn--secondary'}" title="Speaks new orders aloud for 3 chefs while cooking">
              <span>${kitchenVoiceEnabled ? '🗣️ Voice: ON' : '🔇 Voice: OFF'}</span>
            </button>

            ${focusedOrderId ? `
              <button id="clear-kds-focus-btn" class="btn btn--danger btn--sm tb-ambient-pulse" style="font-weight: 800; display: inline-flex; align-items: center; gap: 5px;">
                <span>✕</span> Show All (Reset Queue)
              </button>
            ` : ''}

            <button id="refresh-kds-manual-btn" class="btn btn--secondary btn--sm">
              🔄 Refresh
            </button>

            <div style="background: #FFF; border: 1.5px solid var(--border-light); padding: 8px 16px; border-radius: 10px; text-align: center; min-width: 75px;">
              <div style="font-family: var(--font-mono); font-size: 1.4rem; font-weight: 800; color: var(--brand-red); line-height: 1;">
                ${cookOrders.length}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--ink-secondary); text-transform: uppercase; font-weight: 700; margin-top: 2px;">
                To Cook
              </div>
            </div>

            <div style="background: #FFF; border: 1.5px solid var(--border-light); padding: 8px 16px; border-radius: 10px; text-align: center; min-width: 75px;">
              <div style="font-family: var(--font-mono); font-size: 1.4rem; font-weight: 800; color: #22C55E; line-height: 1;">
                ${readyOrders.length}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--ink-secondary); text-transform: uppercase; font-weight: 700; margin-top: 2px;">
                At Counter
              </div>
            </div>
          </div>
        </div>

        <!-- 👨‍🍳 3-CHEF BATCH PREP BOARD (Zero-Popup 1-Tap Knuckle Buttons) -->
        ${batchEntries.length > 0 ? `
          <div style="background: linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%); border: 2px solid #F59E0B; border-radius: 14px; padding: 14px 18px; margin-bottom: 1.4rem; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.12);">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 1.35rem;">👨‍🍳</span>
                <div>
                  <div style="font-family: var(--font-mono); font-size: 0.92rem; font-weight: 900; color: #92400E; letter-spacing: 0.03em;">
                    3-CHEF LIVE BATCH PREP BOARD
                  </div>
                  <div style="font-family: var(--font-sans); font-size: 0.78rem; font-weight: 600; color: #B45309;">
                    Sorted by stove quantity · 1-tap with knuckle/finger to advance queue (zero popups)
                  </div>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 900; background: #B45309; color: #FFF; padding: 4px 12px; border-radius: 8px; box-shadow: 0 2px 4px rgba(180, 83, 9, 0.25);">
                  🔥 ${totalItemsOnStove} TOTAL ITEMS ON STOVE
                </span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">
              ${batchEntries.map(([name, qty]) => `
                <div 
                  class="kds-batch-card"
                  style="background: #FFFFFF; border: 2px solid #FDE68A; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.04); transition: transform 0.1s ease, box-shadow 0.1s ease;"
                >
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <span style="font-family: var(--font-mono); font-size: 1.45rem; font-weight: 900; color: #92400E; background: #FEF3C7; border: 1.5px solid #F59E0B; padding: 4px 10px; border-radius: 8px; min-width: 44px; text-align: center;">
                      ${qty}x
                    </span>
                    <span style="font-family: var(--font-sans); font-size: 1.05rem; font-weight: 800; color: var(--ink-primary); flex: 1; margin-left: 6px; line-height: 1.25;">
                      ${escapeHtml(name)}
                    </span>
                  </div>

                  <div style="display: flex; gap: 8px; margin-top: 2px;">
                    <button 
                      class="kds-quick-plate-btn btn" 
                      data-action="single"
                      data-item-name="${escapeHtml(name)}"
                      data-count="1"
                      style="flex: 1; height: 42px; background: #F8FAFC; border: 1.5px solid #CBD5E1; color: #334155; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;"
                      title="Plate 1 item and advance oldest ticket"
                    >
                      <span>+1 Done</span>
                    </button>
                    <button 
                      class="kds-quick-plate-btn btn" 
                      data-action="all"
                      data-item-name="${escapeHtml(name)}"
                      data-count="${qty}"
                      style="flex: 1.4; height: 42px; background: #16A34A; border: 1.5px solid #15803D; color: #FFFFFF; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; box-shadow: 0 2px 4px rgba(22,163,74,0.25);"
                      title="Plate all ${qty} items and mark matching tickets ready"
                    >
                      <span>All (${qty}) ✅</span>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Quick Category Filters (Non-locking, instant toggle for 3 chefs) -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 1.2rem;">
          <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; align-items: center;">
            ${[
              { id: 'all', label: '🍽️ All Dishes (Unified 3-Chef View)' },
              { id: 'dosa', label: '🥞 Dosa / Tawa' },
              { id: 'sandwich', label: '🥪 Sandwich & Grill' },
              { id: 'chinese', label: '🍜 Chinese & Meals' },
              { id: 'snack', label: '🥖 Pav & Snacks' },
              { id: 'beverage', label: '🥤 Beverage Counter' },
            ].map(cat => `
              <button 
                class="kds-filter-btn ${selectedCategoryFilter === cat.id ? 'active' : ''}" 
                data-cat="${cat.id}"
                style="padding: 8px 18px; border-radius: 999px; font-family: var(--font-mono); font-size: 0.82rem; font-weight: 700; cursor: pointer; border: 1.5px solid ${selectedCategoryFilter === cat.id ? 'var(--brand-red)' : 'var(--border-light)'}; background: ${selectedCategoryFilter === cat.id ? 'var(--brand-red)' : '#FFF'}; color: ${selectedCategoryFilter === cat.id ? '#FFF' : 'var(--ink-secondary)'}; transition: all 0.15s ease;"
              >
                ${cat.label}
              </button>
            `).join('')}
          </div>
        </div>

        ${!isInitialSyncDone && cookOrders.length === 0 ? `
          <!-- Responsive Loading Skeleton (Never Blank) -->
          <div style="background: #FFF; border: 2px dashed #CBD5E1; border-radius: 14px; padding: 3rem 2rem; text-align: center;">
            <div style="font-size: 2.5rem; margin-bottom: 0.8rem; animation: bounce 1s infinite alternate;">🍳</div>
            <h3 style="font-family: var(--font-display); font-size: 1.6rem; color: var(--ink-primary); margin: 0 0 0.4rem 0;">
              SYNCHRONIZING LIVE KITCHEN TICKETS...
            </h3>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin: 0 auto; max-width: 420px;">
              Connecting directly to kitchen order queue over low-latency Firestore channel.
            </p>
          </div>
        ` : cookOrders.length === 0 ? `
          <!-- All Caught Up Zero State -->
          <div style="text-align: center; padding: 4rem 1rem; background: #FFF; border: 2px dashed var(--border-light); border-radius: 16px;">
            <div style="font-size: 3.5rem; margin-bottom: 0.5rem;">🍳</div>
            <h3 style="font-family: var(--font-display); font-size: 2rem; color: var(--ink-primary); margin: 0;">ALL CAUGHT UP!</h3>
            <p style="font-family: var(--font-sans); font-size: 0.95rem; color: var(--ink-secondary); margin-top: 6px;">
              No pending kitchen tickets. Standing by for incoming orders.
            </p>
          </div>
        ` : viewMode === 'pipeline' ? `
          <!-- ═════════════════════════════════════════════════════════════ -->
          <!-- SEQUENTIAL ONE-BY-ONE QUEUE PIPELINE                          -->
          <!-- ═════════════════════════════════════════════════════════════ -->
          
          <div style="display: flex; flex-direction: column; gap: 1.8rem;">
            
            <!-- SECTION 1: HERO SPOTLIGHT (QUEUE #1: NOW COOKING / UP FIRST) -->
            ${(() => {
              const isCooking = heroOrder.status === 'preparing';
              const elapsedMins = heroOrder.createdAt ? Math.floor(Math.max(0, (Date.now() - new Date(heroOrder.createdAt).getTime()) / 60000)) : 0;
              const isDelayed = elapsedMins >= 15;
              const effectiveScore = computeEffectiveScore(heroOrder);
              const orderId = heroOrder.orderId || heroOrder.id;

              return `
                <div style="background: ${isCooking ? '#FEF9C3' : '#FFF'}; border: 2.5px solid ${isDelayed ? '#EF4444' : (isCooking ? '#F59E0B' : 'var(--brand-red)')}; border-radius: 18px; padding: 1.6rem; box-shadow: 0 8px 24px rgba(0,0,0,0.07); position: relative; overflow: hidden;">
                  
                  <!-- Top Banner Ribbon -->
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; border-bottom: 2px solid ${isCooking ? '#FDE68A' : 'var(--border-light)'}; padding-bottom: 1rem;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <span style="background: ${isCooking ? '#D97706' : 'var(--brand-red)'}; color: #FFF; font-family: var(--font-mono); font-size: 0.95rem; font-weight: 800; padding: 6px 14px; border-radius: 8px; letter-spacing: 0.05em; display: inline-flex; align-items: center; gap: 6px;">
                        <span>${isCooking ? '🔥 NOW COOKING' : '⏳ UP FIRST'}</span>
                        <span style="background: rgba(255,255,255,0.25); padding: 1px 6px; border-radius: 4px; font-size: 0.8rem;">QUEUE #1</span>
                      </span>
                      <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #4338CA; background: #EEF2FF; padding: 4px 10px; border-radius: 6px; border: 1px solid #C7D2FE;">
                        Score: ${effectiveScore}
                      </span>
                      ${heroOrder.priorityLevel > 1 ? `
                        <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #B45309; background: #FEF3C7; padding: 4px 10px; border-radius: 6px; border: 1px solid #FDE68A;">
                          Priority ⭐️
                        </span>
                      ` : ''}
                    </div>

                    <div style="display: flex; align-items: center; gap: 10px;">
                      <span style="font-family: var(--font-mono); font-size: 0.95rem; color: ${isDelayed ? '#EF4444' : 'var(--ink-secondary)'}; font-weight: 800; background: #FFF; padding: 4px 12px; border-radius: 8px; border: 1.5px solid ${isDelayed ? '#EF4444' : 'var(--border-light)'};">
                        ⏱️ ${elapsedMins}m waiting
                      </span>
                    </div>
                  </div>

                  <!-- Token & Big Action CTA -->
                  <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.4rem;">
                    <div>
                      <div style="font-family: var(--font-sans); font-size: 0.85rem; text-transform: uppercase; color: var(--ink-secondary); font-weight: 700; letter-spacing: 0.05em;">
                        Order Token Number
                      </div>
                      <div style="font-family: var(--font-mono); font-size: 3rem; font-weight: 900; color: var(--brand-red); line-height: 1.1; margin-top: 2px;">
                        ${escapeHtml(heroOrder.tokenNumber || 'TB-???')}
                      </div>
                      ${heroOrder.isOnlyReadyMade ? `
                        <div style="margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; background: #DCFCE7; border: 1.5px solid #86EFAC; border-radius: 8px; padding: 4px 10px;">
                          <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: #15803D;">⚡ READY-MADE ONLY</span>
                          ${heroOrder.readyMadePreference ? `<span style="font-family: var(--font-sans); font-size: 0.8rem; font-weight: 700; color: #166534;">· ${escapeHtml(heroOrder.readyMadePreference)}</span>` : ''}
                        </div>
                      ` : ''}
                      ${(heroOrder.dietaryPreferences?.length > 0 || heroOrder.dietaryNotes) ? `
                        <div style="margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; background: #FEF3C7; border: 1.5px solid #F59E0B; border-radius: 8px; padding: 4px 10px;">
                          <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: #B45309;">🥗 DIETARY:</span>
                          <span style="font-family: var(--font-sans); font-size: 0.8rem; font-weight: 700; color: #92400E;">
                            ${escapeHtml((heroOrder.dietaryPreferences || []).join(', '))}${heroOrder.dietaryNotes ? ` (${escapeHtml(heroOrder.dietaryNotes)})` : ''}
                          </span>
                        </div>
                      ` : ''}
                    </div>

                    <!-- 1-Tap Ready Progression CTA -->
                    <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
                      ${!isCooking ? `
                        <button 
                          class="btn btn--outline-warning btn--xl kds-action-btn start-cook-btn" 
                          data-order-id="${escapeHtml(orderId)}" 
                          data-target-status="preparing"
                          style="min-height: 64px; padding: 14px 22px; font-size: 1.1rem; font-weight: 800; border-radius: 12px;"
                        >
                          <span>🔥 Start Cooking</span>
                        </button>
                      ` : ''}

                      <button 
                        class="btn btn--success btn--xl kds-action-btn mark-ready-btn hero-mark-ready-btn" 
                        data-order-id="${escapeHtml(orderId)}" 
                        data-target-status="ready"
                        style="min-height: 74px; padding: 16px 32px; font-size: 1.35rem; font-weight: 900; border-radius: 14px; box-shadow: 0 6px 20px rgba(34,197,94,0.4); display: inline-flex; align-items: center; gap: 12px; border: 2px solid #16A34A;"
                      >
                        <span style="font-size: 1.6rem;">✅</span>
                        <span>Mark Ready & Next ⏭️</span>
                        <span style="background: rgba(255,255,255,0.28); font-size: 0.75rem; font-family: var(--font-mono); padding: 4px 8px; border-radius: 6px; letter-spacing: 0.05em;">[SPACE / ENTER]</span>
                      </button>

                      <button 
                        class="btn btn--outline-danger btn--xl kds-cancel-btn" 
                        data-order-id="${escapeHtml(orderId)}" 
                        data-token="${escapeHtml(heroOrder.tokenNumber || 'TB-???')}"
                        title="Cancel order due to out-of-stock dish or customer request"
                        style="min-height: 64px; border-radius: 12px;"
                      >
                        <span>🚫 Out of Stock / Cancel</span>
                      </button>
                    </div>
                  </div>

                  <!-- Item Checklist for Hero Ticket -->
                  <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1.2rem; margin-bottom: 0.5rem;">
                    <div style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: var(--ink-secondary); text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0.05em;">
                      Dish Preparation List (${(heroOrder.items || []).length} items):
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 10px;">
                      ${(heroOrder.items || []).map(item => {
                        const isInstant = item.type === 'instant' || (!item.type && ((item.category || '').toLowerCase().includes('drink') || (item.category || '').toLowerCase().includes('bottle')));
                        return `
                        <div style="display: flex; justify-content: space-between; align-items: center; background: #F8FAFC; border: 1px solid #E2E8F0; padding: 10px 14px; border-radius: 10px; font-family: var(--font-mono);">
                          <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="background: var(--brand-red); color: #FFF; font-size: 1.1rem; font-weight: 800; padding: 3px 9px; border-radius: 6px;">
                              ${escapeHtml(item.quantity)}x
                            </span>
                            <div>
                              <div style="font-size: 1rem; font-weight: 700; color: var(--ink-primary); font-family: var(--font-sans);">
                                ${escapeHtml(item.name)}
                              </div>
                              ${item.customization ? `<div style="font-size: 0.8rem; font-weight: 700; color: #D97706; margin-top: 2px;">⚡ ${escapeHtml(item.customization)}</div>` : ''}
                            </div>
                          </div>
                          <div style="display: flex; gap: 6px; align-items: center;">
                            ${isInstant ? `
                              <span style="font-size: 0.72rem; font-weight: 700; color: #0284C7; text-transform: uppercase; background: #E0F2FE; padding: 3px 8px; border-radius: 6px; border: 1px solid #BAE6FD;">
                                📦 Grab & Pack
                              </span>
                            ` : `
                              <span style="font-size: 0.72rem; font-weight: 700; color: #D97706; text-transform: uppercase; background: #FEF3C7; padding: 3px 8px; border-radius: 6px; border: 1px solid #FDE68A;">
                                🍳 Cook
                              </span>
                            `}
                            ${item.station ? `<span style="font-size: 0.72rem; font-weight: 700; color: #64748B; text-transform: uppercase; background: #FFF; padding: 3px 8px; border-radius: 6px; border: 1px solid #CBD5E1;">${escapeHtml(item.station)}</span>` : ''}
                          </div>
                        </div>
                      `;
                      }).join('')}
                    </div>
                  </div>

                </div>
              `;
            })()}

            <!-- SECTION 2: THE WAITING PILE (UP NEXT IN QUEUE: #2, #3, #4...) -->
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <h3 style="font-family: var(--font-display); font-size: 1.4rem; color: var(--ink-primary); margin: 0;">
                    📋 WAITING ORDERS PILE
                  </h3>
                  <span style="background: #EEF2FF; color: #4338CA; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; padding: 2px 8px; border-radius: 6px; border: 1px solid #C7D2FE;">
                    ${waitingPile.length} Ticket${waitingPile.length === 1 ? '' : 's'} in Queue
                  </span>
                </div>
                <div style="font-family: var(--font-sans); font-size: 0.82rem; color: var(--ink-secondary);">
                  As Queue #1 completes, Queue #2 automatically moves to the spotlight!
                </div>
              </div>

              ${waitingPile.length === 0 ? `
                <div style="background: #FFF; border: 2px dashed var(--border-light); border-radius: 12px; padding: 2rem; text-align: center; color: var(--ink-secondary);">
                  <div style="font-size: 1.8rem; margin-bottom: 6px;">👌</div>
                  <div style="font-family: var(--font-display); font-size: 1.1rem; color: var(--ink-primary);">No additional orders in waiting pile</div>
                  <div style="font-family: var(--font-sans); font-size: 0.82rem; margin-top: 4px;">Incoming student orders will automatically pile up here in real-time.</div>
                </div>
              ` : `
                <div style="max-height: 68vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 6px;">
                  ${waitingPile.map((order, idx) => {
                    const queueRank = idx + 2;
                    const isCooking = order.status === 'preparing';
                    const elapsedMins = order.createdAt ? Math.floor(Math.max(0, (Date.now() - new Date(order.createdAt).getTime()) / 60000)) : 0;
                    const orderId = order.orderId || order.id;
                    const itemCount = (order.items || []).reduce((acc, it) => acc + (it.quantity || 1), 0);
                    const itemNames = (order.items || []).map(it => `${it.quantity}x ${it.name}`).join(', ');

                    return `
                      <div class="kds-pile-card" id="ticket-${escapeHtml(orderId)}" style="background: #FFF; border: 1.5px solid ${isCooking ? '#F59E0B' : 'var(--border-light)'}; border-radius: 12px; padding: 1rem 1.2rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03); transition: all 0.15s ease;">
                        
                        <div style="display: flex; align-items: center; gap: 14px;">
                          <!-- Queue Rank Badge -->
                          <div style="background: #F4F4F5; border: 1.5px solid #E4E4E7; border-radius: 8px; width: 48px; height: 48px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                            <div style="font-family: var(--font-mono); font-size: 0.65rem; color: var(--ink-secondary); font-weight: 700; line-height: 1;">QUEUE</div>
                            <div style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 900; color: var(--ink-primary); line-height: 1; margin-top: 2px;">#${queueRank}</div>
                          </div>

                          <div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                              <span style="font-family: var(--font-mono); font-size: 1.4rem; font-weight: 800; color: var(--ink-primary);">
                                ${escapeHtml(order.tokenNumber || 'TB-???')}
                              </span>
                              <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; padding: 2px 7px; border-radius: 4px; background: ${isCooking ? '#FEF3C7' : '#F3F4F6'}; color: ${isCooking ? '#92400E' : 'var(--ink-secondary)'}; border: 1px solid ${isCooking ? '#FCD34D' : '#E5E7EB'};">
                                ${isCooking ? '🔥 COOKING' : (queueRank === 2 ? '⏭️ UP NEXT' : '⏳ QUEUED')}
                              </span>
                              ${order.isOnlyReadyMade ? `
                                <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; padding: 2px 7px; border-radius: 4px; background: #DCFCE7; color: #15803D; border: 1px solid #86EFAC;">
                                  ⚡ READY-MADE ${order.readyMadePreference ? `· ${escapeHtml(order.readyMadePreference)}` : ''}
                                </span>
                              ` : ''}
                              ${(order.dietaryPreferences?.length > 0 || order.dietaryNotes) ? `
                                <span style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: 800; padding: 2px 7px; border-radius: 4px; background: #FEF3C7; color: #B45309; border: 1px solid #FCD34D;">
                                  🥗 ${escapeHtml((order.dietaryPreferences || []).join(', '))}${order.dietaryNotes ? ` (${escapeHtml(order.dietaryNotes)})` : ''}
                                </span>
                              ` : ''}
                              <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">
                                ⏱️ ${elapsedMins}m ago
                              </span>
                            </div>

                            <div style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-primary); margin-top: 4px; max-width: 600px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                              <strong>${itemCount} item${itemCount === 1 ? '' : 's'}:</strong> ${escapeHtml(itemNames)}
                            </div>
                          </div>
                        </div>

                        <!-- Pile Action Buttons -->
                        <div style="display: flex; gap: 8px; align-items: center;">
                          <button 
                            class="btn btn--secondary btn--sm focus-order-btn" 
                            data-order-id="${escapeHtml(orderId)}" 
                            title="Bring this order to Queue #1 spotlight"
                          >
                            ⬆️ Move to Top
                          </button>

                          ${!isCooking ? `
                            <button 
                              class="btn btn--outline-warning btn--sm kds-action-btn start-cook-btn" 
                              data-order-id="${escapeHtml(orderId)}" 
                              data-target-status="preparing"
                            >
                              🔥 Cook
                            </button>
                          ` : ''}

                          <button 
                            class="btn btn--success btn--sm kds-action-btn mark-ready-btn" 
                            data-order-id="${escapeHtml(orderId)}" 
                            data-target-status="ready"
                          >
                            Ready 🔔
                          </button>

                          <button 
                            class="btn btn--outline-danger btn--sm kds-cancel-btn" 
                            data-order-id="${escapeHtml(orderId)}" 
                            data-token="${escapeHtml(order.tokenNumber || 'TB-???')}"
                            title="Cancel order due to out-of-stock dish"
                          >
                            🚫
                          </button>
                        </div>

                      </div>
                    `;
                  }).join('')}
                </div>
              `}
            </div>

          </div>
        ` : `
          <!-- ═════════════════════════════════════════════════════════════ -->
          <!-- MULTI-TICKET GRID VIEW                                        -->
          <!-- ═════════════════════════════════════════════════════════════ -->
          <div class="kds-grid-view" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 1rem;">
            ${cookOrders.map((order, idx) => {
              const queueRank = idx + 1;
              const isCooking = order.status === 'preparing';
              const elapsedMins = order.createdAt ? Math.floor(Math.max(0, (Date.now() - new Date(order.createdAt).getTime()) / 60000)) : 0;
              const isDelayed = elapsedMins >= 15;
              const effectiveScore = computeEffectiveScore(order);
              const orderId = order.orderId || order.id;

              return `
                <div class="kds-ticket-card" id="ticket-${escapeHtml(orderId)}" style="background: #FFF; border: 2px solid ${isDelayed ? '#EF4444' : (isCooking ? '#F59E0B' : 'var(--border-light)')}; border-radius: 14px; padding: 1.2rem; box-shadow: 0 4px 12px rgba(0,0,0,0.04); display: flex; flex-direction: column; justify-content: space-between; transition: all 0.2s ease;">
                  
                  <div>
                    <!-- Header: Token & Priority Score -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; border-bottom: 1.5px solid var(--border-light); padding-bottom: 0.8rem;">
                      <div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <div style="font-family: var(--font-mono); font-size: 1.7rem; font-weight: 800; color: var(--ink-primary); line-height: 1;">
                            ${escapeHtml(order.tokenNumber || 'TB-???')}
                          </div>
                          <span style="background: ${queueRank === 1 ? 'var(--brand-red)' : '#F4F4F5'}; color: ${queueRank === 1 ? '#FFF' : 'var(--ink-secondary)'}; font-family: var(--font-mono); font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">
                            #${queueRank}
                          </span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 5px;">
                          <span style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; color: #4338CA; background: #EEF2FF; padding: 2px 7px; border-radius: 4px; border: 1px solid #C7D2FE;">
                            Score: ${effectiveScore}
                          </span>
                          ${order.priorityLevel > 1 ? `
                            <span style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; color: #B45309; background: #FEF3C7; padding: 2px 7px; border-radius: 4px; border: 1px solid #FDE68A;">
                              Priority ⭐️
                            </span>
                          ` : ''}
                          ${order.isOnlyReadyMade ? `
                            <span style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: 800; color: #15803D; background: #DCFCE7; padding: 2px 7px; border-radius: 4px; border: 1px solid #86EFAC;">
                              ⚡ READY-MADE ${order.readyMadePreference ? `· ${escapeHtml(order.readyMadePreference)}` : ''}
                            </span>
                          ` : ''}
                        </div>
                      </div>

                      <div style="text-align: right;">
                        <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; padding: 4px 10px; border-radius: 6px; background: ${isCooking ? '#FEF3C7' : '#F3F4F6'}; color: ${isCooking ? '#92400E' : 'var(--ink-secondary)'}; border: 1px solid ${isCooking ? '#FCD34D' : '#E5E7EB'};">
                          ${isCooking ? '🔥 COOKING' : '⏳ PLACED'}
                        </span>
                        <div style="font-family: var(--font-mono); font-size: 0.75rem; color: ${isDelayed ? '#EF4444' : 'var(--ink-secondary)'}; margin-top: 5px; font-weight: ${isDelayed ? '800' : '500'};">
                          ⏱️ ${elapsedMins}m ago
                        </div>
                      </div>
                    </div>

                    <!-- Order Items Checklist -->
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 1.2rem;">
                      ${(order.items || []).map(item => {
                        const isInstant = item.type === 'instant' || (!item.type && ((item.category || '').toLowerCase().includes('drink') || (item.category || '').toLowerCase().includes('bottle')));
                        return `
                        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface); padding: 8px 12px; border-radius: 8px; font-family: var(--font-mono);">
                          <div>
                            <span style="font-size: 1rem; font-weight: 700; color: var(--ink-primary);">
                              ${escapeHtml(item.quantity)}x ${escapeHtml(item.name)}
                            </span>
                            ${item.customization ? `<div style="font-size: 0.75rem; font-weight: 700; color: #D97706; margin-top: 1px;">⚡ ${escapeHtml(item.customization)}</div>` : ''}
                          </div>
                          <div style="display: flex; gap: 6px; align-items: center;">
                            ${isInstant ? `
                              <span style="font-size: 0.72rem; font-weight: 700; color: #0284C7; text-transform: uppercase; background: #E0F2FE; padding: 2px 6px; border-radius: 4px; border: 1px solid #BAE6FD;">
                                📦 Grab & Pack
                              </span>
                            ` : `
                              <span style="font-size: 0.72rem; font-weight: 700; color: #D97706; text-transform: uppercase; background: #FEF3C7; padding: 2px 6px; border-radius: 4px; border: 1px solid #FDE68A;">
                                🍳 Cook
                              </span>
                            `}
                            ${item.station ? `<span style="font-size: 0.72rem; font-weight: 700; color: var(--ink-secondary); text-transform: uppercase; background: #FFF; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-light);">${escapeHtml(item.station)}</span>` : ''}
                          </div>
                        </div>
                      `;
                      }).join('')}
                    </div>
                  </div>

                  <!-- Action Buttons -->
                  <div style="display: grid; grid-template-columns: ${isCooking ? '1fr 40px' : '1fr 1fr 40px'}; gap: 8px;">
                    ${!isCooking ? `
                      <button 
                        class="btn btn--outline-warning btn--md kds-action-btn start-cook-btn" 
                        data-order-id="${escapeHtml(orderId)}" 
                        data-target-status="preparing"
                      >
                        Start Cooking 🔥
                      </button>
                    ` : ''}

                    <button 
                      class="btn btn--success btn--md kds-action-btn mark-ready-btn" 
                      data-order-id="${escapeHtml(orderId)}" 
                      data-target-status="ready"
                    >
                      Mark Ready 🔔
                    </button>

                    <button 
                      class="btn btn--outline-danger btn--md kds-cancel-btn" 
                      data-order-id="${escapeHtml(orderId)}" 
                      data-token="${escapeHtml(order.tokenNumber || 'TB-???')}"
                      title="Cancel order due to out-of-stock dish"
                    >
                      🚫
                    </button>
                  </div>

                </div>
              `;
            }).join('')}
          </div>
        `}

        <!-- Ready At Counter Section (Collapsible / Summary) -->
        ${readyOrders.length > 0 ? `
          <div style="margin-top: 2rem; background: #F0FDF4; border: 1.5px solid #BBF7D0; border-radius: 14px; padding: 1.2rem 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <div style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 800; color: #166534; display: flex; align-items: center; gap: 8px;">
                <span>🔔 READY AT COUNTER FOR PICKUP (${readyOrders.length})</span>
              </div>
              <span style="font-family: var(--font-sans); font-size: 0.8rem; color: #15803D;">Awaiting student pickup with PIN/QR</span>
            </div>

            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              ${readyOrders.map(ro => `
                <div style="background: #FFF; border: 1.5px solid #86EFAC; padding: 8px 14px; border-radius: 8px; display: flex; align-items: center; gap: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                  <span style="font-family: var(--font-mono); font-size: 1.1rem; font-weight: 800; color: #166534;">${escapeHtml(ro.tokenNumber || 'TB-???')}</span>
                  <span style="font-family: var(--font-sans); font-size: 0.8rem; color: #64748B;">(${(ro.items || []).length} items)</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

      </div>
    `;

    // Attach View Mode Listeners
    container.querySelector('#view-mode-pipeline-btn')?.addEventListener('click', () => {
      viewMode = 'pipeline';
      renderKDS();
    });
    container.querySelector('#view-mode-grid-btn')?.addEventListener('click', () => {
      viewMode = 'grid';
      renderKDS();
    });

    // Attach Focus Order Listener
    container.querySelectorAll('.focus-order-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        focusedOrderId = btn.getAttribute('data-order-id');
        renderKDS();
      });
    });

    // Attach Clear Focus Order Listener
    container.querySelector('#clear-kds-focus-btn')?.addEventListener('click', () => {
      focusedOrderId = null;
      renderKDS();
    });

    // Attach Audio Toggle Listener
    container.querySelector('#toggle-kds-audio-btn')?.addEventListener('click', () => {
      audioAlertsEnabled = !audioAlertsEnabled;
      localStorage.setItem('tb_kds_audio_enabled', String(audioAlertsEnabled));
      if (audioAlertsEnabled) {
        playKitchenOrderChime();
      }
      renderKDS();
    });

    // Attach Voice Toggle Listener
    container.querySelector('#toggle-kds-voice-btn')?.addEventListener('click', () => {
      kitchenVoiceEnabled = !kitchenVoiceEnabled;
      localStorage.setItem('tb_kds_voice_enabled', String(kitchenVoiceEnabled));
      if (kitchenVoiceEnabled && 'speechSynthesis' in window) {
        try {
          const u = new SpeechSynthesisUtterance("Kitchen voice assistant active for 3 chefs");
          u.rate = 1.0;
          u.pitch = 1.05;
          u.lang = 'en-IN';
          window.speechSynthesis.speak(u);
        } catch (_) {}
      }
      renderKDS();
    });

    // Attach Manual Refresh
    container.querySelector('#refresh-kds-manual-btn')?.addEventListener('click', () => {
      loadKitchenDataAuthoritative();
    });

    // Attach KDS Filter Listeners (Unified 3-chef non-locking switcher)
    container.querySelectorAll('.kds-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedCategoryFilter = btn.getAttribute('data-cat') || 'all';
        renderKDS();
      });
    });

    // Attach Status Update Listeners (Optimistic UI & Auto-Progression)
    container.querySelectorAll('.kds-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        const targetStatus = btn.getAttribute('data-target-status');
        if (inFlightOrderIds.has(orderId)) return;
        inFlightOrderIds.add(orderId);

        btn.textContent = 'Updating...';
        btn.disabled = true;

        // If this order was manually focused, clear focus when completed
        if (focusedOrderId === orderId && targetStatus === 'ready') {
          focusedOrderId = null;
        }

        // Optimistic UI update locally so the queue advances immediately!
        const cardEl = btn.closest('.kds-card, .kds-pile-card, .kds-ticket-card');
        if (cardEl && targetStatus === 'ready') {
          cardEl.classList.add('kds-card-leaving');
          await new Promise(r => setTimeout(r, 120));
        }

        const targetIdx = currentOrders.findIndex(o => (o.orderId || o.id) === orderId);
        let previousStatus = null;
        if (targetIdx !== -1) {
          previousStatus = currentOrders[targetIdx].status;
          currentOrders[targetIdx].status = targetStatus;
          renderKDS();
        }

        try {
          await updateOrderStatus(orderId, targetStatus);
        } catch (e) {
          console.error("Status update error:", e);
          // Rollback if failed
          if (targetIdx !== -1 && previousStatus) {
            currentOrders[targetIdx].status = previousStatus;
            renderKDS();
          }
          alert("Status Update Failed: " + getFriendlyErrorMessage(e, 'Unable to update status.'));
        } finally {
          inFlightOrderIds.delete(orderId);
        }
      });
    });

    // Attach Cancel Order Listeners
    container.querySelectorAll('.kds-cancel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        const tokenNumber = btn.getAttribute('data-token') || 'Order';
        if (inFlightOrderIds.has(orderId)) return;

        const reason = prompt(`Reason for cancelling order ${tokenNumber}?`, 'Out of ingredients / Kitchen unable to prepare');
        if (!reason) return;

        const confirmed = confirm(`Are you sure you want to CANCEL order ${tokenNumber}?\nThis will update the live queue and notify the customer.`);
        if (!confirmed) return;

        inFlightOrderIds.add(orderId);
        const origContent = btn.innerHTML;
        btn.textContent = 'Cancelling...';
        btn.disabled = true;

        try {
          await cancelStaffOrder(orderId, reason);
          if (focusedOrderId === orderId) focusedOrderId = null;
          await loadKitchenDataAuthoritative();
        } catch (err) {
          console.error("Kitchen cancellation error:", err);
          alert("Cancellation Failed: " + getFriendlyErrorMessage(err, 'Unable to cancel order.'));
          btn.innerHTML = origContent;
          btn.disabled = false;
        } finally {
          inFlightOrderIds.delete(orderId);
        }
      });
    });

    // Auto-Cook Feature: If Hero order is placed/confirmed, auto-advance to preparing after 4s
    clearTimeout(autoCookTimeout);
    if (heroOrder && (heroOrder.status === 'placed' || heroOrder.status === 'confirmed')) {
      const heroId = heroOrder.orderId || heroOrder.id;
      autoCookTimeout = setTimeout(async () => {
        if (!inFlightOrderIds.has(heroId)) {
          inFlightOrderIds.add(heroId);
          try {
            await updateOrderStatus(heroId, 'preparing');
            heroOrder.status = 'preparing';
            renderKDS();
          } catch (_) {}
          finally {
            inFlightOrderIds.delete(heroId);
          }
        }
      }, 4000);
    }

    // Attach 1-Tap Knuckle Batch Fulfillment Listeners (Zero Popups)
    container.querySelectorAll('.kds-quick-plate-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemName = btn.getAttribute('data-item-name');
        const count = parseInt(btn.getAttribute('data-count'), 10) || 1;
        
        // Find matching orders that need this item
        const matchingOrders = cookOrders.filter(o => 
          (o.items || []).some(i => (i.name || '').toLowerCase() === itemName.toLowerCase())
        );

        if (matchingOrders.length === 0) return;

        btn.disabled = true;
        btn.style.opacity = '0.5';

        let remaining = count;
        let fulfilledCount = 0;

        for (const order of matchingOrders) {
          if (remaining <= 0) break;
          const oId = order.orderId || order.id;
          if (inFlightOrderIds.has(oId)) continue;

          const itemObj = (order.items || []).find(i => (i.name || '').toLowerCase() === itemName.toLowerCase());
          const itemQty = itemObj ? (itemObj.quantity || 1) : 1;
          remaining -= itemQty;
          fulfilledCount++;

          inFlightOrderIds.add(oId);
          try {
            await updateOrderStatus(oId, 'ready');
            order.status = 'ready';
          } catch (err) {
            console.error("Batch update error for order " + oId, err);
          } finally {
            inFlightOrderIds.delete(oId);
          }
        }

        playKitchenOrderChime();
        showKdsToast(`🎉 Plated ${count}x ${itemName} — ${fulfilledCount} order(s) marked READY!`);
        renderKDS();
      });
    });

    // Setup Global Physical Numpad / Bump Bar Keyboard Shortcuts
    if (kitchenKeydownHandler) {
      window.removeEventListener('keydown', kitchenKeydownHandler);
    }

    kitchenKeydownHandler = (e) => {
      // Don't intercept when staff is typing in an input or modal prompt
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      // 1. Spacebar or Enter: Complete the active Hero order (#1 in queue)
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (tokenKeyBuffer.length > 0) {
          // Process token jump buffer if any digits were entered
          const queryToken = tokenKeyBuffer;
          tokenKeyBuffer = '';
          clearTimeout(tokenKeyTimer);
          const found = cookOrders.find(o => (o.tokenNumber || '').endsWith(queryToken));
          if (found) {
            const fId = found.orderId || found.id;
            updateOrderStatus(fId, 'ready').then(() => {
              playKitchenOrderChime();
              showKdsToast(`⚡ Token #${found.tokenNumber} marked READY via Numpad!`);
              renderKDS();
            }).catch(() => {});
          } else {
            showKdsToast(`❓ No active order matching token "...${queryToken}"`);
          }
          return;
        }

        const heroReadyBtn = container.querySelector('.hero-mark-ready-btn');
        if (heroReadyBtn && !heroReadyBtn.disabled) {
          heroReadyBtn.click();
          playKitchenOrderChime();
          showKdsToast(`✅ Order ${heroOrder?.tokenNumber || ''} marked READY via [${e.code}]!`);
        }
        return;
      }

      // 2. Key '+' or '=': Start cooking the active Hero order
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        const startBtn = container.querySelector('.start-cook-btn');
        if (startBtn && !startBtn.disabled) {
          startBtn.click();
          showKdsToast(`🔥 Cooking started for ${heroOrder?.tokenNumber || ''} via [+]!`);
        }
        return;
      }

      // 3. Digit Keys (0-9): Buffer for fast token completion
      if (e.key >= '0' && e.key <= '9') {
        tokenKeyBuffer += e.key;
        clearTimeout(tokenKeyTimer);
        showKdsToast(`⌨️ Numpad Token: ${tokenKeyBuffer} (Hit Enter to Complete)`);
        tokenKeyTimer = setTimeout(() => {
          tokenKeyBuffer = '';
        }, 2000);
      }
    };

    window.addEventListener('keydown', kitchenKeydownHandler);
  }

  // 1. Render immediately so screen is NEVER blank
  renderKDS();

  // 2. Authoritative Fetch function
  async function loadKitchenDataAuthoritative() {
    try {
      const orders = await fetchKitchenOrders();
      if (Array.isArray(orders)) {
        if (audioAlertsEnabled && isInitialSyncDone && orders.length > currentOrders.length) {
          playKitchenOrderChime();
        }
        currentOrders = orders.map(o => ({
          ...o,
          id: o.orderId || o.id,
        }));

        currentOrders.forEach(o => {
          const oId = o.orderId || o.id;
          if (!announcedKitchenOrders.has(oId)) {
            if (isInitialSyncDone && (o.status === 'placed' || o.status === 'confirmed' || o.status === 'preparing') && !o.isOnlyReadyMade) {
              speakKitchenOrder(o);
            }
            announcedKitchenOrders.add(oId);
          }
        });
      }
      isInitialSyncDone = true;
      renderKDS();
    } catch (err) {
      console.warn("KDS operational fetch notice:", err);
      isInitialSyncDone = true;
      renderKDS();
    }
  }

  // 3. Connect real-time Firestore stream (sub-50ms)
  try {
    const ordersCol = collection(db, 'orders');
    const q = query(ordersCol, where('status', 'in', ['placed', 'confirmed', 'preparing', 'payment_pending', 'ready']), limit(100));
    
    unsubscribeOrders = onSnapshot(q, (snapshot) => {
      const liveOrders = snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          orderId: d.id,
          tokenNumber: data.tokenNumber || 'TB-???',
          status: data.status,
          priorityLevel: typeof data.priorityLevel === 'number' ? data.priorityLevel : 1,
          effectivePriority: data.effectivePriority,
          items: data.items || [],
          estimatedMinutes: data.estimatedMinutes || data.estimatedPrepTimeMinutes || null,
          isOnlyReadyMade: data.isOnlyReadyMade === true || (Array.isArray(data.items) && data.items.length > 0 && data.items.every(i => i.type === 'instant')),
          readyMadePreference: data.readyMadePreference || null,
          dietaryPreferences: Array.isArray(data.dietaryPreferences) ? data.dietaryPreferences : [],
          dietaryNotes: data.dietaryNotes || null,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
        };
      });

      if (audioAlertsEnabled && isInitialSyncDone && liveOrders.length > currentOrders.length) {
        playKitchenOrderChime();
      }

      liveOrders.forEach(o => {
        const oId = o.orderId || o.id;
        if (!announcedKitchenOrders.has(oId)) {
          if (isInitialSyncDone && (o.status === 'placed' || o.status === 'confirmed' || o.status === 'preparing') && !o.isOnlyReadyMade) {
            speakKitchenOrder(o);
          }
          announcedKitchenOrders.add(oId);
        }
      });

      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      currentOrders = liveOrders;
      isInitialSyncDone = true;
      renderKDS();
      syncPublicLiveQueue(liveOrders);
    }, (err) => {
      console.warn("KDS Firestore onSnapshot notice (falling back to polling):", err);
      loadKitchenDataAuthoritative();
      if (!pollInterval) {
        pollInterval = setInterval(loadKitchenDataAuthoritative, 5000);
      }
    });
  } catch (err) {
    console.warn("Could not attach KDS snapshot listener, activating fallback polling:", err);
    if (!pollInterval) {
      pollInterval = setInterval(loadKitchenDataAuthoritative, 5000);
    }
  }

  // Initial immediate fetch for instant render before snapshot resolves
  loadKitchenDataAuthoritative();
}

export function cleanupKitchenView() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (unsubscribeOrders) {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }
  if (kitchenAudioCtx) {
    try { kitchenAudioCtx.close(); } catch (_) {}
    kitchenAudioCtx = null;
  }
  if (kitchenKeydownHandler) {
    window.removeEventListener('keydown', kitchenKeydownHandler);
    kitchenKeydownHandler = null;
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
  announcedKitchenOrders.clear();
  clearTimeout(autoCookTimeout);
  clearTimeout(tokenKeyTimer);
  tokenKeyBuffer = '';
  isInitialSyncDone = false;
  currentOrders = [];
}
