// Thakur Bites — Dedicated Developer Command Cockpit & Engineering Security Center
import { staffAuth, renderPinPadModal } from './auth.js?v=8';
import { renderSecurityCenterView } from './views/securityCenterView.js?v=5';

function initDeveloperCockpit() {
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
    const developerRoles = ['developer', 'security_admin', 'system', 'admin'];
    const isAuthorizedDev = developerRoles.includes(currentRole);

    if (!isAuthorizedDev) {
      root.innerHTML = `
        <div style="max-width: 520px; margin: 5rem auto; background: #09090B; border: 2px solid #EF4444; border-radius: 14px; padding: 2.5rem 2rem; text-align: center; color: #FFF; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          <div style="font-size: 3.5rem; margin-bottom: 0.75rem;">🔒</div>
          <h2 style="font-family: var(--font-display); font-size: 2.2rem; color: #EF4444; margin: 0 0 0.5rem 0; letter-spacing: 0.05em;">
            ENGINEERING COCKPIT LOCKED
          </h2>
          <p style="font-family: var(--font-sans); color: #A1A1AA; font-size: 0.95rem; line-height: 1.5; margin-bottom: 1.5rem;">
            Your account has role <code style="background: #27272A; color: #EF4444; padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-weight: 700;">${currentRole}</code>. Developer telemetry, system kill switches, and cryptographic diagnostics require <strong>Developer</strong> or <strong>Security Administrator</strong> clearance.
          </p>
          <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
            <a href="staff.html" style="padding: 10px 18px; border-radius: 8px; background: var(--brand-red); color: #FFF; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; text-decoration: none;">
              🍳 Staff Workstation
            </a>
            <a href="index.html" style="padding: 10px 18px; border-radius: 8px; background: #27272A; border: 1.5px solid #3F3F46; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; text-decoration: none; color: #FFF;">
              Portal Gateway
            </a>
            <button id="dev-switch-account-btn" style="padding: 10px 18px; border-radius: 8px; background: transparent; border: 1.5px solid #3F3F46; color: #A1A1AA; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;">
              Sign Out
            </button>
          </div>
        </div>
      `;
      root.querySelector('#dev-switch-account-btn')?.addEventListener('click', async () => {
        await staffAuth.logout();
        render();
      });
      return;
    }

    root.innerHTML = `
      <!-- Developer Portal Header -->
      <header class="app-header" style="background: #09090B; border-bottom: 2px solid #27272A; padding: 0.8rem 1.2rem; position: sticky; top: 0; z-index: 100; color: #FFF;">
        <div style="max-width: 1400px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          
          <!-- Brand Badge -->
          <div style="display: flex; align-items: center; gap: 10px;">
            <a href="index.html" style="text-decoration: none; display: flex; align-items: center; gap: 10px;">
              <div style="width: 36px; height: 36px; background: #DC2626; color: #FFF; font-family: var(--font-display); font-size: 1.4rem; display: flex; align-items: center; justify-content: center; border-radius: 8px;">
                TB
              </div>
            </a>
            <div>
              <div style="font-family: var(--font-display); font-size: 1.5rem; letter-spacing: 0.05em; line-height: 1; color: #FFF;">
                THAKUR BITES · DEVELOPER COCKPIT
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #4ADE80; font-weight: 700; display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                <span style="display: inline-block; width: 7px; height: 7px; background: #22C55E; border-radius: 50%;"></span>
                SENTINEL TELEMETRY · PRODUCTION RUNTIME
                <span style="background: #27272A; color: #CBD5E1; padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; text-transform: uppercase;">
                  CLEARANCE: ${currentRole}
                </span>
              </div>
            </div>
          </div>

          <!-- Quick Actions -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <a href="admin.html" style="text-decoration: none; background: #18181B; border: 1.5px solid #27272A; padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; color: #CBD5E1;">
              📋 Admin Portal
            </a>
            <a href="staff.html" style="text-decoration: none; background: #18181B; border: 1.5px solid #27272A; padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; color: #CBD5E1;">
              🍳 Staff Workstation
            </a>
            <a href="tv.html" target="_blank" style="text-decoration: none; background: #18181B; border: 1.5px solid #27272A; padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; color: #CBD5E1;">
              📺 Token TV
            </a>
            <button id="signout-dev-btn" style="background: transparent; border: 1.5px solid #3F3F46; padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; cursor: pointer; color: #A1A1AA;">
              🔒 Sign Out
            </button>
          </div>
        </div>
      </header>

      <!-- Main Developer Cockpit Target -->
      <main id="dev-view-target" style="min-height: calc(100vh - 80px); background: #0F172A; color: #FFF;"></main>
    `;

    root.querySelector('#signout-dev-btn')?.addEventListener('click', async () => {
      await staffAuth.logout();
      render();
    });

    const viewTarget = root.querySelector('#dev-view-target');
    if (!viewTarget) return;

    renderSecurityCenterView(viewTarget);
  }

  render();
}

window.addEventListener('DOMContentLoaded', initDeveloperCockpit);
