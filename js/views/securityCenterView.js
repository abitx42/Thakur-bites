// Thakur Bites Platform 2.0 — Developer Command Cockpit & Security Center
import { db } from '../firebase.js?v=4';
import { collection, onSnapshot, query, limit, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

let unsubscribeSecurity = null;
let currentEvents = [];
let severityFilter = 'all';
let scanRunning = false;
let lastScanResult = null;
let simulationResult = null;
let simRunning = false;

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
    unsubscribeSecurity();
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
      <div class="main-wrapper" style="max-width: 1300px; margin: 0 auto; padding: 1.5rem 1rem;">
        
        <!-- Top Security Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; line-height: 1;">
                DEVELOPER COMMAND COCKPIT & SECURITY
              </h2>
              <span style="background: #16A34A; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px;">
                ● SENTINEL 2.0 HARDENED
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Real-time attack telemetry, RBAC permission simulator, and continuous 15-point invariant scanner.
            </p>
          </div>

          <!-- Stat Badges & Integrity Action -->
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button id="run-scan-btn" ${scanRunning ? 'disabled' : ''} style="background: #0F172A; color: #FFF; border: none; padding: 10px 16px; border-radius: 10px; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px;">
              ${scanRunning ? '⏳ SCANNING INVARIANTS...' : '🔍 RUN 15-POINT INTEGRITY SCAN'}
            </button>

            <div style="background: #FEF2F2; border: 1.5px solid #FCA5A5; padding: 8px 14px; border-radius: 10px; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 800; color: #DC2626; line-height: 1;">
                ${critCount}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #991B1B; font-weight: 700;">CRITICAL</div>
            </div>

            <div style="background: #FFFBEB; border: 1.5px solid #FDE68A; padding: 8px 14px; border-radius: 10px; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 800; color: #D97706; line-height: 1;">
                ${warnCount}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #92400E; font-weight: 700;">WARNINGS</div>
            </div>

            <div style="background: #F0FDF4; border: 1.5px solid #86EFAC; padding: 8px 14px; border-radius: 10px; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 800; color: #16A34A; line-height: 1;">
                ${infoCount}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #166534; font-weight: 700;">AUDIT LOGS</div>
            </div>
          </div>
        </div>

        ${lastScanResult ? `
          <div style="background: ${lastScanResult.status === 'HEALTHY' ? '#F0FDF4' : (lastScanResult.status === 'CRITICAL_BREACH' ? '#FEF2F2' : '#FFFBEB')}; border: 1.5px solid ${lastScanResult.status === 'HEALTHY' ? '#86EFAC' : (lastScanResult.status === 'CRITICAL_BREACH' ? '#FCA5A5' : '#FDE68A')}; border-radius: 12px; padding: 1rem; margin-bottom: 1.5rem; font-family: var(--font-mono); font-size: 0.85rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>🛡️ 15-POINT INTEGRITY SCAN RESULT: ${lastScanResult.status}</strong>
              <span>${new Date(lastScanResult.timestamp).toLocaleTimeString()}</span>
            </div>
            <div style="margin-top: 6px; color: var(--ink-secondary);">
              Anomalies: ${lastScanResult.anomaliesDetected} | Action Taken: <strong>${lastScanResult.actionTaken}</strong>
            </div>
          </div>
        ` : ''}

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 1: INTERACTIVE RBAC PERMISSION SIMULATOR (P2.0)     -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 16px; padding: 1.4rem; margin-bottom: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
          <div style="margin-bottom: 1rem;">
            <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>🧪</span>
              <span>INTERACTIVE RBAC PERMISSION SIMULATOR</span>
            </h3>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Simulate role authorization boundaries against Firestore security rules and backend Cloud Functions.
            </p>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; align-items: flex-end;">
            <div>
              <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 4px;">
                SIMULATE ROLE:
              </label>
              <select id="sim-role-select" style="width: 100%; padding: 10px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.9rem;">
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
              <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 4px;">
                TARGET OPERATION:
              </label>
              <select id="sim-op-select" style="width: 100%; padding: 10px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.9rem;">
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
            <div style="margin-top: 1.2rem; padding: 1rem; border-radius: 10px; background: ${simulationResult.allowed ? '#F0FDF4' : '#FEF2F2'}; border: 1.5px solid ${simulationResult.allowed ? '#86EFAC' : '#FCA5A5'}; font-family: var(--font-mono); font-size: 0.85rem;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <span style="padding: 3px 8px; border-radius: 4px; font-weight: 800; background: ${simulationResult.allowed ? '#16A34A' : '#DC2626'}; color: #FFF;">
                  ${simulationResult.allowed ? '✅ AUTHORIZED (200 OK)' : '🚫 REJECTED (403 FORBIDDEN)'}
                </span>
                <span style="font-weight: 700; color: var(--ink-primary);">
                  Role: ${simulationResult.simulatedRole} → Operation: ${simulationResult.operation}
                </span>
              </div>
              <div style="color: var(--ink-secondary); margin-top: 4px;">
                ${simulationResult.reason}
              </div>
              <div style="font-size: 0.75rem; color: var(--ink-secondary); margin-top: 4px;">
                Required Capabilities: [${(simulationResult.requiredRoles || []).join(', ')}]
              </div>
            </div>
          ` : ''}
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 2: LIVE SECURITY EVENT & INCIDENT STREAM            -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 1.2rem; box-shadow: 0 1px 4px rgba(0,0,0,0.03);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 1rem;">
            <div style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700; color: var(--ink-primary);">
              LIVE INCIDENT & TELEMETRY STREAM (${filteredEvents.length} events logged)
            </div>

            <!-- Filter Buttons -->
            <div style="display: flex; gap: 6px;">
              <button class="sev-filter-btn ${severityFilter === 'all' ? 'active' : ''}" data-sev="all" style="padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border-light); font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">ALL</button>
              <button class="sev-filter-btn ${severityFilter === 'warn' ? 'active' : ''}" data-sev="warn" style="padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border-light); font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">WARNINGS</button>
              <button class="sev-filter-btn ${severityFilter === 'critical' ? 'active' : ''}" data-sev="critical" style="padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border-light); font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">CRITICAL</button>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${filteredEvents.length === 0 ? `
              <div style="text-align: center; padding: 3rem 1rem; font-family: var(--font-mono); font-size: 0.9rem; color: var(--ink-secondary);">
                🛡️ No security incidents or warnings logged. System healthy.
              </div>
            ` : filteredEvents.map(e => {
              const sev = (e.severity || 'INFO').toUpperCase();
              const isCrit = sev === 'CRITICAL';
              const isWarn = sev === 'HIGH' || sev === 'MEDIUM' || sev === 'WARN';
              const badgeColor = isCrit ? '#DC2626' : (isWarn ? '#D97706' : '#2563EB');
              const bgColor = isCrit ? '#FEF2F2' : (isWarn ? '#FFFBEB' : '#EFF6FF');

              const safeEventType = escapeHtml(e.eventType || 'SECURITY_EVENT');
              const safeIncidentId = e.incidentId ? escapeHtml(e.incidentId) : '';
              const safeActor = e.actorUid ? `Actor: ${escapeHtml(e.actorUid.slice(0, 16))}...` : 'System Boundary';
              const safeDetails = e.details ? escapeHtml(JSON.stringify(e.details)) : '';

              return `
                <div style="background: ${bgColor}; border: 1px solid ${badgeColor}40; border-radius: 10px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; font-family: var(--font-mono); font-size: 0.85rem;">
                  <div>
                    <span style="background: ${badgeColor}; color: #FFF; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 0.75rem; margin-right: 8px;">
                      ${safeEventType}
                    </span>
                    ${safeIncidentId ? `<span style="font-size: 0.75rem; color: var(--ink-secondary); font-weight: 700; margin-right: 8px;">[${safeIncidentId}]</span>` : ''}
                    <strong style="color: var(--ink-primary);">${safeActor}</strong>
                    ${e.suppressedOccurrences > 1 ? `<span style="background: #E2E8F0; color: #334155; font-size: 0.7rem; font-weight: 700; padding: 1px 6px; border-radius: 999px; margin-left: 6px;">×${Number(e.suppressedOccurrences)}</span>` : ''}
                    ${safeDetails ? `<div style="font-size: 0.75rem; color: var(--ink-secondary); margin-top: 3px;">${safeDetails}</div>` : ''}
                  </div>
                  <div style="color: var(--ink-secondary); font-size: 0.75rem;">
                    ${e.lastSeen ? new Date(e.lastSeen.toDate ? e.lastSeen.toDate() : e.lastSeen).toLocaleTimeString() : (e.firstSeen ? new Date(e.firstSeen.toDate ? e.firstSeen.toDate() : e.firstSeen).toLocaleTimeString() : 'Just now')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

      </div>
    `;

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
          render();
          const functions = getFunctions();
          const scanFn = httpsCallable(functions, 'runSecurityIntegrityScan');
          const res = await scanFn();
          lastScanResult = res.data;
        } catch (err) {
          alert('Integrity Scan Notice: ' + (err.message || err));
        } finally {
          scanRunning = false;
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
          const functions = getFunctions();
          const simFn = httpsCallable(functions, 'simulatePermissionCheck');
          const res = await simFn({ simulatedRole: role, operation: op });
          simulationResult = res.data;
        } catch (err) {
          alert('Simulation Error: ' + (err.message || err));
        } finally {
          simRunning = false;
          render();
        }
      });
    }
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
