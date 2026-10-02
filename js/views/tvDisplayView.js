// Big Screen TV Token Board View for Canteen Wall Display connected to publicLiveQueue/current
import { db } from '../firebase.js?v=6';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { escapeHtml } from './escapeHtml.js';

let unsubscribeQueue = null;
let confirmedTickets = [];
let preparingTickets = [];
let readyTickets = [];
let clockInterval = null;
let staleInterval = null;
let lastDataReceivedAt = Date.now();
let isStale = false;
let lastFormattedTime = '';
let audioContext = null;
const knownReadyTokens = new Set();
let isFirstLoad = true;

const MAX_PER_SECTION = 8;

function initAudio() {
  try {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) audioContext = new AudioCtx();
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  } catch (_) {}
}

['click', 'keydown', 'touchstart'].forEach(evt => {
  window.addEventListener(evt, initAudio, { passive: true, once: false });
});

function playReadyChime() {
  initAudio();
  if (!audioContext || audioContext.state === 'suspended') return;

  try {
    const now = audioContext.currentTime;
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(800, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1060, now + 0.15);
    gain2.gain.setValueAtTime(0.4, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.65);
  } catch (_) {}
}

export function renderTvDisplayView(container) {
  if (unsubscribeQueue) {
    unsubscribeQueue();
    unsubscribeQueue = null;
  }
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
  if (staleInterval) {
    clearInterval(staleInterval);
    staleInterval = null;
  }

  function getFormattedTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function render() {
    const totalActive = confirmedTickets.length + preparingTickets.length + readyTickets.length;
    const MAX_VISIBLE_CONFIRMED = 6;
    const visibleConfirmed = confirmedTickets.slice(0, MAX_VISIBLE_CONFIRMED);
    const overflowConfirmed = Math.max(0, confirmedTickets.length - MAX_VISIBLE_CONFIRMED);

    const visiblePreparing = preparingTickets.slice(0, MAX_PER_SECTION);
    const overflowPreparing = Math.max(0, preparingTickets.length - MAX_PER_SECTION);

    const visibleReady = readyTickets.slice(0, MAX_PER_SECTION);
    const overflowReady = Math.max(0, readyTickets.length - MAX_PER_SECTION);

    container.innerHTML = `
      <div class="tv-outer-container">
        <div class="tv-display-screen">
          
          <!-- TV Top Bar -->
          <div class="tv-header-bar">
            <div class="tv-header-brand" style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
              <div class="brand-logo" style="width: 48px; height: 48px; font-size: 1.8rem; background: var(--brand-red, #EF4444); color: #FFF; font-family: var(--font-display, 'Bebas Neue', sans-serif); display: flex; align-items: center; justify-content: center; border-radius: 10px; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4); flex-shrink: 0;">TB</div>
              <div>
                <h1 style="font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: clamp(1.6rem, 4.5vw, 2.5rem); letter-spacing: 0.04em; line-height: 1.1; color: #FFF; margin: 0; word-break: break-word;">
                  THAKUR BITES · CANTEEN ORDER BOARD
                </h1>
                <div style="font-family: var(--font-mono, monospace); font-size: clamp(0.68rem, 2.2vw, 0.8rem); color: #A1A1AA; margin-top: 4px; letter-spacing: 0.03em;">
                  TCET CANTEEN · PROCEED TO COUNTER WHEN YOUR TOKEN APPEARS IN GREEN
                </div>
              </div>
            </div>

            <div class="tv-header-status-clock" style="display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap;">
              <div style="background: rgba(34, 197, 94, 0.12); border: 1.5px solid #22C55E; color: #4ADE80; font-family: var(--font-mono, monospace); font-size: 0.82rem; font-weight: 700; padding: 6px 14px; border-radius: 999px; display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <span class="tb-ambient-pulse" style="width: 8px; height: 8px; border-radius: 50%; background: #22C55E; box-shadow: 0 0 8px #22C55E;"></span>
                <span>LIVE DISPATCH</span>
              </div>
              <div style="text-align: right;">
                <div id="tv-live-clock" style="font-family: var(--font-mono, monospace); font-size: clamp(1.4rem, 4vw, 2rem); font-weight: 700; color: #FBBF24; line-height: 1; letter-spacing: 0.05em;">
                  ${getFormattedTime()}
                </div>
                <div style="font-family: var(--font-mono, monospace); font-size: 0.7rem; color: #71717A; text-transform: uppercase; margin-top: 3px;">
                  CAMPUS CLOCK
                </div>
              </div>
            </div>
          </div>

          ${isStale ? `
            <div style="background: rgba(234, 179, 8, 0.15); border: 1.5px solid #EAB308; color: #FACC15; padding: 10px 16px; border-radius: 10px; font-family: var(--font-mono, monospace); font-size: 0.9rem; margin-top: 1rem; display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
              <span>⚠️</span>
              <span><strong>CONNECTION STALE:</strong> Showing last known queue from ${lastFormattedTime || 'server'}. Reconnecting...</span>
            </div>
          ` : ''}

          <!-- Empty Queue Standby View -->
          ${totalActive === 0 ? `
            <div style="flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; padding: 2rem 1rem;">
              <div style="background: #18181B; border: 2px dashed #27272A; border-radius: 20px; padding: 2.5rem 2rem; max-width: 540px; width: 100%; box-sizing: border-box;">
                <div style="font-size: 3.5rem; margin-bottom: 1rem;">🍱</div>
                <h2 style="font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: clamp(1.8rem, 5vw, 2.4rem); letter-spacing: 0.05em; color: #F4F4F5; margin: 0 0 0.5rem 0;">CANTEEN IS ALL CAUGHT UP</h2>
                <p style="font-family: var(--font-mono, monospace); font-size: 0.9rem; color: #A1A1AA; line-height: 1.5; margin: 0 0 1.5rem 0;">
                  All confirmed orders have been prepared and collected.<br>Order now through the Thakur Bites Mobile App!
                </p>
                <span style="background: rgba(239, 68, 68, 0.15); border: 1px solid #EF4444; color: #FCA5A5; font-family: var(--font-mono, monospace); font-size: 0.8rem; font-weight: 700; padding: 6px 14px; border-radius: 999px;">
                  TCET DIGITAL CANTEEN
                </span>
              </div>
            </div>
          ` : `
            <!-- TV 3-Stage Pipeline Grid -->
            <div class="tv-pipeline-grid">
              
              <!-- STAGE 1: ORDER CONFIRMED (Incoming FIFO Queue) -->
              <div style="background: #111113; border: 1.5px solid #27272A; border-radius: 14px; display: flex; flex-direction: column; overflow: hidden;">
                <div style="background: #78350F; color: #FEF3C7; padding: 10px 16px; font-family: var(--font-mono, monospace); font-size: 1rem; font-weight: 700; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #D97706; flex-shrink: 0;">
                  <span>🟡 ORDER CONFIRMED</span>
                  <span style="background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 4px; font-size: 0.85rem;">${confirmedTickets.length}</span>
                </div>

                <div style="padding: 1rem; flex: 1; display: flex; flex-direction: column; gap: 0.75rem; overflow-y: auto;">
                  ${visibleConfirmed.length === 0 ? `
                    <div style="text-align: center; padding: 3rem 1rem; color: #71717A; font-family: var(--font-mono, monospace); font-size: 0.9rem; border: 1.5px dashed #27272A; border-radius: 10px;">
                      No new confirmed orders waiting
                    </div>
                  ` : visibleConfirmed.map((o, idx) => `
                    <div style="background: #1C1917; border: 1.5px solid #78350F; border-radius: 10px; padding: 0.9rem 1rem; display: flex; justify-content: space-between; align-items: center;">
                      <div>
                        <div style="font-family: var(--font-mono, monospace); font-size: 1.9rem; font-weight: 800; color: #FBBF24; line-height: 1;">
                          ${escapeHtml(o.token || o.tokenNumber)}
                        </div>
                        <div style="font-family: var(--font-mono, monospace); font-size: 0.7rem; color: #D97706; margin-top: 4px; font-weight: 600; text-transform: uppercase;">
                          RECEIVED &middot; IN QUEUE
                        </div>
                      </div>
                      <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid #D97706; color: #FDE68A; font-family: var(--font-mono, monospace); font-size: 0.75rem; font-weight: 700; padding: 4px 8px; border-radius: 6px;">
                        #${idx + 1}
                      </div>
                    </div>
                  `).join('')}

                  ${overflowConfirmed > 0 ? `
                    <div style="background: rgba(245, 158, 11, 0.1); border: 1px dashed #D97706; color: #FDE68A; padding: 8px; border-radius: 8px; text-align: center; font-family: var(--font-mono, monospace); font-size: 0.8rem; font-weight: 600;">
                      +${overflowConfirmed} more order${overflowConfirmed > 1 ? 's' : ''} in queue...
                    </div>
                  ` : ''}
                </div>
              </div>

              <!-- STAGE 2: PREPARING IN KITCHEN (Active Cooking) -->
              <div style="background: #111113; border: 1.5px solid #27272A; border-radius: 14px; display: flex; flex-direction: column; overflow: hidden;">
                <div style="background: #1E293B; color: #F1F5F9; padding: 10px 16px; font-family: var(--font-mono, monospace); font-size: 1rem; font-weight: 700; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #475569; flex-shrink: 0;">
                  <span>⏳ NOW PREPARING</span>
                  <span style="background: rgba(255,255,255,0.15); padding: 2px 8px; border-radius: 4px; font-size: 0.85rem;">${preparingTickets.length}</span>
                </div>

                <div style="padding: 1rem; flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.75rem; align-content: start; overflow-y: auto;">
                  ${visiblePreparing.length === 0 ? `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: #71717A; font-family: var(--font-mono, monospace); font-size: 0.9rem; border: 1.5px dashed #27272A; border-radius: 10px;">
                      Kitchen currently idle
                    </div>
                  ` : visiblePreparing.map(o => `
                    <div style="background: #18181B; border: 1.5px solid #3F3F46; border-radius: 10px; padding: 1rem 0.6rem; text-align: center;">
                      <div style="font-family: var(--font-mono, monospace); font-size: 2rem; font-weight: 700; color: #E4E4E7; line-height: 1; white-space: nowrap;">
                        ${escapeHtml(o.token || o.tokenNumber)}
                      </div>
                      <div style="font-family: var(--font-mono, monospace); font-size: 0.75rem; color: #FB923C; margin-top: 6px; font-weight: 600;">
                        ${o.estimatedMinutes ? `Est. ~${o.estimatedMinutes}m 🔥` : 'Cooking 🔥'}
                      </div>
                    </div>
                  `).join('')}

                  ${overflowPreparing > 0 ? `
                    <div style="grid-column: 1 / -1; background: rgba(249, 115, 22, 0.1); border: 1px dashed #EA580C; color: #FDBA74; padding: 8px; border-radius: 8px; text-align: center; font-family: var(--font-mono, monospace); font-size: 0.8rem; font-weight: 600;">
                      +${overflowPreparing} more cooking in kitchen...
                    </div>
                  ` : ''}
                </div>
              </div>

              <!-- STAGE 3: READY FOR PICKUP (Handover Counter) -->
              <div style="background: #111113; border: 1.5px solid #14532D; border-radius: 14px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 0 30px rgba(34,197,94,0.15);">
                <div style="background: #15803D; color: #FFF; padding: 10px 16px; font-family: var(--font-mono, monospace); font-size: 1rem; font-weight: 700; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #22C55E; flex-shrink: 0;">
                  <span>🔔 READY FOR PICKUP</span>
                  <span style="background: rgba(255,255,255,0.25); padding: 2px 8px; border-radius: 4px; font-size: 0.85rem;">${readyTickets.length}</span>
                </div>

                <div style="padding: 1rem; flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 0.85rem; align-content: start; overflow-y: auto;">
                  ${visibleReady.length === 0 ? `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: #71717A; font-family: var(--font-mono, monospace); font-size: 0.9rem; border: 1.5px dashed #27272A; border-radius: 10px;">
                      Preparing next batch of tokens...
                    </div>
                  ` : visibleReady.map(o => `
                    <div class="tb-ambient-pulse" style="background: #14532D; border: 2.5px solid #22C55E; border-radius: 12px; padding: 1.1rem 0.6rem; text-align: center; box-shadow: 0 0 20px rgba(34,197,94,0.35);">
                      <div style="font-family: var(--font-mono, monospace); font-size: 2.2rem; font-weight: 900; color: #4ADE80; line-height: 1; white-space: nowrap;">
                        ${escapeHtml(o.token || o.tokenNumber)}
                      </div>
                      <div style="font-family: var(--font-mono, monospace); font-size: 0.75rem; color: #BBF7D0; margin-top: 6px; font-weight: 700; letter-spacing: 0.05em; white-space: nowrap;">
                        COLLECT NOW 🟢
                      </div>
                    </div>
                  `).join('')}

                  ${overflowReady > 0 ? `
                    <div style="grid-column: 1 / -1; background: rgba(34, 197, 94, 0.12); border: 1px dashed #22C55E; color: #86EFAC; padding: 8px; border-radius: 8px; text-align: center; font-family: var(--font-mono, monospace); font-size: 0.8rem; font-weight: 600;">
                      +${overflowReady} more ready at counter...
                    </div>
                  ` : ''}
                </div>
              </div>

            </div>
          `}

          <!-- TV Bottom Strip -->
          <div style="margin-top: 1rem; border-top: 1px solid #27272A; padding-top: 0.8rem; display: flex; justify-content: space-between; align-items: center; font-family: var(--font-mono, monospace); font-size: 0.75rem; color: #71717A; flex-shrink: 0;">
            <div style="display: flex; gap: 1.5rem;">
              <span>🟡 1. Order Placed & Confirmed</span>
              <span>⏳ 2. Kitchen Preparation</span>
              <span style="color: #4ADE80;">🟢 3. Counter Handover</span>
            </div>
            <div>
              <span>🔊 Web Audio: Click screen once to enable chimes</span>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  // Initial synchronous render
  render();

  // Independent 1-second clock updater
  clockInterval = setInterval(() => {
    const clockEl = container.querySelector('#tv-live-clock');
    if (clockEl) {
      clockEl.textContent = getFormattedTime();
    }
  }, 1000);

  // Stale data heartbeat monitor (TB-TV-STALE-TIMER)
  staleInterval = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - lastDataReceivedAt) / 1000);
    if (elapsedSec > 60 && !isStale) {
      isStale = true;
      render();
    }
  }, 10000);

  // Authoritative real-time public live queue subscription (Zero PII, Zero credentials needed)
  const queueDocRef = doc(db, 'publicLiveQueue', 'current');
  unsubscribeQueue = onSnapshot(queueDocRef, (snap) => {
    lastDataReceivedAt = Date.now();
    isStale = false;
    lastFormattedTime = getFormattedTime();

    if (snap.exists()) {
      const data = snap.data();
      confirmedTickets = Array.isArray(data.confirmed) ? data.confirmed : [];
      preparingTickets = Array.isArray(data.preparing) ? data.preparing : [];
      readyTickets = Array.isArray(data.ready) ? data.ready : [];

      // Check for newly ready tickets to trigger chime
      let hasNewReady = false;
      readyTickets.forEach(item => {
        const token = item.token || item.tokenNumber;
        if (token && !knownReadyTokens.has(token)) {
          knownReadyTokens.add(token);
          if (!isFirstLoad) {
            hasNewReady = true;
          }
        }
      });
      if (hasNewReady) {
        playReadyChime();
      }
      isFirstLoad = false;

      // Clean up departed tokens
      const currentReadySet = new Set(readyTickets.map(item => item.token || item.tokenNumber));
      for (const t of knownReadyTokens) {
        if (!currentReadySet.has(t)) {
          knownReadyTokens.delete(t);
        }
      }
    } else {
      confirmedTickets = [];
      preparingTickets = [];
      readyTickets = [];
    }
    render();
  }, (err) => {
    console.warn("TV live queue subscription notice:", err);
    isStale = true;
    render();
  });
}

export function cleanupTvDisplayView() {
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
  if (staleInterval) {
    clearInterval(staleInterval);
    staleInterval = null;
  }
  if (unsubscribeQueue) {
    try { unsubscribeQueue(); } catch (_) {}
    unsubscribeQueue = null;
  }
  confirmedTickets = [];
  preparingTickets = [];
  readyTickets = [];
}

