import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getFirestore, 
  doc, 
  onSnapshot 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Public Configuration (Zero Privileges Required)
const firebaseConfig = {
  apiKey: "AIzaSyBK6j2OYH2WdBC2c4HrOvAmqeBzG0ZkGbc",
  authDomain: "adi-thakur-bite.firebaseapp.com",
  projectId: "adi-thakur-bite",
  storageBucket: "adi-thakur-bite.firebasestorage.app",
  messagingSenderId: "391012293021",
  appId: "1:391012293021:web:94d50c950a753ce38be819"
};

// ─── Kiosk Security Sentinel & Anti-Tamper Perimeter ─────────────────────────
try {
  if (window.top !== window.self) {
    try {
      window.top.location = window.self.location;
    } catch (_) {
      document.documentElement.innerHTML = '<div style="background:#000;color:#FFF;padding:40px;text-align:center;font-family:sans-serif;"><h3>Framing Prohibited</h3></div>';
    }
  }
} catch (_) {}

try {
  console.log('%c[STOP] TV DISPLAY KIOSK PERIMETER', 'color: #DC2626; font-size: 24px; font-weight: 900;');
  console.log('%cTV projection displays live token numbers with zero PII. Tampering is logged.', 'color: #1F2937; font-size: 13px;');
} catch (_) {}

window.addEventListener('keydown', (e) => {
  if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) || (e.ctrlKey && e.key.toUpperCase() === 'U')) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}, true);

// Canary traps
['debugMode', 'bypassAuth', 'overridePrice', 'adminKey'].forEach((key) => {
  try {
    Object.defineProperty(window, key, {
      configurable: true,
      get: () => { console.warn(`[CANARY_TRAP] Probe on ${key}`); return undefined; },
      set: (v) => { console.warn(`[CANARY_TRAP] Attack on ${key}:`, v); },
    });
  } catch (_) {}
});

// Undocked DevTools Probe & Debugger Timing Trap
try {
  const probe = /./;
  probe.toString = function () {
    console.warn('[SECURITY] TV Display Kiosk DevTools activity detected.');
    return ' ';
  };
  setInterval(() => {
    console.debug?.(probe);
  }, 4000);

  setInterval(() => {
    const start = performance.now();
    (function () {}.constructor('debugger')());
    const elapsed = performance.now() - start;
    if (elapsed > 100) {
      console.warn('[SECURITY] TV Display interactive debugger detected.');
    }
  }, 5000);
} catch (_) {}

const app = initializeApp(firebaseConfig, 'TB_TV_DISPLAY');
const db = getFirestore(app);

// DOM Elements
const confirmedGrid = document.getElementById('confirmed-grid');
const preparingGrid = document.getElementById('preparing-grid');
const readyGrid = document.getElementById('ready-grid');
const confirmedCountEl = document.getElementById('confirmed-count');
const preparingCountEl = document.getElementById('preparing-count');
const readyCountEl = document.getElementById('ready-count');
const statusPill = document.getElementById('connection-status-pill');
const statusText = document.getElementById('status-text');
const reconnectBanner = document.getElementById('reconnecting-banner');
const standbyOverlay = document.getElementById('standby-overlay');
const clockDisplay = document.getElementById('clock-display');
const audioBanner = document.getElementById('audio-enable-banner');

// Track known ready tokens to trigger chime only on NEW additions
const knownReadyTokens = new Set();
let isFirstLoad = true;
let audioContext = null;
let currentUnsubscribe = null;
let reconnectDelayMs = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;

// Initialize Web Audio API on user interaction or wake-up
function initAudio() {
  try {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContext = new AudioCtx();
      }
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    if (audioBanner) {
      audioBanner.classList.add('hidden');
    }
  } catch (err) {
    console.warn("Audio init notice:", err);
  }
}

['click', 'keydown', 'touchstart', 'pointerdown'].forEach(evt => {
  window.addEventListener(evt, initAudio, { passive: true });
});
if (audioBanner) {
  audioBanner.addEventListener('click', initAudio);
}

/**
 * Synthesizes a clean, pleasant two-tone counter chime (800Hz -> 1060Hz)
 * Zero external MP3 downloads or network dependencies.
 */
