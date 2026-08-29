// Thakur Bites Main Application Entry Point
import { appState } from './state.js';
import { renderStudentView } from './views/studentView.js';
import { renderKitchenView } from './views/kitchenView.js';
import { renderTvDisplayView } from './views/tvDisplayView.js';
import { renderAdminView } from './views/adminView.js';

function initApp() {
  const root = document.getElementById('app-root');
  if (!root) return;

  function render() {
    const { currentRole } = appState;

    root.innerHTML = `
      <!-- App Header -->
      <header class="app-header">
        <div class="header-container">
          <div class="brand-badge">
            <div class="brand-logo">TB</div>
            <div class="brand-text">
              <h1>THAKUR BITES</h1>
              <span>TCET / TSA Canteen Hub</span>
            </div>
          </div>

          <!-- Multi-Role Switcher -->
          <nav class="role-switcher">
            <button class="role-btn ${currentRole === 'student' ? 'active' : ''}" data-role="student">
              <span>📱</span>
              <span>Student App</span>
            </button>
            <button class="role-btn ${currentRole === 'kitchen' ? 'active' : ''}" data-role="kitchen">
              <span>🍳</span>
              <span>Kitchen KDS</span>
            </button>
            <button class="role-btn ${currentRole === 'tv_display' ? 'active' : ''}" data-role="tv_display">
              <span>📺</span>
              <span>Token TV Screen</span>
            </button>
            <button class="role-btn ${currentRole === 'admin' ? 'active' : ''}" data-role="admin">
              <span>⚙️</span>
              <span>Daily Board</span>
            </button>
          </nav>
        </div>
      </header>

      <!-- Main View Mount Target -->
      <main id="view-target"></main>
    `;

    // Attach role switcher events
    root.querySelectorAll('.role-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetRole = btn.getAttribute('data-role');
        appState.setRole(targetRole);
      });
    });

    // Mount active view
    const viewTarget = document.getElementById('view-target');
    if (currentRole === 'student') {
      renderStudentView(viewTarget);
    } else if (currentRole === 'kitchen') {
      renderKitchenView(viewTarget);
    } else if (currentRole === 'tv_display') {
      renderTvDisplayView(viewTarget);
    } else if (currentRole === 'admin') {
      renderAdminView(viewTarget);
    }
  }

  // Subscribe to reactive state updates
  appState.subscribe(() => {
    const viewTarget = document.getElementById('view-target');
    if (!viewTarget) {
      render();
      return;
    }

    // Update active view
    if (appState.currentRole === 'student') {
      renderStudentView(viewTarget);
    } else if (appState.currentRole === 'kitchen') {
      renderKitchenView(viewTarget);
    } else if (appState.currentRole === 'tv_display') {
      renderTvDisplayView(viewTarget);
    } else if (appState.currentRole === 'admin') {
      renderAdminView(viewTarget);
    }

    // Update active role button styling in header
    document.querySelectorAll('.role-btn').forEach(btn => {
      if (btn.getAttribute('data-role') === appState.currentRole) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  });

  render();
}

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', initApp);
