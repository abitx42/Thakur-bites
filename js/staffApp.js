import { staffAuth, renderPinPadModal, getRegisteredWorkstation, onStaffAuthStateChanged } from './auth.js?v=12';
import { renderKitchenView, cleanupKitchenView } from './views/kitchenView.js?v=7';
import { renderPickupView, cleanupPickupView } from './views/pickupView.js?v=7';
import { renderCashierView, cleanupCashierView } from './views/cashierView.js?v=1';
import { renderAdminView, cleanupAdminView } from './views/adminView.js?v=10';
import { renderDailyBoardModal } from './views/dailyBoardModal.js?v=1';
import { subscribeDailyBoard, saveDailyBoard } from './firebase.js?v=9';
import { initSecuritySentinel } from './securitySentinel.js?v=2';
import { escapeHtml } from './views/escapeHtml.js';
import { initNetworkSentinel } from './networkSentinel.js';

initSecuritySentinel({ blockShortcuts: true, portalName: 'Staff Workstation' });
initNetworkSentinel({ portalName: 'Staff Workstation' });

let currentStaffWorkstationView = 'kitchen'; // 'kitchen' | 'pickup' | 'cashier' | 'menu'
let currentDailyBoardState = null;
let isBoardSubscribed = false;
let isWorkstationLocked = false;
let lastActivityTime = Date.now();
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of idle inactivity

function recordActivity() {
  lastActivityTime = Date.now();
}

['mousemove', 'mousedown', 'keydown', 'touchstart', 'pointerdown', 'scroll'].forEach((evt) => {
  window.addEventListener(evt, recordActivity, { passive: true });
});

