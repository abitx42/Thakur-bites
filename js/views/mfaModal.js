// Thakur Bites Platform 2.0 — Free-First RFC 6238 TOTP Authenticator MFA Modals
import { staffAuth, savePrivilegedSession } from '../auth.js?v=8';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

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

/**
 * Modal prompting for Authenticator TOTP Code to establish a 6-Hour Privileged Session.
 */
export function renderPrivilegedAuthModal(container, { onSuccess, onCancel }) {
  let isRecoveryMode = false;
  let enteredCode = '';
  let errorMessage = null;
  let authenticating = false;

  function render() {
    container.innerHTML = `
      <div class="pin-modal-overlay">
        <div class="pin-modal-card" style="max-width: 440px; text-align: left; background: #FFF;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #DC2626; font-weight: 800; background: #FEE2E2; padding: 2px 8px; border-radius: 4px;">
              MANDATORY MFA · 6-HR PRIVILEGE
            </span>
            <button id="close-mfa-modal-btn" style="background: transparent; border: none; font-size: 1.2rem; cursor: pointer; color: var(--ink-secondary);">✕</button>
          </div>

          <h2 style="font-family: var(--font-display); font-size: 2rem; margin: 0.4rem 0 0.2rem 0; color: var(--ink-primary);">
            ${isRecoveryMode ? 'EMERGENCY RECOVERY CODE' : 'AUTHENTICATOR MFA'}
          </h2>
          <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-bottom: 1.2rem;">
            ${isRecoveryMode 
              ? 'Enter one of your 8-character single-use emergency backup recovery codes.' 
              : 'Enter the 6-digit verification code from Google Authenticator, Microsoft Authenticator, or Aegis.'}
          </p>

          ${errorMessage ? `
            <div style="margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; background: #FEE2E2; color: #DC2626; border: 1px solid #FCA5A5;">
              ${escapeHtml(errorMessage)}
            </div>
          ` : ''}

          <div style="margin-bottom: 1.2rem;">
            <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 6px;">
              ${isRecoveryMode ? 'BACKUP RECOVERY CODE (XXXX-XXXX):' : '6-DIGIT TOTP CODE:'}
            </label>
            <input 
              type="text" 
              id="mfa-code-input"
              maxlength="${isRecoveryMode ? 12 : 6}"
              placeholder="${isRecoveryMode ? 'A1B2-C3D4' : '••••••'}"
              value="${escapeHtml(enteredCode)}"
              style="width: 100%; padding: 12px; border-radius: 10px; border: 2px solid var(--border-light); font-family: var(--font-mono); font-size: 1.6rem; letter-spacing: 0.25em; text-align: center; box-sizing: border-box;"
            />
          </div>

          <button 
            id="verify-mfa-submit-btn"
            ${authenticating ? 'disabled' : ''}
            style="width: 100%; padding: 12px; border-radius: 10px; background: #0F172A; color: #FFF; border: none; font-family: var(--font-sans); font-size: 0.95rem; font-weight: 700; cursor: pointer; margin-bottom: 12px;"
          >
            ${authenticating ? 'Verifying...' : 'Authenticate 6-Hour Privileged Session →'}
          </button>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <button id="toggle-recovery-btn" style="background: transparent; border: none; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.75rem; font-weight: 600; cursor: pointer; text-decoration: underline;">
              ${isRecoveryMode ? '← Use Authenticator App Code' : 'Lost your phone? Use Backup Recovery Code'}
            </button>
            <button id="open-mfa-setup-btn" style="background: transparent; border: none; color: var(--brand-red); font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer;">
              Setup / Reset MFA
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#close-mfa-modal-btn')?.addEventListener('click', () => {
      container.innerHTML = '';
      if (onCancel) onCancel();
    });

    container.querySelector('#toggle-recovery-btn')?.addEventListener('click', () => {
      isRecoveryMode = !isRecoveryMode;
      enteredCode = '';
      errorMessage = null;
      render();
    });

    container.querySelector('#open-mfa-setup-btn')?.addEventListener('click', () => {
      renderMfaEnrollmentModal(container, {
        onEnrolled: () => {
          render();
        },
        onCancel: () => {
          render();
        },
      });
    });

    const input = container.querySelector('#mfa-code-input');
    input?.addEventListener('input', (e) => {
      enteredCode = e.target.value;
    });
    input?.focus();

    container.querySelector('#verify-mfa-submit-btn')?.addEventListener('click', async () => {
      if (!enteredCode.trim()) {
        errorMessage = 'Please enter the verification code.';
        render();
        return;
      }

      authenticating = true;
      render();

      try {
        const functions = getFunctions();
        const createSessionFn = httpsCallable(functions, 'createPrivilegedSession');
        const payload = isRecoveryMode ? { recoveryCode: enteredCode.trim() } : { totpCode: enteredCode.trim() };
        const res = await createSessionFn(payload);

        if (res.data?.sessionId) {
          savePrivilegedSession(res.data);
          container.innerHTML = '';
          if (onSuccess) onSuccess(res.data);
        } else {
          errorMessage = 'Session authorization failed.';
          authenticating = false;
          render();
        }
      } catch (err) {
        if (err.message?.includes('MFA_ENROLLMENT_REQUIRED')) {
          renderMfaEnrollmentModal(container, {
            onEnrolled: () => render(),
            onCancel: () => render(),
          });
          return;
        }
        errorMessage = err.message || 'MFA verification failed.';
        authenticating = false;
        render();
      }
    });
  }

  render();
}

/**
 * Modal to enroll an Authenticator App using Base32 Secret and single-use recovery codes.
 */
export function renderMfaEnrollmentModal(container, { onEnrolled, onCancel }) {
  let enrollmentData = null;
  let verifyCode = '';
  let errorMessage = null;
  let loading = true;
  let activating = false;

  async function initEnrollment() {
    try {
      const functions = getFunctions();
      const enrollFn = httpsCallable(functions, 'enrollMfaTotp');
      const res = await enrollFn();
      enrollmentData = res.data;
    } catch (err) {
      errorMessage = err.message || 'Failed to initialize MFA enrollment.';
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    container.innerHTML = `
      <div class="pin-modal-overlay">
        <div class="pin-modal-card" style="max-width: 520px; text-align: left; background: #FFF; max-height: 90vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #16A34A; font-weight: 800; background: #DCFCE7; padding: 2px 8px; border-radius: 4px;">
              FREE AUTHENTICATOR ENROLLMENT
            </span>
            <button id="close-enroll-modal-btn" style="background: transparent; border: none; font-size: 1.2rem; cursor: pointer; color: var(--ink-secondary);">✕</button>
          </div>

          <h2 style="font-family: var(--font-display); font-size: 2rem; margin: 0.4rem 0 0.2rem 0; color: var(--ink-primary);">
            CONFIGURE AUTHENTICATOR APP
          </h2>
          <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-bottom: 1.2rem;">
            Works with any free authenticator: Google Authenticator, Microsoft Authenticator, 1Password, or Aegis. No SMS/WhatsApp messaging cost.
          </p>

          ${errorMessage ? `
            <div style="margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; background: #FEE2E2; color: #DC2626; border: 1px solid #FCA5A5;">
              ${escapeHtml(errorMessage)}
            </div>
          ` : ''}

          ${loading ? `
            <div style="text-align: center; padding: 2rem; font-family: var(--font-mono); font-size: 0.9rem; color: var(--ink-secondary);">
              ⏳ Generating cryptographic MFA secret...
            </div>
          ` : enrollmentData ? `
            <!-- Step 1: Base32 Secret Key -->
            <div style="background: var(--bg-surface); border: 1px solid var(--border-light); border-radius: 10px; padding: 12px; margin-bottom: 1.2rem;">
              <div style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 6px;">
                STEP 1: ADD ACCOUNT IN AUTHENTICATOR APP
              </div>
              <div style="font-family: var(--font-sans); font-size: 0.8rem; color: var(--ink-secondary); margin-bottom: 6px;">
                Choose <em>"Enter a setup key"</em> in your Authenticator app and paste this secret:
              </div>
              <div style="background: #FFF; border: 1.5px dashed var(--border-light); padding: 8px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 1.1rem; font-weight: 800; color: #0F172A; letter-spacing: 0.15em; word-break: break-all; text-align: center;">
                ${enrollmentData.secret}
              </div>
            </div>

            <!-- Step 2: Emergency Recovery Codes -->
            <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 10px; padding: 12px; margin-bottom: 1.2rem;">
              <div style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; color: #92400E; margin-bottom: 4px;">
                ⚠️ STEP 2: SAVE THESE 8 ONE-TIME RECOVERY CODES
              </div>
              <div style="font-family: var(--font-sans); font-size: 0.75rem; color: #78350F; margin-bottom: 8px;">
                If you ever lose access to your authenticator device, each code can be used exactly once:
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: #92400E;">
                ${(enrollmentData.recoveryCodes || []).map(code => `
                  <div style="background: #FFF; padding: 4px 8px; border-radius: 4px; border: 1px solid #FCD34D;">${code}</div>
                `).join('')}
              </div>
            </div>

            <!-- Step 3: Enter 6-Digit Code to Confirm -->
            <div style="margin-bottom: 1.5rem;">
              <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--ink-secondary); margin-bottom: 6px;">
                STEP 3: ENTER CODE SHOWN IN AUTHENTICATOR TO ACTIVATE:
              </label>
              <input 
                type="text" 
                id="mfa-verify-input" 
                maxlength="6"
                placeholder="••••••"
                value="${escapeHtml(verifyCode)}"
                style="width: 100%; padding: 10px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 1.4rem; letter-spacing: 0.2em; text-align: center; box-sizing: border-box;"
              />
            </div>

            <button 
              id="activate-mfa-btn"
              ${activating ? 'disabled' : ''}
              style="width: 100%; padding: 12px; border-radius: 8px; background: #16A34A; color: #FFF; border: none; font-family: var(--font-sans); font-size: 0.95rem; font-weight: 700; cursor: pointer;"
            >
              ${activating ? 'Activating...' : 'Verify & Enable MFA Protection ✓'}
            </button>
          ` : ''}

        </div>
      </div>
    `;

    container.querySelector('#close-enroll-modal-btn')?.addEventListener('click', () => {
      container.innerHTML = '';
      if (onCancel) onCancel();
    });

    const verifyInput = container.querySelector('#mfa-verify-input');
    verifyInput?.addEventListener('input', (e) => {
      verifyCode = e.target.value;
    });

    container.querySelector('#activate-mfa-btn')?.addEventListener('click', async () => {
      if (!verifyCode.trim() || verifyCode.trim().length !== 6) {
        errorMessage = 'Please enter the 6-digit code shown in your Authenticator app.';
        render();
        return;
      }

      activating = true;
      render();

      try {
        const functions = getFunctions();
        const verifyFn = httpsCallable(functions, 'verifyAndEnableMfaTotp');
        await verifyFn({ code: verifyCode.trim() });
        alert('MFA Protection Successfully Activated!');
        container.innerHTML = '';
        if (onEnrolled) onEnrolled();
      } catch (err) {
        errorMessage = err.message || 'Verification failed. Please check your phone time synchronization and code.';
        activating = false;
        render();
      }
    });
  }

  initEnrollment();
}
