// Staff Firebase Authentication & Role-Based Access Control (RBAC)
import { staffLogin, staffQuickAuth, staffLogout, subscribeStaffAuth } from './firebase.js?v=4';

let currentStaffState = {
  user: null,
  role: sessionStorage.getItem('tb_staff_role') || null,
  isAuthenticated: sessionStorage.getItem('tb_staff_auth') === 'true'
};

// Listen to Firebase Auth state
subscribeStaffAuth((state) => {
  if (state.isAuthenticated) {
    currentStaffState = state;
    sessionStorage.setItem('tb_staff_auth', 'true');
    sessionStorage.setItem('tb_staff_role', state.role || 'manager');
  }
});

export const staffAuth = {
  isAuthenticated() {
    return currentStaffState.isAuthenticated || sessionStorage.getItem('tb_staff_auth') === 'true';
  },

  getRole() {
    return currentStaffState.role || sessionStorage.getItem('tb_staff_role') || 'manager';
  },

  async login(email, password) {
    try {
      const { user, role } = await staffLogin(email, password);
      currentStaffState = { user, role, isAuthenticated: true };
      sessionStorage.setItem('tb_staff_auth', 'true');
      sessionStorage.setItem('tb_staff_role', role);
      return { success: true, role };
    } catch (e) {
      console.error("Staff auth error:", e);
      return { success: false, error: e.message };
    }
  },

  async quickAuth(role = 'manager') {
    try {
      const { user } = await staffQuickAuth(role);
      currentStaffState = { user, role, isAuthenticated: true };
      sessionStorage.setItem('tb_staff_auth', 'true');
      sessionStorage.setItem('tb_staff_role', role);
      return { success: true, role };
    } catch (e) {
      console.error("Quick auth error:", e);
      return { success: false, error: e.message };
    }
  },

  async refreshToken() {
    if (currentStaffState.user) {
      try {
        const tokenResult = await currentStaffState.user.getIdTokenResult(true);
        const role = tokenResult.claims.role || currentStaffState.role || 'manager';
        currentStaffState.role = role;
        sessionStorage.setItem('tb_staff_role', role);
        return role;
      } catch (e) {
        console.warn("Token refresh warning:", e);
      }
    }
    return currentStaffState.role;
  },

  async logout() {
    await staffLogout();
    currentStaffState = { user: null, role: null, isAuthenticated: false };
    sessionStorage.removeItem('tb_staff_auth');
    sessionStorage.removeItem('tb_staff_role');
  }
};

/**
 * Renders the Staff Identity & Credentials modal.
 * @param {HTMLElement} container - DOM container to render into
 * @param {Function} onUnlocked - Callback triggered upon successful authentication
 */
export function renderPinPadModal(container, onUnlocked) {
  container.innerHTML = `
    <div class="pin-modal-overlay">
      <div class="pin-modal-card" style="max-width: 440px; text-align: left;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <div class="pin-badge" style="margin: 0;">STAFF RBAC IDENTITY</div>
          <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #16A34A; font-weight: 700;">● SECURE PORTAL</span>
        </div>

        <h2 style="font-family: var(--font-display); font-size: 2rem; margin: 0.4rem 0 0.2rem 0; letter-spacing: 0.05em; color: var(--ink-primary);">
          CANTEEN STAFF ACCESS
        </h2>
        <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-bottom: 1.5rem;">
          Sign in with authorized staff credentials or select your assigned workstation.
        </p>

        <!-- Station Role Quick Select -->
        <div style="margin-bottom: 1.2rem;">
          <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 6px;">
            SELECT WORKSTATION / ROLE:
          </label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <button class="role-quick-btn" data-role="kitchen" style="padding: 10px; border-radius: 8px; border: 1.5px solid var(--border-light); background: #FFF; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
              🍳 Kitchen KDS
            </button>
            <button class="role-quick-btn" data-role="pickup" style="padding: 10px; border-radius: 8px; border: 1.5px solid var(--border-light); background: #FFF; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
              📦 Pickup Counter
            </button>
            <button class="role-quick-btn" data-role="manager" style="padding: 10px; border-radius: 8px; border: 1.5px solid var(--border-light); background: #FFF; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
              📋 Menu & Stock
            </button>
            <button class="role-quick-btn" data-role="admin" style="padding: 10px; border-radius: 8px; border: 1.5px solid var(--border-light); background: #FFF; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 6px;">
              🛡️ Canteen Admin
            </button>
          </div>
        </div>

        <div style="display: flex; align-items: center; margin: 1.2rem 0; gap: 10px;">
          <div style="flex: 1; height: 1px; background: var(--border-light);"></div>
          <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">OR EMAIL LOGIN</span>
          <div style="flex: 1; height: 1px; background: var(--border-light);"></div>
        </div>

        <!-- Staff Email / Password Form -->
        <form id="staff-login-form">
          <div style="margin-bottom: 10px;">
            <input 
              type="email" 
              id="staff-email" 
              placeholder="moreaboutastram@gmail.com" 
              value="moreaboutastram@gmail.com"
              style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.9rem; box-sizing: border-box;"
            />
          </div>
          <div style="margin-bottom: 14px;">
            <input 
              type="password" 
              id="staff-password" 
              placeholder="••••••••" 
              value="mAc@080147"
              style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.9rem; box-sizing: border-box;"
            />
          </div>

          <div id="staff-auth-error" style="display: none; color: var(--brand-red); font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; margin-bottom: 10px;"></div>

          <button 
            type="submit" 
            style="width: 100%; padding: 12px; border-radius: 10px; background: var(--brand-red); color: #FFF; border: none; font-family: var(--font-sans); font-size: 0.95rem; font-weight: 700; cursor: pointer;"
          >
            Authenticate Staff Session →
          </button>
        </form>
      </div>
    </div>
  `;

  // Attach quick station select listeners
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

  // Attach form submit listener
  const form = container.querySelector('#staff-login-form');
  const errorEl = container.querySelector('#staff-auth-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.querySelector('#staff-email').value;
    const password = form.querySelector('#staff-password').value;

    if (!email || !password) {
      errorEl.textContent = 'Please enter both staff email and password.';
      errorEl.style.display = 'block';
      return;
    }

    const res = await staffAuth.login(email, password);
    if (res.success) {
      onUnlocked();
    } else {
      errorEl.textContent = res.error || 'Authentication failed. Verify credentials.';
      errorEl.style.display = 'block';
    }
  });
}
