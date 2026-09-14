import { staffAuth, renderPinPadModal, getRegisteredWorkstation, onStaffAuthStateChanged } from './auth.js?v=12';
import { renderKitchenView, cleanupKitchenView } from './views/kitchenView.js?v=7';
import { renderPickupView, cleanupPickupView } from './views/pickupView.js?v=7';
import { renderCashierView, cleanupCashierView } from './views/cashierView.js?v=1';
import { renderAdminView, cleanupAdminView } from './views/adminView.js?v=10';
import { renderDailyBoardModal } from './views/dailyBoardModal.js?v=1';
import { subscribeDailyBoard, saveDailyBoard } from './firebase.js?v=9';
import { initSecuritySentinel } from './securitySentinel.js?v=1';

initSecuritySentinel({ blockShortcuts: true });

let currentStaffWorkstationView = 'kitchen'; // 'kitchen' | 'pickup' | 'cashier' | 'menu'
let currentDailyBoardState = null;
let isBoardSubscribed = false;

function initStaffWorkstation() {
  const root = document.getElementById('app-root');
  if (!root) return;

  if (!isBoardSubscribed) {
    isBoardSubscribed = true;
    subscribeDailyBoard((board) => {
      currentDailyBoardState = board;
      updateBreadStockBarUi(root);
    });
  }

  function updateBreadStockBarUi(container) {
    const rotiBtn = container.querySelector('#quick-toggle-roti-btn');
    const puriBtn = container.querySelector('#quick-toggle-puri-btn');
    if (rotiBtn) {
      const isRotiOk = currentDailyBoardState?.rotiAvailable !== false;
      rotiBtn.style.border = `1.5px solid ${isRotiOk ? '#86EFAC' : '#FCA5A5'}`;
      rotiBtn.style.background = isRotiOk ? '#F0FDF4' : '#FEF2F2';
      rotiBtn.style.color = isRotiOk ? '#166534' : '#DC2626';
      rotiBtn.innerHTML = `🫓 Chapati: <strong>${isRotiOk ? 'IN STOCK ✅' : 'OVER / SOLD OUT ❌'}</strong> <span style="font-size: 0.7rem; opacity: 0.85;">(Click to switch)</span>`;
    }
    if (puriBtn) {
      const isPuriOk = currentDailyBoardState?.puriAvailable !== false;
      puriBtn.style.border = `1.5px solid ${isPuriOk ? '#86EFAC' : '#FCA5A5'}`;
      puriBtn.style.background = isPuriOk ? '#F0FDF4' : '#FEF2F2';
      puriBtn.style.color = isPuriOk ? '#166534' : '#DC2626';
      puriBtn.innerHTML = `🟡 Poori: <strong>${isPuriOk ? 'IN STOCK ✅' : 'OVER / SOLD OUT ❌'}</strong> <span style="font-size: 0.7rem; opacity: 0.85;">(Click to switch)</span>`;
    }
  }

  function render() {
    // If not authenticated, render the Shift PIN / staff login modal
    if (!staffAuth.isAuthenticated()) {
      renderPinPadModal(root, () => {
        render();
      });
      return;
    }

    const currentRole = staffAuth.getRole() || '';
    const operationalRoles = ['kitchen', 'pickup', 'cashier', 'manager', 'admin', 'developer', 'security_admin', 'system'];
    const isAllowed = operationalRoles.includes(currentRole.toLowerCase());

    if (!isAllowed) {
      root.innerHTML = `
        <div style="max-width: 500px; margin: 4rem auto; background: #FFF; border: 2px solid #FCA5A5; border-radius: 12px; padding: 2rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">🚫</div>
          <h2 style="font-family: var(--font-display); font-size: 2rem; color: #DC2626; margin: 0 0 0.5rem 0;">
            ACCESS DENIED
          </h2>
          <p style="font-family: var(--font-sans); color: var(--ink-secondary); font-size: 0.9rem; margin-bottom: 1.5rem;">
            Your account role (<code>${currentRole}</code>) lacks operational kitchen/pickup capabilities for this workstation.
          </p>
          <div style="display: flex; gap: 10px; justify-content: center;">
            <a href="index.html" style="padding: 10px 16px; border-radius: 8px; background: var(--bg-surface); border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; text-decoration: none; color: var(--ink-primary);">
              ← Back to Portal Home
            </a>
            <button id="access-denied-signout-btn" style="padding: 10px 16px; border-radius: 8px; background: #DC2626; border: none; color: #FFF; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;">
              Sign Out
            </button>
          </div>
        </div>
      `;
      root.querySelector('#access-denied-signout-btn')?.addEventListener('click', async () => {
        await staffAuth.logout();
        render();
      });
      return;
    }

    const isElevatedRole = ['admin', 'manager', 'developer', 'security_admin'].includes(currentRole.toLowerCase());
    const regWs = getRegisteredWorkstation();

    root.innerHTML = `
      <!-- Staff Workstation Header -->
      <header class="app-header" style="background: #FFF; border-bottom: 2px solid var(--border-light); padding: 0.8rem 1.2rem; position: sticky; top: 0; z-index: 100;">
        <div style="max-width: 1400px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          
          <!-- Brand Badge -->
          <div style="display: flex; align-items: center; gap: 10px;">
            <a href="index.html" style="text-decoration: none; display: flex; align-items: center; gap: 10px;">
              <div style="width: 36px; height: 36px; background: var(--brand-red); color: #FFF; font-family: var(--font-display); font-size: 1.4rem; display: flex; align-items: center; justify-content: center; border-radius: 8px;">
                TB
              </div>
            </a>
            <div>
              <div style="font-family: var(--font-display); font-size: 1.5rem; letter-spacing: 0.05em; line-height: 1; color: var(--ink-primary);">
                THAKUR BITES · STAFF WORKSTATION
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #16A34A; font-weight: 700; display: flex; align-items: center; gap: 6px; margin-top: 2px; flex-wrap: wrap;">
                <span style="display: inline-block; width: 7px; height: 7px; background: #22C55E; border-radius: 50%;"></span>
                ONLINE · LIVE FIRESTORE
                <span style="background: #DCEACB; color: #2C4A1E; padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; text-transform: uppercase;">
                  STATION ROLE: ${currentRole}
                </span>
                ${regWs ? `
                  <span style="background: #E0E7FF; color: #3730A3; padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 700;">
                    🖥️ ${regWs.name || regWs.id}
                  </span>
                ` : `
                  <button id="staff-enroll-hardware-btn" style="background: #FEF3C7; color: #92400E; border: 1px solid #F59E0B; padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; cursor: pointer;">
                    ⚠️ UNREGISTERED TERMINAL (ENROLL)
                  </button>
                `}
              </div>
            </div>
          </div>

          <!-- Station Views Switcher -->
          <nav class="staff-nav-bar" style="display: flex; gap: 6px; background: var(--bg-surface); padding: 4px; border-radius: 999px; border: 1.5px solid var(--border-light);">
            <button class="staff-nav-btn ${currentStaffWorkstationView === 'kitchen' ? 'active' : ''}" data-view="kitchen">
              🍳 Kitchen KDS
            </button>
            <button class="staff-nav-btn ${currentStaffWorkstationView === 'pickup' ? 'active' : ''}" data-view="pickup">
              📦 Pickup Counter
            </button>
            <!-- Cashier POS (safely inactive for online-only phase) -->
            <!--
            <button class="staff-nav-btn ${currentStaffWorkstationView === 'cashier' ? 'active' : ''}" data-view="cashier">
              💵 Cashier POS
            </button>
            -->
            <button class="staff-nav-btn ${currentStaffWorkstationView === 'menu' ? 'active' : ''}" data-view="menu">
              📋 Menu & Stock (Add / Quantity)
            </button>
            <button id="staff-open-daily-board-btn" style="background: #FFFBEB; color: #92400E; border: 1.5px solid #F59E0B; padding: 6px 12px; border-radius: 999px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;">
              🍱 Today's Daily Board
            </button>
          </nav>

          <!-- Quick Portal Actions -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <a href="tv.html" target="_blank" style="text-decoration: none; background: #09090B; color: #FFF; border: 1.5px solid #27272A; padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
              📺 Token TV
            </a>
            ${isElevatedRole ? `
              <a href="admin.html" style="text-decoration: none; background: #FFF; border: 1.5px solid var(--border-light); padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; color: var(--ink-secondary);">
                📋 Admin Portal
              </a>
            ` : ''}
            <button id="signout-station-btn" style="background: transparent; border: 1.5px solid var(--border-light); padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; cursor: pointer; color: var(--ink-secondary);">
              🔒 Sign Out
            </button>
          </div>
        </div>
      </header>

      <!-- Live Bread Availability Quick Bar (Chapati & Poori Stock) -->
      <div id="staff-bread-stock-bar" style="background: #FFFBEB; border-bottom: 2px solid #FDE68A; padding: 6px 1.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: #92400E; display: flex; align-items: center; gap: 6px;">
            🍞 LIVE BREAD STOCK:
          </span>
          <button id="quick-toggle-roti-btn" style="padding: 5px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer; border: 1.5px solid ${currentDailyBoardState?.rotiAvailable !== false ? '#86EFAC' : '#FCA5A5'}; background: ${currentDailyBoardState?.rotiAvailable !== false ? '#F0FDF4' : '#FEF2F2'}; color: ${currentDailyBoardState?.rotiAvailable !== false ? '#166534' : '#DC2626'}; box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
            🫓 Chapati: <strong>${currentDailyBoardState?.rotiAvailable !== false ? 'IN STOCK ✅' : 'OVER / SOLD OUT ❌'}</strong> <span style="font-size: 0.7rem; opacity: 0.85;">(Click to switch)</span>
          </button>
          <button id="quick-toggle-puri-btn" style="padding: 5px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer; border: 1.5px solid ${currentDailyBoardState?.puriAvailable !== false ? '#86EFAC' : '#FCA5A5'}; background: ${currentDailyBoardState?.puriAvailable !== false ? '#F0FDF4' : '#FEF2F2'}; color: ${currentDailyBoardState?.puriAvailable !== false ? '#166534' : '#DC2626'}; box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
            🟡 Poori: <strong>${currentDailyBoardState?.puriAvailable !== false ? 'IN STOCK ✅' : 'OVER / SOLD OUT ❌'}</strong> <span style="font-size: 0.7rem; opacity: 0.85;">(Click to switch)</span>
          </button>
        </div>
        <span style="font-family: var(--font-sans); font-size: 0.75rem; color: #B45309; font-weight: 500;">
          💡 When marked Over, student app automatically pre-selects available bread &amp; shows upfront notice to prevent cancellations.
        </span>
      </div>

      <!-- Main Station Target -->
      <main id="staff-view-target" style="min-height: calc(100vh - 80px); background: var(--bg-primary);"></main>

      <!-- Modal Container -->
      <div id="staff-modal-container"></div>
    `;

    root.querySelector('#quick-toggle-roti-btn')?.addEventListener('click', async () => {
      const btn = root.querySelector('#quick-toggle-roti-btn');
      if (btn) btn.disabled = true;
      const currentVal = currentDailyBoardState?.rotiAvailable !== false;
      await saveDailyBoard({
        ...(currentDailyBoardState || {}),
        rotiAvailable: !currentVal,
      });
      if (btn) btn.disabled = false;
    });

    root.querySelector('#quick-toggle-puri-btn')?.addEventListener('click', async () => {
      const btn = root.querySelector('#quick-toggle-puri-btn');
      if (btn) btn.disabled = true;
      const currentVal = currentDailyBoardState?.puriAvailable !== false;
      await saveDailyBoard({
        ...(currentDailyBoardState || {}),
        puriAvailable: !currentVal,
      });
      if (btn) btn.disabled = false;
    });

    root.querySelector('#staff-open-daily-board-btn')?.addEventListener('click', () => {
      const modalCont = root.querySelector('#staff-modal-container');
      if (modalCont) {
        renderDailyBoardModal(modalCont);
      }
    });

    root.querySelector('#staff-enroll-hardware-btn')?.addEventListener('click', () => {
      const modalCont = root.querySelector('#staff-modal-container');
      if (modalCont) {
        renderPinPadModal(modalCont, () => render());
      }
    });

    function cleanupCurrentStation() {
      try { cleanupKitchenView(); } catch (_) {}
      try { cleanupPickupView(); } catch (_) {}
      try { cleanupCashierView(); } catch (_) {}
      try { cleanupAdminView(); } catch (_) {}
    }

    // Attach Station View Switcher Listeners
    root.querySelectorAll('.staff-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        cleanupCurrentStation();
        currentStaffWorkstationView = btn.getAttribute('data-view');
        render();
      });
    });

    root.querySelector('#signout-station-btn')?.addEventListener('click', async () => {
      cleanupCurrentStation();
      await staffAuth.logout();
      render();
    });

    const viewTarget = root.querySelector('#staff-view-target');
    if (!viewTarget) return;

    if (currentStaffWorkstationView === 'kitchen') {
      renderKitchenView(viewTarget);
    } else if (currentStaffWorkstationView === 'pickup') {
      renderPickupView(viewTarget);
    } else if (currentStaffWorkstationView === 'menu') {
      renderAdminView(viewTarget, { staffMode: true });
    } else if (currentStaffWorkstationView === 'cashier') {
      // Inactive phase fallback
      currentStaffWorkstationView = 'kitchen';
      renderKitchenView(viewTarget);
    }
  }

  render();
  onStaffAuthStateChanged(() => {
    try { cleanupKitchenView(); } catch (_) {}
    try { cleanupPickupView(); } catch (_) {}
    try { cleanupCashierView(); } catch (_) {}
    try { cleanupAdminView(); } catch (_) {}
    render();
  });
}

window.addEventListener('DOMContentLoaded', initStaffWorkstation);
