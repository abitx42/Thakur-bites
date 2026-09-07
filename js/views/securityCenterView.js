// Thakur Bites Platform 2.0 — Developer Command Cockpit & Security Center
// Features: Live System Operational Cockpit, Runtime Server Telemetry,
// 15-Point Invariant Scanner, Menu Catalog Health, RBAC Simulator,
// Dynamic Security Rate Limits, Step-Up Verification, and Incident Streaming.

import { db, functions } from '../firebase.js?v=5';
import { doc, collection, onSnapshot, query, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

let unsubscribeSecurity = null;
let unsubscribeSystemStatus = null;
let currentEvents = [];
let severityFilter = 'all';
let scanRunning = false;
let lastScanResult = null;
let lastScanError = null;
let simulationResult = null;
let simRunning = false;
let rateLimitsData = null;
let rateLimitsLoading = false;
let rateLimitsSaving = false;
let rateLimitsFeedback = null;
let menuHealthResult = null;
let menuHealthLoading = false;
let menuHealthError = null;

// Platform 2.0 Operational Cockpit State
let currentOperationalMode = 'NORMAL';
let telemetryData = null;
let telemetryLoading = false;
let showDevOpModal = false;
let targetDevOpMode = null;
let devOpReason = '';
let devOpLoading = false;
let devOpError = null;
let stepUpChallenge = null;
let stepUpExecuting = false;
let stepUpError = null;

function escapeHtml(str) {
  if (typeof str !== 'string') str = String(str ?? '');
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m]));
}