function playReadyChime() {
  if (!audioContext) {
    initAudio();
  }
  if (!audioContext) {
    if (audioBanner) {
      audioBanner.classList.remove('hidden');
      audioBanner.style.background = '#DC2626';
      audioBanner.innerHTML = '<span>⚠️ AUDIO MUTED: Tap screen or press remote to enable pick-up chime!</span>';
    }
    return;
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }

  try {
    const now = audioContext.currentTime;
    
    // Tone 1: 800 Hz
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(800, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);

    osc1.onended = () => {
      try {
        gain1.disconnect();
        osc1.disconnect();
      } catch (_) {}
    };

    osc1.start(now);
    osc1.stop(now + 0.4);

    // Tone 2: 1060 Hz (Major third harmonic)
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1060, now + 0.15);
    gain2.gain.setValueAtTime(0.4, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);

    osc2.onended = () => {
      try {
        gain2.disconnect();
        osc2.disconnect();
      } catch (_) {}
    };

    osc2.start(now + 0.15);
    osc2.stop(now + 0.7);
  } catch (err) {
    console.warn("Chime audio notice:", err);
  }
}

/**
 * Updates the digital header clock every second
 */
function updateClock() {
  const now = new Date();
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  clockDisplay.textContent = `${hours}:${minutes}:${seconds} ${ampm}`;
}
setInterval(updateClock, 1000);
updateClock();

/**
 * Sanitizes strings for safe DOM insertion (Zero XSS)
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const MAX_PER_SECTION = 8;

/**
 * Render Tokens from the single sanitized publicLiveQueue/current projection
 */
function renderQueueData(data) {
  const confirmedTickets = Array.isArray(data?.confirmed) ? data.confirmed : [];
  const preparingTickets = Array.isArray(data?.preparing) ? data.preparing : [];
  const readyTickets = Array.isArray(data?.ready) ? data.ready : [];

  const MAX_VISIBLE_CONFIRMED = 6;
  const visibleConfirmed = confirmedTickets.slice(0, MAX_VISIBLE_CONFIRMED);
  const overflowConfirmed = Math.max(0, confirmedTickets.length - MAX_VISIBLE_CONFIRMED);

  const visiblePreparing = preparingTickets.slice(0, MAX_PER_SECTION);
  const overflowPreparing = Math.max(0, preparingTickets.length - MAX_PER_SECTION);

  const visibleReady = readyTickets.slice(0, MAX_PER_SECTION);
  const overflowReady = Math.max(0, readyTickets.length - MAX_PER_SECTION);

  // Check for newly ready orders to trigger chime
  let hasNewReady = false;
  readyTickets.forEach(item => {
    const token = item.token;
    if (token && !knownReadyTokens.has(token)) {
      knownReadyTokens.add(token);
      if (!isFirstLoad) {
        hasNewReady = true;
      }
    }
  });

  if (hasNewReady) {
    playReadyChime();
  }
  isFirstLoad = false;

  // Clean up departed ready tokens from set
  const currentReadySet = new Set(readyTickets.map(item => item.token));
  for (const t of knownReadyTokens) {
    if (!currentReadySet.has(t)) {
      knownReadyTokens.delete(t);
    }
  }

  // Update Counters
  if (confirmedCountEl) confirmedCountEl.textContent = confirmedTickets.length;
  if (preparingCountEl) preparingCountEl.textContent = preparingTickets.length;
  if (readyCountEl) readyCountEl.textContent = readyTickets.length;

  // 1. Render Confirmed Grid
  if (confirmedGrid) {
    if (confirmedTickets.length === 0) {
      confirmedGrid.innerHTML = `
        <div style="grid-column: 1/-1; padding: 2rem; text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 1rem;">
          No incoming orders waiting
        </div>
      `;
    } else {
      let html = visibleConfirmed.map((item, idx) => `
        <div class="token-card confirmed">
          <div class="token-number">${escapeHtml(item.token || 'TB-???')}</div>
          <div class="token-status">IN QUEUE &middot; #${idx + 1}</div>
        </div>
      `).join('');

      if (overflowConfirmed > 0) {
        html += `
          <div class="token-overflow-pill confirmed">
            +${overflowConfirmed} more in queue...
          </div>
        `;
      }
      confirmedGrid.innerHTML = html;
    }
  }

  // 2. Render Preparing Grid
  if (preparingGrid) {
    if (preparingTickets.length === 0) {
      preparingGrid.innerHTML = `
        <div style="grid-column: 1/-1; padding: 2rem; text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 1rem;">
          No tickets currently in kitchen queue
        </div>
      `;
    } else {
      let html = visiblePreparing.map(item => {
        const etaLabel = typeof item.estimatedMinutes === 'number' && item.estimatedMinutes > 0
          ? `Est. ~${item.estimatedMinutes}m`
          : `Cooking 🔥`;

        return `
          <div class="token-card preparing">
            <div class="token-number">${escapeHtml(item.token || 'TB-???')}</div>
            <div class="token-eta">${etaLabel}</div>
          </div>
        `;
      }).join('');

      if (overflowPreparing > 0) {
        html += `
          <div class="token-overflow-pill preparing">
            +${overflowPreparing} more cooking...
          </div>
        `;
      }
      preparingGrid.innerHTML = html;
    }
  }

  // 3. Render Ready Grid
  if (readyGrid) {
    if (readyTickets.length === 0) {
      readyGrid.innerHTML = `
        <div style="grid-column: 1/-1; padding: 2rem; text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 1rem;">
          Ready orders will appear here
        </div>
      `;
    } else {
      let html = visibleReady.map(item => `
        <div class="token-card ready">
          <div class="token-number">${escapeHtml(item.token || 'TB-???')}</div>
          <div class="token-ready-label">COLLECT AT COUNTER 🟢</div>
        </div>
      `).join('');

      if (overflowReady > 0) {
        html += `
          <div class="token-overflow-pill ready">
            +${overflowReady} more ready...
          </div>
        `;
      }
      readyGrid.innerHTML = html;
    }
  }

  // Standby Overlay State: If total active count is 0, show Standby Card
  const totalActive = confirmedTickets.length + preparingTickets.length + readyTickets.length;
  if (totalActive === 0) {
    standbyOverlay.classList.remove('hidden');
  } else {
    standbyOverlay.classList.add('hidden');
  }
}

