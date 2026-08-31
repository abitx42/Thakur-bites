// Thakur Bites Staff Operations Dashboard & Hub Entry Point
import { staffAuth, renderPinPadModal } from './auth.js?v=3';
import { renderKitchenView } from './views/kitchenView.js?v=3';
import { renderPickupView } from './views/pickupView.js?v=3';
import { renderAdminView } from './views/adminView.js?v=3';
import { renderTvDisplayView } from './views/tvDisplayView.js?v=3';

let currentStaffView = 'kitchen'; // 'kitchen' | 'pickup' | 'admin' | 'tv'

function initStaffDashboard() {
  const root = document.getElementById('app-root');
  if (!root) return;

  function render() {
    // If not authenticated, prompt for PIN
    if (!staffAuth.isAuthenticated()) {
      renderPinPadModal(root, () => {
        render();
      });
      return;
    }

    root.innerHTML = `
      <!-- Staff App Header -->
      <header class="app-header" style="background: #FFF; border-bottom: 2px solid var(--border-light); padding: 0.8rem 1.2rem; position: sticky; top: 0; z-index: 100;">
        <div style="max-width: 1400px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          
          <!-- Brand Badge -->
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 36px; height: 36px; background: var(--brand-red); color: #FFF; font-family: var(--font-display); font-size: 1.4rem; display: flex; align-items: center; justify-content: center; border-radius: 8px;">
              TB
            </div>
            <div>
              <div style="font-family: var(--font-display); font-size: 1.5rem; letter-spacing: 0.05em; line-height: 1; color: var(--ink-primary);">
                THAKUR BITES · STAFF HUB
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #16A34A; font-weight: 700; display: flex; align-items: center; gap: 4px; margin-top: 2px;">
                <span style="display: inline-block; width: 7px; height: 7px; background: #22C55E; border-radius: 50%;"></span>
                ONLINE · LIVE FIRESTORE
              </div>
            </div>
          </div>

          <!-- Staff Role Views Switcher -->
          <nav style="display: flex; gap: 6px; flex-wrap: wrap; background: var(--bg-surface); padding: 4px; border-radius: 999px; border: 1.5px solid var(--border-light);">
            <button class="staff-nav-btn ${currentStaffView === 'kitchen' ? 'active' : ''}" data-view="kitchen">
              🍳 Kitchen KDS
            </button>
            <button class="staff-nav-btn ${currentStaffView === 'pickup' ? 'active' : ''}" data-view="pickup">
              🏷️ Pickup Counter
            </button>
            <button class="staff-nav-btn ${currentStaffView === 'admin' ? 'active' : ''}" data-view="admin">
              📋 Menu & Stock
            </button>
            <button class="staff-nav-btn ${currentStaffView === 'tv' ? 'active' : ''}" data-view="tv">
              📺 Token TV
            </button>
          </nav>

          <!-- Lock Session Button -->
          <button id="lock-session-btn" style="background: transparent; border: 1.5px solid var(--border-light); padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; cursor: pointer; color: var(--ink-secondary);">
            🔒 Lock PIN
          </button>
        </div>
      </header>

      <!-- Main View Target -->
      <main id="staff-view-target" style="min-height: calc(100vh - 80px); background: var(--bg-primary);"></main>
    `;

    // Attach View Navigation Listeners
    root.querySelectorAll('.staff-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentStaffView = btn.getAttribute('data-view');
        render();
      });
    });

    const lockBtn = root.querySelector('#lock-session-btn');
    if (lockBtn) {
      lockBtn.addEventListener('click', () => {
        staffAuth.lock();
        render();
      });
    }

    // Mount the selected view
    const viewTarget = root.querySelector('#staff-view-target');
    if (!viewTarget) return;

    if (currentStaffView === 'kitchen') {
      renderKitchenView(viewTarget);
    } else if (currentStaffView === 'pickup') {
      renderPickupView(viewTarget);
    } else if (currentStaffView === 'admin') {
      renderAdminView(viewTarget);
    } else if (currentStaffView === 'tv') {
      renderTvDisplayView(viewTarget);
    }
  }

  render();
}

// Start application
document.addEventListener('DOMContentLoaded', initStaffDashboard);
