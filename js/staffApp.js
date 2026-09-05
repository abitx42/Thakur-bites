// Thakur Bites — Dedicated Staff Operations Workstation (Kitchen KDS & Pickup Counter)
import { staffAuth, renderPinPadModal, getRegisteredWorkstation } from './auth.js?v=8';
import { renderKitchenView } from './views/kitchenView.js?v=5';
import { renderPickupView } from './views/pickupView.js?v=5';

let currentStaffWorkstationView = 'kitchen'; // 'kitchen' | 'pickup'

function initStaffWorkstation() {
  const root = document.getElementById('app-root');
  if (!root) return;

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
          <nav style="display: flex; gap: 6px; flex-wrap: wrap; background: var(--bg-surface); padding: 4px; border-radius: 999px; border: 1.5px solid var(--border-light);">
            <button class="staff-nav-btn ${currentStaffWorkstationView === 'kitchen' ? 'active' : ''}" data-view="kitchen">
              🍳 Kitchen KDS
            </button>
            <button class="staff-nav-btn ${currentStaffWorkstationView === 'pickup' ? 'active' : ''}" data-view="pickup">
              📦 Pickup Counter
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

      <!-- Main Station Target -->
      <main id="staff-view-target" style="min-height: calc(100vh - 80px); background: var(--bg-primary);"></main>

      <!-- Modal Container -->
      <div id="staff-modal-container"></div>
    `;

    root.querySelector('#staff-enroll-hardware-btn')?.addEventListener('click', () => {
      const modalCont = root.querySelector('#staff-modal-container');
      if (modalCont) {
        renderPinPadModal(modalCont, () => render());
      }
    });
    `;

    // Attach Station View Switcher Listeners
    root.querySelectorAll('.staff-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentStaffWorkstationView = btn.getAttribute('data-view');
        render();
      });
    });

    root.querySelector('#signout-station-btn')?.addEventListener('click', async () => {
      await staffAuth.logout();
      render();
    });

    const viewTarget = root.querySelector('#staff-view-target');
    if (!viewTarget) return;

    if (currentStaffWorkstationView === 'kitchen') {
      renderKitchenView(viewTarget);
    } else if (currentStaffWorkstationView === 'pickup') {
      renderPickupView(viewTarget);
    }
  }

  render();
}

window.addEventListener('DOMContentLoaded', initStaffWorkstation);
