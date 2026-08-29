// Canteen Manager & Today's Board Admin View
import { appState } from '../state.js';
import { MENU_ITEMS, STATIONS } from '../data/menu.js';

export function renderAdminView(container) {
  const { todaysBoard, outOfStockItems, orders, stations } = appState;

  const totalRevenue = orders.reduce((sum, o) => sum + (o.paymentStatus === 'PAID' ? o.totalAmount : 0), 0);
  const totalServed = orders.filter(o => o.status === 'served').length;
  const activeCount = orders.filter(o => o.status !== 'served').length;

  container.innerHTML = `
    <div class="main-wrapper">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
        <div>
          <h2 style="font-family: var(--font-display); font-size: 2rem; letter-spacing: 0.05em; line-height: 1;">CANTEEN MANAGER & TODAY'S BOARD</h2>
          <div style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary);">
            Control morning menu rotations, bread stock & 86 items in real-time
          </div>
        </div>

        <!-- Metric Badges -->
        <div style="display: flex; gap: 0.75rem;">
          <div style="background: #FFFFFF; border: 1px solid var(--border-light); padding: 8px 14px; border-radius: 8px; font-family: var(--font-mono);">
            <div style="font-size: 0.7rem; color: var(--ink-muted);">TOTAL SALES</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--curry-green);">₹${totalRevenue}</div>
          </div>
          <div style="background: #FFFFFF; border: 1px solid var(--border-light); padding: 8px 14px; border-radius: 8px; font-family: var(--font-mono);">
            <div style="font-size: 0.7rem; color: var(--ink-muted);">SERVED ORDERS</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--ink-primary);">${totalServed} / ${orders.length}</div>
          </div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
        <!-- Left: Today's Rotating Board Manager -->
        <div style="background: #FFFFFF; border: 2px solid var(--border-light); border-radius: 12px; padding: 1.25rem;">
          <h3 style="font-family: var(--font-display); font-size: 1.35rem; margin-bottom: 1rem; color: var(--chai-brown); display: flex; align-items: center; gap: 6px;">
            <span>📢</span>
            <span>MORNING "TODAY'S BOARD" CONFIG</span>
          </h3>

          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div>
              <label style="font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary); display: block; margin-bottom: 4px;">
                TODAY'S SABJI 1 (PANEER / SPECIAL VEG)
              </label>
              <input 
                type="text" 
                id="sabji-1-input" 
                value="${todaysBoard.sabji1}"
                style="width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-light); font-size: 0.9rem;"
              />
            </div>

            <div>
              <label style="font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary); display: block; margin-bottom: 4px;">
                TODAY'S SABJI 2 (SUKHA / SEASONAL VEG)
              </label>
              <input 
                type="text" 
                id="sabji-2-input" 
                value="${todaysBoard.sabji2}"
                style="width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-light); font-size: 0.9rem;"
              />
            </div>

            <div>
              <label style="font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary); display: block; margin-bottom: 4px;">
                CANTEEN SPECIAL DISH / DESSERT
              </label>
              <input 
                type="text" 
                id="canteen-special-input" 
                value="${todaysBoard.canteenSpecial}"
                style="width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-light); font-size: 0.9rem;"
              />
            </div>

            <!-- Bread Availability Toggles -->
            <div style="border-top: 1px dashed var(--border-light); padding-top: 1rem;">
              <label style="font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary); display: block; margin-bottom: 6px;">
                THALI BREAD COMPONENT AVAILABILITY
              </label>
              <div style="display: flex; gap: 1rem;">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">
                  <input type="checkbox" id="roti-avail-check" ${todaysBoard.rotiAvailable ? 'checked' : ''} />
                  <span>Fresh Rotis / Phulkas</span>
                </label>
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">
                  <input type="checkbox" id="puri-avail-check" ${todaysBoard.puriAvailable ? 'checked' : ''} />
                  <span>Fresh Fried Puris</span>
                </label>
              </div>
            </div>

            <button 
              id="save-board-btn"
              style="background: var(--turmeric-yellow); color: var(--ink-primary); border: none; padding: 10px; border-radius: 8px; font-family: var(--font-mono); font-weight: 700; font-size: 0.9rem; cursor: pointer;"
            >
              💾 PUBLISH UPDATES TO STUDENT APPS
            </button>
          </div>
        </div>

        <!-- Right: Out-of-Stock / Item 86 Toggles -->
        <div style="background: #FFFFFF; border: 2px solid var(--border-light); border-radius: 12px; padding: 1.25rem; display: flex; flex-direction: column;">
          <h3 style="font-family: var(--font-display); font-size: 1.35rem; margin-bottom: 0.5rem; color: var(--chili-red); display: flex; align-items: center; gap: 6px;">
            <span>🚫</span>
            <span>OUT OF STOCK / 86 TOGGLE</span>
          </h3>
          <p style="font-size: 0.8rem; color: var(--ink-muted); margin-bottom: 1rem;">
            Instantly grey-out items that ran out so students don't order them:
          </p>

          <div style="flex-grow: 1; max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; padding-right: 0.5rem;">
            ${MENU_ITEMS.map(item => {
              const is86 = outOfStockItems.has(item.id);
              return `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-light); background: ${is86 ? '#FEE2E2' : '#FFF'};">
                  <span style="font-size: 0.85rem; font-weight: 600; ${is86 ? 'text-decoration: line-through; color: #991B1B;' : ''}">${item.name}</span>
                  <button 
                    class="toggle-stock-btn" 
                    data-item-id="${item.id}"
                    style="padding: 4px 8px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; border: none; cursor: pointer; background: ${is86 ? '#DC2626' : '#22C55E'}; color: #FFF;"
                  >
                    ${is86 ? 'MARKED OUT' : 'IN STOCK'}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  attachAdminViewEvents(container);
}

function attachAdminViewEvents(container) {
  const saveBtn = container.querySelector('#save-board-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const sabji1 = container.querySelector('#sabji-1-input').value.trim();
      const sabji2 = container.querySelector('#sabji-2-input').value.trim();
      const canteenSpecial = container.querySelector('#canteen-special-input').value.trim();
      const rotiAvailable = container.querySelector('#roti-avail-check').checked;
      const puriAvailable = container.querySelector('#puri-avail-check').checked;

      appState.updateTodaysBoard({
        sabji1,
        sabji2,
        canteenSpecial,
        rotiAvailable,
        puriAvailable
      });

      alert('✓ Today\'s Board updated successfully! Reflected on all student screens.');
    });
  }

  container.querySelectorAll('.toggle-stock-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = btn.getAttribute('data-item-id');
      appState.toggleItemStock(itemId);
      renderAdminView(container);
    });
  });
}
