// Thakur Bites — Dedicated Business Administration Portal (Menu, Stock, Roles & Analytics)
import { staffAuth, renderPinPadModal, getPrivilegedSession, onStaffAuthStateChanged } from './auth.js?v=12';
import { renderAdminView } from './views/adminView.js?v=10';
import { renderUserProfilesView, cleanupUserProfilesView } from './views/userProfilesView.js?v=1';
import { renderAnalyticsView } from './views/analyticsView.js?v=6';
import { renderWorkstationView } from './views/workstationView.js?v=2';
import { renderPrivilegedAuthModal } from './views/mfaModal.js?v=2';
import { initSecuritySentinel } from './securitySentinel.js?v=2';
import { initNetworkSentinel } from './networkSentinel.js';

initSecuritySentinel({ blockShortcuts: true, portalName: 'Admin Operations' });
initNetworkSentinel({ portalName: 'Admin Operations' });

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getInitialAdminView() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    if (viewParam && ['menu', 'users', 'analytics', 'workstations'].includes(viewParam)) {
      return viewParam;
    }
    const hash = window.location.hash.toLowerCase().replace('#', '');
    if (hash === 'copilot' || hash === 'analytics' || hash === 'ai') {
      return 'analytics';
    }
  } catch (_) {}
  return 'menu';
}