let lastDataReceivedAt = Date.now();
let lastFormattedUpdateTime = '';

// Check for stale data every 10 seconds (TB-TV-STALE-TIMER)
setInterval(() => {
  const elapsedSec = Math.floor((Date.now() - lastDataReceivedAt) / 1000);
  if (elapsedSec > 60) {
    statusPill.className = 'status-pill reconnecting';
    statusText.textContent = 'STALE DATA';
    reconnectBanner.textContent = `⚡️ Connection stale (${elapsedSec}s ago). Showing last known queue from ${lastFormattedUpdateTime || 'cache'}.`;
    reconnectBanner.classList.remove('hidden');
  }
}, 10000);

/**
 * Resilient Single-Document Firestore Listener with Clean Lifecycle and Exponential Backoff
 */
function startTVStream() {
  // Clean up any existing listener before creating a new one
  if (currentUnsubscribe) {
    try {
      currentUnsubscribe();
    } catch (_) {}
    currentUnsubscribe = null;
  }

  try {
    const queueDocRef = doc(db, 'publicLiveQueue', 'current');

    currentUnsubscribe = onSnapshot(
      queueDocRef,
      (snapshot) => {
        lastDataReceivedAt = Date.now();
        const d = new Date();
        const hrs = d.getHours() % 12 || 12;
        const mins = String(d.getMinutes()).padStart(2, '0');
        const secs = String(d.getSeconds()).padStart(2, '0');
        const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
        lastFormattedUpdateTime = `${hrs}:${mins}:${secs} ${ampm}`;

        // State 1: Live Stream Active
        statusPill.className = 'status-pill live';
        statusText.textContent = 'LIVE DISPATCH';
        reconnectBanner.textContent = '⚡️ Reconnecting to canteen server... Showing cached queue.';
        reconnectBanner.classList.add('hidden');
        
        // Reset exponential backoff on healthy snapshot
        reconnectDelayMs = 5000;

        if (snapshot.exists()) {
          renderQueueData(snapshot.data());
        } else {
          renderQueueData({ confirmed: [], preparing: [], ready: [] });
        }
      },
      (error) => {
        // State 2: Reconnecting / Stale Data State
        console.warn("TV Stream connection interrupted:", error);
        statusPill.className = 'status-pill reconnecting';
        statusText.textContent = 'RECONNECTING';
        reconnectBanner.classList.remove('hidden');

        // Exponential backoff
        const nextDelay = reconnectDelayMs;
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
        setTimeout(startTVStream, nextDelay);
      }
    );
  } catch (e) {
    console.warn("TV Init error:", e);
    statusPill.className = 'status-pill reconnecting';
    statusText.textContent = 'RECONNECTING';
    reconnectBanner.classList.remove('hidden');
    
    const nextDelay = reconnectDelayMs;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    setTimeout(startTVStream, nextDelay);
  }
}

// Start Stream
startTVStream();