function initStaffWorkstation() {
  const root = document.getElementById('app-root');
  if (!root) return;

  // Background Inactivity Sentinel Check
  setInterval(() => {
    if (staffAuth.isAuthenticated() && !isWorkstationLocked) {
      if (Date.now() - lastActivityTime >= INACTIVITY_TIMEOUT_MS) {
        lockWorkstation('Workstation auto-locked due to 10 minutes of inactivity.');
      }
    }
  }, 15000);

  function lockWorkstation(reason = 'Workstation locked for counter security.') {
    isWorkstationLocked = true;
    cleanupCurrentStation();
    render();
  }

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
    // If not authenticated or workstation is idle/locked, render Shift PIN keypad
    if (!staffAuth.isAuthenticated() || isWorkstationLocked) {
      cleanupCurrentStation();
      renderPinPadModal(root, () => {
        isWorkstationLocked = false;
        lastActivityTime = Date.now();
        render();
      });
      return;
    }

    const currentRole = staffAuth.getRole() || '';
    const operationalRoles = ['kitchen', 'pickup', 'cashier', 'manager', 'admin', 'developer', 'security_admin', 'system'];
    const isAllowed = operationalRoles.includes(currentRole.toLowerCase());

    if (!isAllowed) {
      root.innerHTML = `
        <div style="max-width: 500px; width: calc(100% - 2rem); box-sizing: border-box; margin: 3rem auto; background: #FFF; border: 2px solid #FCA5A5; border-radius: 12px; padding: 2rem 1.25rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">🚫</div>
          <h2 style="font-family: var(--font-display); font-size: 2rem; color: #DC2626; margin: 0 0 0.5rem 0;">
            ACCESS DENIED
          </h2>
          <p style="font-family: var(--font-sans); color: var(--ink-secondary); font-size: 0.9rem; margin-bottom: 1.5rem;">
            Your account role (<code>${escapeHtml(currentRole)}</code>) lacks operational kitchen/pickup capabilities for this workstation.
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
      <!-- Canteen Staff Workstation Header -->
      <header class="staff-header">
        <div class="staff-header-inner">
          
          <div class="staff-top-row">
            <!-- Brand Badge -->
            <div class="staff-brand-section">
              <a href="portal.html" style="text-decoration: none;">
                <div style="width: 38px; height: 38px; background: var(--brand-red); color: #FFF; font-family: var(--font-display); font-size: 1.5rem; display: flex; align-items: center; justify-content: center; border-radius: 9px; font-weight: 800; box-shadow: 0 2px 5px rgba(220,38,38,0.25);">
                  TB
                </div>
              </a>
              <div>
                <div style="font-family: var(--font-display); font-size: 1.45rem; letter-spacing: 0.03em; line-height: 1.1; color: var(--ink-primary); font-weight: 800;">
                  THAKUR BITES CANTEEN
                </div>
                <div class="staff-brand-subtitle" style="font-family: var(--font-sans); font-size: 0.76rem; color: #16A34A; font-weight: 700; display: flex; align-items: center; gap: 5px; margin-top: 2px;">
                  <span style="display: inline-block; width: 7px; height: 7px; background: #22C55E; border-radius: 50%;"></span>
                  ONLINE · LIVE ORDERS
                </div>
              </div>
            </div>

            <!-- Sign Out Button -->
            <button id="signout-station-btn" class="staff-signout-btn">
              🚪 <span>Sign Out</span>
            </button>
          </div>

          <!-- Station Switcher Tabs (Horizontally scrollable on mobile) -->
          <nav class="staff-nav-bar">
            <button class="staff-nav-btn ${currentStaffWorkstationView === 'kitchen' ? 'active' : ''}" data-view="kitchen">
              🍳 Kitchen (To Cook)
            </button>
            <button class="staff-nav-btn ${currentStaffWorkstationView === 'pickup' ? 'active' : ''}" data-view="pickup">
              📦 Counter (Pickup)
            </button>
            <button class="staff-nav-btn ${currentStaffWorkstationView === 'menu' ? 'active' : ''}" data-view="menu">
              📋 Menu & Stock
            </button>
            <button id="staff-open-daily-board-btn" class="staff-specials-btn">
              🍱 Today's Specials
            </button>
          </nav>
        </div>
      </header>

      <!-- Live Bread Stock Quick Toggle Bar -->
      <div id="staff-bread-stock-bar" class="staff-bread-bar">
        <div class="staff-bread-inner">
          <span style="font-family: var(--font-sans); font-size: 0.88rem; font-weight: 800; color: #92400E; display: flex; align-items: center; gap: 6px; white-space: nowrap;">
            🍞 Bread Stock:
          </span>
          <button id="quick-toggle-roti-btn" class="staff-bread-btn" style="border: 2px solid ${currentDailyBoardState?.rotiAvailable !== false ? '#86EFAC' : '#FCA5A5'}; background: ${currentDailyBoardState?.rotiAvailable !== false ? '#F0FDF4' : '#FEF2F2'}; color: ${currentDailyBoardState?.rotiAvailable !== false ? '#166534' : '#DC2626'};">
            🫓 Chapati: <strong>${currentDailyBoardState?.rotiAvailable !== false ? 'IN STOCK ✅' : 'OVER / FINISHED ❌'}</strong>
          </button>
          <button id="quick-toggle-puri-btn" class="staff-bread-btn" style="border: 2px solid ${currentDailyBoardState?.puriAvailable !== false ? '#86EFAC' : '#FCA5A5'}; background: ${currentDailyBoardState?.puriAvailable !== false ? '#F0FDF4' : '#FEF2F2'}; color: ${currentDailyBoardState?.puriAvailable !== false ? '#166534' : '#DC2626'};">
            🟡 Poori: <strong>${currentDailyBoardState?.puriAvailable !== false ? 'IN STOCK ✅' : 'OVER / FINISHED ❌'}</strong>
          </button>
        </div>
        <div style="font-family: var(--font-sans); font-size: 0.78rem; color: #B45309; font-weight: 600;">
          Tap button to toggle stock status
        </div>
      </div>

      <!-- Main Station Target -->
      <main id="staff-view-target" style="min-height: calc(100vh - 80px); background: var(--bg-primary);"></main>

      <!-- Modal Container -->
      <div id="staff-modal-container"></div>
    `;

    root.querySelector('#quick-toggle-roti-btn')?.addEventListener('click', async () => {
      const btn = root.querySelector('#quick-toggle-roti-btn');
      if (btn) btn.disabled = true;
      try {
        const currentVal = currentDailyBoardState?.rotiAvailable !== false;
        await saveDailyBoard({
          ...(currentDailyBoardState || {}),
          rotiAvailable: !currentVal,
        });
      } catch (err) {
        console.error('Error toggling roti availability:', err);
        alert('Failed to update Roti status: ' + (err.message || err));
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    root.querySelector('#quick-toggle-puri-btn')?.addEventListener('click', async () => {
      const btn = root.querySelector('#quick-toggle-puri-btn');
      if (btn) btn.disabled = true;
      try {
        const currentVal = currentDailyBoardState?.puriAvailable !== false;
        await saveDailyBoard({
          ...(currentDailyBoardState || {}),
          puriAvailable: !currentVal,
        });
      } catch (err) {
        console.error('Error toggling puri availability:', err);
        alert('Failed to update Puri status: ' + (err.message || err));
      } finally {
        if (btn) btn.disabled = false;
      }
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

    root.querySelector('#lock-station-btn')?.addEventListener('click', () => {
      lockWorkstation('Workstation manually locked by operator.');
    });

    root.querySelector('#signout-station-btn')?.addEventListener('click', async () => {
      cleanupCurrentStation();
      currentDailyBoardState = null;
      await staffAuth.logout();
      render();
    });

    const viewTarget = root.querySelector('#staff-view-target');
    if (!viewTarget) return;

    viewTarget.classList.remove('tb-view-fade-in');
    void viewTarget.offsetWidth;
    viewTarget.classList.add('tb-view-fade-in');

    if (currentStaffWorkstationView === 'kitchen') {
      renderKitchenView(viewTarget);
    } else if (currentStaffWorkstationView === 'pickup') {
      renderPickupView(viewTarget);
    } else if (currentStaffWorkstationView === 'menu') {
      renderAdminView(viewTarget, { staffMode: true });
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

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initStaffWorkstation);
} else {
  initStaffWorkstation();
}
