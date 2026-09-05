// Thakur Bites — Dedicated Business Administration Portal (Menu, Stock, Roles & Analytics)
import { staffAuth, renderPinPadModal, getPrivilegedSession } from './auth.js?v=8';
import { renderAdminView } from './views/adminView.js?v=5';
import { renderAnalyticsView } from './views/analyticsView.js?v=5';
import { renderWorkstationView } from './views/workstationView.js?v=1';
import { renderPrivilegedAuthModal } from './views/mfaModal.js?v=1';

let currentAdminView = 'menu'; // 'menu' | 'analytics' | 'workstations'

function initAdminPortal() {
  const root = document.getElementById('app-root');
  if (!root) return;

  function render() {
    // If not authenticated, prompt for credentials
    if (!staffAuth.isAuthenticated()) {
      renderPinPadModal(root, () => {
        render();
      });
      return;
    }

    const currentRole = (staffAuth.getRole() || '').toLowerCase();
    const adminRoles = ['admin', 'manager', 'developer', 'security_admin', 'system'];
    const isAuthorizedAdmin = adminRoles.includes(currentRole);

    if (!isAuthorizedAdmin) {
      root.innerHTML = `
        <div style="max-width: 520px; margin: 5rem auto; background: #FFF; border: 2px solid #FCA5A5; border-radius: 14px; padding: 2.5rem 2rem; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
          <div style="font-size: 3.5rem; margin-bottom: 0.75rem;">🛡️</div>
          <h2 style="font-family: var(--font-display); font-size: 2.2rem; color: #DC2626; margin: 0 0 0.5rem 0; letter-spacing: 0.05em;">
            ADMINISTRATIVE ACCESS REQUIRED
          </h2>
          <p style="font-family: var(--font-sans); color: var(--ink-secondary); font-size: 0.95rem; line-height: 1.5; margin-bottom: 1.5rem;">
            Your current authenticated session has role <code style="background: #FEE2E2; color: #DC2626; padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-weight: 700;">${currentRole}</code>. Business Administration (Catalog, Pricing, Roles, Ledgers) requires <strong>Manager</strong> or <strong>Admin</strong> privileges.
          </p>
          <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
            <a href="staff.html" style="padding: 10px 18px; border-radius: 8px; background: var(--brand-red); color: #FFF; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; text-decoration: none;">
              🍳 Go to Staff Workstation
            </a>
            <a href="index.html" style="padding: 10px 18px; border-radius: 8px; background: var(--bg-surface); border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; text-decoration: none; color: var(--ink-primary);">
              Portal Gateway
            </a>
            <button id="admin-switch-account-btn" style="padding: 10px 18px; border-radius: 8px; background: transparent; border: 1.5px solid var(--border-light); color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;">
              Sign Out
            </button>
          </div>
        </div>
      `;
      root.querySelector('#admin-switch-account-btn')?.addEventListener('click', async () => {
        await staffAuth.logout();
        render();
      });
      return;
    }

    const isDeveloper = ['developer', 'security_admin', 'system'].includes(currentRole);
    const privSession = getPrivilegedSession();
    let privTimeLeftStr = '';
    if (privSession) {
      const msLeft = new Date(privSession.expiresAt).getTime() - Date.now();
      if (msLeft > 0) {
        const hrs = Math.floor(msLeft / 3600000);
        const mins = Math.floor((msLeft % 3600000) / 60000);
        privTimeLeftStr = `${hrs}h ${mins}m`;
      }
    }

    root.innerHTML = `
      <!-- Admin Portal Header -->
      <header class="app-header" style="background: #FFF; border-bottom: 2px solid var(--border-light); padding: 0.8rem 1.2rem; position: sticky; top: 0; z-index: 100;">
        <div style="max-width: 1400px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          
          <!-- Brand Badge -->
          <div style="display: flex; align-items: center; gap: 10px;">
            <a href="index.html" style="text-decoration: none; display: flex; align-items: center; gap: 10px;">
              <div style="width: 36px; height: 36px; background: #0F172A; color: #FFF; font-family: var(--font-display); font-size: 1.4rem; display: flex; align-items: center; justify-content: center; border-radius: 8px;">
                TB
              </div>
            </a>
            <div>
              <div style="font-family: var(--font-display); font-size: 1.5rem; letter-spacing: 0.05em; line-height: 1; color: var(--ink-primary);">
                THAKUR BITES · BUSINESS ADMIN
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #16A34A; font-weight: 700; display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                <span style="display: inline-block; width: 7px; height: 7px; background: #22C55E; border-radius: 50%;"></span>
                ADMIN PRIVILEGES · SECURE GOVERNANCE
                <span style="background: #E2E8F0; color: #1E293B; padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; text-transform: uppercase;">
                  ROLE: ${currentRole}
                </span>
                ${privSession && privTimeLeftStr ? `
                  <span style="background: #DCFCE7; color: #166534; padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 800;">
                    ⏳ 6-HR PRIVILEGED (${privTimeLeftStr})
                  </span>
                ` : `
                  <button id="activate-priv-session-btn" style="background: #DC2626; color: #FFF; border: none; padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; cursor: pointer;">
                    🔐 MFA ACTIVATE (6-HR)
                  </button>
                `}
              </div>
            </div>
          </div>

          <!-- Admin Views Switcher -->
          <nav style="display: flex; gap: 6px; flex-wrap: wrap; background: var(--bg-surface); padding: 4px; border-radius: 999px; border: 1.5px solid var(--border-light);">
            <button class="admin-nav-btn ${currentAdminView === 'menu' ? 'active' : ''}" data-view="menu">
              📋 Menu Catalog & Stock
            </button>
            <button class="admin-nav-btn ${currentAdminView === 'analytics' ? 'active' : ''}" data-view="analytics">
              📊 Analytics & Financials
            </button>
            <button class="admin-nav-btn ${currentAdminView === 'workstations' ? 'active' : ''}" data-view="workstations">
              🖥️ Terminals & Workstations
            </button>
          </nav>

          <!-- Quick Actions -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <a href="staff.html" style="text-decoration: none; background: #FFF; border: 1.5px solid var(--border-light); padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; color: var(--ink-secondary);">
              🍳 Staff Workstation
            </a>
            ${isDeveloper ? `
              <a href="developer.html" style="text-decoration: none; background: #0F172A; color: #FFF; border: 1.5px solid #1E293B; padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600;">
                🛡️ Developer Cockpit
              </a>
            ` : ''}
            <button id="signout-admin-btn" style="background: transparent; border: 1.5px solid var(--border-light); padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; cursor: pointer; color: var(--ink-secondary);">
              🔒 Sign Out
            </button>
          </div>
        </div>
      </header>

      <!-- Main Admin Target -->
      <main id="admin-view-target" style="min-height: calc(100vh - 80px); background: var(--bg-primary);"></main>

      <!-- Modal Container -->
      <div id="admin-modal-container"></div>
    `;

    root.querySelectorAll('.admin-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentAdminView = btn.getAttribute('data-view');
        render();
      });
    });

    root.querySelector('#activate-priv-session-btn')?.addEventListener('click', () => {
      const modalCont = root.querySelector('#admin-modal-container');
      if (modalCont) {
        renderPrivilegedAuthModal(modalCont, {
          onSuccess: () => render(),
        });
      }
    });

    root.querySelector('#signout-admin-btn')?.addEventListener('click', async () => {
      await staffAuth.logout();
      render();
    });

    const viewTarget = root.querySelector('#admin-view-target');
    if (!viewTarget) return;

    if (currentAdminView === 'menu') {
      renderAdminView(viewTarget);
    } else if (currentAdminView === 'analytics') {
      renderAnalyticsView(viewTarget);
    } else if (currentAdminView === 'workstations') {
      renderWorkstationView(viewTarget);
    }
  }

  render();
}

window.addEventListener('DOMContentLoaded', initAdminPortal);
