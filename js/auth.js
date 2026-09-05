// Staff Firebase Authentication & Role-Based Access Control (RBAC) with Shift PINs & Device Binding
import { auth, staffLogin, staffLogout, subscribeStaffAuth } from './firebase.js?v=4';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { signInWithCustomToken } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// Clear any stale demo localStorage keys
try {
  localStorage.removeItem('tb_staff_authenticated');
  localStorage.removeItem('tb_staff_role');
  localStorage.removeItem('tb_staff_email');
} catch (_) {}

export function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem('tb_workstation_device_id');
  if (!deviceId) {
    deviceId = 'tb_ws_' + Math.random().toString(16).substring(2, 10) + Math.random().toString(16).substring(2, 6);
    localStorage.setItem('tb_workstation_device_id', deviceId);
  }
  return deviceId;
}

export function getRegisteredWorkstation() {
  const id = localStorage.getItem('tb_registered_workstation_id');
  const token = localStorage.getItem('tb_registered_workstation_token');
  const role = localStorage.getItem('tb_registered_workstation_role');
  const name = localStorage.getItem('tb_registered_workstation_name');
  if (id && token) {
    return { id, token, role, name };
  }
  return null;
}

export function saveRegisteredWorkstation(id, token, role, name) {
  localStorage.setItem('tb_registered_workstation_id', id);
  localStorage.setItem('tb_registered_workstation_token', token);
  if (role) localStorage.setItem('tb_registered_workstation_role', role);
  if (name) localStorage.setItem('tb_registered_workstation_name', name);
}

export function clearRegisteredWorkstation() {
  localStorage.removeItem('tb_registered_workstation_id');
  localStorage.removeItem('tb_registered_workstation_token');
  localStorage.removeItem('tb_registered_workstation_role');
  localStorage.removeItem('tb_registered_workstation_name');
}

export function getPrivilegedSession() {
  const sessStr = localStorage.getItem('tb_privileged_session');
  if (!sessStr) return null;
  try {
    const sess = JSON.parse(sessStr);
    const now = Date.now();
    if (new Date(sess.expiresAt).getTime() < now) {
      localStorage.removeItem('tb_privileged_session');
      return null;
    }
    return sess;
  } catch (_) {
    return null;
  }
}

export function savePrivilegedSession(sessionData) {
  localStorage.setItem('tb_privileged_session', JSON.stringify(sessionData));
}

export function clearPrivilegedSession() {
  localStorage.removeItem('tb_privileged_session');
}

let currentStaffState = {
  user: null,
  role: null,
  isAuthenticated: false,
  deviceId: getOrCreateDeviceId(),
};

// Listen to authoritative Firebase Auth state
subscribeStaffAuth((state) => {
  if (state.isAuthenticated && auth.currentUser) {
    currentStaffState = { ...state, deviceId: getOrCreateDeviceId() };
  } else {
    currentStaffState = {
      user: null,
      role: null,
      isAuthenticated: false,
      deviceId: getOrCreateDeviceId(),
    };
  }
});

