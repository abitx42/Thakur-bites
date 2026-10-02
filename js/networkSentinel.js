// Thakur Bites Platform 2.0 — Global Network Sentinel & Friendly Error Formatter
// Provides real-time offline/online banners and human-readable error translation.

let sentinelInitialized = false;
let bannerEl = null;

/**
 * Initialize global offline/online monitoring across web portals.
 * Renders a persistent floating banner when offline and auto-reconnects with a brief success toast.
 */
export function initNetworkSentinel(options = {}) {
  if (sentinelInitialized || typeof window === 'undefined') return;
  sentinelInitialized = true;

  const portalName = options.portalName || 'Portal';

  // Create floating banner element if not present
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.id = 'tb-network-sentinel-banner';
    bannerEl.style.position = 'fixed';
    bannerEl.style.top = '0';
    bannerEl.style.left = '0';
    bannerEl.style.width = '100%';
    bannerEl.style.zIndex = '999999';
    bannerEl.style.padding = '10px 16px';
    bannerEl.style.fontFamily = 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)';
    bannerEl.style.fontSize = '0.85rem';
    bannerEl.style.fontWeight = '700';
    bannerEl.style.textAlign = 'center';
    bannerEl.style.boxSizing = 'border-box';
    bannerEl.style.transition = 'all 0.25s ease';
    bannerEl.style.display = 'none';
    bannerEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    document.body.appendChild(bannerEl);
  }

  function updateStatus(isOnline) {
    if (!bannerEl) return;

    if (!isOnline) {
      bannerEl.style.display = 'block';
      bannerEl.style.background = '#DC2626';
      bannerEl.style.color = '#FFFFFF';
      bannerEl.style.borderBottom = '2px solid #991B1B';
      bannerEl.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap;">
          <span style="font-size: 1.1rem;">⚠️</span>
          <span>No Internet Connection</span>
          <span style="font-weight: 400; opacity: 0.9;">— ${portalName} is currently offline. Please check your network. Live orders will sync once reconnected.</span>
        </div>
      `;
    } else if (bannerEl.style.display !== 'none' && bannerEl.style.background.includes('220')) {
      // Transitioning back online from an offline state
      bannerEl.style.background = '#16A34A';
      bannerEl.style.color = '#FFFFFF';
      bannerEl.style.borderBottom = '2px solid #15803D';
      bannerEl.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span style="font-size: 1.1rem;">✅</span>
          <span>Internet Connection Restored! Syncing live data...</span>
        </div>
      `;
      setTimeout(() => {
        if (navigator.onLine && bannerEl) {
          bannerEl.style.display = 'none';
        }
      }, 3500);
    }
  }

  window.addEventListener('offline', () => updateStatus(false));
  window.addEventListener('online', () => updateStatus(true));

  // Initial check on boot
  if (!navigator.onLine) {
    updateStatus(false);
  }
}

/**
 * Translates technical error objects, Firebase exceptions, and network failures
 * into clean, user-friendly, actionable messages.
 *
 * @param {Error|string|any} err - The caught error
 * @param {string} defaultFallback - Default message if unclassified
 * @returns {string} Human-readable friendly error string
 */
export function getFriendlyErrorMessage(err, defaultFallback = 'An unexpected error occurred. Please try again.') {
  if (!err) return defaultFallback;

  // 1. Check if browser is currently offline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'No internet connection. Please check your network and try again.';
  }

  const raw = String(err?.message || err || '').trim();
  const lower = raw.toLowerCase();

  // 2. Network & Connectivity Failures
  if (
    lower.includes('network-request-failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('unavailable') ||
    lower.includes('client is offline') ||
    lower.includes('socket') ||
    lower.includes('timeout') ||
    lower.includes('deadline-exceeded')
  ) {
    return 'Network connection error. Please check your internet connection and try again.';
  }

  // 3. Authentication & Credential Errors
  if (
    lower.includes('auth/invalid-credential') ||
    lower.includes('auth/wrong-password') ||
    lower.includes('auth/user-not-found') ||
    lower.includes('invalid credentials')
  ) {
    return 'Incorrect email or password. Please verify your staff credentials.';
  }

  if (lower.includes('auth/user-disabled')) {
    return 'This staff account has been disabled. Please contact an administrator.';
  }

  if (lower.includes('auth/invalid-email')) {
    return 'Please enter a valid email address.';
  }

  if (lower.includes('auth/weak-password')) {
    return 'The password is too weak. Please use at least 8 characters.';
  }

  if (
    lower.includes('too-many-requests') ||
    lower.includes('resource-exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('too many attempts')
  ) {
    return 'Too many attempts. For security reasons, please wait a moment before trying again.';
  }

  // 4. Shift PIN & Workstation Security Errors
  if (lower.includes('lockout active') || lower.includes('locked out') || lower.includes('failedpinattempts')) {
    return 'Terminal temporarily locked out due to multiple failed attempts. Please wait 15 minutes or contact a manager.';
  }

  if (lower.includes('unregistered workstation') || lower.includes('device not registered') || lower.includes('hardware binding')) {
    return 'This terminal hardware is not authorized. Please enroll this workstation first.';
  }

  if (lower.includes('invalid shift pin') || lower.includes('shift pin verification failed') || lower.includes('incorrect shift pin')) {
    return 'Incorrect 6-digit shift PIN for this station. Please check and try again.';
  }

  // 5. Authorization & Permissions
  if (lower.includes('permission-denied') || lower.includes('unauthorized') || lower.includes('lacks operational')) {
    return 'Access denied. Your session does not have permission for this action.';
  }

  if (lower.includes('unauthenticated')) {
    return 'Your session has expired or is unauthenticated. Please sign in again.';
  }

  // 6. Business Logic Errors
  if (lower.includes('order is not ready') || lower.includes('not ready')) {
    return 'Order is still being prepared by the kitchen and is not ready for pickup.';
  }

  if (lower.includes('already collected') || lower.includes('replay detected')) {
    return 'Order has already been verified and collected. Do not hand over meal again.';
  }

  if (lower.includes('already paid') || lower.includes('already settled')) {
    return 'This order has already been marked as paid.';
  }

  if (lower.includes('out of stock') || lower.includes('insufficient stock')) {
    return 'Item is currently sold out or has insufficient stock.';
  }

  if (lower.includes('not-found') || lower.includes('not found')) {
    return 'The requested order or record was not found.';
  }

  // 7. Strip raw Firebase wrappers if present e.g. "Firebase: Error (auth/foo)."
  const cleaned = raw
    .replace(/^Firebase:\s*Error\s*\(([^)]+)\)\.?/i, '$1')
    .replace(/^\[[a-zA-Z0-9_\/-]+\]\s*/i, '')
    .trim();

  return cleaned.length > 0 ? cleaned : defaultFallback;
}
