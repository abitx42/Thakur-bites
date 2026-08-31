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

const app = initializeApp(firebaseConfig, 'TB_TV_DISPLAY');
const db = getFirestore(app);

// DOM Elements
const preparingGrid = document.getElementById('preparing-grid');
const readyGrid = document.getElementById('ready-grid');
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

// Initialize Web Audio API on first user interaction
function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioBanner) audioBanner.classList.add('hidden');
  }
}

document.body.addEventListener('click', initAudio, { once: true });
document.body.addEventListener('keydown', initAudio, { once: true });

/**
 * Synthesizes a clean, pleasant two-tone counter chime (800Hz -> 1060Hz)
 * Zero external MP3 downloads or network dependencies.
 */
function playReadyChime() {
  if (!audioContext) return;

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
 * Render Tokens from the single sanitized publicLiveQueue/current projection
 */
function renderQueueData(data) {
  const preparingTickets = Array.isArray(data?.preparing) ? data.preparing : [];
  const readyTickets = Array.isArray(data?.ready) ? data.ready : [];

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
  preparingCountEl.textContent = preparingTickets.length;
  readyCountEl.textContent = readyTickets.length;

  // Render Preparing Grid
  if (preparingTickets.length === 0) {
    preparingGrid.innerHTML = `
      <div style="grid-column: 1/-1; padding: 2rem; text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 1rem;">
        No tickets currently in kitchen queue
      </div>
    `;
  } else {
    preparingGrid.innerHTML = preparingTickets.map(item => {
      const etaLabel = typeof item.estimatedMinutes === 'number' && item.estimatedMinutes > 0
        ? `Est. ~${item.estimatedMinutes}m`
        : `Est. Pending`;

      return `
        <div class="token-card preparing">
          <div class="token-number">${escapeHtml(item.token || 'TB-???')}</div>
          <div class="token-eta">${etaLabel}</div>
        </div>
      `;
    }).join('');
  }

  // Render Ready Grid
  if (readyTickets.length === 0) {
    readyGrid.innerHTML = `
      <div style="grid-column: 1/-1; padding: 2rem; text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 1rem;">
        Ready orders will appear here
      </div>
    `;
  } else {
    readyGrid.innerHTML = readyTickets.map(item => {
      return `
        <div class="token-card ready">
          <div class="token-number">${escapeHtml(item.token || 'TB-???')}</div>
          <div class="token-ready-label">COLLECT AT COUNTER</div>
        </div>
      `;
    }).join('');
  }

  // Standby Overlay State: If total active count is 0, show Standby Card
  const totalActive = preparingTickets.length + readyTickets.length;
  if (totalActive === 0) {
    standbyOverlay.classList.remove('hidden');
  } else {
    standbyOverlay.classList.add('hidden');
  }
}

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
        // State 1: Live Stream Active
        statusPill.className = 'status-pill live';
        statusText.textContent = 'LIVE DISPATCH';
        reconnectBanner.classList.add('hidden');
        
        // Reset exponential backoff on healthy snapshot
        reconnectDelayMs = 5000;

        if (snapshot.exists()) {
          renderQueueData(snapshot.data());
        } else {
          renderQueueData({ preparing: [], ready: [] });
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
