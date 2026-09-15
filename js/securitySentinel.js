// Thakur Bites — Universal Web Security Sentinel & Anti-Tamper Guard
import { getOrCreateDeviceId } from './auth.js?v=10';

export function initSecuritySentinel(options = { blockShortcuts: false, portalName: 'Thakur Bites' }) {
  const portal = options.portalName || 'Thakur Bites';

  // 1. Anti-Clickjacking Framebusting Guard (RFC 7034 / OWASP A05)
  try {
    if (window.top !== window.self) {
      window.top.location = window.self.location;
    }
  } catch (_) {}

  // 2. High-Visibility Console Security Warning
  try {
    const bannerStyle1 = 'color: #DC2626; font-size: 28px; font-weight: 900; font-family: sans-serif; text-shadow: 1px 1px 2px rgba(0,0,0,0.2);';
    const bannerStyle2 = 'color: #1F2937; font-size: 13px; font-weight: 600; line-height: 1.6; font-family: sans-serif;';
    const bannerStyle3 = 'color: #D97706; font-size: 12px; font-weight: 700; font-family: monospace;';

    console.log(`%c[STOP] ${portal.toUpperCase()} SECURITY PERIMETER`, bannerStyle1);
    console.log(
      '%cThis console is strictly monitored for security audits and penetration defense.\n\n' +
      '• Pricing & Financial Invariants: Cart calculations and stock locks are 100% server-authoritative.\n' +
      '• Cryptographic Pickup Gates: Order handovers require server-verified one-time nonces or PIN hashes.\n' +
      '• Adversarial AI Deception: Automated fuzzing parameters or script injection will trigger automatic session quarantine.\n' +
      '• Hardware Telemetry: Client activities are fingerprinted and linked to college audit logs.',
      bannerStyle2
    );
    console.log(`%c[Sentinel 2.1 — ${portal}] Hardware Device Fingerprint: ` + getOrCreateDeviceId(), bannerStyle3);
  } catch (_) {}

  // 3. Client-Side Canary Deception Traps
  // Attackers or automated LLM agents probing window properties will trip these canary traps.
  const CANARY_TRAP_KEYS = [
    'debugMode',
    'bypassAuth',
    'bypassPayment',
    'overridePrice',
    'adminKey',
    'forceRole',
    '__DEBUG__',
    'mockPayment',
    'masterToken',
  ];

  CANARY_TRAP_KEYS.forEach((key) => {
    let internalVal = undefined;
    try {
      Object.defineProperty(window, key, {
        configurable: true,
        enumerable: false,
        get: () => {
          console.warn(`[CANARY_TRAP] Unauthorized property read probe on window.${key}`);
          try {
            sessionStorage.setItem('tb_security_canary_tripped', key);
          } catch (_) {}
          return internalVal;
        },
        set: (val) => {
          console.warn(`[CANARY_TRAP] Unauthorized property write attack on window.${key} =`, val);
          try {
            sessionStorage.setItem('tb_security_canary_tripped', `${key}:${String(val).slice(0, 32)}`);
          } catch (_) {}
          internalVal = val;
        },
      });
    } catch (_) {}
  });

  // 4. Keyboard Shortcut Interceptor for Workstations & Kiosks
  if (options.blockShortcuts) {
    window.addEventListener('keydown', (e) => {
      // F12
      if (e.key === 'F12' || e.keyCode === 123) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      // Ctrl+Shift+I / Cmd+Option+I (Inspect Element)
      // Ctrl+Shift+J / Cmd+Option+J (Console)
      // Ctrl+Shift+C / Cmd+Option+C (Element Picker)
      // Ctrl+U / Cmd+Option+U (View Source)
      if (
        (isCtrlOrCmd && isShift && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
        (isCtrlOrCmd && (e.key === 'U' || e.key === 'u'))
      ) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, true);
  }

  // 5. DevTools Active State Heuristic Detector
  let devToolsOpenLogged = false;
  function checkDevTools() {
    const widthThreshold = window.outerWidth - window.innerWidth > 160;
    const heightThreshold = window.outerHeight - window.innerHeight > 160;

    if ((widthThreshold || heightThreshold) && !devToolsOpenLogged) {
      devToolsOpenLogged = true;
      console.warn(`[SECURITY] Browser DevTools activity detected on ${portal}.`);
    }
  }

  window.addEventListener('resize', checkDevTools);
  setInterval(checkDevTools, 3000);
}