export function renderSecurityCenterView(container) {
  if (unsubscribeSecurity) {
    try { unsubscribeSecurity(); } catch (_) {}
  }
  if (unsubscribeSystemStatus) {
    try { unsubscribeSystemStatus(); } catch (_) {}
  }

  function render() {
    const filteredEvents = currentEvents.filter(e => {
      const sev = (e.severity || 'INFO').toUpperCase();
      if (severityFilter === 'all') return true;
      if (severityFilter === 'critical') return sev === 'CRITICAL';
      if (severityFilter === 'warn') return sev === 'HIGH' || sev === 'MEDIUM' || sev === 'WARN';
      return sev === 'LOW' || sev === 'INFO';
    });

    const critCount = currentEvents.filter(e => (e.severity || '').toUpperCase() === 'CRITICAL').length;
    const warnCount = currentEvents.filter(e => {
      const s = (e.severity || '').toUpperCase();
      return s === 'HIGH' || s === 'MEDIUM' || s === 'WARN';
    }).length;
    const infoCount = currentEvents.filter(e => {
      const s = (e.severity || '').toUpperCase();
      return s === 'LOW' || s === 'INFO' || !e.severity;
    }).length;

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1300px; margin: 0 auto; padding: 1.5rem 1rem; color: #F8FAFC;">
        
        <!-- Top Security Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; line-height: 1; color: #FFF;">
                DEVELOPER COMMAND COCKPIT & SECURITY
              </h2>
              <span style="background: #16A34A; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px;">
                ● SENTINEL 2.0 HARDENED
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: #94A3B8; margin-top: 4px; margin-bottom: 0;">
              Real-time attack telemetry, System Operational Status controller, RBAC simulator, and continuous 15-point invariant scanner.
            </p>
          </div>

          <!-- Stat Badges & Integrity Action -->
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button id="run-scan-btn" ${scanRunning ? 'disabled' : ''} style="background: #2563EB; color: #FFF; border: none; padding: 10px 16px; border-radius: 10px; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 2px 8px rgba(37,99,235,0.4);">
              ${scanRunning ? '⏳ SCANNING INVARIANTS...' : '🔍 RUN 15-POINT INTEGRITY SCAN'}
            </button>

            <div style="background: #450A0A; border: 1.5px solid #DC2626; padding: 8px 14px; border-radius: 10px; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 800; color: #F87171; line-height: 1;">
                ${critCount}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #FCA5A5; font-weight: 700;">CRITICAL</div>
            </div>

            <div style="background: #451A03; border: 1.5px solid #D97706; padding: 8px 14px; border-radius: 10px; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 800; color: #FBBF24; line-height: 1;">
                ${warnCount}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #FDE68A; font-weight: 700;">WARNINGS</div>
            </div>

            <div style="background: #052E16; border: 1.5px solid #16A34A; padding: 8px 14px; border-radius: 10px; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 800; color: #4ADE80; line-height: 1;">
                ${infoCount}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #86EFAC; font-weight: 700;">AUDIT LOGS</div>
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 0: SYSTEM OPERATIONAL COCKPIT & RUNTIME TELEMETRY    -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #1E293B; border: 2px solid ${currentOperationalMode === 'NORMAL' ? '#22C55E' : (currentOperationalMode === 'DEGRADED' ? '#F59E0B' : '#EF4444')}; border-radius: 16px; padding: 1.4rem; margin-bottom: 2rem; box-shadow: 0 4px 16px rgba(0,0,0,0.25);">
          
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 1.2rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 1.6rem;">🚨</span>
                <h3 style="font-family: var(--font-display); font-size: 1.5rem; letter-spacing: 0.05em; margin: 0; color: #FFF;">
                  SYSTEM OPERATIONAL COCKPIT
                </h3>
                <span style="background: ${currentOperationalMode === 'NORMAL' ? '#16A34A' : (currentOperationalMode === 'DEGRADED' ? '#D97706' : '#DC2626')}; color: #FFF; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; padding: 3px 10px; border-radius: 999px;">
                  ● ${currentOperationalMode}
                </span>
              </div>
              <p style="font-family: var(--font-sans); font-size: 0.85rem; color: #94A3B8; margin: 4px 0 0 0;">
                ${currentOperationalMode === 'NORMAL' ? 'All student checkout, UPI payments, and counter order services are operating normally.' : (currentOperationalMode === 'DEGRADED' ? 'Online ordering paused. Counter operations running.' : (currentOperationalMode === 'FINANCIAL_FROZEN' ? 'Financial transactions frozen for accounting reconciliation.' : 'EMERGENCY HALT: Complete platform lockdown active.'))}
              </p>
            </div>

            <!-- Mode Toggle Controls -->
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="dev-op-mode-btn" data-mode="NORMAL" ${currentOperationalMode === 'NORMAL' ? 'disabled' : ''} style="padding: 8px 14px; border-radius: 8px; border: 1.5px solid #22C55E; background: ${currentOperationalMode === 'NORMAL' ? '#064E3B' : '#0F172A'}; color: #4ADE80; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer;">
                🟢 NORMAL
              </button>
              <button class="dev-op-mode-btn" data-mode="DEGRADED" ${currentOperationalMode === 'DEGRADED' ? 'disabled' : ''} style="padding: 8px 14px; border-radius: 8px; border: 1.5px solid #F59E0B; background: ${currentOperationalMode === 'DEGRADED' ? '#78350F' : '#0F172A'}; color: #FCD34D; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer;">
                🟡 PAUSE ONLINE (DEGRADED)
              </button>
              <button class="dev-op-mode-btn" data-mode="FINANCIAL_FROZEN" ${currentOperationalMode === 'FINANCIAL_FROZEN' ? 'disabled' : ''} style="padding: 8px 14px; border-radius: 8px; border: 1.5px solid #EF4444; background: ${currentOperationalMode === 'FINANCIAL_FROZEN' ? '#7F1D1D' : '#0F172A'}; color: #FCA5A5; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer;">
                🔴 FREEZE CHECKOUT
              </button>
              <button class="dev-op-mode-btn" data-mode="EMERGENCY_HALT" ${currentOperationalMode === 'EMERGENCY_HALT' ? 'disabled' : ''} style="padding: 8px 14px; border-radius: 8px; border: 1.5px solid #DC2626; background: #DC2626; color: #FFF; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 800; cursor: pointer;">
                🛑 EMERGENCY HALT
              </button>
              <button id="dev-step-up-btn" style="padding: 8px 14px; border-radius: 8px; border: 1.5px solid #6366F1; background: #312E81; color: #A5B4FC; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer;">
                🔐 60s Step-Up Challenge
              </button>
            </div>
          </div>

          <!-- Runtime Telemetry Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; border-top: 1px solid #334155; padding-top: 1rem;">
            <div style="background: #0F172A; padding: 10px 14px; border-radius: 8px; border: 1px solid #334155;">
              <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #94A3B8; text-transform: uppercase;">RUNTIME ENGINE</div>
              <div style="font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; color: #38BDF8;">Node.js ${telemetryData ? telemetryData.nodeVersion : 'v24.19.0'}</div>
            </div>
            <div style="background: #0F172A; padding: 10px 14px; border-radius: 8px; border: 1px solid #334155;">
              <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #94A3B8; text-transform: uppercase;">PROCESS UPTIME</div>
              <div style="font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; color: #4ADE80;">${telemetryData ? Math.floor(telemetryData.uptimeSeconds / 60) + ' mins' : 'Live Active'}</div>
            </div>
            <div style="background: #0F172A; padding: 10px 14px; border-radius: 8px; border: 1px solid #334155;">
              <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #94A3B8; text-transform: uppercase;">MEMORY HEAP</div>
              <div style="font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; color: #FCD34D;">${telemetryData ? telemetryData.memoryUsageMB + ' MB' : '< 128 MB'}</div>
            </div>
            <div style="background: #0F172A; padding: 10px 14px; border-radius: 8px; border: 1px solid #334155;">
              <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #94A3B8; text-transform: uppercase;">SECURITY INCIDENTS</div>
              <div style="font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; color: ${critCount > 0 ? '#EF4444' : '#4ADE80'};">${telemetryData ? telemetryData.activeSecurityIncidents : critCount} Active</div>
            </div>
            <div style="background: #0F172A; padding: 10px 14px; border-radius: 8px; border: 1px solid #334155; display: flex; align-items: center; justify-content: center;">
              <button id="refresh-telemetry-btn" ${telemetryLoading ? 'disabled' : ''} style="background: #1E293B; border: 1px solid #475569; color: #E2E8F0; padding: 8px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer; width: 100%;">
                ${telemetryLoading ? '⏳ Refreshing...' : '🔄 Refresh Metrics'}
              </button>
            </div>
          </div>

          ${stepUpChallenge ? `
            <!-- Step-Up Ephemeral Challenge Result Panel -->
            <div style="margin-top: 1rem; background: #0F172A; border: 1.5px solid #6366F1; border-radius: 10px; padding: 1rem; font-family: var(--font-mono); font-size: 0.8rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="color: #A5B4FC; font-weight: 700;">🔐 EPHEMERAL STEP-UP NONCE CHALLENGE ACTIVE</span>
                <span style="color: #FCD34D;">Expires: ${new Date(stepUpChallenge.expiresAt).toLocaleTimeString()}</span>
              </div>
              <div style="color: #CBD5E1; margin-bottom: 6px;">Challenge ID: <code>${stepUpChallenge.challengeId}</code></div>
              <div style="color: #CBD5E1; margin-bottom: 10px; word-break: break-all;">Nonce: <code>${stepUpChallenge.challengeNonce}</code></div>
              <div style="display: flex; gap: 8px;">
                <button id="execute-step-up-btn" ${stepUpExecuting ? 'disabled' : ''} style="background: #DC2626; color: #FFF; border: none; padding: 7px 14px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                  ${stepUpExecuting ? 'Executing...' : `Execute Action (${stepUpChallenge.action}) →`}
                </button>
                <button id="dismiss-step-up-btn" style="background: transparent; color: #94A3B8; border: 1px solid #475569; padding: 7px 14px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">
                  Dismiss
                </button>
              </div>
            </div>
          ` : ''}
        </div>

        ${lastScanResult ? `
          <div style="background: ${lastScanResult.status === 'HEALTHY' ? '#064E3B' : (lastScanResult.status === 'CRITICAL_BREACH' ? '#7F1D1D' : '#78350F')}; border: 1.5px solid ${lastScanResult.status === 'HEALTHY' ? '#10B981' : (lastScanResult.status === 'CRITICAL_BREACH' ? '#EF4444' : '#F59E0B')}; border-radius: 12px; padding: 1rem; margin-bottom: 1.5rem; font-family: var(--font-mono); font-size: 0.85rem; color: #FFF;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>🛡️ 15-POINT INTEGRITY SCAN RESULT: ${lastScanResult.status}</strong>
              <span>${new Date(lastScanResult.timestamp).toLocaleTimeString()}</span>
            </div>
            <div style="margin-top: 6px; opacity: 0.9;">
              Anomalies: ${lastScanResult.anomaliesDetected} | Action Taken: <strong>${lastScanResult.actionTaken}</strong>
            </div>
          </div>
        ` : ''}

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 0.8: CANONICAL MENU HEALTH & VISUAL CONTENT COVERAGE -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #1E293B; border: 1.5px solid #334155; border-radius: 16px; padding: 1.4rem; margin-bottom: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 1rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; display: flex; align-items: center; gap: 8px; color: #FFF;">
                  <span>📋</span>
                  <span>MENU CATALOG INTEGRITY & 3-TIER VISUAL COVERAGE</span>
                </h3>
                <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: ${menuHealthResult && menuHealthResult.status === 'HEALTHY' ? '#064E3B' : (menuHealthResult ? '#7F1D1D' : '#334155')}; color: ${menuHealthResult && menuHealthResult.status === 'HEALTHY' ? '#34D399' : (menuHealthResult ? '#FCA5A5' : '#CBD5E1')};">
                  ${menuHealthResult ? menuHealthResult.status : 'DIAGNOSTIC READY'}
                </span>
              </div>
              <p style="font-family: var(--font-sans); font-size: 0.85rem; color: #94A3B8; margin-top: 4px; margin-bottom: 0;">
                Verifies that all 85 physical menu items are active, have server-authoritative paise pricing, and resolve through the 3-tier visual fallback engine.
              </p>
            </div>

            <button 
              id="check-menu-health-btn"
              ${menuHealthLoading ? 'disabled' : ''}
              style="padding: 8px 16px; border-radius: 8px; background: #0F172A; color: #FFF; border: 1px solid #475569; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;"
            >
              ${menuHealthLoading ? '⏳ Verifying Catalog...' : '🔍 Check Menu Health'}
            </button>
          </div>

          ${menuHealthResult ? `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 1rem;">
              <div style="background: #0F172A; padding: 10px; border-radius: 8px; border: 1px solid #334155;">
                <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #94A3B8;">TOTAL ITEMS</div>
                <div style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: #FFF;">${menuHealthResult.totalItems}</div>
              </div>
              <div style="background: #0F172A; padding: 10px; border-radius: 8px; border: 1px solid #334155;">
                <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #4ADE80;">ACTIVE CATALOG</div>
                <div style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: #4ADE80;">${menuHealthResult.activeItems}</div>
              </div>
              <div style="background: #0F172A; padding: 10px; border-radius: 8px; border: 1px solid #334155;">
                <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #94A3B8;">REAL PHOTOS</div>
                <div style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: #FFF;">📷 ${menuHealthResult.itemsWithDirectPhotos}</div>
              </div>
              <div style="background: #0F172A; padding: 10px; border-radius: 8px; border: 1px solid #334155;">
                <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #FCD34D;">VISUAL KEYS</div>
                <div style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: #FCD34D;">🎨 ${menuHealthResult.itemsWithVisualKeys}</div>
              </div>
              <div style="background: #0F172A; padding: 10px; border-radius: 8px; border: 1px solid #334155;">
                <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #94A3B8;">CATEGORIES</div>
                <div style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: #FFF;">${menuHealthResult.categoriesCount} / ${menuHealthResult.subcategoriesCount}</div>
              </div>
            </div>

            ${(menuHealthResult.anomalies || []).length === 0 ? `
              <div style="padding: 10px 14px; border-radius: 8px; background: #064E3B; border: 1px solid #10B981; font-family: var(--font-mono); font-size: 0.8rem; color: #A7F3D0;">
                ✅ 100% Menu Health: All canonical items have authoritative prices, dietary classifications, and 3-tier visual resolvers.
              </div>
            ` : `
              <div style="padding: 10px 14px; border-radius: 8px; background: #450A0A; border: 1px solid #EF4444; font-family: var(--font-mono); font-size: 0.8rem; color: #FCA5A5;">
                ⚠️ Catalog Anomalies Detected:
                <ul style="margin: 6px 0 0 16px; padding: 0;">
                  ${menuHealthResult.anomalies.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
                </ul>
              </div>
            `}
          ` : `
            <div style="padding: 1rem; background: #0F172A; border-radius: 10px; border: 1px dashed #334155; text-align: center; font-family: var(--font-mono); font-size: 0.8rem; color: #94A3B8;">
              Click "Check Menu Health" to run an authoritative diagnostic on the live menu catalog and visual resolver coverage.
            </div>
          `}
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 1: INTERACTIVE RBAC PERMISSION SIMULATOR            -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #1E293B; border: 1.5px solid #334155; border-radius: 16px; padding: 1.4rem; margin-bottom: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
          <div style="margin-bottom: 1rem;">
            <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; display: flex; align-items: center; gap: 8px; color: #FFF;">
              <span>🧪</span>
              <span>INTERACTIVE RBAC PERMISSION SIMULATOR</span>
            </h3>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: #94A3B8; margin-top: 4px; margin-bottom: 0;">
              Simulate role authorization boundaries against Firestore security rules and backend Cloud Functions.
            </p>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; align-items: flex-end;">
            <div>
              <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: #94A3B8; margin-bottom: 4px;">
                SIMULATE ROLE:
              </label>
              <select id="sim-role-select" style="width: 100%; padding: 10px; border-radius: 8px; border: 1.5px solid #475569; background: #0F172A; color: #FFF; font-family: var(--font-sans); font-size: 0.9rem;">
                <option value="student">👨‍🎓 Student (Institutional)</option>
                <option value="teacher">👨‍🏫 Teacher / Faculty</option>
                <option value="college_staff">🏢 College Staff</option>
                <option value="visitor">👤 Visitor / Guest</option>
                <option value="kitchen">🍳 Kitchen Staff</option>
                <option value="pickup">📦 Pickup Staff</option>
                <option value="cashier">💵 Cashier</option>
                <option value="manager">📋 Canteen Manager</option>
                <option value="admin">🛡️ Canteen Admin</option>
                <option value="security_admin">⚡️ Security Admin</option>
              </select>
            </div>

            <div>
              <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: #94A3B8; margin-bottom: 4px;">
                TARGET OPERATION:
              </label>
              <select id="sim-op-select" style="width: 100%; padding: 10px; border-radius: 8px; border: 1.5px solid #475569; background: #0F172A; color: #FFF; font-family: var(--font-sans); font-size: 0.9rem;">
                <option value="createCheckout">createCheckout (Place Order)</option>
                <option value="reviewVerificationApplication">reviewVerificationApplication (Approve Faculty)</option>
                <option value="generateShiftPin">generateShiftPin (Issue Workstation PIN)</option>
                <option value="adjustInventoryStock">adjustInventoryStock (Modify Physical Stock)</option>
                <option value="setSystemOperationalMode">setSystemOperationalMode (Emergency Kill Switch)</option>
                <option value="reconcileDailyLedger">reconcileDailyLedger (Financial Reconcile)</option>
                <option value="viewSecurityIncidents">viewSecurityIncidents (Security Telemetry)</option>
              </select>
            </div>

            <button 
              id="test-rbac-btn"
              ${simRunning ? 'disabled' : ''}
              style="padding: 11px 18px; border-radius: 8px; background: #2563EB; color: #FFF; border: none; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;"
            >
              ${simRunning ? 'Evaluating...' : 'Test RBAC Capability →'}
            </button>
          </div>

          ${simulationResult ? `
            <div style="margin-top: 1.2rem; padding: 1rem; border-radius: 10px; background: ${simulationResult.allowed ? '#064E3B' : '#450A0A'}; border: 1.5px solid ${simulationResult.allowed ? '#10B981' : '#EF4444'}; font-family: var(--font-mono); font-size: 0.85rem; color: #FFF;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <span style="padding: 3px 8px; border-radius: 4px; font-weight: 800; background: ${simulationResult.allowed ? '#16A34A' : '#DC2626'}; color: #FFF;">
                  ${simulationResult.allowed ? '✅ AUTHORIZED (200 OK)' : '🚫 REJECTED (403 FORBIDDEN)'}
                </span>
                <span style="font-weight: 700; color: #FFF;">
                  Role: ${simulationResult.simulatedRole} → Operation: ${simulationResult.operation}
                </span>
              </div>
              <div style="color: #CBD5E1; margin-top: 4px;">
                ${simulationResult.reason}
              </div>
              <div style="font-size: 0.75rem; color: #94A3B8; margin-top: 4px;">
                Required Capabilities: [${(simulationResult.requiredRoles || []).join(', ')}]
              </div>
            </div>
          ` : ''}
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 1.5: DYNAMIC SECURITY RATE LIMITS CONFIGURATION      -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #1E293B; border: 1.5px solid #334155; border-radius: 14px; padding: 1.2rem; margin-bottom: 1.5rem; box-shadow: 0 1px 4px rgba(0,0,0,0.2);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 0.8rem;">
            <div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; color: #FFF; display: flex; align-items: center; gap: 8px;">
                ⚡ DYNAMIC SECURITY RATE LIMITS (FIRESTORE SYSTEMCONFIG)
                <span style="font-size: 0.7rem; background: #064E3B; color: #34D399; padding: 2px 6px; border-radius: 4px;">FAIL-CLOSED CACHE</span>
              </div>
              <p style="font-family: var(--font-sans); font-size: 0.8rem; color: #94A3B8; margin: 3px 0 0 0;">
                Configure sliding-window request ceilings dynamically without code deployment. Backed by 60s in-memory TTL caching.
              </p>
            </div>
            <button id="refresh-rate-limits-btn" style="background: #0F172A; border: 1px solid #475569; color: #E2E8F0; padding: 6px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer;">
              🔄 Refresh Active Limits
            </button>
          </div>

          ${rateLimitsFeedback ? `
            <div style="margin-bottom: 1rem; padding: 8px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; background: ${rateLimitsFeedback.type === 'error' ? '#450A0A' : '#064E3B'}; color: ${rateLimitsFeedback.type === 'error' ? '#FCA5A5' : '#86EFAC'}; border: 1px solid ${rateLimitsFeedback.type === 'error' ? '#EF4444' : '#10B981'};">
              ${escapeHtml(rateLimitsFeedback.message)}
            </div>
          ` : ''}

          <!-- Update Form Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; align-items: flex-end; background: #0F172A; padding: 12px; border-radius: 10px; border: 1px solid #334155; margin-bottom: 1rem;">
            <div>
              <label style="display: block; font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; color: #94A3B8; margin-bottom: 4px;">
                TARGET ENDPOINT:
              </label>
              <select id="rate-limit-endpoint-select" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #475569; background: #1E293B; color: #FFF; font-family: var(--font-mono); font-size: 0.8rem;">
                <option value="checkout">checkout (Order Placement)</option>
                <option value="payment_session">payment_session (Gateway Session)</option>
                <option value="pickup_verify">pickup_verify (Token Pickup QR)</option>
                <option value="role_assignment">role_assignment (Staff Role Update)</option>
                <option value="emergency_action">emergency_action (Kill Switch)</option>
                <option value="refund">refund (Ledger Refund)</option>
                <option value="inventory_adjustment">inventory_adjustment (Stock Edit)</option>
                <option value="cash_payment">cash_payment (Cashier Record)</option>
                <option value="developer_telemetry">developer_telemetry (Logs Query)</option>
              </select>
            </div>

            <div>
              <label style="display: block; font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; color: #94A3B8; margin-bottom: 4px;">
                MAX REQUESTS (1–1000):
              </label>
              <input type="number" id="rate-limit-max-input" min="1" max="1000" placeholder="e.g. 15" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #475569; background: #1E293B; color: #FFF; font-family: var(--font-mono); font-size: 0.8rem; box-sizing: border-box;" />
            </div>

            <div>
              <label style="display: block; font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; color: #94A3B8; margin-bottom: 4px;">
                WINDOW SECONDS (5–3600):
              </label>
              <input type="number" id="rate-limit-window-input" min="5" max="3600" placeholder="e.g. 60" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #475569; background: #1E293B; color: #FFF; font-family: var(--font-mono); font-size: 0.8rem; box-sizing: border-box;" />
            </div>

            <div>
              <label style="display: block; font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; color: #94A3B8; margin-bottom: 4px;">
                AUDIT REASON:
              </label>
              <input type="text" id="rate-limit-reason-input" placeholder="e.g. Lunch rush traffic spike" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #475569; background: #1E293B; color: #FFF; font-family: var(--font-sans); font-size: 0.8rem; box-sizing: border-box;" />
            </div>

            <div>
              <button id="save-rate-limit-btn" ${rateLimitsSaving ? 'disabled' : ''} style="width: 100%; padding: 9px; border-radius: 6px; background: #2563EB; color: #FFF; border: none; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;">
                ${rateLimitsSaving ? 'Updating...' : 'Save Limit Policy'}
              </button>
            </div>
          </div>

          <!-- Active Effective Limits Summary -->
          ${rateLimitsData ? `
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #94A3B8; margin-bottom: 6px;">
              Active Dynamic Overrides: ${Object.keys(rateLimitsData.overrides || {}).length} configured ${rateLimitsData.updatedAt ? `(Last updated: ${new Date(rateLimitsData.updatedAt).toLocaleTimeString()})` : ''}
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; max-height: 180px; overflow-y: auto;">
              ${Object.entries(rateLimitsData.effective || {}).map(([ep, cfg]) => {
                const isOverridden = Boolean(rateLimitsData.overrides && rateLimitsData.overrides[ep]);
                return `
                  <div style="padding: 6px 10px; border-radius: 6px; background: ${isOverridden ? '#78350F' : '#0F172A'}; border: 1px solid ${isOverridden ? '#F59E0B' : '#334155'}; font-family: var(--font-mono); font-size: 0.72rem;">
                    <strong style="color: #FFF;">${ep}</strong>: 
                    <span style="font-weight: 700; color: ${isOverridden ? '#FDE68A' : '#38BDF8'};">${cfg.maxRequests} req / ${cfg.windowSeconds}s</span>
                    ${isOverridden ? `<span style="font-size: 0.65rem; background: #F59E0B; color: #000; padding: 1px 4px; border-radius: 3px; margin-left: 4px; font-weight: 800;">DYNAMIC</span>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <div style="font-family: var(--font-mono); font-size: 0.8rem; color: #94A3B8; padding: 10px; text-align: center;">
              ⏳ Loading dynamic rate limit policies from Firestore...
            </div>
          `}
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 2: LIVE SECURITY EVENT & INCIDENT STREAM            -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #1E293B; border: 1.5px solid #334155; border-radius: 14px; padding: 1.2rem; box-shadow: 0 1px 4px rgba(0,0,0,0.2);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 1rem;">
            <div style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700; color: #FFF;">
              LIVE INCIDENT & TELEMETRY STREAM (${filteredEvents.length} events logged)
            </div>

            <!-- Filter Buttons -->
            <div style="display: flex; gap: 6px;">
              <button class="sev-filter-btn ${severityFilter === 'all' ? 'active' : ''}" data-sev="all" style="padding: 4px 10px; border-radius: 6px; border: 1px solid #475569; background: ${severityFilter === 'all' ? '#2563EB' : '#0F172A'}; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">ALL</button>
              <button class="sev-filter-btn ${severityFilter === 'warn' ? 'active' : ''}" data-sev="warn" style="padding: 4px 10px; border-radius: 6px; border: 1px solid #475569; background: ${severityFilter === 'warn' ? '#D97706' : '#0F172A'}; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">WARNINGS</button>
              <button class="sev-filter-btn ${severityFilter === 'critical' ? 'active' : ''}" data-sev="critical" style="padding: 4px 10px; border-radius: 6px; border: 1px solid #475569; background: ${severityFilter === 'critical' ? '#DC2626' : '#0F172A'}; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">CRITICAL</button>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${filteredEvents.length === 0 ? `
              <div style="text-align: center; padding: 3rem 1rem; font-family: var(--font-mono); font-size: 0.9rem; color: #94A3B8;">
                🛡️ No security incidents or warnings logged. System healthy.
              </div>
            ` : filteredEvents.map(e => {
              const sev = (e.severity || 'INFO').toUpperCase();
              const isCrit = sev === 'CRITICAL';
              const isWarn = sev === 'HIGH' || sev === 'MEDIUM' || sev === 'WARN';
              const badgeColor = isCrit ? '#EF4444' : (isWarn ? '#F59E0B' : '#3B82F6');
              const bgColor = isCrit ? '#450A0A' : (isWarn ? '#451A03' : '#0F172A');

              const safeEventType = escapeHtml(e.eventType || 'SECURITY_EVENT');
              const safeIncidentId = e.incidentId ? escapeHtml(e.incidentId) : '';
              const safeActor = e.actorUid ? `Actor: ${escapeHtml(e.actorUid.slice(0, 16))}...` : 'System Boundary';
              const safeDetails = e.details ? escapeHtml(JSON.stringify(e.details)) : '';

              return `
                <div style="background: ${bgColor}; border: 1px solid ${badgeColor}60; border-radius: 10px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; font-family: var(--font-mono); font-size: 0.85rem;">
                  <div>
                    <span style="background: ${badgeColor}; color: #FFF; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 0.75rem; margin-right: 8px;">
                      ${safeEventType}
                    </span>
                    ${safeIncidentId ? `<span style="font-size: 0.75rem; color: #94A3B8; font-weight: 700; margin-right: 8px;">[${safeIncidentId}]</span>` : ''}
                    <strong style="color: #FFF;">${safeActor}</strong>
                    ${e.suppressedOccurrences > 1 ? `<span style="background: #334155; color: #CBD5E1; font-size: 0.7rem; font-weight: 700; padding: 1px 6px; border-radius: 999px; margin-left: 6px;">×${Number(e.suppressedOccurrences)}</span>` : ''}
                    ${safeDetails ? `<div style="font-size: 0.75rem; color: #CBD5E1; margin-top: 3px;">${safeDetails}</div>` : ''}
                  </div>
                  <div style="color: #94A3B8; font-size: 0.75rem;">
                    ${e.lastSeen ? new Date(e.lastSeen.toDate ? e.lastSeen.toDate() : e.lastSeen).toLocaleTimeString() : (e.firstSeen ? new Date(e.firstSeen.toDate ? e.firstSeen.toDate() : e.firstSeen).toLocaleTimeString() : 'Just now')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- DEVELOPER IN-APP OPERATIONAL MODE CHANGE MODAL              -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        ${showDevOpModal && targetDevOpMode ? `
          <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem;">
            <div style="background: #1E293B; border-radius: 16px; width: 100%; max-width: 520px; padding: 1.8rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); border: 2px solid #475569; color: #FFF;">
              
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.2rem;">
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 1.5rem;">🚨</span>
                    <h3 style="font-family: var(--font-display); font-size: 1.6rem; letter-spacing: 0.05em; margin: 0; color: #FFF;">
                      SYSTEM OPERATIONAL TRANSITION
                    </h3>
                  </div>
                  <p style="font-family: var(--font-sans); font-size: 0.85rem; color: #94A3B8; margin: 4px 0 0 0;">
                    Target Runtime Mode: <strong>${escapeHtml(targetDevOpMode)}</strong>
                  </p>
                </div>
                <button id="close-dev-op-modal-btn" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #94A3B8;">&times;</button>
              </div>

              <!-- Mode Impact Description -->
              <div style="padding: 12px 14px; border-radius: 10px; margin-bottom: 1.2rem; font-family: var(--font-mono); font-size: 0.82rem; ${targetDevOpMode === 'NORMAL' ? 'background: #064E3B; border: 1.5px solid #10B981; color: #A7F3D0;' : (targetDevOpMode === 'DEGRADED' ? 'background: #451A03; border: 1.5px solid #F59E0B; color: #FDE68A;' : (targetDevOpMode === 'FINANCIAL_FROZEN' ? 'background: #450A0A; border: 1.5px solid #EF4444; color: #FCA5A5;' : 'background: #7F1D1D; border: 1.5px solid #EF4444; color: #FFF;'))}">
                <strong>${targetDevOpMode === 'NORMAL' ? '🟢 RESTORE NORMAL OPERATIONS' : (targetDevOpMode === 'DEGRADED' ? '🟡 DEGRADED MODE (COUNTER ONLY)' : (targetDevOpMode === 'FINANCIAL_FROZEN' ? '🔴 FREEZE ALL FINANCIAL CHECKOUTS' : '🛑 TOTAL PLATFORM EMERGENCY HALT'))}</strong>:
                <div style="margin-top: 4px; font-family: var(--font-sans); font-size: 0.8rem; opacity: 0.95;">
                  ${targetDevOpMode === 'NORMAL' ? 'Permits all online checkouts, payment gateway sessions, and staff counter sales.' : (targetDevOpMode === 'DEGRADED' ? 'Rejects online student checkout. Canteen counter cash orders continue.' : (targetDevOpMode === 'FINANCIAL_FROZEN' ? 'Freezes all payment processing and checkouts for financial auditing.' : 'Total immediate lockdown. All student and staff mutations rejected at API layer.'))}
                </div>
              </div>

              ${devOpError ? `
                <div style="padding: 10px 14px; background: #450A0A; border: 1.5px solid #EF4444; border-radius: 8px; color: #FCA5A5; font-family: var(--font-mono); font-size: 0.82rem; margin-bottom: 1.2rem;">
                  ${escapeHtml(devOpError)}
                </div>
              ` : ''}

              <!-- Preset Reasons -->
              <div style="margin-bottom: 1.2rem;">
                <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; margin-bottom: 6px; color: #94A3B8;">
                  OPERATIONAL JUSTIFICATION PRESETS:
                </label>
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                  <button type="button" class="dev-op-preset-btn" data-reason="Developer system maintenance recovery" style="padding: 5px 10px; border-radius: 6px; border: 1px solid #475569; background: #0F172A; color: #CBD5E1; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">System Recovery</button>
                  <button type="button" class="dev-op-preset-btn" data-reason="Peak load traffic shedding" style="padding: 5px 10px; border-radius: 6px; border: 1px solid #475569; background: #0F172A; color: #CBD5E1; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">Peak Traffic</button>
                  <button type="button" class="dev-op-preset-btn" data-reason="Accounting reconciliation freeze" style="padding: 5px 10px; border-radius: 6px; border: 1px solid #475569; background: #0F172A; color: #CBD5E1; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">Ledger Audit</button>
                  <button type="button" class="dev-op-preset-btn" data-reason="Security telemetry incident response" style="padding: 5px 10px; border-radius: 6px; border: 1px solid #475569; background: #0F172A; color: #CBD5E1; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">Security Incident</button>
                </div>
              </div>

              <!-- Reason Input -->
              <div style="margin-bottom: 1.5rem;">
                <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; margin-bottom: 6px; color: #94A3B8;">
                  AUDIT NOTE (REQUIRED):
                </label>
                <input type="text" id="dev-op-modal-reason-input" value="${escapeHtml(devOpReason)}" placeholder="Provide audit justification" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid #475569; background: #0F172A; color: #FFF; font-family: var(--font-sans); font-size: 0.88rem; box-sizing: border-box;" />
              </div>

              <!-- Action Buttons -->
              <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="cancel-dev-op-modal-btn" type="button" style="padding: 10px 16px; border-radius: 8px; background: transparent; border: 1.5px solid #475569; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer; color: #94A3B8;">
                  Cancel
                </button>
                <button id="submit-dev-op-modal-btn" ${devOpLoading ? 'disabled' : ''} style="padding: 10px 20px; border-radius: 8px; background: ${targetDevOpMode === 'NORMAL' ? '#16A34A' : (targetDevOpMode === 'DEGRADED' ? '#D97706' : '#DC2626')}; color: #FFF; border: none; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                  ${devOpLoading ? 'Executing Transition...' : `Confirm: Set ${targetDevOpMode} →`}
                </button>
              </div>

            </div>
          </div>
        ` : ''}

      </div>
    `;

    // ─── Operational Cockpit Listeners ─────────────────────────────
    container.querySelectorAll('.dev-op-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        targetDevOpMode = btn.getAttribute('data-mode');
        showDevOpModal = true;
        devOpError = null;
        if (targetDevOpMode === 'NORMAL') devOpReason = 'Developer system recovery to NORMAL operations';
        else if (targetDevOpMode === 'DEGRADED') devOpReason = 'Developer load shedding override';
        else if (targetDevOpMode === 'FINANCIAL_FROZEN') devOpReason = 'Accounting ledger reconciliation audit freeze';
        else if (targetDevOpMode === 'EMERGENCY_HALT') devOpReason = 'Emergency platform halt initiated from Developer Cockpit';
        render();
      });
    });

    if (showDevOpModal) {
      container.querySelector('#close-dev-op-modal-btn')?.addEventListener('click', () => {
        showDevOpModal = false;
        devOpError = null;
        render();
      });

      container.querySelector('#cancel-dev-op-modal-btn')?.addEventListener('click', () => {
        showDevOpModal = false;
        devOpError = null;
        render();
      });

      container.querySelectorAll('.dev-op-preset-btn').forEach(pBtn => {
        pBtn.addEventListener('click', () => {
          const r = pBtn.getAttribute('data-reason');
          const input = container.querySelector('#dev-op-modal-reason-input');
          if (input) input.value = r;
          devOpReason = r;
        });
      });

      container.querySelector('#submit-dev-op-modal-btn')?.addEventListener('click', async () => {
        const inputReason = container.querySelector('#dev-op-modal-reason-input')?.value?.trim();
        const reason = inputReason || devOpReason || 'Developer operational transition';
        devOpLoading = true;
        devOpError = null;
        render();

        try {
          const setModeFn = httpsCallable(functions, 'setSystemOperationalMode');
          await setModeFn({ mode: targetDevOpMode, reason });
          currentOperationalMode = targetDevOpMode;
          showDevOpModal = false;
          devOpLoading = false;
          await loadDeveloperTelemetry();
        } catch (err) {
          console.error("Developer setSystemOperationalMode error:", err);
          devOpError = err.message || 'Failed to update system operational status.';
          devOpLoading = false;
          render();
        }
      });
    }

    // Refresh Telemetry Listener
    container.querySelector('#refresh-telemetry-btn')?.addEventListener('click', () => {
      loadDeveloperTelemetry();
    });

    // Step-Up Challenge Listener
    container.querySelector('#dev-step-up-btn')?.addEventListener('click', async () => {
      try {
        const challengeFn = httpsCallable(functions, 'requestEmergencyStepUpChallenge');
        const res = await challengeFn({
          action: 'FREEZE_FINANCIALS',
          reason: 'Emergency step-up verification challenge from Developer Cockpit',
        });
        stepUpChallenge = res.data;
        stepUpError = null;
        render();
      } catch (err) {
        stepUpError = err.message || String(err);
        render();
      }
    });

    if (stepUpChallenge) {
      container.querySelector('#dismiss-step-up-btn')?.addEventListener('click', () => {
        stepUpChallenge = null;
        stepUpError = null;
        render();
      });

      container.querySelector('#execute-step-up-btn')?.addEventListener('click', async () => {
        stepUpExecuting = true;
        render();

        try {
          const execFn = httpsCallable(functions, 'executeEmergencyOperationalAction');
          await execFn({
            action: stepUpChallenge.action,
            challengeId: stepUpChallenge.challengeId,
            challengeNonce: stepUpChallenge.challengeNonce,
            reason: 'Step-up challenge execution verified',
          });
          stepUpChallenge = null;
          stepUpExecuting = false;
          await loadDeveloperTelemetry();
        } catch (err) {
          stepUpError = err.message || String(err);
          stepUpExecuting = false;
          render();
        }
      });
    }

    // Filter Listeners
    container.querySelectorAll('.sev-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        severityFilter = btn.getAttribute('data-sev');
        render();
      });
    });

    // Run Scan Listener
    const scanBtn = container.querySelector('#run-scan-btn');
    if (scanBtn) {
      scanBtn.addEventListener('click', async () => {
        try {
          scanRunning = true;
          lastScanError = null;
          render();
          const scanFn = httpsCallable(functions, 'runSecurityIntegrityScan');
          const res = await scanFn();
          lastScanResult = res.data;
        } catch (err) {
          lastScanError = err.message || String(err);
        } finally {
          scanRunning = false;
          render();
        }
      });
    }

    // Menu Health Diagnostic Listener
    const checkMenuBtn = container.querySelector('#check-menu-health-btn');
    if (checkMenuBtn) {
      checkMenuBtn.addEventListener('click', async () => {
        menuHealthLoading = true;
        menuHealthError = null;
        render();

        try {
          const healthFn = httpsCallable(functions, 'getMenuHealth');
          const res = await healthFn();
          menuHealthResult = res.data;
        } catch (err) {
          menuHealthError = err.message || String(err);
        } finally {
          menuHealthLoading = false;
          render();
        }
      });
    }

    // Interactive RBAC Simulator Listener
    const testRbacBtn = container.querySelector('#test-rbac-btn');
    if (testRbacBtn) {
      testRbacBtn.addEventListener('click', async () => {
        const role = container.querySelector('#sim-role-select')?.value;
        const op = container.querySelector('#sim-op-select')?.value;

        simRunning = true;
        render();

        try {
          const simFn = httpsCallable(functions, 'simulatePermissionCheck');
          const res = await simFn({ simulatedRole: role, operation: op });
          simulationResult = res.data;
        } catch (err) {
          simulationResult = { allowed: false, reason: err.message || String(err), simulatedRole: role, operation: op, requiredRoles: [] };
        } finally {
          simRunning = false;
          render();
        }
      });
    }

    // Refresh Rate Limits Listener
    const refreshLimitsBtn = container.querySelector('#refresh-rate-limits-btn');
    if (refreshLimitsBtn) {
      refreshLimitsBtn.addEventListener('click', async () => {
        rateLimitsFeedback = null;
        await loadRateLimits();
      });
    }

    // Save Rate Limit Policy Listener
    const saveLimitBtn = container.querySelector('#save-rate-limit-btn');
    if (saveLimitBtn) {
      saveLimitBtn.addEventListener('click', async () => {
        const endpoint = container.querySelector('#rate-limit-endpoint-select')?.value;
        const maxReq = parseInt(container.querySelector('#rate-limit-max-input')?.value || '', 10);
        const winSec = parseInt(container.querySelector('#rate-limit-window-input')?.value || '', 10);
        const reason = container.querySelector('#rate-limit-reason-input')?.value?.trim() || '';

        if (!endpoint || isNaN(maxReq) || isNaN(winSec)) {
          rateLimitsFeedback = { type: 'error', message: 'Please select an endpoint and provide valid integers for max requests and window seconds.' };
          render();
          return;
        }

        if (maxReq < 1 || maxReq > 1000) {
          rateLimitsFeedback = { type: 'error', message: 'Max requests must be between 1 and 1,000.' };
          render();
          return;
        }

        if (winSec < 5 || winSec > 3600) {
          rateLimitsFeedback = { type: 'error', message: 'Window seconds must be between 5 and 3,600.' };
          render();
          return;
        }

        try {
          rateLimitsSaving = true;
          render();
          const updateFn = httpsCallable(functions, 'updateSecurityRateLimits');
          const res = await updateFn({
            limits: {
              [endpoint]: { maxRequests: maxReq, windowSeconds: winSec },
            },
            reason,
          });

          rateLimitsFeedback = { type: 'success', message: res.data?.message || 'Rate limit updated successfully.' };
          await loadRateLimits();
        } catch (err) {
          rateLimitsFeedback = { type: 'error', message: err.message || 'Failed to update rate limit.' };
          render();
        } finally {
          rateLimitsSaving = false;
          render();
        }
      });
    }
  }

  async function loadDeveloperTelemetry() {
    if (telemetryLoading) return;
    try {
      telemetryLoading = true;
      const getTelFn = httpsCallable(functions, 'getDeveloperTelemetry');
      const res = await getTelFn();
      if (res.data && res.data.telemetry) {
        telemetryData = res.data.telemetry;
        if (telemetryData.operationalMode) {
          currentOperationalMode = telemetryData.operationalMode;
        }
      }
    } catch (err) {
      console.warn('Could not load developer telemetry:', err);
    } finally {
      telemetryLoading = false;
      render();
    }
  }

  async function loadRateLimits() {
    if (rateLimitsLoading) return;
    try {
      rateLimitsLoading = true;
      const getFn = httpsCallable(functions, 'getSecurityRateLimits');
      const res = await getFn();
      rateLimitsData = res.data;
    } catch (err) {
      console.warn('Could not load security rate limits:', err);
    } finally {
      rateLimitsLoading = false;
      render();
    }
  }

  // Load telemetry & rate limits on mount
  loadDeveloperTelemetry();
  if (!rateLimitsData && !rateLimitsLoading) {
    loadRateLimits();
  }

  // Subscribe to real-time publicSystemStatus/global
  try {
    const statusDocRef = doc(db, 'publicSystemStatus', 'global');
    unsubscribeSystemStatus = onSnapshot(statusDocRef, (snap) => {
      if (snap.exists()) {
        currentOperationalMode = snap.data()?.mode || 'NORMAL';
        render();
      }
    }, (err) => {
      console.warn("Public status subscription notice:", err);
    });
  } catch (err) {
    console.warn("Could not attach public status listener:", err);
  }

  // Subscribe to real-time security events
  const secRef = collection(db, 'securityEvents');
  const q = query(secRef, limit(50));

  unsubscribeSecurity = onSnapshot(q, (snapshot) => {
    currentEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    render();
  }, (error) => {
    console.error("Security Center subscription notice:", error);
    render();
  });
}
