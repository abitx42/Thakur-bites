// Staff 4-Digit PIN Authentication & Session Guard
const DEFAULT_STAFF_PIN = '1234';

export const staffAuth = {
  isAuthenticated() {
    return sessionStorage.getItem('tb_staff_auth') === 'true';
  },

  verifyPin(enteredPin) {
    const validPin = localStorage.getItem('tb_custom_pin') || DEFAULT_STAFF_PIN;
    if (enteredPin === validPin) {
      sessionStorage.setItem('tb_staff_auth', 'true');
      return true;
    }
    return false;
  },

  lock() {
    sessionStorage.removeItem('tb_staff_auth');
  },

  setCustomPin(newPin) {
    if (newPin && newPin.length === 4) {
      localStorage.setItem('tb_custom_pin', newPin);
      return true;
    }
    return false;
  }
};

/**
 * Renders the PIN unlock modal overlay if staff is not authenticated.
 * @param {HTMLElement} container - DOM container to render into
 * @param {Function} onUnlocked - Callback triggered upon successful PIN entry
 */
export function renderPinPadModal(container, onUnlocked) {
  let pinInput = '';

  function updateDisplay() {
    const dots = container.querySelectorAll('.pin-dot');
    dots.forEach((dot, idx) => {
      if (idx < pinInput.length) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });

    const errorEl = container.querySelector('#pin-error');
    if (errorEl) errorEl.style.display = 'none';
  }

  container.innerHTML = `
    <div class="pin-modal-overlay">
      <div class="pin-modal-card">
        <div class="pin-badge">STAFF ACCESS</div>
        <h2 style="font-family: var(--font-display); font-size: 2.2rem; margin: 0.5rem 0 0.2rem 0; letter-spacing: 0.05em;">ENTER 4-DIGIT PIN</h2>
        <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-bottom: 1.5rem;">
          Authorized canteen staff credentials required
        </p>

        <!-- PIN Dots Indicator -->
        <div class="pin-dots-container">
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
        </div>

        <div id="pin-error" style="display: none; color: var(--brand-red); font-family: var(--font-mono); font-size: 0.85rem; font-weight: 600; margin-bottom: 1rem;">
          Incorrect PIN. Try again.
        </div>

        <!-- 3x4 Number Keypad -->
        <div class="pin-keypad">
          ${[1,2,3,4,5,6,7,8,9].map(num => `
            <button class="pin-key-btn" data-key="${num}">${num}</button>
          `).join('')}
          <button class="pin-key-btn clear-key" data-key="clear">CLR</button>
          <button class="pin-key-btn" data-key="0">0</button>
          <button class="pin-key-btn del-key" data-key="backspace">⌫</button>
        </div>
      </div>
    </div>
  `;

  // Attach Keypad Listeners
  container.querySelectorAll('.pin-key-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      if (key === 'clear') {
        pinInput = '';
      } else if (key === 'backspace') {
        pinInput = pinInput.slice(0, -1);
      } else if (pinInput.length < 4) {
        pinInput += key;
      }

      updateDisplay();

      // Check PIN once 4 digits entered
      if (pinInput.length === 4) {
        setTimeout(() => {
          if (staffAuth.verifyPin(pinInput)) {
            onUnlocked();
          } else {
            pinInput = '';
            updateDisplay();
            const errorEl = container.querySelector('#pin-error');
            if (errorEl) errorEl.style.display = 'block';
          }
        }, 150);
      }
    });
  });
}
