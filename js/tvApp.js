// Thakur Bites — Dedicated Fullscreen Big-Screen TV Token Display
import { renderTvDisplayView } from './views/tvDisplayView.js?v=5';

function initTvApp() {
  const root = document.getElementById('app-root');
  if (!root) return;

  renderTvDisplayView(root);
}

window.addEventListener('DOMContentLoaded', initTvApp);
