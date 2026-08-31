import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  query, 
  where, 
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
 * Render Tokens into DOM
 */
function renderTokens(orders) {
  const preparingOrders = orders.filter(o => o.status === 'confirmed' || o.status === 'preparing' || o.status === 'placed');
  const readyOrders = orders.filter(o => o.status === 'ready');

  // Check for newly ready orders to trigger chime
  let hasNewReady = false;
  readyOrders.forEach(o => {
    const token = o.tokenNumber;
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
  const currentReadySet = new Set(readyOrders.map(o => o.tokenNumber));
  for (const t of knownReadyTokens) {
    if (!currentReadySet.has(t)) {
      knownReadyTokens.delete(t);
    }
  }

  // Update Counters
  preparingCountEl.textContent = preparingOrders.length;
  readyCountEl.textContent = readyOrders.length;

  // Render Preparing Grid
  if (preparingOrders.length === 0) {
    preparingGrid.innerHTML = `
      <div style="grid-column: 1/-1; padding: 2rem; text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 1rem;">
        No tickets currently in kitchen queue
      </div>
    `;
  } else {
    preparingGrid.innerHTML = preparingOrders.map(o => {
      const isPriority = (o.priorityLevel || 0) >= 2;
      const eta = o.estimatedMinutes || 6;
      return `
        <div class="token-card preparing ${isPriority ? 'is-priority' : ''}">
          ${isPriority ? '<div class="priority-crown">⭐️</div>' : ''}
          <div class="token-number">${escapeHtml(o.tokenNumber || 'TB-???')}</div>
          <div class="token-eta">Est. ~${eta}m</div>
        </div>
      `;
    }).join('');
  }

  // Render Ready Grid
  if (readyOrders.length === 0) {
    readyGrid.innerHTML = `
      <div style="grid-column: 1/-1; padding: 2rem; text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 1rem;">
        Ready orders will appear here
      </div>
    `;
  } else {
    readyGrid.innerHTML = readyOrders.map(o => {
      const isPriority = (o.priorityLevel || 0) >= 2;
      return `
        <div class="token-card ready ${isPriority ? 'is-priority' : ''}">
          ${isPriority ? '<div class="priority-crown">⭐️</div>' : ''}
          <div class="token-number">${escapeHtml(o.tokenNumber || 'TB-???')}</div>
          <div class="token-ready-label">COLLECT AT COUNTER</div>
        </div>
      `;
    }).join('');
  }

  // Standby Overlay State: If total active orders is 0, show Standby Card
  if (orders.length === 0) {
    standbyOverlay.classList.remove('hidden');
  } else {
    standbyOverlay.classList.add('hidden');
  }
}

/**
 * Resilient Firestore Listener with Auto-Reconnection
 */
function startTVStream() {
  try {
    const q = query(
      collection(db, 'orders'),
      where('status', 'in', ['confirmed', 'preparing', 'ready', 'placed'])
    );

    onSnapshot(
      q,
      (snapshot) => {
        // State 1: Live Stream Active
        statusPill.className = 'status-pill live';
        statusText.textContent = 'LIVE DISPATCH';
        reconnectBanner.classList.add('hidden');

        const orders = snapshot.docs.map(doc => ({
          id: doc.id,
          tokenNumber: doc.data().tokenNumber,
          status: doc.data().status,
          priorityLevel: doc.data().priorityLevel || 1,
          estimatedMinutes: doc.data().estimatedMinutes || 6,
          createdAt: doc.data().createdAt?.toDate?.() || new Date(),
        }));

        renderTokens(orders);
      },
      (error) => {
        // State 2: Reconnecting / Stale Data State (Graceful fallback)
        console.warn("TV Stream Connection interrupted:", error);
        statusPill.className = 'status-pill reconnecting';
        statusText.textContent = 'RECONNECTING';
        reconnectBanner.classList.remove('hidden');

        // Retry connection in 5 seconds
        setTimeout(startTVStream, 5000);
      }
    );
  } catch (e) {
    console.warn("TV Init error, retrying in 5s:", e);
    statusPill.className = 'status-pill reconnecting';
    statusText.textContent = 'RECONNECTING';
    reconnectBanner.classList.remove('hidden');
    setTimeout(startTVStream, 5000);
  }
}

// Start Stream
startTVStream();
