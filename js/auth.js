// Staff Firebase Authentication & Role-Based Access Control (RBAC) with Shift PINs & Device Binding
import { auth, staffLogin, staffQuickAuth, staffLogout, subscribeStaffAuth } from './firebase.js?v=4';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { signInWithCustomToken } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

let currentStaffState = {
  user: null,
  role: null,
  isAuthenticated: false,
  deviceId: getOrCreateDeviceId(),
};

export function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem('tb_workstation_device_id');
  if (!deviceId) {
    deviceId = 'tb_ws_' + Math.random().toString(16).substring(2, 10) + Math.random().toString(16).substring(2, 6);
    localStorage.setItem('tb_workstation_device_id', deviceId);
  }
  return deviceId;
}

// Listen to Firebase Auth state
subscribeStaffAuth((state) => {
  if (state.isAuthenticated && auth.currentUser) {
    currentStaffState = { ...state, deviceId: getOrCreateDeviceId() };
  } else {
    currentStaffState = { user: null, role: null, isAuthenticated: false, deviceId: getOrCreateDeviceId() };
  }
});

export const staffAuth = {
  isAuthenticated() {
    return !!(auth.currentUser && currentStaffState.isAuthenticated);
  },

  getRole() {
    return currentStaffState.role || 'staff';
  },

  async login(email, password) {
    try {
      const { user, role } = await staffLogin(email, password);
      currentStaffState = { user, role, isAuthenticated: true, deviceId: getOrCreateDeviceId() };
      return { success: true, role };
    } catch (e) {
      console.error("Staff auth error:", e);
      return { success: false, error: e.message };
    }
  },

  async loginWithShiftPin(pin, role) {
    try {
      const functions = getFunctions();
      const verifyFn = httpsCallable(functions, 'verifyShiftPin');
      const deviceId = getOrCreateDeviceId();

      const res = await verifyFn({
        pin,
        role,
        deviceId,
        deviceName: navigator.userAgent.includes('Mobile') ? 'Counter Tablet' : 'Staff Workstation',
      });

      if (res.data?.token) {
        const userCred = await signInWithCustomToken(auth, res.data.token);
        const assignedRole = res.data.role || role;
        currentStaffState = { user: userCred.user, role: assignedRole, isAuthenticated: true, deviceId };
        return { success: true, role: assignedRole };
      }
      return { success: false, error: 'Failed to verify shift credentials.' };
    } catch (e) {
      console.error("Shift PIN auth error:", e);
      return { success: false, error: e.message || 'Incorrect shift PIN or max devices reached.' };
    }
  },

  async quickAuth() {
    throw new Error('Quick authorization disabled in production.');
  },

  async refreshToken() {
    if (currentStaffState.user) {
      try {
        const tokenResult = await currentStaffState.user.getIdTokenResult(true);
        const role = tokenResult.claims.role || currentStaffState.role || 'staff';
        currentStaffState.role = role;
        return role;
      } catch (e) {
        console.warn("Token refresh warning:", e);
      }
    }
    return currentStaffState.role;
  },

  async logout() {
    await staffLogout();
    currentStaffState = { user: null, role: null, isAuthenticated: false, deviceId: getOrCreateDeviceId() };
  }
};

/**
 * Renders the Staff Identity & Credentials modal with Shift PIN Keypad.
 */
export function renderPinPadModal(container, onUnlocked) {
  let activeTab = 'pin'; // 'pin' | 'email'
  let selectedPinRole = 'kitchen';
  let enteredPin = '';

  function render() {
    const deviceId = getOrCreateDeviceId();

    container.innerHTML = `
      <div class="pin-modal-overlay">
        <div class="pin-modal-card" style="max-width: 460px; text-align: left;">
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
          </div>

          <div id="auth-error-box" style="display: none; color: var(--brand-red); font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; margin-bottom: 12px; padding: 8px; background: #FEE2E2; border-radius: 8px; border: 1px solid #FCA5A5;"></div>

          ${activeTab === 'pin' ? `
            <!-- Shift PIN Keypad Form -->
            <div>
              <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 6px;">
                SELECT ROLE:
              </label>
              <div style="display: flex; gap: 6px; margin-bottom: 12px;">
                ${['kitchen', 'pickup', 'cashier'].map(r => `
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
          ` : `
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
          `}
        </div>
      </div>
    `;

    // Tab switching
    container.querySelector('#tab-pin')?.addEventListener('click', () => { activeTab = 'pin'; render(); });
    container.querySelector('#tab-email')?.addEventListener('click', () => { activeTab = 'email'; render(); });

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

    // Quick station select
    container.querySelectorAll('.role-quick-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const role = btn.getAttribute('data-role');
        btn.textContent = 'Verifying...';
        const res = await staffAuth.quickAuth(role);
        if (res.success) {
          onUnlocked();
        }
      });
    });

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
