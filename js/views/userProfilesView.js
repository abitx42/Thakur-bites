// Thakur Bites Platform 2.0 — User Profiles & Role Management View
// Master Role Management & Engineering Governance
import { db, auth, functions } from '../firebase.js?v=5';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  getDocsFromServer
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { escapeHtml } from './escapeHtml.js';
import { staffAuth, getPrivilegedSession, onStaffAuthStateChanged } from '../auth.js?v=12';

let unsubscribeUsers = null;
let unsubscribeStaffUsers = null;
let allUsers = new Map(); // uid -> userData
let allStaffUsers = new Map(); // uid -> staffData
let searchQuery = '';
let selectedRoleFilter = 'ALL'; // 'ALL' | 'ADMINS' | 'STAFF' | 'PRIORITY' | 'STUDENTS' | 'SUSPENDED'
let actionLoadingUid = null;
let statusFeedback = null; // { type: 'success' | 'error' | 'info', text: string }
let unsubscribeAuth = null;
let feedbackTimeout = null;
let viewRevision = 0;
let activeContainer = null;
const ADMIN_ROLES = ['manager', 'admin', 'developer', 'security_admin', 'system'];
const ASSIGNABLE_ROLES = ['customer', 'student', 'kitchen', 'pickup', 'cashier', 'manager', 'admin', 'developer', 'security_admin'];

export function cleanupUserProfilesView() {
  ++viewRevision;
  if (unsubscribeUsers) {
    unsubscribeUsers();
    unsubscribeUsers = null;
  }
  if (unsubscribeStaffUsers) {
    unsubscribeStaffUsers();
    unsubscribeStaffUsers = null;
  }
  if (unsubscribeAuth) { unsubscribeAuth(); unsubscribeAuth = null; }
  if (feedbackTimeout !== null) { clearTimeout(feedbackTimeout); feedbackTimeout = null; }
  allUsers.clear();
  allStaffUsers.clear();
  searchQuery = '';
  selectedRoleFilter = 'ALL';
  actionLoadingUid = null;
  statusFeedback = null;
  if (activeContainer) { activeContainer.innerHTML = ''; activeContainer = null; }
}