let currentAdminView = getInitialAdminView(); // 'menu' | 'analytics' | 'workstations'

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
        <div style="max-width: 520px; width: calc(100% - 2rem); box-sizing: border-box; margin: 3rem auto; background: #FFF; border: 2px solid #FCA5A5; border-radius: 14px; padding: 2rem 1.25rem; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
          <div style="font-size: 3.5rem; margin-bottom: 0.75rem;">🛡️</div>
          <h2 style="font-family: var(--font-display); font-size: 2.2rem; color: #DC2626; margin: 0 0 0.5rem 0; letter-spacing: 0.05em;">
            ADMINISTRATIVE ACCESS REQUIRED
          </h2>
          <p style="font-family: var(--font-sans); color: var(--ink-secondary); font-size: 0.95rem; line-height: 1.5; margin-bottom: 1.5rem;">
            Your current authenticated session has role <code style="background: #FEE2E2; color: #DC2626; padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-weight: 700;">${escapeHtml(currentRole)}</code>. Business Administration (Catalog, Pricing, Roles, Ledgers) requires <strong>Manager</strong> or <strong>Admin</strong> privileges.
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
      <!-- Admin Portal Header -->
      <header class="admin-header">
        <div class="admin-header-inner">
          
          <div class="admin-top-row">
            <!-- Brand Badge -->
            <div class="admin-brand-section">
              <a href="portal.html" style="text-decoration: none; display: flex; align-items: center; gap: 10px;">
                <div style="width: 36px; height: 36px; background: #0F172A; color: #FFF; font-family: var(--font-display); font-size: 1.4rem; display: flex; align-items: center; justify-content: center; border-radius: 8px;">
                  TB
                </div>
              </a>
              <div>
                <div style="font-family: var(--font-display); font-size: 1.4rem; letter-spacing: 0.04em; line-height: 1.1; color: var(--ink-primary);">
                  THAKUR BITES ADMIN
                </div>
                <div class="admin-brand-subtitle" style="font-family: var(--font-mono); font-size: 0.72rem; color: #16A34A; font-weight: 700; display: flex; align-items: center; gap: 5px; margin-top: 2px;">
                  <span style="display: inline-block; width: 6px; height: 6px; background: #22C55E; border-radius: 50%;"></span>
                  ROLE: ${escapeHtml(currentRole).toUpperCase()}
                  ${privSession && privTimeLeftStr ? `
                    <span style="background: #DCFCE7; color: #166534; padding: 1px 5px; border-radius: 4px; font-size: 0.68rem; font-weight: 800;">
                      ⏳ ${privTimeLeftStr}
                    </span>
                  ` : ''}
                </div>
              </div>
            </div>

            <!-- Sign Out / Top Action -->
            <div style="display: flex; align-items: center; gap: 6px;">
              ${!privSession ? `
                <button id="activate-priv-session-btn" style="background: #DC2626; color: #FFF; border: none; padding: 5px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; cursor: pointer;">
                  🔐 MFA
                </button>
              ` : ''}
              <button id="signout-admin-btn" style="background: #FEF2F2; border: 1.5px solid #FCA5A5; color: #DC2626; padding: 5px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                🔒 Sign Out
              </button>
            </div>
          </div>

          <!-- Admin Views Switcher (Horizontally scrollable on mobile) -->
          <nav class="admin-nav-bar">
            <button class="admin-nav-btn ${currentAdminView === 'menu' ? 'active' : ''}" data-view="menu">
              📋 Menu Catalog
            </button>
            <button class="admin-nav-btn ${currentAdminView === 'users' ? 'active' : ''}" data-view="users">
              👥 User Roles
            </button>
            <button class="admin-nav-btn ${currentAdminView === 'analytics' ? 'active' : ''}" data-view="analytics">
              <span>🤖 AI Copilot</span>
              <span style="background: #16A34A; color: #FFF; font-size: 0.6rem; padding: 1px 5px; border-radius: 999px; font-weight: 800;">● LIVE</span>
            </button>
            <button class="admin-nav-btn ${currentAdminView === 'workstations' ? 'active' : ''}" data-view="workstations">
              🖥️ Terminals
            </button>
          </nav>

          <!-- Quick Actions -->
          <div class="admin-actions-section">
            <button id="admin-header-copilot-btn" title="Open AI Business Intelligence Copilot" style="background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%); color: #FFF; border: 1.5px solid #DC2626; padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(220,38,38,0.25);">
              <span>🤖 AI Copilot</span>
              <span style="background: #22C55E; width: 6px; height: 6px; border-radius: 50%;"></span>
            </button>
            <a href="staff.html" style="text-decoration: none; background: #FFF; border: 1.5px solid var(--border-light); padding: 6px 10px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 600; color: var(--ink-secondary);">
              🍳 Staff
            </a>
            ${isDeveloper ? `
              <a href="developer.html" style="text-decoration: none; background: #0F172A; color: #FFF; border: 1.5px solid #1E293B; padding: 6px 10px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 600;">
                🛡️ Dev
              </a>
            ` : ''}
          </div>

        </div>
      </header>

      <!-- Main Admin Target -->
      <main id="admin-view-target" style="min-height: calc(100vh - 80px); background: var(--bg-primary);"></main>

      <!-- Floating AI Copilot Quick-Launcher (Admin Exclusive) -->
      <aside id="admin-floating-copilot-container" class="admin-fab-container" aria-label="AI Copilot Quick Launcher">
        <button 
          id="admin-floating-copilot-btn"
          class="admin-fab-main"
          title="Open AI Business Intelligence Copilot"
          aria-label="Open AI Business Intelligence Copilot"
        >
          <span class="admin-fab-icon" aria-hidden="true">🤖</span>
          <span class="admin-fab-label">${currentAdminView === 'analytics' ? 'Ask AI Copilot' : 'Thakur Bites AI'}</span>
          <span class="admin-fab-pulse" aria-hidden="true"></span>
        </button>
        <a 
          href="copilot.html" 
          target="_blank" 
          rel="noopener" 
          class="admin-fab-popout"
          title="Open AI Copilot in New Window"
          aria-label="Open AI Copilot in New Window"
        >
          <span aria-hidden="true">↗</span>
        </a>
      </aside>

      <!-- Modal Container -->
      <div id="admin-modal-container"></div>
    `;

    root.querySelectorAll('.admin-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        cleanupUserProfilesView();
        currentAdminView = btn.getAttribute('data-view');
        try {
          if (currentAdminView === 'analytics') {
            window.location.hash = 'copilot';
          } else {
            history.replaceState(null, '', window.location.pathname + (window.location.search ? window.location.search : ''));
          }
        } catch (_) {}
        render();
      });
    });

    function navigateToCopilot() {
      cleanupUserProfilesView();
      currentAdminView = 'analytics';
      try {
        window.location.hash = 'copilot';
      } catch (_) {}
      render();
      setTimeout(() => {
        const copilotInput = document.querySelector('#copilot-input');
        if (copilotInput) {
          copilotInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          copilotInput.focus();
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 100);
    }

    root.querySelector('#admin-header-copilot-btn')?.addEventListener('click', navigateToCopilot);
    root.querySelector('#admin-floating-copilot-btn')?.addEventListener('click', navigateToCopilot);

    root.querySelector('#activate-priv-session-btn')?.addEventListener('click', () => {
      const modalCont = root.querySelector('#admin-modal-container');
      if (modalCont) {
        renderPrivilegedAuthModal(modalCont, {
          onSuccess: () => render(),
        });
      }
    });

    root.querySelector('#signout-admin-btn')?.addEventListener('click', async () => {
      cleanupUserProfilesView();
      await staffAuth.logout();
      render();
    });

    const viewTarget = root.querySelector('#admin-view-target');
    if (!viewTarget) return;

    if (currentAdminView === 'menu') {
      renderAdminView(viewTarget);
    } else if (currentAdminView === 'users') {
      renderUserProfilesView(viewTarget);
    } else if (currentAdminView === 'analytics') {
      renderAnalyticsView(viewTarget);
    } else if (currentAdminView === 'workstations') {
      renderWorkstationView(viewTarget);
    }
  }

  render();
  onStaffAuthStateChanged(() => {
    render();
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initAdminPortal);
} else {
  initAdminPortal();
}
