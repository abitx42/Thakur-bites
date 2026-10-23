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

// Voice Announcement Engine (Web Speech API)
const voiceToggleBtn = document.getElementById('voice-toggle-btn');
const voiceToggleIcon = document.getElementById('voice-toggle-icon');
const voiceToggleText = document.getElementById('voice-toggle-text');

let speechEnabled = localStorage.getItem('tb_tv_speech_enabled') !== 'false';
const recentlyAnnouncedTokens = new Set();

function updateVoiceToggleUI() {
  if (!voiceToggleBtn) return;
  if (speechEnabled) {
    voiceToggleBtn.classList.remove('muted');
    if (voiceToggleIcon) voiceToggleIcon.textContent = '📢';
    if (voiceToggleText) voiceToggleText.textContent = 'Voice: ON';
  } else {
    voiceToggleBtn.classList.add('muted');
    if (voiceToggleIcon) voiceToggleIcon.textContent = '🔇';
    if (voiceToggleText) voiceToggleText.textContent = 'Voice: MUTED';
  }
}

if (voiceToggleBtn) {
  voiceToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    initAudio();
    speechEnabled = !speechEnabled;
    localStorage.setItem('tb_tv_speech_enabled', String(speechEnabled));
    updateVoiceToggleUI();
    if (speechEnabled && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const testUtterance = new SpeechSynthesisUtterance('Voice announcements enabled');
      testUtterance.rate = 1.0;
      testUtterance.lang = 'en-IN';
      window.speechSynthesis.speak(testUtterance);
    }
  });
  updateVoiceToggleUI();
}

/**
 * Speaks newly ready token numbers aloud via Web Speech API (TTS)
 */
