// Kitchen Display System (KDS) & Counter Operations View
import { appState } from '../state.js';
import { STATIONS } from '../data/menu.js';

let selectedStationFilter = 'all';

export function renderKitchenView(container) {
  const { orders } = appState;

  // Filter orders by station if selected
  const activeOrders = orders.filter(o => o.status !== 'served');

  const cookQueueOrders = activeOrders.filter(o => 
    (o.status === 'ordered' || o.status === 'cooking') && 
    (selectedStationFilter === 'all' || o.primaryStation === selectedStationFilter)
  );

  const serveQueueOrders = activeOrders.filter(o => 
    o.status === 'ready' || 
    (o.tierHighest !== 'tier3_cook' && o.status === 'ordered')
  );

  container.innerHTML = `
    <div class="main-wrapper">
      <!-- KDS Control Bar -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
        <div>
          <h2 style="font-family: var(--font-display); font-size: 2rem; letter-spacing: 0.05em; line-height: 1;">KITCHEN DISPATCH & COUNTER SYSTEM</h2>
          <div style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary);">
            Active Queue Load: ${activeOrders.length} orders · Auto-throttling active
          </div>
        </div>

        <!-- Station Selector Filter -->
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          <button 
            class="station-filter-btn ${selectedStationFilter === 'all' ? 'active' : ''}"
            data-station="all"
            style="padding: 6px 12px; border-radius: 6px; border: 2px solid ${selectedStationFilter === 'all' ? 'var(--ink-primary)' : 'var(--border-light)'}; background: ${selectedStationFilter === 'all' ? 'var(--ink-primary)' : '#FFF'}; color: ${selectedStationFilter === 'all' ? '#FFF' : 'var(--ink-primary)'}; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;"
          >
            All Stations
          </button>
          ${STATIONS.map(st => `
            <button 
              class="station-filter-btn ${selectedStationFilter === st.id ? 'active' : ''}"
              data-station="${st.id}"
              style="padding: 6px 12px; border-radius: 6px; border: 2px solid ${selectedStationFilter === st.id ? 'var(--ink-primary)' : 'var(--border-light)'}; background: ${selectedStationFilter === st.id ? 'var(--ink-primary)' : '#FFF'}; color: ${selectedStationFilter === st.id ? '#FFF' : 'var(--ink-primary)'}; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;"
            >
              ${st.name.split(' ')[0]} ${st.name.split(' ')[1]}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- KDS Dual Columns -->
      <div class="kds-container">
        <!-- COLUMN 1: COOK QUEUE (Made-to-Order) -->
        <div class="kds-column" style="border-top: 6px solid #2563EB;">
          <div class="kds-header">
            <h3>
              <span>🍳 COOK QUEUE</span>
              <span style="font-family: var(--font-mono); font-size: 1rem; background: #EFF6FF; color: #1D4ED8; padding: 2px 10px; border-radius: 9999px;">
                ${cookQueueOrders.length} active
              </span>
            </h3>
            <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-muted);">Made-to-Order (Dosa/Wok/Grill)</span>
          </div>

          <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 1rem;">
            ${cookQueueOrders.length === 0 ? `
              <div style="text-align: center; padding: 3rem 1rem; color: var(--ink-muted); font-family: var(--font-mono); font-size: 0.9rem;">
                ✓ Cook queue is clear! All active orders prepared.
              </div>
            ` : cookQueueOrders.map(order => {
              const elapsedMinutes = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
              const isUrgent = elapsedMinutes >= 6;

              return `
                <div class="kds-card ${isUrgent ? 'urgent' : ''}">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                    <div>
                      <span style="font-family: var(--font-display); font-size: 2rem; color: var(--ink-primary); line-height: 1;">${order.tokenNumber}</span>
                      <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-muted); margin-left: 6px;">[${order.studentName}]</span>
                    </div>
                    <div style="text-align: right;">
                      <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: ${isUrgent ? 'var(--chili-red)' : 'var(--ink-secondary)'};">
                        ⏱️ ${elapsedMinutes}m ago
                      </span>
                      <div style="font-size: 0.7rem; font-family: var(--font-mono); color: var(--ink-muted);">${order.pickupSlot}</div>
                    </div>
                  </div>

                  <!-- Items list -->
                  <div style="background: #FFFFFF; border: 1px solid var(--border-light); border-radius: 6px; padding: 0.75rem; margin-bottom: 0.75rem; font-family: var(--font-mono);">
                    ${order.items.map(it => `
                      <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 0.95rem; margin-bottom: 3px;">
                        <span>${it.quantity}x ${it.name}</span>
                        ${it.variant && it.variant !== 'Regular' ? `<span style="font-size: 0.75rem; color: var(--ink-muted);">[${it.variant}]</span>` : ''}
                      </div>
                      ${it.customOptions?.bread ? `<div style="font-size: 0.75rem; color: #B45309;">→ Bread: ${it.customOptions.bread}</div>` : ''}
                    `).join('')}
                  </div>

                  <!-- Kitchen Action Buttons -->
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                    ${order.status === 'ordered' ? `
                      <button 
                        class="kds-action-btn" 
                        data-action="start-cooking" 
                        data-order-id="${order.id}"
                        style="grid-column: 1 / -1; background: #2563EB; color: #FFF; border: none; padding: 8px; border-radius: 6px; font-family: var(--font-mono); font-weight: 700; font-size: 0.85rem; cursor: pointer;"
                      >
                        🔥 START COOKING
                      </button>
                    ` : `
                      <button 
                        class="kds-action-btn" 
                        data-action="mark-ready" 
                        data-order-id="${order.id}"
                        style="grid-column: 1 / -1; background: var(--curry-green); color: #FFF; border: none; padding: 10px; border-radius: 6px; font-family: var(--font-mono); font-weight: 700; font-size: 0.95rem; cursor: pointer; box-shadow: 0 3px 0 #14532D;"
                      >
                        ✓ MARK COOKED & SEND TO COUNTER
                      </button>
                    `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- COLUMN 2: SERVE QUEUE (Counter Handoff & Batch-Ready) -->
        <div class="kds-column" style="border-top: 6px solid var(--curry-green);">
          <div class="kds-header">
            <h3>
              <span>🍱 SERVE & HANDOFF QUEUE</span>
              <span style="font-family: var(--font-mono); font-size: 1rem; background: #DCFCE7; color: #15803D; padding: 2px 10px; border-radius: 9999px;">
                ${serveQueueOrders.length} ready
              </span>
            </h3>
            <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-muted);">Plating & Pickup Counter</span>
          </div>

          <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 1rem;">
            ${serveQueueOrders.length === 0 ? `
              <div style="text-align: center; padding: 3rem 1rem; color: var(--ink-muted); font-family: var(--font-mono); font-size: 0.9rem;">
                Waiting for cooked dishes or new batch orders...
              </div>
            ` : serveQueueOrders.map(order => `
              <div class="kds-card" style="background: #F0FDF4; border-color: var(--curry-green);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                  <div>
                    <span style="font-family: var(--font-display); font-size: 2.25rem; color: var(--curry-green); line-height: 1;">${order.tokenNumber}</span>
                    <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-left: 6px;">${order.studentName} (${order.studentRoll})</span>
                  </div>
                  <div style="text-align: right;">
                    <div style="font-family: var(--font-mono); font-weight: 800; font-size: 1.1rem; color: var(--ink-primary); background: #FFF; padding: 2px 8px; border-radius: 4px; border: 1px dashed #15803D;">
                      PIN: ${order.pinCode}
                    </div>
                    <div style="font-size: 0.7rem; font-family: var(--font-mono); color: ${order.paymentStatus === 'PAID' ? 'var(--curry-green)' : '#DC2626'}; font-weight: 700;">
                      ${order.paymentMethod} [${order.paymentStatus}]
                    </div>
                  </div>
                </div>

                <!-- Items to Plate/Hand over -->
                <div style="background: #FFFFFF; border: 1px solid #BBF7D0; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.75rem; font-family: var(--font-mono);">
                  ${order.items.map(it => `
                    <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 0.9rem; margin-bottom: 2px;">
                      <span>${it.quantity}x ${it.name}</span>
                      <span style="color: var(--ink-muted);">₹${it.price * it.quantity}</span>
                    </div>
                    ${it.customOptions?.bread ? `<div style="font-size: 0.75rem; color: #B45309;">→ ${it.customOptions.bread}</div>` : ''}
                  `).join('')}
                </div>

                <!-- Handover Button -->
                <button 
                  class="kds-action-btn" 
                  data-action="mark-served" 
                  data-order-id="${order.id}"
                  style="width: 100%; background: var(--ink-primary); color: #FFF; border: none; padding: 10px; border-radius: 6px; font-family: var(--font-mono); font-weight: 700; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;"
                >
                  <span>✓ HANDED OVER TO STUDENT (CLEAR)</span>
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  attachKitchenViewEvents(container);
}

function attachKitchenViewEvents(container) {
  // Station filter buttons
  container.querySelectorAll('.station-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedStationFilter = btn.getAttribute('data-station');
      renderKitchenView(container);
    });
  });

  // Action buttons (Start Cooking, Mark Ready, Mark Served)
  container.querySelectorAll('.kds-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-order-id');
      const action = btn.getAttribute('data-action');

      if (action === 'start-cooking') {
        appState.updateOrderStatus(orderId, 'cooking');
      } else if (action === 'mark-ready') {
        appState.updateOrderStatus(orderId, 'ready');
      } else if (action === 'mark-served') {
        appState.updateOrderStatus(orderId, 'served');
      }
    });
  });
}
