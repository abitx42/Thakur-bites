// Thakur Bites Platform 2.0 — Universal Operations & Application Portal Gateway
import { staffAuth, renderPinPadModal, getOrCreateDeviceId } from './auth.js?v=12';
import { initSecuritySentinel } from './securitySentinel.js?v=2';

initSecuritySentinel({ blockShortcuts: false, portalName: 'Portal Gateway' });

function initPortalGateway() {
  const root = document.getElementById('app-root');
  if (!root) return;

  function render() {
    const isAuthenticated = staffAuth.isAuthenticated();
    const currentRole = (staffAuth.getRole() || '').toLowerCase();
    const deviceId = getOrCreateDeviceId();

    const isStaffAllowed = ['kitchen', 'pickup', 'cashier', 'manager', 'admin', 'developer', 'security_admin', 'system'].includes(currentRole);
    const isAdminAllowed = ['admin', 'manager', 'developer', 'security_admin', 'system'].includes(currentRole);
    const isDevAllowed = ['developer', 'security_admin', 'system', 'admin'].includes(currentRole);

    root.innerHTML = `
      <div style="min-height: 100vh; background: var(--bg-primary); display: flex; flex-direction: column;">
        
        <!-- Gateway Header -->
        <header class="app-header" style="background: #FFF; border-bottom: 2px solid var(--border-light); padding: 0.8rem 1rem;">
          <div style="max-width: 1300px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.8rem;">
            
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 40px; height: 40px; background: var(--brand-red); color: #FFF; font-family: var(--font-display); font-size: 1.5rem; display: flex; align-items: center; justify-content: center; border-radius: 10px; box-shadow: 0 2px 6px rgba(197,34,31,0.25); flex-shrink: 0;">
                TB
              </div>
              <div>
                <div style="font-family: var(--font-display); font-size: clamp(1.25rem, 4vw, 1.75rem); letter-spacing: 0.05em; line-height: 1.1; color: var(--ink-primary);">
                  THAKUR BITES · PORTAL GATEWAY
                </div>
                <div style="font-family: var(--font-mono); font-size: clamp(0.65rem, 2.5vw, 0.75rem); color: #16A34A; font-weight: 700; display: flex; align-items: center; gap: 5px; margin-top: 2px;">
                  <span style="display: inline-block; width: 6px; height: 6px; background: #22C55E; border-radius: 50%; flex-shrink: 0;"></span>
                  CAMPUS DINING PLATFORM 2.0
                </div>
              </div>
            </div>

            <!-- Session & Auth Controls -->
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              ${isAuthenticated ? `
                <div style="background: var(--bg-surface); border: 1.5px solid var(--border-light); padding: 5px 10px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.78rem; display: flex; align-items: center; gap: 6px;">
                  <span style="color: var(--ink-secondary);">ROLE:</span>
                  <strong style="color: var(--brand-red); text-transform: uppercase;">${currentRole}</strong>
                </div>
                <button id="gateway-signout-btn" class="btn btn--secondary btn--sm" style="min-height: 38px;">
                  🔒 Sign Out
                </button>
              ` : `
                <button id="gateway-signin-btn" class="btn btn--primary btn--sm" style="min-height: 40px; box-shadow: 0 2px 6px rgba(197,34,31,0.25);">
                  🔑 Staff & Admin Sign In
                </button>
              `}
            </div>

          </div>
        </header>

        <!-- Main Portal Selection Hub -->
        <main style="max-width: 1300px; margin: 0 auto; padding: 1.5rem 1rem; flex: 1; width: 100%; box-sizing: border-box;">
          
          <div style="margin-bottom: 2rem; text-align: center;">
            <span style="background: #E2E8F0; color: #334155; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 4px 12px; border-radius: 999px; text-transform: uppercase; display: inline-block; max-width: 100%;">
              Role-Isolated Portals
            </span>
            <h1 style="font-family: var(--font-display); font-size: clamp(1.4rem, 5.2vw, 2.5rem); letter-spacing: 0.02em; color: var(--ink-primary); margin: 0.6rem 0 0.4rem 0; line-height: 1.15; text-wrap: balance; word-break: break-word;">
              AUTHORIZED ACCESS PORTALS
            </h1>
            <p style="font-family: var(--font-sans); font-size: 0.95rem; color: var(--ink-secondary); max-width: 650px; margin: 0 auto; line-height: 1.4;">
              Select the dedicated workstation or management dashboard corresponding to your operational clearance and station hardware.
            </p>
          </div>

          <!-- 4 Dedicated Application Cards Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 1.25rem; margin-bottom: 2.5rem;">
            
            <!-- PORTAL 1: STAFF WORKSTATION -->
            <div class="portal-card" style="background: #FFF; border: 2px solid var(--border-light); border-radius: 16px; padding: 1.8rem; display: flex; flex-direction: column; justify-content: space-between; transition: transform 0.15s ease, box-shadow 0.15s ease;">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                  <div style="width: 52px; height: 52px; background: #FEE2E2; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.8rem;">
                    🍳
                  </div>
                  <span style="font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: ${isAuthenticated && isStaffAllowed ? '#DCFCE7' : '#F1F5F9'}; color: ${isAuthenticated && isStaffAllowed ? '#166534' : '#64748B'};">
                    ${isAuthenticated && isStaffAllowed ? '✓ AUTHORIZED' : 'WORKSTATION PIN'}
                  </span>
                </div>
                <h3 style="font-family: var(--font-display); font-size: 1.6rem; margin: 0 0 0.5rem 0; color: var(--ink-primary);">
                  STAFF WORKSTATION
                </h3>
                <p style="font-family: var(--font-sans); font-size: 0.88rem; color: var(--ink-secondary); line-height: 1.5; margin-bottom: 1.2rem;">
                  Kitchen KDS, Order Dispatch Line, and Pickup Verification Counter. Supports 6-digit shift PINs and terminal hardware binding.
                </p>
                <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--ink-tertiary); margin-bottom: 1.5rem;">
                  • Kitchen KDS Orders View<br>
                  • Pickup Counter Ticket Unlock<br>
                  • Terminal Shift PIN Auth
                </div>
              </div>
              <a href="staff.html" class="btn btn--primary btn--lg" style="width: 100%; text-decoration: none;">
                Launch Staff Workstation →
              </a>
            </div>

            <!-- PORTAL 2: BUSINESS ADMIN -->
            <div class="portal-card" style="background: #FFF; border: 2px solid var(--border-light); border-radius: 16px; padding: 1.8rem; display: flex; flex-direction: column; justify-content: space-between; transition: transform 0.15s ease, box-shadow 0.15s ease;">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                  <div style="width: 52px; height: 52px; background: #E0E7FF; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.8rem;">
                    📋
                  </div>
                  <span style="font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: ${isAuthenticated && isAdminAllowed ? '#DCFCE7' : '#F1F5F9'}; color: ${isAuthenticated && isAdminAllowed ? '#166534' : '#64748B'};">
                    ${isAuthenticated && isAdminAllowed ? '✓ AUTHORIZED' : 'MANAGER / ADMIN'}
                  </span>
                </div>
                <h3 style="font-family: var(--font-display); font-size: 1.6rem; margin: 0 0 0.5rem 0; color: var(--ink-primary);">
                  BUSINESS ADMIN
                </h3>
                <p style="font-family: var(--font-sans); font-size: 0.88rem; color: var(--ink-secondary); line-height: 1.5; margin-bottom: 1.2rem;">
                  Physical Menu Catalog, Two-Tier Hierarchical Taxonomy, Soft Archiving, Staff Shift PINs, Faculty Verification, and Ledgers.
                </p>
                <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--ink-tertiary); margin-bottom: 1.5rem;">
                  • 85-Item Menu Governance<br>
                  • Staff Shift PIN Management<br>
                  • Daily Ledger Reconciliation
                </div>
              </div>
              <a href="admin.html" class="btn btn--secondary btn--lg" style="width: 100%; text-decoration: none; background: #0F172A; color: #FFF;">
                Launch Admin Portal →
              </a>
            </div>

            <!-- PORTAL 3: DEVELOPER COCKPIT -->
            <div class="portal-card" style="background: #FFF; border: 2px solid var(--border-light); border-radius: 16px; padding: 1.8rem; display: flex; flex-direction: column; justify-content: space-between; transition: transform 0.15s ease, box-shadow 0.15s ease;">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                  <div style="width: 52px; height: 52px; background: #FEF3C7; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.8rem;">
                    🛡️
                  </div>
                  <span style="font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: ${isAuthenticated && isDevAllowed ? '#DCFCE7' : '#F1F5F9'}; color: ${isAuthenticated && isDevAllowed ? '#166534' : '#64748B'};">
                    ${isAuthenticated && isDevAllowed ? '✓ AUTHORIZED' : 'DEV / SECURITY'}
                  </span>
                </div>
                <h3 style="font-family: var(--font-display); font-size: 1.6rem; margin: 0 0 0.5rem 0; color: var(--ink-primary);">
                  DEVELOPER COCKPIT
                </h3>
                <p style="font-family: var(--font-sans); font-size: 0.88rem; color: var(--ink-secondary); line-height: 1.5; margin-bottom: 1.2rem;">
                  15-Point Invariant Integrity Scanner, Dynamic Security Rate Limits, Real-time Attack Telemetry, and RBAC Simulator.
                </p>
                <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--ink-tertiary); margin-bottom: 1.5rem;">
                  • Invariant Diagnostic Scanner<br>
                  • Configurable Rate Limits UI<br>
                  • Emergency Operational Freeze
                </div>
              </div>
              <a href="developer.html" class="btn btn--secondary btn--lg" style="width: 100%; text-decoration: none; background: #475569; color: #FFF;">
                Launch Developer Cockpit →
              </a>
            </div>

            <!-- PORTAL 4: TOKEN TV DISPLAY -->
            <div class="portal-card" style="background: #09090B; border: 2px solid #27272A; border-radius: 16px; padding: 1.8rem; display: flex; flex-direction: column; justify-content: space-between; color: #FFF; transition: transform 0.15s ease, box-shadow 0.15s ease;">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                  <div style="width: 52px; height: 52px; background: #27272A; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.8rem;">
                    📺
                  </div>
                  <span style="font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: #16A34A; color: #FFF;">
                    PUBLIC DISPLAY
                  </span>
                </div>
                <h3 style="font-family: var(--font-display); font-size: 1.6rem; margin: 0 0 0.5rem 0; color: #FFF;">
                  TOKEN TV DISPLAY
                </h3>
                <p style="font-family: var(--font-sans); font-size: 0.88rem; color: #A1A1AA; line-height: 1.5; margin-bottom: 1.2rem;">
                  Fullscreen zero-PII live canteen board reading directly from public projection with automatic stale detection.
                </p>
                <div style="font-family: var(--font-mono); font-size: 0.72rem; color: #71717A; margin-bottom: 1.5rem;">
                  • Single Document Firestore Projection<br>
                  • Zero PII (Tokens & Stations Only)<br>
                  • No Authentication Required
                </div>
              </div>
              <a href="tv.html" target="_blank" class="btn btn--success btn--lg" style="width: 100%; text-decoration: none; color: #FFF;">
                Open Token TV Board ↗
              </a>
            </div>

          </div>

          <!-- Hardware Binding & System Diagnostic Footer -->
          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1.2rem 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary);">
              <span>Hardware Device ID:</span>
              <code style="color: var(--brand-red); font-weight: 700; background: var(--bg-surface); padding: 2px 8px; border-radius: 4px; margin-left: 4px;">${deviceId}</code>
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--ink-secondary); display: flex; flex-wrap: wrap; gap: 0.75rem 1.25rem;">
              <span>Defense: <strong>Sentinel 2.0 Hardened</strong></span>
              <span>Rate Limits: <strong>Firestore Dynamic</strong></span>
              <span>Backend: <strong>Live Cloud Functions</strong></span>
            </div>
          </div>

        </main>

      </div>
    `;

    root.querySelector('#gateway-signin-btn')?.addEventListener('click', () => {
      renderPinPadModal(root, () => {
        render();
      });
    });

    root.querySelector('#gateway-signout-btn')?.addEventListener('click', async () => {
      await staffAuth.logout();
      render();
    });
  }

  render();
}

window.addEventListener('DOMContentLoaded', initPortalGateway);
