// Thakur Bites — Dedicated Fullscreen Big-Screen TV Token Display
import { renderTvDisplayView } from './views/tvDisplayView.js?v=7';
import { initSecuritySentinel } from './securitySentinel.js?v=1';

initSecuritySentinel({ blockShortcuts: true });

function initTvApp() {
  const root = document.getElementById('app-root');
  if (!root) return;

  renderTvDisplayView(root);
}

window.addEventListener('DOMContentLoaded', initTvApp);
