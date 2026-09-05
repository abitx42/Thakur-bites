// Big Screen TV Token Board View for Canteen Wall Display connected to publicLiveQueue/current
import { db } from '../firebase.js?v=4';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { escapeHtml } from './escapeHtml.js';

let unsubscribeQueue = null;
let readyTickets = [];
let preparingTickets = [];
let clockInterval = null;
let staleInterval = null;
let lastDataReceivedAt = Date.now();
let isStale = false;
let lastFormattedTime = '';

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
    container.innerHTML = `
      <div style="padding: 1.5rem; max-width: 1600px; margin: 0 auto;">
        <div class="tv-display-screen" style="background: #09090B; border: 2px solid #27272A; border-radius: 16px; padding: 2rem; color: #FFF; min-height: 80vh;">
          <!-- TV Top Bar -->
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #27272A; padding-bottom: 1.5rem;">
            <div style="display: flex; align-items: center; gap: 1rem;">
              <div class="brand-logo" style="width: 50px; height: 50px; font-size: 1.8rem; background: var(--brand-red); color: #FFF; font-family: var(--font-display); display: flex; align-items: center; justify-content: center; border-radius: 8px;">TB</div>
              <div>
                <h1 style="font-family: var(--font-display); font-size: 2.75rem; letter-spacing: 0.05em; line-height: 1; color: #FFF; margin: 0;">
                  THAKUR BITES · TOKEN DISPLAY
                </h1>
                <div style="font-family: var(--font-mono); font-size: 0.85rem; color: #A1A1AA; margin-top: 4px;">
                  TCET CANTEEN · PLEASE PROCEED TO COUNTER WHEN YOUR TOKEN TURNS GREEN
                </div>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 1.5rem;">
              <div style="text-align: right;">
                <div id="tv-live-clock" style="font-family: var(--font-mono); font-size: 2.25rem; font-weight: 700; color: #EFA727; line-height: 1;">
                  ${getFormattedTime()}
                </div>
                <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #71717A; text-transform: uppercase; margin-top: 2px;">
                  CAMPUS LIVE TIME
                </div>
              </div>
            </div>
          </div>

          ${isStale ? `
            <div style="background: rgba(234, 179, 8, 0.15); border: 1.5px solid #EAB308; color: #FACC15; padding: 12px 18px; border-radius: 10px; font-family: var(--font-mono); font-size: 0.95rem; margin-top: 1.5rem; display: flex; align-items: center; gap: 10px;">
              <span>⚠️</span>
              <span><strong>CONNECTION STALE:</strong> Showing last known queue from ${lastFormattedTime || 'server'}. Reconnecting to canteen system...</span>
            </div>
          ` : ''}

          <!-- TV Split Columns -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 2rem;">
            
            <!-- Column 1: READY / NOW SERVING -->
            <div>
              <div style="background: #15803D; color: #FFF; padding: 12px 18px; border-radius: 8px; font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;">
                <span>🔔 READY FOR PICKUP</span>
                <span style="background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 4px; font-size: 0.9rem;">${readyTickets.length}</span>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1.2rem;">
                ${readyTickets.length === 0 ? `
                  <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: #71717A; font-family: var(--font-mono); font-size: 1.1rem; border: 2px dashed #27272A; border-radius: 12px;">
                    Preparing next batch of tokens...
                  </div>
                ` : readyTickets.map(o => `
                  <div style="background: #14532D; border: 2.5px solid #22C55E; border-radius: 14px; padding: 1.4rem 1rem; text-align: center; box-shadow: 0 0 25px rgba(34,197,94,0.35);">
                    <div style="font-family: var(--font-mono); font-size: 2.6rem; font-weight: 900; color: #4ADE80; line-height: 1;">
                      ${escapeHtml(o.token || o.tokenNumber)}
                    </div>
                    <div style="font-family: var(--font-mono); font-size: 0.8rem; color: #BBF7D0; margin-top: 8px; font-weight: 700; letter-spacing: 0.05em;">
                      COLLECT NOW 🟢
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Column 2: PREPARING NOW -->
            <div>
              <div style="background: #27272A; color: #FFF; padding: 12px 18px; border-radius: 8px; font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;">
                <span>⏳ PREPARING IN KITCHEN</span>
                <span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; font-size: 0.9rem;">${preparingTickets.length}</span>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1.2rem;">
                ${preparingTickets.length === 0 ? `
                  <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: #71717A; font-family: var(--font-mono); font-size: 1.1rem; border: 2px dashed #27272A; border-radius: 12px;">
                    No pending orders
                  </div>
                ` : preparingTickets.map(o => `
                  <div style="background: #18181B; border: 1.5px solid #3F3F46; border-radius: 14px; padding: 1.4rem 1rem; text-align: center;">
                    <div style="font-family: var(--font-mono); font-size: 2.6rem; font-weight: 700; color: #E4E4E7; line-height: 1;">
                      ${escapeHtml(o.token || o.tokenNumber)}
                    </div>
                    <div style="font-family: var(--font-mono); font-size: 0.8rem; color: #A1A1AA; margin-top: 8px;">
                      ${o.estimatedMinutes ? `Est. ~${o.estimatedMinutes}m` : 'Cooking 🔥'}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

          </div>
        </div>
      </div>
    `;
  }

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
      readyTickets = Array.isArray(data.ready) ? data.ready : [];
      preparingTickets = Array.isArray(data.preparing) ? data.preparing : [];
    } else {
      readyTickets = [];
      preparingTickets = [];
    }
    render();
  }, (err) => {
    console.warn("TV live queue subscription notice:", err);
    isStale = true;
    render();
  });
}