export function renderUserProfilesView(container) {
  cleanupUserProfilesView();
  activeContainer = container;
  const revision = viewRevision;
  const actorUid = auth.currentUser?.uid;

  function stopDirectory(message) {
    if (revision !== viewRevision) return;
    cleanupUserProfilesView();
    container.innerHTML = `<div role="alert" style="padding: 1.5rem;">${escapeHtml(message)}</div>`;
  }

  function isCurrentView() {
    if (revision !== viewRevision) return false;
    if (!actorUid || auth.currentUser?.uid !== actorUid || !staffAuth.isAuthenticated()
        || !ADMIN_ROLES.includes(staffAuth.getRole())) {
      stopDirectory('User directory access requires a current administrative sign-in. Sign in and reload the directory.');
      return false;
    }
    return true;
  }

  if (!isCurrentView()) return;

  function showStatus(text, type = 'info', duration = 4000) {
    if (!isCurrentView()) return;
    if (feedbackTimeout !== null) clearTimeout(feedbackTimeout);
    statusFeedback = { text, type };
    render();
    if (duration > 0) {
      feedbackTimeout = setTimeout(() => {
        if (isCurrentView() && statusFeedback && statusFeedback.text === text) {
          statusFeedback = null;
          render();
        }
      }, duration);
    }
  }

  // Dual listener: Listen to 'users' and 'staffUsers'
  const failDirectory = error => {
    console.error('[UserProfilesView] User directory read failed:', error);
    stopDirectory('Unable to load user records. Check your authorization and connection, then reload the directory.');
  };
  try {
    const usersCol = collection(db, 'users');
    unsubscribeUsers = onSnapshot(usersCol, (snapshot) => {
      if (!isCurrentView()) return;
      allUsers = new Map(snapshot.docs.map(record => [record.id, { ...record.data(), id: record.id, uid: record.id }]));
      render();
    }, failDirectory);

    const staffCol = collection(db, 'staffUsers');
    unsubscribeStaffUsers = onSnapshot(staffCol, (snapshot) => {
      if (!isCurrentView()) return;
      allStaffUsers = new Map(snapshot.docs.map(record => [record.id, { ...record.data(), id: record.id, uid: record.id }]));
      render();
    }, failDirectory);
    unsubscribeAuth = onStaffAuthStateChanged(() => { isCurrentView(); });
  } catch (err) {
    failDirectory(err);
  }

  async function updateUserRole(uid, newRole, existingData = {}) {
    if (!isCurrentView()) return false;
    const session = getPrivilegedSession();
    if (!session?.sessionId) {
      showStatus('Activate a current MFA privileged session before assigning staff roles.', 'error');
      return false;
    }
    if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/') || uid !== uid.trim()
        || !ASSIGNABLE_ROLES.includes(newRole)) {
      showStatus('A valid existing Firebase UID and canonical role are required.', 'error');
      return false;
    }
    actionLoadingUid = uid;
    render();
    try {
      const email = existingData.email || '';
      const displayName = existingData.displayName || existingData.name || email.split('@')[0] || 'User';

      const assignFn = httpsCallable(functions, 'assignStaffRole');
      const result = await assignFn({ targetUid: uid, newRole, privilegedSessionId: session.sessionId });
      if (!isCurrentView()) return false;
      if (result.data?.success !== true || result.data.targetUid !== uid || result.data.assignedRole !== newRole) {
        throw new Error('The server did not confirm this role assignment. Refresh records before retrying.');
      }
      showStatus(`Successfully updated role to "${newRole.toUpperCase()}" for ${displayName}`, 'success');
      return true;
    } catch (err) {
      console.error('[UserProfilesView] Role update error:', err);
      showStatus(`Error updating role: ${err.message || err}`, 'error');
      return false;
    } finally {
      if (isCurrentView()) { actionLoadingUid = null; render(); }
    }
  }

  async function handleQuickAssign(e) {
    e.preventDefault();
    if (!isCurrentView()) return;
    const form = e.target;
    const identifier = (form.identifier.value || '').trim();
    const role = form.role.value;

    if (!identifier) {
      showStatus('Please enter an Email or User UID.', 'error');
      return;
    }

    showStatus(`Assigning role ${role.toUpperCase()} to ${identifier}...`, 'info', 10000);

    // Look in current users
    let targetUid = null;
    let targetData = null;

    for (const [uid, u] of allUsers.entries()) {
      if (uid === identifier || (u.email && u.email.toLowerCase() === identifier.toLowerCase())) {
        targetUid = uid;
        targetData = u;
        break;
      }
    }

    if (!targetUid) {
      for (const [uid, s] of allStaffUsers.entries()) {
        if (uid === identifier || (s.email && s.email.toLowerCase() === identifier.toLowerCase())) {
          targetUid = uid;
          targetData = s;
          break;
        }
      }
    }

    if (!targetUid) {
      if (identifier.includes('@')) {
        try {
          for (const collectionName of ['users', 'staffUsers']) {
            const q = query(collection(db, collectionName), where('email', '==', identifier.toLowerCase()));
            const snap = await getDocsFromServer(q);
            if (!isCurrentView()) return;
            if (snap.docs.length > 1) throw new Error('Multiple accounts match this email. Use the verified Firebase UID.');
            if (snap.docs.length === 1) {
              targetUid = snap.docs[0].id;
              targetData = snap.docs[0].data();
              break;
            }
          }
        } catch (error) {
          showStatus(`Account lookup failed: ${error.message || error}`, 'error');
          return;
        }
        if (!targetUid) {
          showStatus('No registered account was found for this email. Ask the user to sign in first, or enter their verified Firebase UID.', 'error');
          return;
        }
      } else {
        // Explicit UIDs are verified by assignStaffRole against Firebase Auth.
        targetUid = identifier;
        targetData = { displayName: identifier };
      }
    }

    await updateUserRole(targetUid, role, targetData || {});
  }

  function getMergedUsersList() {
    const map = new Map();

    allUsers.forEach((u, uid) => {
      map.set(uid, { ...u });
    });

    allStaffUsers.forEach((s, uid) => {
      const existing = map.get(uid) || {};
      map.set(uid, {
        ...existing,
        ...s,
        role: s.role || existing.role || 'staff',
        email: s.email || existing.email || '',
        displayName: s.displayName || existing.displayName || existing.name || '',
      });
    });

    return Array.from(map.values());
  }

  function render() {
    if (!isCurrentView()) return;
    const mergedUsers = getMergedUsersList();
    const cleanSearch = (searchQuery || '').trim().toLowerCase();

    const filteredUsers = mergedUsers.filter(u => {
      const role = (u.role || 'student').toLowerCase();
      const isPriority = Number.isInteger(u.priorityLevel) && u.priorityLevel >= 2;
      const isDisabled = Boolean(u.accountDisabled);

      // Category / Tab filter
      if (selectedRoleFilter === 'ADMINS') {
        if (!['admin', 'manager', 'developer', 'security_admin'].includes(role)) return false;
      } else if (selectedRoleFilter === 'STAFF') {
        if (!['kitchen', 'pickup', 'cashier', 'staff', 'kitchen_staff', 'pickup_staff'].includes(role)) return false;
      } else if (selectedRoleFilter === 'PRIORITY') {
        if (!isPriority) return false;
      } else if (selectedRoleFilter === 'STUDENTS') {
        if (role !== 'student' && role !== '') return false;
      } else if (selectedRoleFilter === 'SUSPENDED') {
        if (!isDisabled) return false;
      }

      // Search filter
      if (cleanSearch) {
        const name = (u.displayName || u.name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const roll = (u.rollNo || u.employeeId || '').toLowerCase();
        const dept = (u.department || '').toLowerCase();
        const uid = (u.uid || u.id || '').toLowerCase();

        return name.includes(cleanSearch) || 
               email.includes(cleanSearch) || 
               roll.includes(cleanSearch) || 
               dept.includes(cleanSearch) ||
               uid.includes(cleanSearch);
      }

      return true;
    });

    // Counts for stats
    const totalCount = mergedUsers.length;
    const adminCount = mergedUsers.filter(u => ['admin', 'manager', 'developer', 'security_admin'].includes((u.role || '').toLowerCase())).length;
    const staffCount = mergedUsers.filter(u => ['kitchen', 'pickup', 'cashier', 'staff', 'kitchen_staff', 'pickup_staff'].includes((u.role || '').toLowerCase())).length;
    const priorityCount = mergedUsers.filter(u => Number.isInteger(u.priorityLevel) && u.priorityLevel >= 2).length;

    container.innerHTML = `
      <div style="max-width: 1400px; margin: 0 auto; padding: 1.5rem 1rem;">
        
        <!-- Header & Co-Pilot Identity -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.6rem;">👥</span>
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; color: var(--ink-primary); line-height: 1;">
                USER PROFILES & ROLE DELEGATION
              </h2>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.88rem; color: var(--ink-secondary); margin: 6px 0 0 0;">
              Real-time user directory and server-validated staff role assignments with MFA.
            </p>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="dev-verify-self-btn" disabled title="Self-promotion is unavailable. Contact another trusted administrator." class="btn btn--secondary btn--sm">
              Self-promotion unavailable
            </button>
            <button id="refresh-users-btn" class="btn btn--secondary btn--sm" style="display: flex; align-items: center; gap: 4px;">
              <span>🔄</span> Refresh
            </button>
          </div>
        </div>

        <div role="note" style="padding: 1rem; margin-bottom: 1.5rem; border: 1px solid var(--border-light); border-radius: 8px;">
          Staff roles require an active privileged MFA session and server approval.
          Faculty priority follows the verified application flow; priority overrides are unavailable here.
          Account suspension/reactivation must use trusted account administration.
          This directory cannot grant master access or promote your own account.
        </div>

        <!-- Status Feedback Notice -->
        ${statusFeedback ? `
          <div style="margin-bottom: 1.25rem; padding: 10px 16px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: ${statusFeedback.type === 'error' ? '#FEE2E2' : statusFeedback.type === 'success' ? '#DCFCE7' : '#EFF6FF'}; color: ${statusFeedback.type === 'error' ? '#DC2626' : statusFeedback.type === 'success' ? '#166534' : '#1D4ED8'}; border: 1.5px solid ${statusFeedback.type === 'error' ? '#FCA5A5' : statusFeedback.type === 'success' ? '#86EFAC' : '#BFDBFE'};">
            <span>${statusFeedback.type === 'error' ? '⚠️' : statusFeedback.type === 'success' ? '✅' : 'ℹ️'} ${escapeHtml(statusFeedback.text)}</span>
            <button id="close-feedback-btn" style="background: none; border: none; cursor: pointer; color: inherit; font-size: 1rem; font-weight: 800;">✕</button>
          </div>
        ` : ''}

        <!-- Stats Bar & Quick Promote Card -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          
          <!-- Metrics -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 10px; padding: 1rem; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--ink-secondary); font-weight: 700; text-transform: uppercase;">Total Users</div>
              <div style="font-family: var(--font-display); font-size: 2.2rem; color: var(--ink-primary); line-height: 1.1;">${totalCount}</div>
            </div>
            <div style="background: #FFF; border: 1.5px solid #FCA5A5; border-radius: 10px; padding: 1rem; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 0.72rem; color: #DC2626; font-weight: 700; text-transform: uppercase;">Admins & Mgrs</div>
              <div style="font-family: var(--font-display); font-size: 2.2rem; color: #DC2626; line-height: 1.1;">${adminCount}</div>
            </div>
            <div style="background: #FFF; border: 1.5px solid #FDE68A; border-radius: 10px; padding: 1rem; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 0.72rem; color: #D97706; font-weight: 700; text-transform: uppercase;">Station Staff</div>
              <div style="font-family: var(--font-display); font-size: 2.2rem; color: #D97706; line-height: 1.1;">${staffCount}</div>
            </div>
            <div style="background: #FFF; border: 1.5px solid #BBF7D0; border-radius: 10px; padding: 1rem; text-align: center;">
              <div style="font-family: var(--font-mono); font-size: 0.72rem; color: #16A34A; font-weight: 700; text-transform: uppercase;">Faculty Priority</div>
              <div style="font-family: var(--font-display); font-size: 2.2rem; color: #16A34A; line-height: 1.1;">${priorityCount}</div>
            </div>
          </div>

          <!-- Quick Promote / Grant Tool -->
          <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 10px; padding: 1rem 1.25rem; display: flex; flex-direction: column; justify-content: center;">
            <div style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; color: var(--ink-secondary); text-transform: uppercase; margin-bottom: 6px;">
              ⚡ Quick Role Grant / Elevation
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.8rem; color: var(--ink-secondary); margin: 0 0 10px 0;">
              Promote any student or staff member by entering their college email address or UID:
            </p>
            <form id="quick-assign-form" style="display: flex; gap: 6px; flex-wrap: wrap;">
              <input 
                type="text" 
                name="identifier" 
                placeholder="email@tcetmumbai.in or UID" 
                required
                style="flex: 2; min-width: 160px; padding: 7px 10px; border-radius: 6px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.85rem;"
              />
              <select 
                name="role"
                style="flex: 1; min-width: 105px; padding: 7px 8px; border-radius: 6px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.8rem; background: #FFF;"
              >
                <option value="admin">👑 Admin</option>
                <option value="manager">👔 Manager</option>
                <option value="kitchen">🍳 Kitchen</option>
                <option value="pickup">📦 Pickup</option>
                <option value="cashier">💵 Cashier</option>
                <option value="student">🎓 Student</option>
              </select>
              <button 
                type="submit" 
                class="btn btn--primary btn--sm" 
                style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700;"
              >
                Apply Role
              </button>
            </form>
          </div>
        </div>

        <!-- Controls: Search & Category Filter Tabs -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 10px; padding: 10px 14px; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          
          <!-- Filter Tabs -->
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            ${[
              { id: 'ALL', label: `All (${totalCount})` },
              { id: 'ADMINS', label: `👑 Admins (${adminCount})` },
              { id: 'STAFF', label: `🍳 Staff (${staffCount})` },
              { id: 'PRIORITY', label: `⭐ Priority (${priorityCount})` },
              { id: 'STUDENTS', label: `🎓 Students` },
              { id: 'SUSPENDED', label: `⛔ Suspended` }
            ].map(tab => `
              <button 
                class="profile-filter-btn" 
                data-filter="${tab.id}"
                style="padding: 6px 12px; border-radius: 6px; border: 1px solid ${selectedRoleFilter === tab.id ? 'var(--brand-red)' : 'var(--border-light)'}; background: ${selectedRoleFilter === tab.id ? 'var(--brand-red)' : 'transparent'}; color: ${selectedRoleFilter === tab.id ? '#FFF' : 'var(--ink-secondary)'}; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer; transition: all 0.15s ease;"
              >
                ${tab.label}
              </button>
            `).join('')}
          </div>

          <!-- Search Input -->
          <div style="position: relative; min-width: 250px; flex-grow: 1; max-width: 400px;">
            <input 
              type="text" 
              id="profiles-search-input" 
              placeholder="🔍 Search name, email, roll no, UID..." 
              value="${escapeHtml(searchQuery)}"
              style="width: 100%; box-sizing: border-box; padding: 7px 12px; border-radius: 6px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.85rem;"
            />
          </div>
        </div>

        <!-- Users Directory Table -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
          ${filteredUsers.length === 0 ? `
            <div style="text-align: center; padding: 4rem 2rem;">
              <div style="font-size: 3rem; margin-bottom: 0.5rem;">🔍</div>
              <div style="font-family: var(--font-display); font-size: 1.4rem; color: var(--ink-secondary);">No Users Found</div>
              <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
                Try adjusting your search criteria or role filters above.
              </p>
            </div>
          ` : `
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; text-align: left; font-family: var(--font-sans);">
                <thead>
                  <tr style="background: var(--bg-surface); border-bottom: 2px solid var(--border-light); font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); text-transform: uppercase;">
                    <th style="padding: 12px 16px;">User / Identity</th>
                    <th style="padding: 12px 16px;">Role</th>
                    <th style="padding: 12px 16px;">College Info</th>
                    <th style="padding: 12px 16px;">Priority / Queue</th>
                    <th style="padding: 12px 16px; text-align: right;">Admin Governance</th>
                  </tr>
                </thead>
                <tbody>
                  ${filteredUsers.map(user => {
                    const uid = user.uid || user.id;
                    const role = (user.role || 'student').toLowerCase();
                    const isAdmin = ['admin', 'manager', 'developer', 'security_admin'].includes(role);
                    const isDev = role === 'developer' || role === 'security_admin' || role === 'system';
                    const isPriority = Number.isInteger(user.priorityLevel) && user.priorityLevel >= 2;
                    const isDisabled = Boolean(user.accountDisabled);
                    const isLoading = actionLoadingUid === uid;

                    // Initials
                    const displayName = user.displayName || user.name || (user.email ? user.email.split('@')[0] : 'Unknown');
                    const initial = displayName.charAt(0).toUpperCase() || 'U';

                    return `
                      <tr style="border-bottom: 1px solid var(--border-light); background: ${isDisabled ? '#FEF2F2' : '#FFF'}; transition: background 0.15s ease;">
                        
                        <!-- User / Identity -->
                        <td style="padding: 12px 16px; vertical-align: middle;">
                          <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 40px; height: 40px; border-radius: 50%; background: ${isDev ? '#312E81' : isAdmin ? '#FEE2E2' : '#F1F5F9'}; color: ${isDev ? '#A5B4FC' : isAdmin ? '#DC2626' : '#475569'}; display: flex; align-items: center; justify-content: center; font-weight: 800; font-family: var(--font-mono); font-size: 1rem; border: 1.5px solid ${isDev ? '#6366F1' : isAdmin ? '#FCA5A5' : '#CBD5E1'}; flex-shrink: 0;">
                              ${initial}
                            </div>
                            <div>
                              <div style="font-weight: 700; color: var(--ink-primary); font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">
                                ${escapeHtml(displayName)}
                                ${isDev ? `
                                  <span style="background: #312E81; color: #818CF8; border: 1px solid #6366F1; font-family: var(--font-mono); font-size: 0.65rem; padding: 1px 6px; border-radius: 4px; font-weight: 800;">
                                    LEAD DEVELOPER
                                  </span>
                                ` : ''}
                                ${isDisabled ? `
                                  <span style="background: #FEE2E2; color: #DC2626; font-family: var(--font-mono); font-size: 0.65rem; padding: 1px 6px; border-radius: 4px; font-weight: 800;">
                                    SUSPENDED
                                  </span>
                                ` : ''}
                              </div>
                              <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--ink-secondary); margin-top: 2px;">
                                ${escapeHtml(user.email || 'No email associated')}
                              </div>
                              <div style="font-family: var(--font-mono); font-size: 0.68rem; color: #94A3B8; margin-top: 1px;">
                                UID: <code style="font-size: 0.68rem;">${escapeHtml(uid)}</code>
                              </div>
                            </div>
                          </div>
                        </td>

                        <!-- Role -->
                        <td style="padding: 12px 16px; vertical-align: middle;">
                          <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                            <span style="
                              font-family: var(--font-mono);
                              font-size: 0.75rem;
                              font-weight: 800;
                              padding: 3px 8px;
                              border-radius: 6px;
                              text-transform: uppercase;
                              display: inline-flex;
                              align-items: center;
                              gap: 4px;
                              background: ${
                                isDev ? '#312E81' :
                                role === 'admin' ? '#FEE2E2' :
                                role === 'manager' ? '#FEF3C7' :
                                role === 'kitchen' ? '#FFEDD5' :
                                role === 'pickup' ? '#E0F2FE' :
                                role === 'cashier' ? '#DCFCE7' : '#F1F5F9'
                              };
                              color: ${
                                isDev ? '#A5B4FC' :
                                role === 'admin' ? '#DC2626' :
                                role === 'manager' ? '#B45309' :
                                role === 'kitchen' ? '#C2410C' :
                                role === 'pickup' ? '#0369A1' :
                                role === 'cashier' ? '#15803D' : '#475569'
                              };
                              border: 1px solid ${
                                isDev ? '#6366F1' :
                                role === 'admin' ? '#FCA5A5' :
                                role === 'manager' ? '#FDE68A' :
                                role === 'kitchen' ? '#FDBA74' :
                                role === 'pickup' ? '#BAE6FD' :
                                role === 'cashier' ? '#86EFAC' : '#E2E8F0'
                              };
                            ">
                              ${
                                isDev ? '🛡️ DEVELOPER' :
                                role === 'admin' ? '👑 ADMIN' :
                                role === 'manager' ? '👔 MANAGER' :
                                role === 'kitchen' ? '🍳 KITCHEN' :
                                role === 'pickup' ? '📦 PICKUP' :
                                role === 'cashier' ? '💵 CASHIER' : '🎓 STUDENT'
                              }
                            </span>
                            
                            <!-- Quick Switch Select -->
                            <select 
                              class="user-role-select" 
                              data-uid="${escapeHtml(uid)}"
                              ${isLoading ? 'disabled' : ''}
                              style="font-family: var(--font-mono); font-size: 0.72rem; padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border-light); background: #FFF; cursor: pointer;"
                            >
                              <option value="student" ${role === 'student' ? 'selected' : ''}>Student</option>
                              <option value="kitchen" ${role === 'kitchen' ? 'selected' : ''}>Kitchen Staff</option>
                              <option value="pickup" ${role === 'pickup' ? 'selected' : ''}>Pickup Staff</option>
                              <option value="cashier" ${role === 'cashier' ? 'selected' : ''}>Cashier POS</option>
                              <option value="manager" ${role === 'manager' ? 'selected' : ''}>Manager</option>
                              <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
                            </select>
                          </div>
                        </td>

                        <!-- College Info -->
                        <td style="padding: 12px 16px; vertical-align: middle;">
                          <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--ink-primary);">
                            ${user.rollNo ? `Roll: <strong>${escapeHtml(user.rollNo)}</strong>` : (user.employeeId ? `Emp: <strong>${escapeHtml(user.employeeId)}</strong>` : '<span style="color:#94A3B8;">—</span>')}
                          </div>
                          <div style="font-family: var(--font-sans); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 2px;">
                            ${escapeHtml(user.department || user.dept || 'General Campus')} ${user.year ? `· Year ${escapeHtml(user.year)}` : ''}
                          </div>
                        </td>

                        <!-- Priority / Queue -->
                        <td style="padding: 12px 16px; vertical-align: middle;">
                          <button 
                            class="toggle-priority-btn" 
                            data-uid="${escapeHtml(uid)}" 
                            data-priority="${user.priorityLevel || 0}"
                            disabled title="Priority is assigned through the verified application flow."
                            style="
                              border: 1.5px solid ${isPriority ? '#86EFAC' : 'var(--border-light)'};
                              background: ${isPriority ? '#F0FDF4' : 'transparent'};
                              color: ${isPriority ? '#15803D' : 'var(--ink-secondary)'};
                              font-family: var(--font-mono);
                              font-size: 0.72rem;
                              font-weight: 700;
                              padding: 4px 8px;
                              border-radius: 6px;
                              cursor: pointer;
                              display: inline-flex;
                              align-items: center;
                              gap: 4px;
                            "
                          >
                            ${isPriority ? `⭐ Verified priority (Level ${escapeHtml(user.priorityLevel)})` : '⚪ Standard Queue'}
                          </button>
                        </td>

                        <!-- Admin Governance Actions -->
                        <td style="padding: 12px 16px; vertical-align: middle; text-align: right;">
                          <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center; flex-wrap: wrap;">
                            
                            <!-- Toggle Admin Button -->
                            ${isAdmin ? `
                              <button 
                                class="btn-action-role" 
                                data-uid="${escapeHtml(uid)}" 
                                data-role="student"
                                ${isLoading ? 'disabled' : ''}
                                style="background: #FFF; border: 1.5px solid #FCA5A5; color: #DC2626; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 6px; cursor: pointer;"
                                title="Revoke administrative rights"
                              >
                                ❌ Revoke Admin
                              </button>
                            ` : `
                              <button 
                                class="btn-action-role" 
                                data-uid="${escapeHtml(uid)}" 
                                data-role="admin"
                                ${isLoading ? 'disabled' : ''}
                                style="background: #DC2626; border: 1.5px solid #DC2626; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 6px; cursor: pointer;"
                                title="Grant full administrative rights"
                              >
                                👑 Make Admin
                              </button>
                            `}

                            <!-- Disable / Enable Toggle -->
                            <button 
                              class="toggle-disable-btn"
                              data-uid="${escapeHtml(uid)}"
                              data-disabled="${isDisabled ? 'true' : 'false'}"
                              disabled title="Account changes require trusted account administration; unavailable in this directory."
                              style="background: transparent; border: 1px solid var(--border-light); color: ${isDisabled ? '#16A34A' : '#64748B'}; font-family: var(--font-mono); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; cursor: pointer;"
                            >
                              ${isDisabled ? '🔓 Activate' : '🔒 Suspend'}
                            </button>

                          </div>
                        </td>

                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

      </div>
    `;

    // Attach Event Handlers
    container.querySelector('#refresh-users-btn')?.addEventListener('click', () => {
      if (isCurrentView()) renderUserProfilesView(container);
    });

    container.querySelector('#close-feedback-btn')?.addEventListener('click', () => {
      statusFeedback = null;
      render();
    });

    container.querySelector('#quick-assign-form')?.addEventListener('submit', handleQuickAssign);

    container.querySelectorAll('.profile-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedRoleFilter = btn.getAttribute('data-filter');
        render();
      });
    });

    const searchInput = container.querySelector('#profiles-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        render();
        const reInput = container.querySelector('#profiles-search-input');
        if (reInput) {
          reInput.focus();
          reInput.setSelectionRange(reInput.value.length, reInput.value.length);
        }
      });
    }

    container.querySelectorAll('.btn-action-role').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.getAttribute('data-uid');
        const role = btn.getAttribute('data-role');
        const user = allUsers.get(uid) || allStaffUsers.get(uid) || {};
        return updateUserRole(uid, role, user);
      });
    });

    container.querySelectorAll('.user-role-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const uid = select.getAttribute('data-uid');
        const role = e.target.value;
        const user = allUsers.get(uid) || allStaffUsers.get(uid) || {};
        return updateUserRole(uid, role, user);
      });
    });
  }

  render();
}
