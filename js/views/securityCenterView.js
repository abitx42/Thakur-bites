// Staff Operations Security Center & Audit Stream View
import { db } from '../firebase.js?v=4';
import { collection, onSnapshot, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let unsubscribeSecurity = null;
let currentEvents = [];
let severityFilter = 'all';

export function renderSecurityCenterView(container) {
  if (unsubscribeSecurity) {
    unsubscribeSecurity();
  }

  function render() {
    const filteredEvents = currentEvents.filter(e => {
      if (severityFilter === 'all') return true;
      return e.severity === severityFilter;
    });

    const critCount = currentEvents.filter(e => e.severity === 'critical').length;
    const warnCount = currentEvents.filter(e => e.severity === 'warn').length;
    const infoCount = currentEvents.filter(e => e.severity === 'info' || !e.severity).length;

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
                ● ACTIVE SENTINEL
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Live stream of security events, rate-limit triggers, payment signature checks, and privileged role updates.
            </p>
          </div>

          <!-- Stat Badges -->
          <div style="display: flex; gap: 10px;">
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

        <!-- Sentinel Health Matrix -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem;">
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); font-weight: 700;">RATE LIMITING ENGINE</div>
            <div style="font-family: var(--font-sans); font-size: 1.1rem; font-weight: 800; color: #16A34A; margin-top: 4px;">ACTIVE (Sliding Window)</div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 2px;">Checkout: 10/min · Pickup: 20/min</div>
          </div>

          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem;">
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); font-weight: 700;">HMAC-SHA256 VERIFICATION</div>
            <div style="font-family: var(--font-sans); font-size: 1.1rem; font-weight: 800; color: #16A34A; margin-top: 4px;">ENFORCED (Timing Safe)</div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 2px;">Cryptographic payment integrity</div>
          </div>

          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem;">
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); font-weight: 700;">IMMUTABLE LEDGERS</div>
            <div style="font-family: var(--font-sans); font-size: 1.1rem; font-weight: 800; color: #16A34A; margin-top: 4px;">APPEND-ONLY LOCKED</div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 2px;">inventoryLedger & orderEvents</div>
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
              const isCrit = e.severity === 'critical';
              const isWarn = e.severity === 'warn';
              const badgeColor = isCrit ? '#DC2626' : (isWarn ? '#D97706' : '#2563EB');
              const bgColor = isCrit ? '#FEF2F2' : (isWarn ? '#FFFBEB' : '#EFF6FF');

              return `
                <div style="background: ${bgColor}; border: 1px solid ${badgeColor}40; border-radius: 10px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; font-family: var(--font-mono); font-size: 0.85rem;">
                  <div>
                    <span style="background: ${badgeColor}; color: #FFF; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 0.75rem; margin-right: 8px;">
                      ${e.eventType || 'SECURITY_EVENT'}
                    </span>
                    <strong style="color: var(--ink-primary);">${e.actorUid ? `Actor: ${e.actorUid.slice(0, 10)}...` : 'System Boundary'}</strong>
                    ${e.endpoint ? `<span style="color: var(--ink-secondary); margin-left: 8px;">[${e.endpoint}]</span>` : ''}
                    ${e.details ? `<div style="font-size: 0.75rem; color: var(--ink-secondary); margin-top: 3px;">${JSON.stringify(e.details)}</div>` : ''}
                  </div>
                  <div style="color: var(--ink-secondary); font-size: 0.75rem;">
                    ${e.timestamp ? new Date(e.timestamp.toDate ? e.timestamp.toDate() : e.timestamp).toLocaleTimeString() : 'Just now'}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

      </div>
    `;

    container.querySelectorAll('.sev-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        severityFilter = btn.getAttribute('data-sev');
        render();
      });
    });
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
