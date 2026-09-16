// Thakur Bites — Universal Web Security Sentinel & Anti-Tamper Guard
import { getOrCreateDeviceId } from './auth.js?v=10';

// Snapshot unhookable native references immediately upon module load
const _nativeFetch = typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null;
const _nativeSendBeacon = typeof navigator !== 'undefined' && navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
const _nativeToString = Function.prototype.toString;

let isLockdownActive = false;

/**
 * Triggers full-screen lockdown, wipes credentials, and reports breach telemetry to developer.
 */
export function triggerTamperLockdown(reason, details = {}) {
  if (isLockdownActive) return;
  isLockdownActive = true;

  console.error(`[SECURITY TAMPER LOCKDOWN] Violation: ${reason}`, details);

  // 1. Evict sensitive session markers and tokens, and scrub in-memory references
  try {
    sessionStorage.setItem('tb_tamper_lockdown_active', reason);
    localStorage.removeItem('tb_staff_token');
    localStorage.removeItem('tb_privileged_session');
    localStorage.removeItem('tb_registered_workstation_token');
    // Wipe sensitive runtime memory references
    if (window.__TB_CURRENT_ORDERS__) window.__TB_CURRENT_ORDERS__ = [];
    if (window.__TB_ACTIVE_TICKETS__) window.__TB_ACTIVE_TICKETS__ = [];
  } catch (_) {}

  // 2. Dispatch security telemetry breach report to backend (deduplicated per session)
  try {
    const hasAlreadyReported = sessionStorage.getItem('tb_lockdown_telemetry_sent') === 'true';
    if (!hasAlreadyReported) {
      sessionStorage.setItem('tb_lockdown_telemetry_sent', 'true');
      const deviceId = getOrCreateDeviceId();
      const payload = {
        data: {
          violationType: details.violationType || 'CLIENT_DOM_TAMPERING',
          deviceId: deviceId,
          details: {
            reason: reason,
            url: window.location.href,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            ...details,
          },
        },
      };

      const endpoint = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? '/reportSecurityViolation'
        : 'https://us-central1-adi-thakur-bite.cloudfunctions.net/reportSecurityViolation';

      if (_nativeSendBeacon) {
        _nativeSendBeacon(endpoint, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      } else if (_nativeFetch) {
        _nativeFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[Sentinel] Failed to dispatch breach report:', err);
  }

  // 3. Render un-bypassable full-page Lockdown Screen
  renderLockdownScreen(reason, details);
}

/**
 * Renders an un-dismissable, full-screen lockdown screen protecting the campus portal.
 */
function renderLockdownScreen(reason, details = {}) {
  const deviceId = getOrCreateDeviceId();
  const timestamp = new Date().toLocaleString();

  let lockdownEl = document.getElementById('tb-security-lockdown-overlay');
  if (!lockdownEl) {
    lockdownEl = document.createElement('div');
    lockdownEl.id = 'tb-security-lockdown-overlay';
  }

  lockdownEl.setAttribute('style', `
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    background: #0A0D14 !important;
    color: #F3F4F6 !important;
    z-index: 2147483647 !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    padding: 24px !important;
    box-sizing: border-box !important;
    text-align: center !important;
    user-select: none !important;
    pointer-events: all !important;
  `);

  lockdownEl.innerHTML = `
    <div style="max-width: 520px; width: 100%; background: #111827; border: 1px solid #DC2626; border-radius: 16px; padding: 36px 28px; box-shadow: 0 25px 50px -12px rgba(220, 38, 38, 0.35); text-align: center;">
      <div style="width: 72px; height: 72px; background: rgba(220, 38, 38, 0.15); border: 2px solid #EF4444; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>

      <div style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: #EF4444; text-transform: uppercase; margin-bottom: 8px;">
        SECURITY INTEGRITY LOCKDOWN
      </div>

      <h1 style="font-size: 22px; font-weight: 800; color: #FFFFFF; margin: 0 0 12px 0; letter-spacing: -0.5px;">
        Tampering or Mod Detected
      </h1>

      <p style="font-size: 14px; line-height: 1.6; color: #9CA3AF; margin: 0 0 24px 0;">
        Unauthorized client-side modification, script injection, or native runtime hooking has been detected. To protect campus financial transactions and counter security, this portal has been locked down for this session.
      </p>

      <div style="background: #1F2937; border-radius: 10px; padding: 14px 18px; text-align: left; font-family: monospace; font-size: 12px; margin-bottom: 24px; border: 1px solid #374151;">
        <div style="color: #9CA3AF; margin-bottom: 4px;">VIOLATION: <span style="color: #F87171; font-weight: bold;">${reason}</span></div>
        <div style="color: #9CA3AF; margin-bottom: 4px;">DEVICE ID: <span style="color: #E5E7EB;">${deviceId}</span></div>
        <div style="color: #9CA3AF; margin-bottom: 4px;">TIMESTAMP: <span style="color: #E5E7EB;">${timestamp}</span></div>
        <div style="color: #9CA3AF;">STATUS: <span style="color: #34D399; font-weight: bold;">TELEMETRY DELIVERED TO DEVELOPER</span></div>
      </div>

      <div style="font-size: 13px; color: #6B7280;">
        If you are an authorized operator encountering this by error, please contact Thakur Bites Canteen Management with your Device ID.
      </div>
    </div>
  `;

  if (!document.body.contains(lockdownEl)) {
    document.body.appendChild(lockdownEl);
  }

  // Self-healing guard: re-mount if an attacker tries to remove it from devtools
  try {
    const observer = new MutationObserver(() => {
      if (!document.getElementById('tb-security-lockdown-overlay')) {
        document.body.appendChild(lockdownEl);
      }
    });
    observer.observe(document.body, { childList: true });
  } catch (_) {}
}

export function initSecuritySentinel(options = { blockShortcuts: false, portalName: 'Thakur Bites' }) {
  const portal = options.portalName || 'Thakur Bites';

  // 0. Check if this session was already locked down
  try {
    const previousViolation = sessionStorage.getItem('tb_tamper_lockdown_active');
    if (previousViolation) {
      triggerTamperLockdown(previousViolation, { violationType: 'CLIENT_DOM_TAMPERING' });
      return;
    }
  } catch (_) {}

  // 1. Anti-Clickjacking Framebusting Guard (RFC 7034 / OWASP A05 — Fail-Closed)
  try {
    if (window.top !== window.self) {
      try {
        window.top.location = window.self.location;
      } catch (_) {
        // If cross-origin framing blocks top redirection, fail-closed by blanking DOM
        document.documentElement.innerHTML = '<div style="background:#0A0D14;color:#FFF;padding:60px;text-align:center;font-family:sans-serif;"><h2>Security Violation: Framing Prohibited</h2></div>';
        throw new Error('Framing prohibited');
      }
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
    console.log(`%c[Sentinel 2.2 — ${portal}] Hardware Device Fingerprint: ` + getOrCreateDeviceId(), bannerStyle3);
  } catch (_) {}

  // 3. Client-Side Canary Deception Traps (Triggers lockdown on write)
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
        configurable: false,
        enumerable: false,
        get: () => {
          console.warn(`[CANARY_TRAP] Unauthorized property read probe on window.${key}`);
          return internalVal;
        },
        set: (val) => {
          console.error(`[CANARY_TRAP] Tamper write on window.${key} =`, val);
          internalVal = val;
          triggerTamperLockdown('CANARY_TRIPWIRE_TRIGGERED', {
            violationType: 'CANARY_TRIPWIRE_TRIGGERED',
            key: key,
            val: String(val).slice(0, 32),
          });
        },
      });
    } catch (_) {}
  });

  // 3.1 Client-Side Prototype Pollution Defense (OWASP A03 / Client-Side Pollution)
  try {
    const PROTOTYPE_CANARIES = ['isAdmin', 'role', 'isSuperUser', 'isDeveloper', 'debugMode', 'bypassAuth'];
    PROTOTYPE_CANARIES.forEach((prop) => {
      let protoVal = undefined;
      Object.defineProperty(Object.prototype, prop, {
        configurable: false,
        get: () => protoVal,
        set: (v) => {
          console.error(`[PROTOTYPE_POLLUTION_ATTACK] Tamper on Object.prototype.${prop} =`, v);
          protoVal = v;
          triggerTamperLockdown('PROTOTYPE_POLLUTION_ATTACK', {
            violationType: 'CLIENT_DOM_TAMPERING',
            property: prop,
            value: String(v).slice(0, 32),
          });
        },
      });
    });
  } catch (err) {
    console.warn('[Sentinel] Prototype defense init notice:', err);
  }

  // 4. Keyboard Shortcut Interceptor for Workstations & Kiosks
  if (options.blockShortcuts) {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F12' || e.keyCode === 123) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      if (
        (isCtrlOrCmd && isShift && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) ||
        (isCtrlOrCmd && ['U', 'u'].includes(e.key))
      ) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, true);
  }

  // 5. DevTools Active State Heuristic Detector (Window geometry + Console getter for undocked DevTools)
  let devToolsOpenLogged = false;
  function onDevToolsDetected() {
    if (!devToolsOpenLogged) {
      devToolsOpenLogged = true;
      console.warn(`[SECURITY] Browser DevTools activity detected on ${portal}.`);
    }
  }

  function checkDevTools() {
    const widthThreshold = window.outerWidth - window.innerWidth > 160;
    const heightThreshold = window.outerHeight - window.innerHeight > 160;

    if (widthThreshold || heightThreshold) {
      onDevToolsDetected();
    }
  }

  window.addEventListener('resize', checkDevTools);
  setInterval(checkDevTools, 3000);

  // Undocked DevTools console getter probe
  try {
    const probe = /./;
    probe.toString = function () {
      onDevToolsDetected();
      return ' ';
    };
    setInterval(() => {
      console.debug?.(probe);
    }, 4000);
  } catch (_) {}

  // Dynamic Debugger Execution Timing Trap (bypasses console mocking/silencing)
  try {
    const debugDetector = () => {
      const start = performance.now();
      (function () {}.constructor('debugger')());
      const elapsed = performance.now() - start;
      if (elapsed > 100) {
        onDevToolsDetected();
      }
    };
    setInterval(debugDetector, 5000);
  } catch (_) {}

  // 6. Native Function Hook Detection & Prototype Cloaking Defense
  function checkNativeIntegrity() {
    try {
      const toStr = Function.prototype.toString;
      // Defense against Function.prototype.toString cloaking
      const toStrSource = _nativeToString.call(toStr);
      if (!toStrSource.includes('[native code]')) {
        triggerTamperLockdown('CLIENT_CODE_TAMPERED', {
          violationType: 'CLIENT_CODE_TAMPERED',
          target: 'Function.prototype.toString',
        });
        return;
      }

      if (window.fetch && !_nativeToString.call(window.fetch).includes('[native code]')) {
        triggerTamperLockdown('CLIENT_CODE_TAMPERED', {
          violationType: 'CLIENT_CODE_TAMPERED',
          target: 'fetch',
        });
        return;
      }
      if (window.XMLHttpRequest && !_nativeToString.call(XMLHttpRequest.prototype.open).includes('[native code]')) {
        triggerTamperLockdown('CLIENT_CODE_TAMPERED', {
          violationType: 'CLIENT_CODE_TAMPERED',
          target: 'XMLHttpRequest.open',
        });
        return;
      }
      if (window.XMLHttpRequest && !_nativeToString.call(XMLHttpRequest.prototype.send).includes('[native code]')) {
        triggerTamperLockdown('CLIENT_CODE_TAMPERED', {
          violationType: 'CLIENT_CODE_TAMPERED',
          target: 'XMLHttpRequest.send',
        });
        return;
      }
    } catch (_) {}
  }

  checkNativeIntegrity();
  setInterval(checkNativeIntegrity, 2500);

  // 7. Active DOM Mutation Observer for Script/Iframe/Base Injection
  function initDomIntegrityObserver() {
    const isTrustedSource = (src) => {
      if (!src) return false;
      try {
        const url = new URL(src, window.location.href);
        if (url.origin === window.location.origin) return true;
        const host = url.hostname.toLowerCase();
        if (
          host.endsWith('.gstatic.com') ||
          host.endsWith('.googleapis.com') ||
          host.endsWith('.google.com') ||
          host.endsWith('.razorpay.com') ||
          host.endsWith('.trycloudflare.com') ||
          host.endsWith('.jsdelivr.net') ||
          url.protocol === 'blob:'
        ) {
          return true;
        }
        return false;
      } catch (_) {
        return false;
      }
    };

    try {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            const tag = node.tagName ? node.tagName.toUpperCase() : '';

            // Forbidden high-risk element types (Base injection, plugins)
            if (tag === 'BASE' || tag === 'OBJECT' || tag === 'EMBED' || tag === 'APPLET') {
              triggerTamperLockdown('UNAUTHORIZED_DOM_ELEMENT_INJECTION', {
                violationType: 'CLIENT_DOM_TAMPERING',
                tag,
              });
              return;
            }

            // Script element injection analysis
            if (tag === 'SCRIPT') {
              const src = node.src || '';
              if (src) {
                if (!isTrustedSource(src)) {
                  triggerTamperLockdown('CLIENT_DOM_TAMPERING', {
                    violationType: 'CLIENT_DOM_TAMPERING',
                    tag,
                    src: src.slice(0, 120),
                  });
                  return;
                }
              } else if (document.readyState === 'complete' || document.readyState === 'interactive') {
                // Dynamically injected inline script after initial bootstrap
                if (!node.hasAttribute('data-tb-verified')) {
                  triggerTamperLockdown('DYNAMIC_INLINE_SCRIPT_INJECTION', {
                    violationType: 'CLIENT_DOM_TAMPERING',
                    tag,
                    snippet: (node.textContent || '').slice(0, 80),
                  });
                  return;
                }
              }
            }

            // Untrusted iframe embedding
            if (tag === 'IFRAME') {
              const src = node.src || '';
              if (src && !isTrustedSource(src)) {
                triggerTamperLockdown('UNAUTHORIZED_IFRAME_INJECTION', {
                  violationType: 'CLIENT_DOM_TAMPERING',
                  tag,
                  src: src.slice(0, 120),
                });
                return;
              }
            }
          }
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (_) {}
  }

  initDomIntegrityObserver();

  // 8. Cross-Tab Storage Tamper Guard
  try {
    window.addEventListener('storage', (e) => {
      if (!e.key) return;
      if (e.key === 'tb_tamper_lockdown_active' && !e.newValue && e.oldValue) {
        triggerTamperLockdown('STORAGE_TAMPER_LOCKDOWN_EVICTION', {
          violationType: 'CLIENT_DOM_TAMPERING',
          key: e.key,
        });
      }
    });
  } catch (_) {}

  // 9. Rogue ServiceWorker Interception Auditor
  if ('serviceWorker' in navigator && !options.allowServiceWorker) {
    try {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        if (registrations && registrations.length > 0) {
          console.warn('[SECURITY] Unauthorized ServiceWorker detected in operational portal. Unregistering...');
          for (const reg of registrations) {
            reg.unregister();
          }
          triggerTamperLockdown('UNAUTHORIZED_SERVICE_WORKER_DETECTED', {
            violationType: 'CLIENT_DOM_TAMPERING',
            count: registrations.length,
          });
        }
      }).catch(() => {});
    } catch (_) {}
  }
}

// 9. Sealed Immutable Sentinel Namespace
try {
  const sentinelApi = Object.freeze({
    triggerTamperLockdown,
    initSecuritySentinel,
    version: '2.3',
  });
  Object.defineProperty(window, '__TB_SENTINEL__', {
    value: sentinelApi,
    writable: false,
    configurable: false,
    enumerable: false,
  });
} catch (_) {}