export const staffAuth = {
  isAuthenticated() {
    return Boolean(currentStaffState.isAuthenticated && currentStaffState.role && auth.currentUser);
  },

  getRole() {
    return currentStaffState.role || null;
  },

  async login(email, password) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    const cleanPass = String(password || '');

    if (!cleanEmail || !cleanPass) {
      return { success: false, error: 'Please provide both staff email and password.' };
    }

    try {
      const { user, role } = await staffLogin(cleanEmail, cleanPass);
      currentStaffState = { user, role, isAuthenticated: true, deviceId: getOrCreateDeviceId() };
      return { success: true, role };
    } catch (e) {
      console.error("Staff auth error:", e);
      return { success: false, error: e.message || 'Authentication failed. Please verify credentials.' };
    }
  },

  async loginWithShiftPin(pin, role) {
    const registeredWs = getRegisteredWorkstation();
    const deviceId = registeredWs ? registeredWs.id : getOrCreateDeviceId();
    const workstationToken = registeredWs ? registeredWs.token : undefined;
    const requestedRole = role || (registeredWs?.role || 'kitchen');

    if (!pin || typeof pin !== 'string' || pin.trim().length !== 6) {
      return { success: false, error: 'A valid 6-digit shift PIN is required.' };
    }

    try {
      const functions = getFunctions();
      const verifyFn = httpsCallable(functions, 'verifyShiftPin');

      const res = await verifyFn({
        pin: pin.trim(),
        role: requestedRole,
        deviceId,
        workstationToken,
        deviceName: registeredWs ? registeredWs.name : (navigator.userAgent.includes('Mobile') ? 'Counter Tablet' : 'Staff Workstation'),
      });

      if (res.data?.token) {
        const userCred = await signInWithCustomToken(auth, res.data.token);
        const serverRole = res.data.role || requestedRole;
        currentStaffState = { user: userCred.user, role: serverRole, isAuthenticated: true, deviceId };
        return { success: true, role: serverRole };
      }
      return { success: false, error: 'Failed to verify shift credentials.' };
    } catch (e) {
      console.error("Shift PIN auth error:", e);
      return { success: false, error: e.message || 'Incorrect shift PIN or workstation authorization failed.' };
    }
  },

  async authenticatePrivilegedSession(totpCode, recoveryCode) {
    try {
      const functions = getFunctions();
      const createSessionFn = httpsCallable(functions, 'createPrivilegedSession');
      const res = await createSessionFn({ totpCode, recoveryCode });
      if (res.data?.sessionId) {
        savePrivilegedSession(res.data);
        return { success: true, session: res.data };
      }
      return { success: false, error: 'Failed to establish privileged session.' };
    } catch (err) {
      return { success: false, error: err.message || 'MFA TOTP verification failed.' };
    }
  },

  async quickAuth() {
    throw new Error('Quick authorization disabled in production.');
  },

  async logout() {
    try {
      localStorage.removeItem('tb_staff_authenticated');
      localStorage.removeItem('tb_staff_role');
      localStorage.removeItem('tb_staff_email');
    } catch (_) {}
    await staffLogout().catch(() => {});
    currentStaffState = { user: null, role: null, isAuthenticated: false, deviceId: getOrCreateDeviceId() };
  },

  async refreshToken() {
    if (currentStaffState.user) {
      try {
        const tokenResult = await currentStaffState.user.getIdTokenResult?.(true);
        const role = tokenResult?.claims?.role || currentStaffState.role || 'staff';
        currentStaffState.role = role;
        return role;
      } catch (e) {
        console.warn("Token refresh warning:", e);
      }
    }
    return currentStaffState.role;
  }
};

/**
 * Enroll physical workstation hardware using a one-time admin invite code.
 */
export async function enrollWorkstationClient(inviteCode, label = 'Terminal', stationRole = 'kitchen') {
  try {
    const functions = getFunctions();
    const fn = httpsCallable(functions, 'enrollWorkstation');
    const res = await fn({ inviteCode: inviteCode.trim().toUpperCase(), label: label.trim(), stationRole });
    if (res.data?.success) {
      saveRegisteredWorkstation(res.data.workstationId, res.data.workstationToken, res.data.workstationRole, res.data.label);
      return { success: true, data: res.data };
    }
    return { success: false, error: 'Registration failed.' };
  } catch (err) {
    return { success: false, error: err.message || 'Workstation enrollment failed.' };
  }
}

/**
 * Renders the Staff Identity & Credentials modal with Shift PIN Keypad.
 */
