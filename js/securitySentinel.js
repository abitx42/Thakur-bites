// Thakur Bites — Web Security Sentinel & Anti-Tamper Guard
import { getOrCreateDeviceId } from './auth.js?v=10';

export function initSecuritySentinel(options = { blockShortcuts: false }) {
  // 1. High-Visibility Console Security Warning
  try {
    const bannerStyle1 = 'color: #DC2626; font-size: 32px; font-weight: 900; font-family: sans-serif; text-shadow: 1px 1px 2px rgba(0,0,0,0.2);';
    const bannerStyle2 = 'color: #1F2937; font-size: 14px; font-weight: 600; line-height: 1.6; font-family: sans-serif;';
    const bannerStyle3 = 'color: #D97706; font-size: 13px; font-weight: 700; font-family: monospace;';

    console.log('%cSTOP!', bannerStyle1);
    console.log(
      '%cThis browser feature is intended strictly for authorized developers and platform engineers.\n\n' +
      '1. Menu pricing and order totals are calculated authoritatively on secure backend servers — DOM edits will NOT alter checkout charges.\n' +
      '2. Canteen pickup requires 4-digit secret PIN or encrypted QR code verification in the staff database. Modified customer screens or screenshots are strictly rejected at the counter.\n' +
      '3. Any attempt to tamper with client code, inject scripts, or forge transaction parameters is recorded with hardware fingerprinting and reported to campus security administration.',
      bannerStyle2
    );
    console.log('%c[Sentinel 2.0] Hardware Device Fingerprint: ' + getOrCreateDeviceId(), bannerStyle3);
  } catch (_) {}

  // 2. Keyboard Shortcut Interceptor for Workstations
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

  // 3. DevTools Active State Heuristic Detector
  let devToolsOpenLogged = false;
  function checkDevTools() {
    const widthThreshold = window.outerWidth - window.innerWidth > 160;
    const heightThreshold = window.outerHeight - window.innerHeight > 160;

    if ((widthThreshold || heightThreshold) && !devToolsOpenLogged) {
      devToolsOpenLogged = true;
      console.warn('[SECURITY] Browser DevTools activity detected on workstation.');
    }
  }

  window.addEventListener('resize', checkDevTools);
  setInterval(checkDevTools, 2000);
}