function speakReadyTokens(tokens) {
  if (!speechEnabled || !('speechSynthesis' in window)) return;
  if (!tokens || tokens.length === 0) return;

  // Wait 650ms for two-tone audio chime to finish before speaking
  setTimeout(() => {
    try {
      window.speechSynthesis.cancel();

      // Format token numbers naturally (e.g. TB-042 -> "Token 42")
      const spokenTokens = tokens.map(t => {
        const clean = t.replace(/^TB-?0*/i, '');
        return `Token ${clean}`;
      }).join(', and ');

      const message = `${spokenTokens}, please collect at the counter.`;
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 0.95;
      utterance.pitch = 1.05;
      utterance.lang = 'en-IN';

      const voices = window.speechSynthesis.getVoices();
      const inVoice = voices.find(v => v.lang.includes('en-IN') || v.lang.includes('hi-IN')) || voices.find(v => v.lang.startsWith('en'));
      if (inVoice) utterance.voice = inVoice;

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("Speech synthesis notice:", e);
    }
  }, 650);
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

/**
 * Validates and sanitizes queue token strings to guarantee strict compliance
 * with campus token format (TB-XXX or 2-12 alphanumeric characters).
 * Defends against unexpected control characters or DOM layout distortion attacks.
 */
function sanitizeToken(token) {
  if (!token || typeof token !== 'string') return 'TB-???';
  const clean = token.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  return clean.length >= 2 ? clean : 'TB-???';
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

  // Check for newly ready orders to trigger chime & voice callout
  let hasNewReady = false;
  const newlyReadyTokens = [];
  readyTickets.forEach(item => {
    const token = item.token;
    if (token && !knownReadyTokens.has(token)) {
      knownReadyTokens.add(token);
      if (!isFirstLoad) {
        hasNewReady = true;
        newlyReadyTokens.push(token);
        recentlyAnnouncedTokens.add(token);
        setTimeout(() => {
          recentlyAnnouncedTokens.delete(token);
          if (readyGrid) {
            const el = readyGrid.querySelector(`[data-token="${token}"]`);
            if (el) el.classList.remove('fresh-ready-pulse');
          }
        }, 12000);
      }
    }
  });

  if (hasNewReady) {
    playReadyChime();
    speakReadyTokens(newlyReadyTokens);
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
          <div class="token-number">${escapeHtml(sanitizeToken(item.token))}</div>
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
            <div class="token-number">${escapeHtml(sanitizeToken(item.token))}</div>
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
      let html = visibleReady.map(item => {
        const isFresh = recentlyAnnouncedTokens.has(item.token);
        return `
          <div class="token-card ready ${isFresh ? 'fresh-ready-pulse' : ''}" data-token="${escapeHtml(sanitizeToken(item.token))}">
            <div class="token-number">${escapeHtml(sanitizeToken(item.token))}</div>
            <div class="token-ready-label">${isFresh ? '⚡ JUST READY NOW 🟢' : 'COLLECT AT COUNTER 🟢'}</div>
          </div>
        `;
      }).join('');

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

let isStreamHealthy = false;
let lastDataReceivedAt = Date.now();
let lastFormattedUpdateTime = '';

// Check for network drop or silent stream freeze every 10 seconds
setInterval(() => {
  if (!navigator.onLine) {
    statusPill.className = 'status-pill reconnecting';
    statusText.textContent = 'OFFLINE';
    reconnectBanner.textContent = '⚠️ No Internet Connection — TV Display is offline. Please check canteen Wi-Fi/network.';
    reconnectBanner.classList.remove('hidden');
    return;
  }

  if (!isStreamHealthy) {
    statusPill.className = 'status-pill reconnecting';
    statusText.textContent = 'RECONNECTING';
    reconnectBanner.textContent = '⚡️ Reconnecting to canteen server... Showing cached queue.';
    reconnectBanner.classList.remove('hidden');
    return;
  }

  // Guard against silent stream socket freezes:
  // If more than 10 minutes elapsed without any snapshot, actively restart stream to ensure websocket isn't stale
  const elapsedSec = Math.floor((Date.now() - lastDataReceivedAt) / 1000);
  if (elapsedSec > 600) {
    console.log('[TV] Proactively refreshing live stream subscription...');
    startTVStream();
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
      { includeMetadataChanges: true },
      (snapshot) => {
        const isFromCache = snapshot.metadata ? snapshot.metadata.fromCache : false;
        if (!isFromCache) {
          lastDataReceivedAt = Date.now();
          isStreamHealthy = true;
        }

        const d = new Date();
        const hrs = d.getHours() % 12 || 12;
        const mins = String(d.getMinutes()).padStart(2, '0');
        const secs = String(d.getSeconds()).padStart(2, '0');
        const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
        lastFormattedUpdateTime = `${hrs}:${mins}:${secs} ${ampm}`;

        if (isFromCache || !navigator.onLine) {
          // Serving from offline cache
          statusPill.className = 'status-pill reconnecting';
          statusText.textContent = navigator.onLine ? 'OFFLINE CACHE' : 'OFFLINE';
          reconnectBanner.textContent = navigator.onLine
            ? `⚡️ Reconnecting to canteen server... Showing cached queue from ${lastFormattedUpdateTime || 'cache'}.`
            : '⚠️ No Internet Connection — TV Display is offline. Please check canteen Wi-Fi/network.';
          reconnectBanner.classList.remove('hidden');
        } else {
          // State 1: Live Stream Active
          statusPill.className = 'status-pill live';
          statusText.textContent = 'LIVE DISPATCH';
          reconnectBanner.textContent = '⚡️ Reconnecting to canteen server... Showing cached queue.';
          reconnectBanner.classList.add('hidden');
        }
        
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
        isStreamHealthy = false;
        console.warn("TV Stream connection interrupted:", error);
        statusPill.className = 'status-pill reconnecting';
        statusText.textContent = navigator.onLine ? 'RECONNECTING' : 'OFFLINE';
        reconnectBanner.textContent = navigator.onLine 
          ? '⚡️ Reconnecting to canteen server... Showing cached queue.' 
          : '⚠️ No Internet Connection — TV Display is offline. Please check canteen Wi-Fi/network.';
        reconnectBanner.classList.remove('hidden');

        // Exponential backoff
        const nextDelay = reconnectDelayMs;
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
        setTimeout(startTVStream, nextDelay);
      }
    );
  } catch (e) {
    isStreamHealthy = false;
    console.warn("TV Init error:", e);
    statusPill.className = 'status-pill reconnecting';
    statusText.textContent = navigator.onLine ? 'RECONNECTING' : 'OFFLINE';
    reconnectBanner.textContent = navigator.onLine
      ? '⚡️ Reconnecting to canteen server... Showing cached queue.'
      : '⚠️ No Internet Connection — TV Display is offline. Please check canteen Wi-Fi/network.';
    reconnectBanner.classList.remove('hidden');
    
    const nextDelay = reconnectDelayMs;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    setTimeout(startTVStream, nextDelay);
  }
}

// Real-time network connectivity listeners
window.addEventListener('offline', () => {
  statusPill.className = 'status-pill reconnecting';
  statusText.textContent = 'OFFLINE';
  reconnectBanner.textContent = '⚠️ No Internet Connection — TV Display is offline. Please check canteen Wi-Fi/network.';
  reconnectBanner.classList.remove('hidden');
});

window.addEventListener('online', () => {
  statusText.textContent = 'CONNECTING...';
  reconnectBanner.textContent = '⚡️ Internet Restored! Reconnecting live queue...';
  reconnectDelayMs = 1000;
  startTVStream();
});

// Start Stream
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startTVStream);
} else {
  startTVStream();
}
