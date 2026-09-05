// Thakur Bites Platform 2.0 — Server-Authoritative Workstation Hardware Management
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

let activeInvites = [];
let registeredWorkstations = [];
let loading = false;
let feedbackMessage = null;

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

export function renderWorkstationView(container) {
  async function loadData() {
    loading = true;
    render();
    try {
      const functions = getFunctions();
      const listFn = httpsCallable(functions, 'listRegisteredWorkstations');
      const res = await listFn();
      registeredWorkstations = res.data?.workstations || [];
    } catch (err) {
      console.warn('Could not load workstations:', err);
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    container.innerHTML = `
      <div style="max-width: 1300px; margin: 0 auto; padding: 1.5rem 1rem;">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; color: var(--ink-primary);">
              WORKSTATION HARDWARE MANAGEMENT
            </h2>
            <p style="font-family: var(--font-sans); font-size: 0.9rem; color: var(--ink-secondary); margin-top: 4px;">
              Server-authoritative hardware enrollment for Kitchen KDS, Pickup Counter, and Cashier terminals.
            </p>
          </div>
          <button id="refresh-ws-btn" style="background: var(--bg-surface); border: 1.5px solid var(--border-light); padding: 8px 16px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;">
            🔄 Refresh Devices
          </button>
        </div>

        ${feedbackMessage ? `
          <div style="margin-bottom: 1.5rem; padding: 12px 16px; border-radius: 10px; font-family: var(--font-mono); font-size: 0.85rem; background: ${feedbackMessage.type === 'error' ? '#FEE2E2' : '#DCFCE7'}; color: ${feedbackMessage.type === 'error' ? '#DC2626' : '#166534'}; border: 1.5px solid ${feedbackMessage.type === 'error' ? '#FCA5A5' : '#86EFAC'};">
            ${escapeHtml(feedbackMessage.text)}
          </div>
        ` : ''}

        <!-- Generate Terminal Enrollment Invite Section -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 1.5rem; margin-bottom: 2rem; box-shadow: 0 1px 4px rgba(0,0,0,0.03);">
          <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0 0 0.5rem 0; color: var(--ink-primary);">
            🔑 ISSUE ONE-TIME TERMINAL ENROLLMENT CODE
          </h3>
          <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-bottom: 1.2rem;">
            Generate a 15-minute one-time code to authorize a new physical tablet or workstation without exposing permanent credentials.
          </p>

          <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;">
            <div style="flex: 1; min-width: 180px;">
              <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 4px;">
                STATION TYPE:
              </label>
              <select id="ws-type-select" style="width: 100%; padding: 10px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.85rem;">
                <option value="kitchen">🍳 Kitchen KDS</option>
                <option value="pickup">📦 Pickup Counter</option>
                <option value="cashier">💵 Cashier Workstation</option>
              </select>
            </div>

            <div style="flex: 2; min-width: 220px;">
              <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 4px;">
                TERMINAL / HARDWARE LABEL:
              </label>
              <input type="text" id="ws-name-input" placeholder="e.g. Kitchen Tablet Station 1" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.85rem; box-sizing: border-box;" />
            </div>

            <button id="generate-ws-code-btn" style="background: var(--brand-red); color: #FFF; border: none; padding: 11px 20px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;">
              Generate 15-Min Code →
            </button>
          </div>

          ${activeInvites.length > 0 ? `
            <div style="margin-top: 1.5rem; display: flex; flex-direction: column; gap: 8px;">
              <div style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary);">
                ACTIVE ENROLLMENT CODES:
              </div>
              ${activeInvites.map(inv => `
                <div style="background: #FEF3C7; border: 1.5px solid #FDE68A; border-radius: 8px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <div>
                    <span style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: #B45309; letter-spacing: 0.1em; background: #FFF; padding: 2px 8px; border-radius: 4px; border: 1px solid #F59E0B;">
                      ${inv.inviteCode}
                    </span>
                    <span style="font-family: var(--font-sans); font-size: 0.85rem; font-weight: 600; margin-left: 10px; color: var(--ink-primary);">
                      ${escapeHtml(inv.stationName)} (${inv.stationType.toUpperCase()})
                    </span>
                  </div>
                  <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #92400E;">
                    Expires at: ${new Date(inv.expiresAt).toLocaleTimeString()}
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>

        <!-- Registered Workstations List -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 1.5rem; box-shadow: 0 1px 4px rgba(0,0,0,0.03);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; color: var(--ink-primary);">
              🖥️ ENROLLED WORKSTATION TERMINALS (${registeredWorkstations.length})
            </h3>
          </div>

          ${registeredWorkstations.length === 0 ? `
            <div style="text-align: center; padding: 3rem 1rem; font-family: var(--font-mono); font-size: 0.9rem; color: var(--ink-secondary);">
              No hardware workstations registered yet. Use the invite generator above to enroll counter tablets.
            </div>
          ` : `
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 0.82rem; text-align: left;">
                <thead>
                  <tr style="background: var(--bg-surface); border-bottom: 2px solid var(--border-light);">
                    <th style="padding: 10px;">WORKSTATION ID</th>
                    <th style="padding: 10px;">ROLE</th>
                    <th style="padding: 10px;">LABEL / DEVICE</th>
                    <th style="padding: 10px;">STATUS</th>
                    <th style="padding: 10px;">LAST SEEN</th>
                    <th style="padding: 10px; text-align: right;">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  ${registeredWorkstations.map(ws => {
                    const isRevoked = ws.status === 'REVOKED';
                    return `
                      <tr style="border-bottom: 1px solid var(--border-light);">
                        <td style="padding: 12px 10px; font-weight: 700; color: var(--ink-primary);">
                          ${escapeHtml(ws.workstationId)}
                        </td>
                        <td style="padding: 12px 10px; text-transform: uppercase;">
                          <span style="background: #E2E8F0; color: #1E293B; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 700;">
                            ${escapeHtml(ws.stationType)}
                          </span>
                        </td>
                        <td style="padding: 12px 10px;">
                          <strong>${escapeHtml(ws.stationName || ws.deviceName)}</strong>
                        </td>
                        <td style="padding: 12px 10px;">
                          <span style="background: ${isRevoked ? '#FEE2E2' : '#DCFCE7'}; color: ${isRevoked ? '#DC2626' : '#166534'}; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 0.72rem;">
                            ${escapeHtml(ws.status)}
                          </span>
                        </td>
                        <td style="padding: 12px 10px; color: var(--ink-secondary);">
                          ${ws.lastSeenAt ? new Date(ws.lastSeenAt).toLocaleString() : 'Never'}
                        </td>
                        <td style="padding: 12px 10px; text-align: right;">
                          ${!isRevoked ? `
                            <button class="revoke-ws-btn" data-id="${ws.workstationId}" style="background: #FEE2E2; color: #DC2626; border: 1px solid #FCA5A5; padding: 4px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                              Revoke Access
                            </button>
                          ` : '<span style="color: #94A3B8;">Revoked</span>'}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

      </div>
    `;

    container.querySelector('#refresh-ws-btn')?.addEventListener('click', loadData);

    container.querySelector('#generate-ws-code-btn')?.addEventListener('click', async () => {
      const type = container.querySelector('#ws-type-select')?.value;
      const name = container.querySelector('#ws-name-input')?.value?.trim();

      if (!type || !name) {
        feedbackMessage = { type: 'error', text: 'Please provide both station type and hardware label.' };
        render();
        return;
      }

      try {
        const functions = getFunctions();
        const createInviteFn = httpsCallable(functions, 'createWorkstationInvite');
        const res = await createInviteFn({ stationType: type, stationName: name });
        activeInvites.push(res.data);
        feedbackMessage = { type: 'success', text: `One-time code ${res.data.inviteCode} generated for ${name} (valid for 15 mins).` };
        render();
      } catch (err) {
        feedbackMessage = { type: 'error', text: err.message || 'Failed to generate enrollment code.' };
        render();
      }
    });

    container.querySelectorAll('.revoke-ws-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const wsId = btn.getAttribute('data-id');
        if (!confirm(`Are you sure you want to revoke access for ${wsId}? Terminal will be immediately barred from login.`)) {
          return;
        }

        try {
          const functions = getFunctions();
          const revokeFn = httpsCallable(functions, 'revokeWorkstation');
          await revokeFn({ workstationId: wsId, reason: 'Manual administrative revocation' });
          feedbackMessage = { type: 'success', text: `Workstation ${wsId} revoked successfully.` };
          await loadData();
        } catch (err) {
          feedbackMessage = { type: 'error', text: err.message || 'Failed to revoke workstation.' };
          render();
        }
      });
    });
  }

  loadData();
}
