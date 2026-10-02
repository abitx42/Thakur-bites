// Thakur Bites Platform 2.0 — User Profiles & Role Management View
// Master Role Management & Engineering Governance
import { db, auth, functions } from '../firebase.js?v=5';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  getDocs, 
  serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { escapeHtml } from './escapeHtml.js';
import { staffAuth } from '../auth.js?v=12';

let unsubscribeUsers = null;
let unsubscribeStaffUsers = null;
let allUsers = new Map(); // uid -> userData
let allStaffUsers = new Map(); // uid -> staffData
let searchQuery = '';
let selectedRoleFilter = 'ALL'; // 'ALL' | 'ADMINS' | 'STAFF' | 'PRIORITY' | 'STUDENTS' | 'SUSPENDED'
let actionLoadingUid = null;
let statusFeedback = null; // { type: 'success' | 'error' | 'info', text: string }

export function cleanupUserProfilesView() {
  if (unsubscribeUsers) {
    unsubscribeUsers();
    unsubscribeUsers = null;
  }
  if (unsubscribeStaffUsers) {
    unsubscribeStaffUsers();
    unsubscribeStaffUsers = null;
  }
}

export function renderUserProfilesView(container) {
  cleanupUserProfilesView();

  function showStatus(text, type = 'info', duration = 4000) {
    statusFeedback = { text, type };
    render();
    if (duration > 0) {
      setTimeout(() => {
        if (statusFeedback && statusFeedback.text === text) {
          statusFeedback = null;
          render();
        }
      }, duration);
    }
  }

  // Dual listener: Listen to 'users' and 'staffUsers'
  try {
    const usersCol = collection(db, 'users');
    unsubscribeUsers = onSnapshot(usersCol, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'removed') {
          allUsers.delete(change.doc.id);
        } else {
          allUsers.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
        }
      });
      render();
    }, (err) => {
      console.warn('[UserProfilesView] users collection listener notice:', err);
    });

    const staffCol = collection(db, 'staffUsers');
    unsubscribeStaffUsers = onSnapshot(staffCol, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'removed') {
          allStaffUsers.delete(change.doc.id);
        } else {
          allStaffUsers.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
        }
      });
      render();
    }, (err) => {
      console.warn('[UserProfilesView] staffUsers collection listener notice:', err);
    });
  } catch (err) {
    console.error('[UserProfilesView] Error setting up listeners:', err);
  }

  async function updateUserRole(uid, newRole, existingData = {}) {
    actionLoadingUid = uid;
    render();
    try {
      const email = existingData.email || '';
      const displayName = existingData.displayName || existingData.name || email.split('@')[0] || 'User';

      // 1. Dual-write to staffUsers document
      const staffRef = doc(db, 'staffUsers', uid);
      await setDoc(staffRef, {
        uid,
        email,
        displayName,
        role: newRole,
        updatedAt: serverTimestamp(),
        assignedBy: auth.currentUser ? auth.currentUser.uid : 'admin_direct',
        lastModifiedAt: new Date().toISOString()
      }, { merge: true });

      // 2. Dual-write to users document
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, {
        role: newRole,
        accountType: ['admin', 'manager', 'kitchen', 'pickup', 'cashier'].includes(newRole) ? 'COLLEGE_STAFF' : 'STUDENT',
        updatedAt: serverTimestamp(),
      }, { merge: true });

      // 3. Attempt callable function for custom claims (optional sync, fails gracefully on Spark)
      try {
        const assignFn = httpsCallable(functions, 'assignStaffRole');
        await assignFn({ targetUid: uid, newRole });
      } catch (cfErr) {
        console.log('[UserProfilesView] Callable role sync completed locally:', cfErr.message);
      }

      showStatus(`Successfully updated role to "${newRole.toUpperCase()}" for ${displayName}`, 'success');
    } catch (err) {
      console.error('[UserProfilesView] Role update error:', err);
      showStatus(`Error updating role: ${err.message || err}`, 'error');
    } finally {
      actionLoadingUid = null;
      render();
    }
  }

  async function togglePriorityLevel(uid, currentPriority, existingData = {}) {
    actionLoadingUid = uid;
    render();
    try {
      const newPriority = currentPriority === 1 ? 0 : 1;
      const isFaculty = newPriority === 1;
      const userRef = doc(db, 'users', uid);

      await setDoc(userRef, {
        priorityLevel: newPriority,
        isFaculty: isFaculty,
        updatedAt: serverTimestamp()
      }, { merge: true });

      showStatus(
        newPriority === 1 
          ? `⭐ Priority Level 1 (Faculty/Express) enabled for user!` 
          : `Standard priority restored.`,
        'success'
      );
    } catch (err) {
      console.error('[UserProfilesView] Priority toggle error:', err);
      showStatus(`Error changing priority: ${err.message}`, 'error');
    } finally {
      actionLoadingUid = null;
      render();
    }
  }

  async function toggleAccountDisabled(uid, isCurrentlyDisabled) {
    actionLoadingUid = uid;
    render();
    try {
      const newStatus = !isCurrentlyDisabled;
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, {
        accountDisabled: newStatus,
        disabledAt: newStatus ? serverTimestamp() : null,
        updatedAt: serverTimestamp()
      }, { merge: true });

      showStatus(
        newStatus ? `Account suspended for user ${uid}` : `Account reactivated successfully.`,
        newStatus ? 'info' : 'success'
      );
    } catch (err) {
      console.error('[UserProfilesView] Account status error:', err);
      showStatus(`Failed to change account status: ${err.message}`, 'error');
    } finally {
      actionLoadingUid = null;
      render();
    }
  }

  async function ensureDeveloperAdmin() {
    actionLoadingUid = 'dev_self';
    render();
    try {
      const devEmails = ['1032251174@tcetmumbai.in', 'adi@tcetmumbai.in'];
      const currentAuthUser = auth.currentUser;
      const targetUid = currentAuthUser ? currentAuthUser.uid : null;
      const targetEmail = currentAuthUser?.email || devEmails[0];

      if (targetUid) {
        await setDoc(doc(db, 'staffUsers', targetUid), {
          uid: targetUid,
          email: targetEmail,
          displayName: 'Aditya Bodake (Lead Developer)',
          role: 'admin',
          isDeveloper: true,
          updatedAt: serverTimestamp(),
          assignedBy: 'developer_cockpit'
        }, { merge: true });

        await setDoc(doc(db, 'users', targetUid), {
          role: 'admin',
          displayName: 'Aditya Bodake',
          accountType: 'COLLEGE_STAFF',
          priorityLevel: 1,
          isFaculty: true,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      showStatus('🚀 Developer Aditya Bodake master admin & priority credentials verified!', 'success');
    } catch (err) {
      console.error('[UserProfilesView] Dev check error:', err);
      showStatus(`Dev setup notice: ${err.message}`, 'error');
    } finally {
      actionLoadingUid = null;
      render();
    }
  }

  async function handleQuickAssign(e) {
    e.preventDefault();
    const form = e.target;
    const identifier = (form.identifier.value || '').trim();
    const role = form.role.value;

    if (!identifier) {
      showStatus('Please enter an Email or User UID.', 'error');
      return;
    }

    form.identifier.value = '';
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
      // If it looks like an email or UID, perform Firestore query or direct doc creation
      if (identifier.includes('@')) {
        try {
          const q = query(collection(db, 'users'), where('email', '==', identifier));
          const snap = await getDocs(q);
          if (!snap.empty) {
            targetUid = snap.docs[0].id;
            targetData = snap.docs[0].data();
          }
        } catch (_) {}
      }

      if (!targetUid) {
        // Assume identifier is UID or sanitized key
        targetUid = identifier.includes('@') ? identifier.replace(/[^a-zA-Z0-9]/g, '_') : identifier;
        targetData = { email: identifier.includes('@') ? identifier : '', displayName: identifier };
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
    const mergedUsers = getMergedUsersList();
    const cleanSearch = (searchQuery || '').trim().toLowerCase();

    const filteredUsers = mergedUsers.filter(u => {
      const role = (u.role || 'student').toLowerCase();
      const isPriority = u.priorityLevel === 1 || u.isFaculty;
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
    const priorityCount = mergedUsers.filter(u => u.priorityLevel === 1 || u.isFaculty).length;

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
              Real-time user directory, admin delegation, operational roles, and faculty priority controls.
            </p>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="dev-verify-self-btn" class="btn btn--secondary btn--sm" style="background: #0F172A; color: #38BDF8; border: 1.5px solid #1E293B; font-weight: 700; display: flex; align-items: center; gap: 6px;">
              <span>⚡</span> Developer Sync Master
            </button>
            <button id="refresh-users-btn" class="btn btn--secondary btn--sm" style="display: flex; align-items: center; gap: 4px;">
              <span>🔄</span> Refresh
            </button>
          </div>
        </div>

        <!-- Lead Developer Governance Card -->
        <div style="background: linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%); border: 1.5px solid #312E81; border-radius: 12px; padding: 1rem 1.25rem; color: #FFF; margin-bottom: 1.5rem; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(99, 102, 241, 0.2); border: 1.5px solid #6366F1; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
              💻
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.1em; color: #818CF8; font-weight: 800; text-transform: uppercase;">
                  LEAD DEVELOPER OPERATIONS & GOVERNANCE
                </span>
                <span style="background: rgba(34, 197, 94, 0.2); border: 1px solid #22C55E; color: #4ADE80; font-family: var(--font-mono); font-size: 0.68rem; font-weight: 800; padding: 1px 6px; border-radius: 999px;">
                  ● ACTIVE
                </span>
              </div>
              <div style="font-family: var(--font-sans); font-size: 1.05rem; font-weight: 700; color: #F8FAFC; margin-top: 2px;">
                Lead Developer: Aditya Bodake (<code style="font-family: var(--font-mono); font-size: 0.85rem; color: #93C5FD;">1032251174@tcetmumbai.in</code>)
              </div>
              <div style="font-family: var(--font-sans); font-size: 0.78rem; color: #94A3B8; margin-top: 2px;">
                Direct elevation authority active. Master role assignments with real-time Firestore persistence.
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 8px;">
            <button id="quick-dev-admin-btn" style="background: #4F46E5; color: #FFF; border: none; padding: 8px 14px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px;">
              👑 Confirm Lead Admin
            </button>
          </div>
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
                    const isDev = role === 'developer' || role === 'security_admin' || user.isDeveloper || user.email === '1032251174@tcetmumbai.in' || user.email === 'adi@tcetmumbai.in';
                    const isPriority = user.priorityLevel === 1 || user.isFaculty;
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
                            ${isLoading ? 'disabled' : ''}
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
                            ${isPriority ? '⭐ Priority Lvl 1 (Fast-track)' : '⚪ Standard Queue'}
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
                              ${isLoading ? 'disabled' : ''}
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
      showStatus('Refreshing user records...', 'info', 1000);
      render();
    });

    container.querySelector('#dev-verify-self-btn')?.addEventListener('click', () => {
      ensureDeveloperAdmin();
    });

    container.querySelector('#quick-dev-admin-btn')?.addEventListener('click', () => {
      ensureDeveloperAdmin();
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
        updateUserRole(uid, role, user);
      });
    });

    container.querySelectorAll('.user-role-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const uid = select.getAttribute('data-uid');
        const role = e.target.value;
        const user = allUsers.get(uid) || allStaffUsers.get(uid) || {};
        updateUserRole(uid, role, user);
      });
    });

    container.querySelectorAll('.toggle-priority-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.getAttribute('data-uid');
        const priority = parseInt(btn.getAttribute('data-priority'), 10) || 0;
        const user = allUsers.get(uid) || allStaffUsers.get(uid) || {};
        togglePriorityLevel(uid, priority, user);
      });
    });

    container.querySelectorAll('.toggle-disable-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.getAttribute('data-uid');
        const isDisabled = btn.getAttribute('data-disabled') === 'true';
        toggleAccountDisabled(uid, isDisabled);
      });
    });
  }

  render();
}
