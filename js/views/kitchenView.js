// Thakur Bites Platform 2.0 — High-Performance Kitchen Display System (KDS)
// Features: Zero-Miss Order Stream (including payment_pending, placed, confirmed, preparing),
// Sequential One-by-One Queue Pipeline with "Now Cooking" Spotlight & "Up Next" Waiting Pile,
// Auto-Progression ("as one completes other gets up next"), Smart Cooking Batches,
// Station-Filtered Views, Dynamic Priority Aging, and Web Audio Alerts.

import { db, functions, fetchKitchenOrders, updateOrderStatus } from '../firebase.js?v=5';
import { collection, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { escapeHtml } from './escapeHtml.js';

let pollInterval = null;
let unsubscribeOrders = null;
let currentOrders = [];
let selectedCategoryFilter = 'all';
let viewMode = 'pipeline'; // 'pipeline' (sequential pile) or 'grid' (all tickets)
let focusedOrderId = null; // User manual focus override if desired
let isInitialSyncDone = false;
let audioAlertsEnabled = localStorage.getItem('tb_kds_audio_enabled') !== 'false'; // default ON

// Synthesize pleasant kitchen chime using Web Audio API (zero external assets needed)
function playKitchenOrderChime() {
  if (!audioAlertsEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
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

    // 2. Cook Queue: includes payment_pending, placed, confirmed, preparing
    const cookOrders = activeOrders.filter(o => {
      const isCookingState = o.status === 'placed' || o.status === 'preparing' || o.status === 'confirmed' || o.status === 'payment_pending';
      if (!isCookingState) return false;
      if (selectedCategoryFilter === 'all') return true;
      return o.items && o.items.some(i => (i.name || '').toLowerCase().includes(selectedCategoryFilter) || (i.station || '').toLowerCase() === selectedCategoryFilter);
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

    // Smart Kitchen Batching Intelligence: Aggregate item totals across tickets
    const batchCounts = {};
    cookOrders.forEach(o => {
      (o.items || []).forEach(i => {
        const key = i.name || 'Item';
        batchCounts[key] = (batchCounts[key] || 0) + (i.quantity || 1);
      });
    });
    const batchEntries = Object.entries(batchCounts);

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1400px; margin: 0 auto; padding: 1.5rem 1rem;">
        
        <!-- KDS Control Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.2rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; line-height: 1; margin: 0; color: var(--ink-primary);">
                KITCHEN DISPLAY SYSTEM (KDS)
              </h2>
              <span class="live-badge" style="background: ${isInitialSyncDone ? '#22C55E' : '#F59E0B'}; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px; display: inline-flex; align-items: center; gap: 5px;">
                <span style="display: inline-block; width: 6px; height: 6px; background: #FFF; border-radius: 50%;"></span>
                ${isInitialSyncDone ? 'LIVE REAL-TIME STREAM' : 'SYNCHRONIZING...'}
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px; margin-bottom: 0;">
              Sequential prep pipeline: orders piled in priority order — as one completes, the next immediately slides up!
            </p>
          </div>

          <!-- Controls: View Mode, Audio Alerts & Quick Stats -->
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            
            <!-- View Mode Switcher -->
            <div style="display: flex; background: #F4F4F5; padding: 3px; border-radius: 10px; border: 1.5px solid var(--border-light);">
              <button id="view-mode-pipeline-btn" style="padding: 6px 12px; border-radius: 8px; border: none; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer; background: ${viewMode === 'pipeline' ? '#FFF' : 'transparent'}; color: ${viewMode === 'pipeline' ? 'var(--brand-red)' : 'var(--ink-secondary)'}; box-shadow: ${viewMode === 'pipeline' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};">
                📋 Queue Pile
              </button>
              <button id="view-mode-grid-btn" style="padding: 6px 12px; border-radius: 8px; border: none; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer; background: ${viewMode === 'grid' ? '#FFF' : 'transparent'}; color: ${viewMode === 'grid' ? 'var(--brand-red)' : 'var(--ink-secondary)'}; box-shadow: ${viewMode === 'grid' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};">
                🔲 All Cards
              </button>
            </div>

            <button id="toggle-kds-audio-btn" style="background: ${audioAlertsEnabled ? '#EEF2FF' : '#F4F4F5'}; border: 1.5px solid ${audioAlertsEnabled ? '#818CF8' : '#D4D4D8'}; color: ${audioAlertsEnabled ? '#4338CA' : '#71717A'}; padding: 8px 14px; border-radius: 10px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px;">
              <span>${audioAlertsEnabled ? '🔔 Sound: ON' : '🔕 Sound: MUTED'}</span>
            </button>

            <button id="refresh-kds-manual-btn" style="background: #FFF; border: 1.5px solid var(--border-light); padding: 8px 14px; border-radius: 10px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; color: var(--ink-primary);">
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

        <!-- Smart Cooking Batches Bar -->
        ${batchEntries.length > 0 ? `
          <div style="background: #FFFBEB; border: 1.5px solid #FDE68A; border-radius: 12px; padding: 12px 16px; margin-bottom: 1.3rem; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: #92400E; display: flex; align-items: center; gap: 6px;">
                <span>🔥 SMART COOKING BATCHES</span>
                <span style="font-size: 0.75rem; font-weight: 400; color: #B45309;">(Consolidated item totals across all waiting tickets in queue)</span>
              </div>
            </div>

            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              ${batchEntries.map(([name, qty]) => `
                <div style="background: #FFF; border: 1.5px solid #FCD34D; padding: 6px 12px; border-radius: 8px; display: flex; align-items: center; gap: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                  <span style="font-family: var(--font-mono); font-size: 1.1rem; font-weight: 800; color: #92400E;">${qty}x</span>
                  <span style="font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; color: var(--ink-primary);">${escapeHtml(name)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Filter Chips -->
        <div style="display: flex; gap: 8px; margin-bottom: 1.3rem; overflow-x: auto; padding-bottom: 4px;">
          ${['all', 'dosa', 'sandwich', 'snack', 'beverage'].map(cat => `
            <button 
              class="kds-filter-btn ${selectedCategoryFilter === cat ? 'active' : ''}" 
              data-cat="${cat}"
              style="padding: 7px 16px; border-radius: 999px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; border: 1.5px solid ${selectedCategoryFilter === cat ? 'var(--brand-red)' : 'var(--border-light)'}; background: ${selectedCategoryFilter === cat ? 'var(--brand-red)' : '#FFF'}; color: ${selectedCategoryFilter === cat ? '#FFF' : 'var(--ink-secondary)'}; transition: all 0.15s ease;"
            >
              ${cat === 'all' ? '🍽️ All Stations' : cat.toUpperCase()}
            </button>
          `).join('')}
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
                    </div>

                    <!-- 1-Tap Ready Progression CTA -->
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                      ${!isCooking ? `
                        <button 
                          class="kds-action-btn start-cook-btn" 
                          data-order-id="${escapeHtml(orderId)}" 
                          data-target-status="preparing"
                          style="padding: 14px 22px; border-radius: 12px; border: 2px solid #F59E0B; background: #FEF3C7; color: #92400E; font-family: var(--font-sans); font-size: 1.05rem; font-weight: 800; cursor: pointer; transition: all 0.15s ease; display: flex; align-items: center; gap: 8px;"
                        >
                          <span>🔥 Start Cooking</span>
                        </button>
                      ` : ''}

                      <button 
                        class="kds-action-btn mark-ready-btn" 
                        data-order-id="${escapeHtml(orderId)}" 
                        data-target-status="ready"
                        style="padding: 14px 28px; border-radius: 12px; border: none; background: #16A34A; color: #FFF; font-family: var(--font-sans); font-size: 1.1rem; font-weight: 800; cursor: pointer; box-shadow: 0 4px 14px rgba(22,163,74,0.35); transition: all 0.15s ease; display: flex; align-items: center; gap: 10px;"
                      >
                        <span>✅ Mark Ready & Next ⏭️</span>
                      </button>
                    </div>
                  </div>

                  <!-- Item Checklist for Hero Ticket -->
                  <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1.2rem; margin-bottom: 0.5rem;">
                    <div style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: var(--ink-secondary); text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0.05em;">
                      Dish Preparation List (${(heroOrder.items || []).length} items):
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;">
                      ${(heroOrder.items || []).map(item => `
                        <div style="display: flex; justify-content: space-between; align-items: center; background: #F8FAFC; border: 1px solid #E2E8F0; padding: 10px 14px; border-radius: 10px; font-family: var(--font-mono);">
                          <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="background: var(--brand-red); color: #FFF; font-size: 1.1rem; font-weight: 800; padding: 3px 9px; border-radius: 6px;">
                              ${escapeHtml(item.quantity)}x
                            </span>
                            <span style="font-size: 1rem; font-weight: 700; color: var(--ink-primary); font-family: var(--font-sans);">
                              ${escapeHtml(item.name)}
                            </span>
                          </div>
                          ${item.station ? `<span style="font-size: 0.72rem; font-weight: 700; color: #64748B; text-transform: uppercase; background: #FFF; padding: 3px 8px; border-radius: 6px; border: 1px solid #CBD5E1;">${escapeHtml(item.station)}</span>` : ''}
                        </div>
                      `).join('')}
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
                <div style="display: flex; flex-direction: column; gap: 10px;">
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
                            class="focus-order-btn" 
                            data-order-id="${escapeHtml(orderId)}"
                            style="background: #F8FAFC; border: 1.5px solid #CBD5E1; color: var(--ink-primary); padding: 8px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer; transition: all 0.1s ease;"
                            title="Bring this order to Queue #1 spotlight"
                          >
                            ⬆️ Move to Top
                          </button>

                          ${!isCooking ? `
                            <button 
                              class="kds-action-btn start-cook-btn" 
                              data-order-id="${escapeHtml(orderId)}" 
                              data-target-status="preparing"
                              style="background: #FEF3C7; border: 1.5px solid #F59E0B; color: #92400E; padding: 8px 14px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; cursor: pointer;"
                            >
                              🔥 Cook
                            </button>
                          ` : ''}

                          <button 
                            class="kds-action-btn mark-ready-btn" 
                            data-order-id="${escapeHtml(orderId)}" 
                            data-target-status="ready"
                            style="background: #16A34A; border: none; color: #FFF; padding: 8px 16px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; cursor: pointer; box-shadow: 0 2px 6px rgba(22,163,74,0.25);"
                          >
                            Ready 🔔
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
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.2rem;">
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
                      ${(order.items || []).map(item => `
                        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface); padding: 8px 12px; border-radius: 8px; font-family: var(--font-mono);">
                          <span style="font-size: 1rem; font-weight: 700; color: var(--ink-primary);">
                            ${escapeHtml(item.quantity)}x ${escapeHtml(item.name)}
                          </span>
                          ${item.station ? `<span style="font-size: 0.72rem; font-weight: 700; color: var(--ink-secondary); text-transform: uppercase; background: #FFF; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-light);">${escapeHtml(item.station)}</span>` : ''}
                        </div>
                      `).join('')}
                    </div>
                  </div>

                  <!-- Action Buttons -->
                  <div style="display: grid; grid-template-columns: ${isCooking ? '1fr' : '1fr 1fr'}; gap: 8px;">
                    ${!isCooking ? `
                      <button 
                        class="kds-action-btn start-cook-btn" 
                        data-order-id="${escapeHtml(orderId)}" 
                        data-target-status="preparing"
                        style="padding: 10px; border-radius: 8px; border: 1.5px solid #F59E0B; background: #FEF3C7; color: #92400E; font-family: var(--font-sans); font-size: 0.88rem; font-weight: 800; cursor: pointer; transition: all 0.1s ease;"
                      >
                        Start Cooking 🔥
                      </button>
                    ` : ''}

                    <button 
                      class="kds-action-btn mark-ready-btn" 
                      data-order-id="${escapeHtml(orderId)}" 
                      data-target-status="ready"
                      style="padding: 10px; border-radius: 8px; border: none; background: #16A34A; color: #FFF; font-family: var(--font-sans); font-size: 0.88rem; font-weight: 800; cursor: pointer; box-shadow: 0 2px 6px rgba(22,163,74,0.3); transition: all 0.1s ease;"
                    >
                      Mark Ready 🔔
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

    // Attach Audio Toggle Listener
    container.querySelector('#toggle-kds-audio-btn')?.addEventListener('click', () => {
      audioAlertsEnabled = !audioAlertsEnabled;
      localStorage.setItem('tb_kds_audio_enabled', String(audioAlertsEnabled));
      if (audioAlertsEnabled) {
        playKitchenOrderChime();
      }
      renderKDS();
    });

    // Attach Manual Refresh
    container.querySelector('#refresh-kds-manual-btn')?.addEventListener('click', () => {
      loadKitchenDataAuthoritative();
    });

    // Attach KDS Filter Listeners
    container.querySelectorAll('.kds-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedCategoryFilter = btn.getAttribute('data-cat');
        renderKDS();
      });
    });

    // Attach Status Update Listeners (Optimistic UI & Auto-Progression)
    container.querySelectorAll('.kds-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-order-id');
        const targetStatus = btn.getAttribute('data-target-status');
        btn.textContent = 'Updating...';
        btn.disabled = true;

        // If this order was manually focused, clear focus when completed
        if (focusedOrderId === orderId && targetStatus === 'ready') {
          focusedOrderId = null;
        }

        // Optimistic UI update locally so the queue advances immediately!
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
          alert("Status Update Failed: " + (e.message || e));
        }
      });
    });
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
    const q = query(ordersCol, where('status', 'in', ['placed', 'confirmed', 'preparing', 'payment_pending', 'ready']));
    
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
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
        };
      });

      if (audioAlertsEnabled && isInitialSyncDone && liveOrders.length > currentOrders.length) {
        playKitchenOrderChime();
      }

      currentOrders = liveOrders;
      isInitialSyncDone = true;
      renderKDS();
    }, (err) => {
      console.warn("KDS Firestore onSnapshot notice (falling back to callable):", err);
      loadKitchenDataAuthoritative();
    });
  } catch (err) {
    console.warn("Could not attach KDS snapshot listener:", err);
  }

  // 4. Also perform immediate fetch and periodic sync fallback
  loadKitchenDataAuthoritative();
  pollInterval = setInterval(loadKitchenDataAuthoritative, 4000);
}
