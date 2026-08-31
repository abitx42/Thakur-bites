// Big Screen TV Token Board View for Canteen Wall Display connected to live Firestore
import { subscribeOrders } from '../firebase.js?v=4';
import { escapeHtml } from './escapeHtml.js';

let unsubscribeOrders = null;
let currentOrders = [];
let clockInterval = null;

export function renderTvDisplayView(container) {
  if (unsubscribeOrders) {
    unsubscribeOrders();
  }
  if (clockInterval) {
    clearInterval(clockInterval);
  }

  function getFormattedTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function render() {
    const readyOrders = currentOrders.filter(o => o.status === 'ready');
    const prepOrders = currentOrders.filter(o => o.status === 'preparing' || o.status === 'placed');

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

          <!-- TV Split Columns -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 2rem;">
            
            <!-- Column 1: READY / NOW SERVING -->
            <div>
              <div style="background: #15803D; color: #FFF; padding: 12px 18px; border-radius: 8px; font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;">
                <span>🔔 READY FOR PICKUP</span>
                <span style="background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 4px; font-size: 0.9rem;">${readyOrders.length}</span>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1.2rem;">
                ${readyOrders.length === 0 ? `
                  <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: #71717A; font-family: var(--font-mono); font-size: 1.1rem; border: 2px dashed #27272A; border-radius: 12px;">
                    Preparing next batch of tokens...
                  </div>
                ` : readyOrders.map(o => `
                  <div style="background: #14532D; border: 2.5px solid #22C55E; border-radius: 14px; padding: 1.4rem 1rem; text-align: center; box-shadow: 0 0 25px rgba(34,197,94,0.35);">
                    <div style="font-family: var(--font-mono); font-size: 2.6rem; font-weight: 900; color: #4ADE80; line-height: 1;">
                      ${escapeHtml(o.tokenNumber)}
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
                <span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; font-size: 0.9rem;">${prepOrders.length}</span>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1.2rem;">
                ${prepOrders.length === 0 ? `
                  <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: #71717A; font-family: var(--font-mono); font-size: 1.1rem; border: 2px dashed #27272A; border-radius: 12px;">
                    No pending orders
                  </div>
                ` : prepOrders.map(o => `
                  <div style="background: #18181B; border: 1.5px solid #3F3F46; border-radius: 14px; padding: 1.4rem 1rem; text-align: center;">
                    <div style="font-family: var(--font-mono); font-size: 2.6rem; font-weight: 700; color: #E4E4E7; line-height: 1;">
                      ${escapeHtml(o.tokenNumber)}
                    </div>
                    <div style="font-family: var(--font-mono); font-size: 0.8rem; color: #A1A1AA; margin-top: 8px;">
                      ${o.status === 'preparing' ? 'Cooking 🔥' : 'In Queue ⏳'}
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

  // Fix 8: Independent 1-second clock updater
  clockInterval = setInterval(() => {
    const clockEl = container.querySelector('#tv-live-clock');
    if (clockEl) {
      clockEl.textContent = getFormattedTime();
    }
  }, 1000);

  unsubscribeOrders = subscribeOrders((orders) => {
    currentOrders = orders;
    render();
  });
}