export function renderPinPadModal(container, onUnlocked) {
  let activeTab = 'pin'; // 'pin' | 'email' | 'enroll'
  let selectedPinRole = 'kitchen';
  let enteredPin = '';

  function render() {
    const deviceId = getOrCreateDeviceId();
    const regWs = getRegisteredWorkstation();

    container.innerHTML = `
      <div class="pin-modal-overlay">
        <div class="pin-modal-card" style="max-width: 480px; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <div class="pin-badge" style="margin: 0;">STAFF WORKSTATION RBAC</div>
            <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #16A34A; font-weight: 700;">● SECURE PORTAL</span>
          </div>

          <h2 style="font-family: var(--font-display); font-size: 2rem; margin: 0.4rem 0 0.2rem 0; letter-spacing: 0.05em; color: var(--ink-primary);">
            CANTEEN STAFF ACCESS
          </h2>
          <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-bottom: 1rem;">
            Workstation Device ID: <code style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--brand-red); background: var(--bg-surface); padding: 2px 6px; border-radius: 4px;">${deviceId}</code>
          </p>

          <!-- Auth Mode Tabs -->
          <div style="display: flex; gap: 6px; margin-bottom: 1.2rem; background: var(--bg-surface); padding: 4px; border-radius: 10px; border: 1.5px solid var(--border-light);">
            <button id="tab-pin" style="flex: 1; padding: 8px; border-radius: 8px; border: none; font-family: var(--font-sans); font-size: 0.8rem; font-weight: 700; cursor: pointer; background: ${activeTab === 'pin' ? '#FFF' : 'transparent'}; color: ${activeTab === 'pin' ? 'var(--brand-red)' : 'var(--ink-secondary)'}; box-shadow: ${activeTab === 'pin' ? '0 1px 4px rgba(0,0,0,0.06)' : 'none'};">
              🔑 Shift PIN
            </button>
            <button id="tab-email" style="flex: 1; padding: 8px; border-radius: 8px; border: none; font-family: var(--font-sans); font-size: 0.8rem; font-weight: 700; cursor: pointer; background: ${activeTab === 'email' ? '#FFF' : 'transparent'}; color: ${activeTab === 'email' ? 'var(--brand-red)' : 'var(--ink-secondary)'}; box-shadow: ${activeTab === 'email' ? '0 1px 4px rgba(0,0,0,0.06)' : 'none'};">
              ✉️ Email & Password
            </button>
            <button id="tab-enroll" style="flex: 1; padding: 8px; border-radius: 8px; border: none; font-family: var(--font-sans); font-size: 0.8rem; font-weight: 700; cursor: pointer; background: ${activeTab === 'enroll' ? '#FFF' : 'transparent'}; color: ${activeTab === 'enroll' ? 'var(--brand-red)' : 'var(--ink-secondary)'}; box-shadow: ${activeTab === 'enroll' ? '0 1px 4px rgba(0,0,0,0.06)' : 'none'};">
              🖥️ ${regWs ? 'Terminal OK' : 'Enroll Terminal'}
            </button>
          </div>

          <div id="auth-error-box" style="display: none; color: var(--brand-red); font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; margin-bottom: 12px; padding: 8px; background: #FEE2E2; border-radius: 8px; border: 1px solid #FCA5A5;"></div>
          <div id="auth-success-box" style="display: none; color: #166534; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; margin-bottom: 12px; padding: 8px; background: #DCFCE7; border-radius: 8px; border: 1px solid #86EFAC;"></div>

          ${activeTab === 'pin' ? `
            <!-- Shift PIN Keypad Form -->
            <div>
              ${regWs ? `
                <div style="background: #F0FDF4; border: 1px solid #BBF7D0; padding: 6px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem; color: #15803D; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                  <span>🖥️ Bound: <strong>${regWs.name || regWs.id}</strong> (${regWs.role || 'kitchen'})</span>
                  <span style="color: #16A34A; font-weight: 700;">ACTIVE</span>
                </div>
              ` : `
                <div style="background: #FFFBEB; border: 1px solid #FDE68A; padding: 6px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem; color: #B45309; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                  <span>⚠️ Unregistered terminal hardware.</span>
                  <a href="#" id="link-enroll-shortcut" style="color: var(--brand-red); font-weight: 700; text-decoration: underline;">Enroll Now</a>
                </div>
              `}

              <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 6px;">
                SELECT ROLE:
              </label>
              <div style="display: flex; gap: 6px; margin-bottom: 12px;">
                ${['kitchen', 'pickup', 'cashier', 'admin'].map(r => `
                  <button class="shift-role-btn" data-role="${r}" style="flex: 1; padding: 8px; border-radius: 8px; border: 1.5px solid ${selectedPinRole === r ? 'var(--brand-red)' : 'var(--border-light)'}; background: ${selectedPinRole === r ? '#FEE2E2' : '#FFF'}; color: ${selectedPinRole === r ? 'var(--brand-red)' : 'var(--ink-primary)'}; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; text-transform: uppercase;">
                    ${r}
                  </button>
                `).join('')}
              </div>

              <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 6px;">
                ENTER 6-DIGIT SHIFT PIN:
              </label>
              <input 
                type="password" 
                id="shift-pin-input" 
                maxlength="6"
                placeholder="••••••" 
                value="${enteredPin}"
                style="width: 100%; padding: 12px; border-radius: 10px; border: 2px solid var(--border-light); font-family: var(--font-mono); font-size: 1.6rem; letter-spacing: 0.3em; text-align: center; box-sizing: border-box; margin-bottom: 14px;"
              />

              <button 
                id="submit-shift-pin-btn"
                style="width: 100%; padding: 12px; border-radius: 10px; background: var(--brand-red); color: #FFF; border: none; font-family: var(--font-sans); font-size: 0.95rem; font-weight: 700; cursor: pointer;"
              >
                Unlock Workstation Session →
              </button>
            </div>
          ` : activeTab === 'email' ? `
            <!-- Staff Email / Password Form -->
            <form id="staff-login-form">
              <div style="margin-bottom: 10px;">
                <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 4px;">
                  STAFF EMAIL:
                </label>
                <input 
                  type="email" 
                  id="staff-email" 
                  placeholder="staff@tcetmumbai.in" 
                  required
                  style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.9rem; box-sizing: border-box;"
                />
              </div>
              <div style="margin-bottom: 14px;">
                <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 4px;">
                  PASSWORD:
                </label>
                <input 
                  type="password" 
                  id="staff-password" 
                  placeholder="••••••••" 
                  required
                  style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.9rem; box-sizing: border-box;"
                />
              </div>
              <button 
                type="submit" 
                style="width: 100%; padding: 12px; border-radius: 10px; background: var(--brand-red); color: #FFF; border: none; font-family: var(--font-sans); font-size: 0.95rem; font-weight: 700; cursor: pointer;"
              >
                Authenticate Staff Session →
              </button>
            </form>
          ` : `
            <!-- Workstation Enrollment Form -->
            <div>
              ${regWs ? `
                <div style="background: #F8FAFC; border: 1.5px solid var(--border-light); border-radius: 10px; padding: 1rem; margin-bottom: 1rem;">
                  <div style="font-family: var(--font-mono); font-size: 0.8rem; color: #16A34A; font-weight: 700; margin-bottom: 6px;">
                    ✅ TERMINAL CURRENTLY ENROLLED
                  </div>
                  <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); line-height: 1.6;">
                    <div>ID: <code style="color: var(--ink-primary);">${regWs.id}</code></div>
                    <div>Label: <strong>${regWs.name || 'Terminal'}</strong></div>
                    <div>Role: <strong>${regWs.role || 'all'}</strong></div>
                  </div>
                  <button id="unlink-workstation-btn" style="margin-top: 10px; background: #FEE2E2; color: #DC2626; border: 1px solid #FCA5A5; padding: 6px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                    Unlink This Terminal Hardware
                  </button>
                </div>
              ` : `
                <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-bottom: 1rem;">
                  Enter the 8-character one-time enrollment code generated by the store manager to bind this device.
                </p>
                <div style="margin-bottom: 10px;">
                  <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 4px;">
                    ONE-TIME INVITE CODE:
                  </label>
                  <input 
                    type="text" 
                    id="enroll-invite-code" 
                    placeholder="WS-XXXXXX" 
                    maxlength="10"
                    style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 1.1rem; text-transform: uppercase; letter-spacing: 0.1em; box-sizing: border-box;"
                  />
                </div>
                <div style="margin-bottom: 10px;">
                  <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 4px;">
                    TERMINAL LABEL:
                  </label>
                  <input 
                    type="text" 
                    id="enroll-terminal-label" 
                    placeholder="Kitchen Counter Tablet #1" 
                    style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.9rem; box-sizing: border-box;"
                  />
                </div>
                <button 
                  id="submit-enroll-btn" 
                  style="width: 100%; padding: 12px; border-radius: 10px; background: #0F172A; color: #FFF; border: none; font-family: var(--font-sans); font-size: 0.95rem; font-weight: 700; cursor: pointer; margin-top: 6px;"
                >
                  Authorize & Bind Terminal →
                </button>
              `}
            </div>
          `}
        </div>
      </div>
    `;

    // Tab switching
    container.querySelector('#tab-pin')?.addEventListener('click', () => { activeTab = 'pin'; render(); });
    container.querySelector('#tab-email')?.addEventListener('click', () => { activeTab = 'email'; render(); });
    container.querySelector('#tab-enroll')?.addEventListener('click', () => { activeTab = 'enroll'; render(); });
    container.querySelector('#link-enroll-shortcut')?.addEventListener('click', (e) => {
      e.preventDefault();
      activeTab = 'enroll';
      render();
    });

    // Unlink button
    container.querySelector('#unlink-workstation-btn')?.addEventListener('click', () => {
      clearRegisteredWorkstation();
      render();
    });

    // Submit enroll button
    const submitEnrollBtn = container.querySelector('#submit-enroll-btn');
    if (submitEnrollBtn) {
      submitEnrollBtn.addEventListener('click', async () => {
        const inviteCode = container.querySelector('#enroll-invite-code')?.value.trim();
        const label = container.querySelector('#enroll-terminal-label')?.value.trim() || 'Workstation Terminal';
        const errBox = container.querySelector('#auth-error-box');

        if (!inviteCode) {
          errBox.textContent = 'Please enter an 8-character invite code.';
          errBox.style.display = 'block';
          return;
        }

        submitEnrollBtn.disabled = true;
        submitEnrollBtn.textContent = 'Enrolling Hardware...';

        const res = await enrollWorkstationClient(inviteCode, label, selectedPinRole);
        if (res.success) {
          activeTab = 'pin';
          render();
        } else {
          submitEnrollBtn.disabled = false;
          submitEnrollBtn.textContent = 'Authorize & Bind Terminal →';
          errBox.textContent = res.error || 'Enrollment failed.';
          errBox.style.display = 'block';
        }
      });
    }

    // Shift PIN role select
    container.querySelectorAll('.shift-role-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedPinRole = btn.getAttribute('data-role');
        render();
      });
    });

    // Shift PIN submit
    const shiftSubmitBtn = container.querySelector('#submit-shift-pin-btn');
    const shiftPinInput = container.querySelector('#shift-pin-input');
    const errorBox = container.querySelector('#auth-error-box');

    if (shiftSubmitBtn && shiftPinInput) {
      shiftSubmitBtn.addEventListener('click', async () => {
        const pin = shiftPinInput.value.trim();
        if (pin.length !== 6) {
          errorBox.textContent = 'Please enter a 6-digit shift PIN.';
          errorBox.style.display = 'block';
          return;
        }

        shiftSubmitBtn.disabled = true;
        shiftSubmitBtn.textContent = 'Verifying Shift PIN...';
        const res = await staffAuth.loginWithShiftPin(pin, selectedPinRole);
        if (res.success) {
          onUnlocked();
        } else {
          shiftSubmitBtn.disabled = false;
          shiftSubmitBtn.textContent = 'Unlock Workstation Session →';
          errorBox.textContent = res.error || 'Authentication failed.';
          errorBox.style.display = 'block';
        }
      });
    }

    // Email login submit
    const form = container.querySelector('#staff-login-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = form.querySelector('#staff-email').value;
        const password = form.querySelector('#staff-password').value;

        if (!email || !password) {
          errorBox.textContent = 'Please enter both staff email and password.';
          errorBox.style.display = 'block';
          return;
        }

        const res = await staffAuth.login(email, password);
        if (res.success) {
          onUnlocked();
        } else {
          errorBox.textContent = res.error || 'Authentication failed. Verify credentials.';
          errorBox.style.display = 'block';
        }
      });
    }
  }

  render();
}
