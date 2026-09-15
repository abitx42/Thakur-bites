// Thakur Bites — Dedicated Fullscreen Big-Screen TV Token Display
import { renderTvDisplayView } from './views/tvDisplayView.js?v=7';
import { initSecuritySentinel } from './securitySentinel.js?v=2';

initSecuritySentinel({ blockShortcuts: true, portalName: 'TV Display Board' });

function initTvApp() {
  const root = document.getElementById('app-root');
  if (!root) return;

  renderTvDisplayView(root);
}

window.addEventListener('DOMContentLoaded', initTvApp);
