// Staff Operations Security Center & Audit Stream View (Stage 3.0 Hardened)
import { db } from '../firebase.js?v=4';
import { collection, onSnapshot, query, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

let unsubscribeSecurity = null;
let currentEvents = [];
let severityFilter = 'all';
let scanRunning = false;
let lastScanResult = null;

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
      <div class="main-wrapper" style="max-width: 1200px; margin: 0 auto; padding: 1.5rem 1rem;">
        
        <!-- Top Security Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; line-height: 1;">
                SECURITY & AUDIT OPERATIONS CENTER
              </h2>
              <span style="background: #16A34A; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px;">
                ● ACTIVE SENTINEL 3.0
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Live stream of deterministic security telemetry, rate-limit triggers, fail-closed assertions, and continuous integrity monitor states.
            </p>
          </div>

          <!-- Stat Badges & Integrity Action -->
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button id="run-scan-btn" ${scanRunning ? 'disabled' : ''} style="background: #0F172A; color: #FFF; border: none; padding: 10px 16px; border-radius: 10px; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px;">
              ${scanRunning ? '⏳ SCANNING...' : '🔍 RUN INTEGRITY SCAN'}
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
              <strong>🛡️ INTEGRITY MONITOR SCAN RESULT: ${lastScanResult.status}</strong>
              <span>${new Date(lastScanResult.timestamp).toLocaleTimeString()}</span>
            </div>
            <div style="margin-top: 6px; color: var(--ink-secondary);">
              Anomalies: ${lastScanResult.anomaliesDetected} | Action Taken: <strong>${lastScanResult.actionTaken}</strong>
            </div>
          </div>
        ` : ''}

        <!-- Sentinel Health Matrix -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem;">
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); font-weight: 700;">COLLEGE NAT-AWARE RATE LIMIT</div>
            <div style="font-family: var(--font-sans); font-size: 1.1rem; font-weight: 800; color: #16A34A; margin-top: 4px;">ACTIVE (Per-UID + Subnet)</div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 2px;">Campus Wi-Fi Cross-Talk Shielded</div>
          </div>

          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem;">
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); font-weight: 700;">DETERMINISTIC AGGREGATION</div>
            <div style="font-family: var(--font-sans); font-size: 1.1rem; font-weight: 800; color: #16A34A; margin-top: 4px;">ENFORCED (SHA-256 5-Min)</div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 2px;">Multi-Instance Atomic Increment</div>
          </div>

          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem;">
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); font-weight: 700;">AUTOMATIC CIRCUIT BREAKER</div>
            <div style="font-family: var(--font-sans); font-size: 1.1rem; font-weight: 800; color: #16A34A; margin-top: 4px;">ARMED (FINANCIAL_FROZEN)</div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 2px;">Cross-checks Orders & Ledgers</div>
          </div>
        </div>

        <!-- Filter Buttons -->
        <div style="display: flex; gap: 8px; margin-bottom: 1rem; align-items: center;">
          <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary);">FILTER SEVERITY:</span>
          <button class="sev-filter-btn ${severityFilter === 'all' ? 'active' : ''}" data-sev="all" style="padding: 6px 12px; border-radius: 6px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">ALL</button>
          <button class="sev-filter-btn ${severityFilter === 'warn' ? 'active' : ''}" data-sev="warn" style="padding: 6px 12px; border-radius: 6px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">WARNINGS</button>
          <button class="sev-filter-btn ${severityFilter === 'critical' ? 'active' : ''}" data-sev="critical" style="padding: 6px 12px; border-radius: 6px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">CRITICAL</button>
        </div>

        <!-- Security Event Feed -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 1.2rem; box-shadow: 0 1px 4px rgba(0,0,0,0.03);">
          <div style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700; color: var(--ink-primary); margin-bottom: 1rem;">
            LIVE EVENT STREAM (${filteredEvents.length} events logged)
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

              return `
                <div style="background: ${bgColor}; border: 1px solid ${badgeColor}40; border-radius: 10px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; font-family: var(--font-mono); font-size: 0.85rem;">
                  <div>
                    <span style="background: ${badgeColor}; color: #FFF; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 0.75rem; margin-right: 8px;">
                      ${e.eventType || 'SECURITY_EVENT'}
                    </span>
                    ${e.incidentId ? `<span style="font-size: 0.75rem; color: var(--ink-secondary); font-weight: 700; margin-right: 8px;">[${e.incidentId}]</span>` : ''}
                    <strong style="color: var(--ink-primary);">${e.actorUid ? `Actor: ${e.actorUid.slice(0, 12)}...` : 'System Boundary'}</strong>
                    ${e.suppressedOccurrences > 1 ? `<span style="background: #E2E8F0; color: #334155; font-size: 0.7rem; font-weight: 700; padding: 1px 6px; border-radius: 999px; margin-left: 6px;">×${e.suppressedOccurrences}</span>` : ''}
                    ${e.details ? `<div style="font-size: 0.75rem; color: var(--ink-secondary); margin-top: 3px;">${JSON.stringify(e.details)}</div>` : ''}
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
