// Thakur Bites Platform 2.0 — Dedicated AI Copilot Application Runner
import { subscribeOrders, subscribeMenuItems } from './firebase.js?v=5';
import { staffAuth, renderPinPadModal } from './auth.js?v=12';
import { renderAiCopilotView } from './views/aiCopilotView.js';
import { initSecuritySentinel } from './securitySentinel.js?v=2';

initSecuritySentinel({ blockShortcuts: false, portalName: 'AI Copilot' });

let currentOrders = [];
let currentMenuItems = [];
let unsubscribeOrders = null;
let unsubscribeMenu = null;

function initCopilotApp() {
  const root = document.getElementById('app-root');
  if (!root) return;

  root.innerHTML = `
    <!-- Dedicated Copilot App Header -->
    <header class="app-header" style="background: #FFF; border-bottom: 2px solid var(--border-light); padding: 0.8rem 1.2rem; position: sticky; top: 0; z-index: 100;">
      <div style="max-width: 1300px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        
        <!-- Brand & Title -->
        <div style="display: flex; align-items: center; gap: 10px;">
          <a href="portal.html" style="text-decoration: none; display: flex; align-items: center; gap: 10px;">
            <div style="width: 38px; height: 38px; background: #DC2626; color: #FFF; font-family: var(--font-display); font-size: 1.5rem; display: flex; align-items: center; justify-content: center; border-radius: 9px; box-shadow: 0 2px 6px rgba(220,38,38,0.25);">
              TB
            </div>
          </a>
          <div>
            <div class="copilot-brand-title" style="font-family: var(--font-display); font-size: 1.55rem; letter-spacing: 0.04em; line-height: 1; color: var(--ink-primary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span>THAKUR BITES · AI COPILOT</span>
              <span style="background: #DCFCE7; color: #166534; font-family: var(--font-mono); font-size: 0.7rem; font-weight: 800; padding: 2px 8px; border-radius: 999px;">
                ● LIVE ASSISTANT
              </span>
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 2px;">
              Executive Decision Support • Grounded in Real-Time Order & Inventory Truth
            </div>
          </div>
        </div>

        <!-- Direct Navigation Links -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <a href="portal.html" style="text-decoration: none; background: #FFF; border: 1.5px solid var(--border-light); padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; color: var(--ink-secondary);">
            🌐 Portal Gateway
          </a>
          <a href="admin.html?view=analytics#copilot" style="text-decoration: none; background: #0F172A; color: #FFF; border: 1.5px solid #1E293B; padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600;">
            📊 Admin Console
          </a>
          <a href="index.html" style="text-decoration: none; background: #FFF; border: 1.5px solid var(--border-light); padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; color: var(--ink-secondary);">
            📱 Student App
          </a>
          <button id="copilot-auth-btn" style="background: ${staffAuth.isAuthenticated() ? 'transparent' : '#DC2626'}; color: ${staffAuth.isAuthenticated() ? 'var(--ink-secondary)' : '#FFF'}; border: 1.5px solid ${staffAuth.isAuthenticated() ? 'var(--border-light)' : '#DC2626'}; padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; cursor: pointer;">
            ${staffAuth.isAuthenticated() ? '🔒 ' + (staffAuth.getRole() || 'Staff').toUpperCase() : '🔑 Unlock Full RBAC'}
          </button>
        </div>

      </div>
    </header>

    <!-- Main Copilot Mount Container -->
    <main id="copilot-mount-target" style="min-height: calc(100vh - 80px); background: var(--bg-primary);"></main>

    <!-- Modal Container -->
    <div id="copilot-modal-container"></div>
  `;

  const mountTarget = root.querySelector('#copilot-mount-target');
  const authBtn = root.querySelector('#copilot-auth-btn');

  authBtn?.addEventListener('click', () => {
    const modalCont = root.querySelector('#copilot-modal-container');
    if (modalCont) {
      renderPinPadModal(modalCont, () => {
        initCopilotApp();
      });
    }
  });

  // Subscribe to real-time collections
  if (unsubscribeOrders) unsubscribeOrders();
  if (unsubscribeMenu) unsubscribeMenu();

  function triggerRender() {
    if (mountTarget) {
      renderAiCopilotView(mountTarget, {
        orders: currentOrders,
        menuItems: currentMenuItems,
      });
    }
  }

  try {
    unsubscribeOrders = subscribeOrders((orders) => {
      currentOrders = orders || [];
      triggerRender();
    });
  } catch (err) {
    console.warn('[CopilotApp] subscribeOrders fallback:', err);
  }

  try {
    unsubscribeMenu = subscribeMenuItems((items) => {
      currentMenuItems = items || [];
      triggerRender();
    });
  } catch (err) {
    console.warn('[CopilotApp] subscribeMenuItems fallback:', err);
  }

  triggerRender();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initCopilotApp);
} else {
  initCopilotApp();
}
