// Big Screen TV Token Board View for Canteen Wall Display
import { appState } from '../state.js';

export function renderTvDisplayView(container) {
  const { orders } = appState;

  const readyOrders = orders.filter(o => o.status === 'ready');
  const prepOrders = orders.filter(o => o.status === 'cooking' || o.status === 'ordered');

  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  container.innerHTML = `
    <div style="padding: 1.5rem; max-width: 1600px; margin: 0 auto;">
      <div class="tv-display-screen">
        <!-- TV Top Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #27272A; padding-bottom: 1.5rem;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div class="brand-logo" style="width: 50px; height: 50px; font-size: 2rem;">TB</div>
            <div>
              <h1 style="font-family: var(--font-display); font-size: 2.75rem; letter-spacing: 0.05em; line-height: 1; color: #FFF;">
                THAKUR BITES · TOKEN DISPLAY
              </h1>
              <div style="font-family: var(--font-mono); font-size: 0.85rem; color: #A1A1AA;">
                THAKUR COLLEGE CANTEEN · PLEASE COLLECT WHEN YOUR TOKEN TURNS GREEN
              </div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 1.5rem;">
            <div style="text-align: right;">
              <div style="font-family: var(--font-mono); font-size: 2.25rem; font-weight: 700; color: var(--turmeric-yellow); line-height: 1;">
                ${currentTime}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #71717A; text-transform: uppercase;">
                CAMPUS LIVE TIME
              </div>
            </div>

            <button 
              id="tv-sound-test-btn"
              style="background: #27272A; color: #FFF; border: 1px solid #3F3F46; padding: 8px 14px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; cursor: pointer;"
            >
              🔔 Test Bell
            </button>
          </div>
        </div>

        <!-- TV Split Columns -->
        <div class="tv-columns">
          <!-- Column 1: READY / NOW SERVING -->
          <div>
            <div class="tv-col-header tv-ready-header">
              <span>🔔 NOW SERVING · READY AT COUNTER</span>
            </div>

            <div class="tv-token-grid">
              ${readyOrders.length === 0 ? `
                <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: #71717A; font-family: var(--font-mono); font-size: 1.1rem; border: 2px dashed #27272A; border-radius: 12px;">
                  Cooking next batch of tokens...
                </div>
              ` : readyOrders.map(order => `
                <div class="tv-token-card tv-token-ready">
                  <div class="tv-token-number">${order.tokenNumber}</div>
                  <div style="font-size: 0.85rem; font-weight: 700; margin-top: 4px; color: #BBF7D0;">
                    ${order.studentName.split(' ')[0]} (${order.studentRoll.split('-')[1] || 'TCET'})
                  </div>
                  <div style="font-size: 0.75rem; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; margin-top: 6px; display: inline-block;">
                    PIN: ${order.pinCode}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Column 2: PREPARING -->
          <div>
            <div class="tv-col-header tv-prep-header">
              <span>⏳ PREPARING IN KITCHEN</span>
            </div>

            <div class="tv-token-grid">
              ${prepOrders.length === 0 ? `
                <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: #71717A; font-family: var(--font-mono); font-size: 1.1rem; border: 2px dashed #27272A; border-radius: 12px;">
                  All ordered items are ready!
                </div>
              ` : prepOrders.map(order => `
                <div class="tv-token-card tv-token-prep">
                  <div class="tv-token-number" style="color: #FBBF24;">${order.tokenNumber}</div>
                  <div style="font-size: 0.85rem; font-weight: 600; margin-top: 4px; color: #E4E4E7;">
                    ${order.studentName.split(' ')[0]}
                  </div>
                  <div style="font-size: 0.75rem; color: #A1A1AA; margin-top: 4px;">
                    ${order.status === 'cooking' ? '🔥 On Tawa/Wok' : '📋 In Queue'}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- TV Footer Ticker -->
        <div style="margin-top: 2rem; padding-top: 1rem; border-top: 1px dashed #3F3F46; display: flex; justify-content: space-between; align-items: center; font-family: var(--font-mono); font-size: 0.85rem; color: #A1A1AA;">
          <div>📢 Today's Sabjis: ${appState.todaysBoard.sabji1} & ${appState.todaysBoard.sabji2}</div>
          <div>📱 Order from phone during class to skip coupon counter</div>
        </div>
      </div>
    </div>
  `;

  const bellBtn = container.querySelector('#tv-sound-test-btn');
  if (bellBtn) {
    bellBtn.addEventListener('click', () => {
      appState.playAudioNotification('token_ready');
    });
  }
}
