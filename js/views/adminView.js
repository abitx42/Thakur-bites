// Phase 11 — Live Menu & Stock Management View with Distinct Cooked vs Store Item Logic
import { 
  db,
  functions,
  subscribeMenuItems, 
  toggleItemAvailability, 
  updateItemStockCount, 
  updateItemDetails, 
  saveMenuItem, 
  archiveMenuItem,
  deleteMenuItem,
  uploadMenuImage
} from '../firebase.js?v=5';
import { renderMenuVisualHtml, VISUAL_FAMILIES } from '../menuVisualResolver.js';
import { staffAuth } from '../auth.js?v=8';
import { doc, onSnapshot, collection, query, where } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { escapeHtml } from './escapeHtml.js';

let unsubscribeMenu = null;
let unsubscribeStatus = null;
let unsubscribeApps = null;
let unsubscribePins = null;
let currentItems = [];
let currentApplications = [];
let currentShiftPins = [];
let showAddModal = false;
let editingItem = null; // Item object currently being edited in details modal
let showCredModal = false; // Issue Shift PIN & Terminal Code Modal
let credModalTab = 'pin'; // 'pin' | 'terminal'
let credModalResult = null; // { type: 'pin' | 'terminal', ... }
let credModalLoading = false;
let credModalError = null;
let currentMode = 'NORMAL';
let modeLoading = false;
let showOperationalModal = false;
let targetOperationalMode = null;
let operationalModeReason = '';
let operationalModeError = null;
let operationalModeLoading = false;
let selectedParentFilter = 'ALL';
let selectedSubFilter = 'ALL';
let menuSearchQuery = '';
let stockStatusFilter = 'ALL';
let selectedSortOption = 'DEFAULT';

export function renderAdminView(container, options = {}) {
  const isStaffMode = Boolean(options && options.staffMode);

  if (unsubscribeMenu) unsubscribeMenu();
  if (unsubscribeStatus) unsubscribeStatus();
  if (unsubscribeApps) unsubscribeApps();
  if (unsubscribePins) unsubscribePins();

  function render() {
    const nonArchivedItems = currentItems.filter(i => !i.isArchived);
    const cleanSearch = (menuSearchQuery || '').trim().toLowerCase();

    const visibleItems = nonArchivedItems.filter(item => {
      // 1. Text Search Filter across name, ID, category, subcategory, tags, type, price
      if (cleanSearch) {
        const nameMatch = (item.name || '').toLowerCase().includes(cleanSearch);
        const idMatch = (item.id || '').toLowerCase().includes(cleanSearch);
        const subCatMatch = (item.subCategory || '').toLowerCase().includes(cleanSearch);
        const catMatch = (item.category || '').toLowerCase().includes(cleanSearch);
        const parentMatch = (item.parentCategory || '').toLowerCase().includes(cleanSearch);
        const batchMatch = (item.batchDate || '').toLowerCase().includes(cleanSearch);
        const priceMatch = String(item.price || '').includes(cleanSearch);
        const tagMatch = Array.isArray(item.tags) && item.tags.some(t => String(t).toLowerCase().includes(cleanSearch));
        const typeMatch = item.type === 'instant'
          ? (cleanSearch === 'packaged' || cleanSearch === 'store' || cleanSearch === 'instant' || cleanSearch === 'package' || cleanSearch === 'inventory')
          : (cleanSearch === 'kitchen' || cleanSearch === 'cooked' || cleanSearch === 'cook');

        if (!nameMatch && !idMatch && !subCatMatch && !catMatch && !parentMatch && !batchMatch && !priceMatch && !tagMatch && !typeMatch) {
          return false;
        }
      }

      // 2. Parent Category Filter
      if (selectedParentFilter !== 'ALL') {
        const p = (item.parentCategory || '').toUpperCase();
        if (p && p !== selectedParentFilter) return false;
      }

      // 3. Subcategory Filter
      if (selectedSubFilter !== 'ALL') {
        const s = (item.subCategory || item.category || '').toLowerCase();
        if (s !== selectedSubFilter.toLowerCase()) return false;
      }

      // 4. Stock Status Filter
      if (stockStatusFilter !== 'ALL') {
        const rawStock = item.stockOnHand !== undefined 
          ? Number(item.stockOnHand) 
          : (item.stockCount !== undefined ? Number(item.stockCount) : (item.type === 'instant' ? 0 : 100));
        const reserved = Number(item.reservedStock || 0);
        const netAvailable = item.type === 'instant' ? Math.max(0, rawStock - reserved) : (item.available !== false ? 100 : 0);
        const isSoldOut = item.available === false || item.availabilityStatus === 'OUT_OF_STOCK' || item.isOrderable === false || (item.type === 'instant' && netAvailable <= 0);

        if (stockStatusFilter === 'IN_STOCK' && isSoldOut) return false;
        if (stockStatusFilter === 'OUT_OF_STOCK' && !isSoldOut) return false;
        if (stockStatusFilter === 'LOW_STOCK' && (isSoldOut || (item.type === 'instant' && netAvailable > 5))) return false;
      }

      return true;
    });

    // 5. Multi-tier Sorting
    visibleItems.sort((a, b) => {
      switch (selectedSortOption) {
        case 'PRICE_LOW_HIGH':
          return (Number(a.price) || 0) - (Number(b.price) || 0);
        case 'PRICE_HIGH_LOW':
          return (Number(b.price) || 0) - (Number(a.price) || 0);
        case 'NAME_AZ':
          return (a.name || '').localeCompare(b.name || '');
        case 'POPULAR':
          return (b.isPopular ? 1 : 0) - (a.isPopular ? 1 : 0) || ((a.sortOrder || 100) - (b.sortOrder || 100));
        case 'DEFAULT':
        default:
          return (a.sortOrder || 100) - (b.sortOrder || 100);
      }
    });

    const cookedItems = visibleItems.filter(i => i.type === 'cooked');
    const storeItems = visibleItems.filter(i => i.type === 'instant');

    const modeColors = {
      NORMAL: { bg: '#F0FDF4', border: '#86EFAC', text: '#166534', badge: '#16A34A' },
      DEGRADED: { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', badge: '#D97706' },
      FINANCIAL_FROZEN: { bg: '#FEF2F2', border: '#FCA5A5', text: '#991B1B', badge: '#DC2626' },
      EMERGENCY_HALT: { bg: '#450A0A', border: '#7F1D1D', text: '#FEF2F2', badge: '#991B1B' },
    };
    const activeColor = modeColors[currentMode] || modeColors.NORMAL;

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1300px; margin: 0 auto; padding: 1.5rem 1rem;">
        
        ${!isStaffMode ? `
        <!-- Emergency Operational Mode Controller Bar -->
        <div style="background: ${activeColor.bg}; border: 2px solid ${activeColor.border}; border-radius: 14px; padding: 1.2rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-family: var(--font-display); font-size: 1.3rem; font-weight: 800; color: ${activeColor.text};">
                🚨 SYSTEM OPERATIONAL STATUS:
              </span>
              <span style="background: ${activeColor.badge}; color: #FFF; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; padding: 3px 12px; border-radius: 999px;">
                ${currentMode}
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: ${activeColor.text}; margin-top: 4px; opacity: 0.9;">
              ${currentMode === 'NORMAL' ? 'All canteen operations, online ordering, and checkout are active.' : (currentMode === 'DEGRADED' ? 'Online checkout paused. Counter cash orders only.' : (currentMode === 'FINANCIAL_FROZEN' ? 'All financial transactions frozen for audit reconciliation.' : 'TOTAL EMERGENCY HALT: All canteen operations paused.'))}
            </p>
          </div>

          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="mode-btn" data-mode="NORMAL" ${modeLoading || currentMode === 'NORMAL' ? 'disabled' : ''} style="padding: 7px 14px; border-radius: 8px; border: 1.5px solid #16A34A; background: #FFF; color: #166534; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;">
              NORMAL
            </button>
            <button class="mode-btn" data-mode="DEGRADED" ${modeLoading || currentMode === 'DEGRADED' ? 'disabled' : ''} style="padding: 7px 14px; border-radius: 8px; border: 1.5px solid #D97706; background: #FFF; color: #92400E; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;">
              PAUSE ONLINE (DEGRADED)
            </button>
            <button class="mode-btn" data-mode="FINANCIAL_FROZEN" ${modeLoading || currentMode === 'FINANCIAL_FROZEN' ? 'disabled' : ''} style="padding: 7px 14px; border-radius: 8px; border: 1.5px solid #DC2626; background: #FFF; color: #991B1B; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;">
              FREEZE CHECKOUT
            </button>
            <button class="mode-btn" data-mode="EMERGENCY_HALT" ${modeLoading || currentMode === 'EMERGENCY_HALT' ? 'disabled' : ''} style="padding: 7px 14px; border-radius: 8px; border: 1.5px solid #991B1B; background: #7F1D1D; color: #FFF; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;">
              EMERGENCY HALT
            </button>
          </div>
        </div>
        ` : ''}
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; line-height: 1;">
                ${isStaffMode ? 'STAFF MENU & INVENTORY MANAGEMENT' : 'MENU & INVENTORY MANAGEMENT'}
              </h2>
              <span style="background: #22C55E; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px;">
                ● LIVE SYNC
              </span>
            </div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Kitchen-made items use simple in-stock toggles. Store packaged items track live unit counts & batch dates.
            </p>
          </div>

          <button 
            id="open-add-modal-btn"
            style="padding: 10px 20px; border-radius: 999px; background: var(--brand-red); color: #FFF; border: none; font-family: var(--font-sans); font-size: 0.95rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(214,64,43,0.25);"
          >
            <span>+</span>
            <span>Add New Dish</span>
          </button>
        </div>

        <!-- Menu Health & KPI Statistics Bar -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 1.2rem 1.4rem; margin-bottom: 2rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; box-shadow: 0 2px 6px rgba(0,0,0,0.02);">
          <div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); text-transform: uppercase;">Total Active Items</div>
            <div style="font-family: var(--font-display); font-size: 1.6rem; font-weight: 800; color: var(--ink-primary);">${nonArchivedItems.length}</div>
          </div>
          <div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #16A34A; text-transform: uppercase;">Available Now</div>
            <div style="font-family: var(--font-display); font-size: 1.6rem; font-weight: 800; color: #16A34A;">${nonArchivedItems.filter(i => i.available !== false && (i.type !== 'instant' || (i.stockCount || 0) > 0)).length}</div>
          </div>
          <div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #DC2626; text-transform: uppercase;">Sold Out</div>
            <div style="font-family: var(--font-display); font-size: 1.6rem; font-weight: 800; color: #DC2626;">${nonArchivedItems.filter(i => i.available === false || (i.type === 'instant' && (i.stockCount || 0) <= 0)).length}</div>
          </div>
          <div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #D97706; text-transform: uppercase;">Popular / Top Picks</div>
            <div style="font-family: var(--font-display); font-size: 1.6rem; font-weight: 800; color: #D97706;">🔥 ${nonArchivedItems.filter(i => !!i.isPopular).length}</div>
          </div>
          <div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); text-transform: uppercase;">Visual Content Tier</div>
            <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; color: var(--ink-primary); margin-top: 4px;">
              📷 ${nonArchivedItems.filter(i => !!i.imageUrl).length} photos · 🎨 ${nonArchivedItems.filter(i => !i.imageUrl).length} fallbacks
            </div>
          </div>
        </div>

        ${!isStaffMode ? `
        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 0: FACULTY & STAFF VERIFICATION (PLATFORM 2.0)      -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 16px; padding: 1.4rem; margin-bottom: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 1rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; display: flex; align-items: center; gap: 6px;">
                  <span>👨‍🏫</span>
                  <span>FACULTY & STAFF VERIFICATION APPLICATIONS</span>
                </h3>
                <span style="background: ${currentApplications.length > 0 ? '#D97706' : '#16A34A'}; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 2px 10px; border-radius: 999px;">
                  ${currentApplications.length} PENDING
                </span>
              </div>
              <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
                Review faculty ID applications. Approving grants Teacher/Staff status with Priority Kitchen Queue scheduling.
              </p>
            </div>
          </div>

          ${currentApplications.length === 0 ? `
            <div style="padding: 1.2rem; background: var(--bg-surface); border-radius: 10px; border: 1px dashed var(--border-light); text-align: center;">
              <span style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary);">
                ✅ No pending faculty verification applications. All campus accounts up to date.
              </span>
            </div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 1rem;">
              ${currentApplications.map(app => `
                <div style="background: var(--bg-surface); border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1.2rem; display: flex; flex-direction: column; justify-content: space-between;">
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                      <div>
                        <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; background: #FFF; border: 1px solid var(--border-light); padding: 2px 8px; border-radius: 6px; color: var(--brand-red);">
                          ${escapeHtml(app.applicationId || app.id)}
                        </span>
                        <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; background: #FEF3C7; color: #92400E; padding: 2px 8px; border-radius: 6px; margin-left: 6px;">
                          ${app.applicationType === 'TEACHER' ? '👨‍🏫 FACULTY' : '🏢 STAFF'}
                        </span>
                      </div>
                      <span style="font-family: var(--font-mono); font-size: 0.7rem; color: var(--ink-secondary);">
                        ${app.submittedAt ? new Date(app.submittedAt.toDate ? app.submittedAt.toDate() : app.submittedAt).toLocaleDateString() : ''}
                      </span>
                    </div>

                    <div style="margin-top: 8px;">
                      <div style="font-family: var(--font-sans); font-size: 0.95rem; font-weight: 700; color: var(--ink-primary);">
                        ${escapeHtml(app.designation || 'Faculty Member')} — ${escapeHtml(app.department || 'Department')}
                      </div>
                      <div style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary); margin-top: 2px;">
                        Employee ID: <strong>${escapeHtml(app.employeeId || 'N/A')}</strong>
                      </div>
                      <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 2px;">
                        Email: ${escapeHtml(app.officialEmail || 'N/A')}
                      </div>
                    </div>
                  </div>

                  <div style="display: flex; gap: 8px; margin-top: 1rem; padding-top: 0.8rem; border-top: 1px solid var(--border-light);">
                    <button 
                      class="approve-app-btn" 
                      data-app-id="${escapeHtml(app.applicationId || app.id)}"
                      style="flex: 1; padding: 8px; border-radius: 8px; border: none; background: #16A34A; color: #FFF; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;"
                    >
                      ✓ Approve Faculty
                    </button>
                    <button 
                      class="reject-app-btn" 
                      data-app-id="${escapeHtml(app.applicationId || app.id)}"
                      style="padding: 8px 12px; border-radius: 8px; border: 1px solid #DC2626; background: #FFF; color: #DC2626; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;"
                    >
                      ✕ Reject
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 0.5: STAFF SHIFT PINS & DEVICE BINDING (P2.0)       -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 16px; padding: 1.4rem; margin-bottom: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 1rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin: 0; display: flex; align-items: center; gap: 6px;">
                  <span>🔑</span>
                  <span>STAFF SHIFT PINS & WORKSTATION DEVICE BINDING</span>
                </h3>
                <span style="background: #3B82F6; color: #FFF; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; padding: 2px 10px; border-radius: 999px;">
                  ${currentShiftPins.length} ACTIVE SHIFTS
                </span>
              </div>
              <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
                Generate role-specific 6-digit shift PINs for Kitchen, Pickup, and Cashier counter tablets. Bound cryptographically to hardware workstations.
              </p>
            </div>

            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button 
                id="generate-shift-pins-btn"
                style="padding: 8px 16px; border-radius: 8px; background: #3B82F6; color: #FFF; border: none; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px;"
              >
                <span>🔑</span>
                <span>Generate Shift PIN</span>
              </button>
              <button 
                id="generate-terminal-invite-btn"
                style="padding: 8px 16px; border-radius: 8px; background: #0F172A; color: #FFF; border: none; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px;"
              >
                <span>🖥️</span>
                <span>Enroll Terminal Code</span>
              </button>
            </div>
          </div>

          ${currentShiftPins.length === 0 ? `
            <div style="padding: 1.2rem; background: var(--bg-surface); border-radius: 10px; border: 1px dashed var(--border-light); text-align: center;">
              <span style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary);">
                ℹ️ No active shift PINs generated for today yet. Click "Generate Shift PIN" to issue credentials for today's shifts.
              </span>
            </div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem;">
              ${currentShiftPins.map(pin => `
                <div style="background: var(--bg-surface); border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1.2rem;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: var(--ink-primary); text-transform: uppercase;">
                      ${pin.role === 'kitchen' ? '👨‍🍳 KITCHEN' : (pin.role === 'pickup' ? '🛍️ PICKUP' : '💵 CASHIER')}
                    </span>
                    <span style="font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: ${pin.status === 'ACTIVE' ? '#DCFCE7' : '#FEE2E2'}; color: ${pin.status === 'ACTIVE' ? '#166534' : '#991B1B'};">
                      ${pin.status}
                    </span>
                  </div>

                  <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 4px;">
                    Window: <strong>${pin.shiftWindow}</strong> · Date: <strong>${pin.shiftDate}</strong>
                  </div>

                  <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary); margin-top: 4px;">
                    Bound Workstations: <strong>${(pin.boundDevices || []).length} / ${pin.maxDevices || 2}</strong>
                  </div>

                  <div style="display: flex; gap: 8px; margin-top: 1rem; padding-top: 0.8rem; border-top: 1px solid var(--border-light);">
                    <button 
                      class="revoke-shift-pin-btn" 
                      data-pin-id="${pin.pinId || pin.id}"
                      ${pin.status !== 'ACTIVE' ? 'disabled' : ''}
                      style="flex: 1; padding: 6px; border-radius: 6px; border: 1px solid #DC2626; background: #FFF; color: #DC2626; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer;"
                    >
                      Revoke PIN
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
        ` : ''}

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- MENU SEARCH, TAXONOMY & STOCK FILTER BAR                   -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="background: #FFF; border: 1.5px solid var(--border-light); border-radius: 14px; padding: 1.2rem; margin-bottom: 2rem; box-shadow: 0 2px 6px rgba(0,0,0,0.02);">
          
          <!-- Primary Search Bar -->
          <div style="display: flex; align-items: center; gap: 12px; background: var(--bg-surface); border: 1.5px solid ${menuSearchQuery ? 'var(--brand-red)' : 'var(--border-light)'}; border-radius: 10px; padding: 0.7rem 1.2rem; margin-bottom: 1rem; box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);">
            <span style="font-size: 1.2rem; color: var(--ink-secondary);">🔍</span>
            <input 
              type="text" 
              id="menu-search-input" 
              placeholder="Search dishes, snacks, drinks, or packaged items (e.g. Dosa, Chai, Chips, Water)..." 
              value="${escapeHtml(menuSearchQuery)}"
              style="flex: 1; border: none; outline: none; font-family: var(--font-sans); font-size: 1rem; font-weight: 600; color: var(--ink-primary); background: transparent;"
            />
            ${menuSearchQuery ? `
              <button id="clear-menu-search-btn" style="background: transparent; border: none; font-size: 1.1rem; color: var(--ink-secondary); cursor: pointer; padding: 0 6px;" title="Clear Search">
                ✕
              </button>
            ` : ''}
            <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary); background: #FFF; border: 1px solid var(--border-light); padding: 3px 10px; border-radius: 6px; white-space: nowrap;">
              ${visibleItems.length} / ${nonArchivedItems.length} Items
            </span>
          </div>

          <!-- Secondary Filters Row: Category Pills + Stock Status Filter + Subcategory -->
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary); margin-right: 4px;">CATEGORY:</span>
              ${[
                { id: 'ALL', label: 'All Items' },
                { id: 'FOOD', label: '🍛 Food' },
                { id: 'SNACKS', label: '🍟 Snacks' },
                { id: 'BEVERAGES', label: '🥤 Drinks' }
              ].map(cat => `
                <button class="cat-filter-btn" data-category="${cat.id}" style="padding: 6px 14px; border-radius: 999px; border: 1.5px solid ${selectedParentFilter === cat.id ? 'var(--brand-red)' : 'var(--border-light)'}; background: ${selectedParentFilter === cat.id ? 'var(--brand-red)' : 'var(--bg-surface)'}; color: ${selectedParentFilter === cat.id ? '#FFF' : 'var(--ink-primary)'}; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; cursor: pointer;">
                  ${cat.label}
                </button>
              `).join('')}
            </div>

            <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
              <!-- Multi-Tier Sort Filter -->
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary);">SORT:</span>
                <select id="sort-filter-select" style="padding: 6px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.85rem; background: var(--bg-surface); cursor: pointer;">
                  <option value="DEFAULT" ${selectedSortOption === 'DEFAULT' ? 'selected' : ''}>Default</option>
                  <option value="PRICE_LOW_HIGH" ${selectedSortOption === 'PRICE_LOW_HIGH' ? 'selected' : ''}>₹ Price: Low → High</option>
                  <option value="PRICE_HIGH_LOW" ${selectedSortOption === 'PRICE_HIGH_LOW' ? 'selected' : ''}>₹ Price: High → Low</option>
                  <option value="NAME_AZ" ${selectedSortOption === 'NAME_AZ' ? 'selected' : ''}>🔤 Name: A → Z</option>
                  <option value="POPULAR" ${selectedSortOption === 'POPULAR' ? 'selected' : ''}>🔥 Popular First</option>
                </select>
              </div>

              <!-- Stock Status Filter -->
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary);">STOCK:</span>
                <select id="stock-filter-select" style="padding: 6px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.85rem; background: var(--bg-surface); cursor: pointer;">
                  <option value="ALL" ${stockStatusFilter === 'ALL' ? 'selected' : ''}>All Stock Status</option>
                  <option value="IN_STOCK" ${stockStatusFilter === 'IN_STOCK' ? 'selected' : ''}>✅ In Stock Only</option>
                  <option value="OUT_OF_STOCK" ${stockStatusFilter === 'OUT_OF_STOCK' ? 'selected' : ''}>❌ Sold Out (0 Qty)</option>
                  <option value="LOW_STOCK" ${stockStatusFilter === 'LOW_STOCK' ? 'selected' : ''}>⚠️ Low Stock (≤ 5)</option>
                </select>
              </div>

              <!-- Subcategory Filter -->
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary);">SUBCATEGORY:</span>
                <select id="subcat-filter-select" style="padding: 6px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.85rem; background: var(--bg-surface); cursor: pointer;">
                  <option value="ALL" ${selectedSubFilter === 'ALL' ? 'selected' : ''}>All Subcategories</option>
                  <option value="South Indian" ${selectedSubFilter === 'South Indian' ? 'selected' : ''}>🍛 South Indian</option>
                  <option value="Sandwiches" ${selectedSubFilter === 'Sandwiches' ? 'selected' : ''}>🥪 Sandwiches</option>
                  <option value="Chinese" ${selectedSubFilter === 'Chinese' ? 'selected' : ''}>🍜 Chinese</option>
                  <option value="Lunch & Meals" ${selectedSubFilter === 'Lunch & Meals' ? 'selected' : ''}>🍱 Lunch & Meals</option>
                  <option value="Pav Items" ${selectedSubFilter === 'Pav Items' ? 'selected' : ''}>🥖 Pav & Samosa</option>
                  <option value="Fries" ${selectedSubFilter === 'Fries' ? 'selected' : ''}>🍟 French Fries</option>
                  <option value="Tea & Coffee" ${selectedSubFilter === 'Tea & Coffee' ? 'selected' : ''}>☕ Tea & Coffee</option>
                  <option value="Cold Drinks" ${selectedSubFilter === 'Cold Drinks' ? 'selected' : ''}>🥤 Cold Drinks</option>
                  <option value="Milkshakes" ${selectedSubFilter === 'Milkshakes' ? 'selected' : ''}>🥛 Milkshakes</option>
                  <option value="Juices" ${selectedSubFilter === 'Juices' ? 'selected' : ''}>🧃 Juices</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        ${visibleItems.length === 0 ? `
          <div style="background: #FFF; border: 2px dashed var(--border-light); border-radius: 16px; padding: 3rem 1.5rem; text-align: center; margin-bottom: 2rem;">
            <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔍</div>
            <h3 style="font-family: var(--font-display); font-size: 1.6rem; color: var(--ink-primary); margin: 0 0 0.5rem 0;">
              NO MENU ITEMS MATCH YOUR SEARCH
            </h3>
            <p style="font-family: var(--font-sans); font-size: 0.9rem; color: var(--ink-secondary); margin-bottom: 1.2rem;">
              No dishes or packaged items match "${escapeHtml(menuSearchQuery)}". Try another keyword or reset filters.
            </p>
            <button id="reset-all-filters-btn" style="padding: 8px 18px; border-radius: 8px; background: var(--brand-red); color: #FFF; border: none; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;">
              Reset Search & Filters
            </button>
          </div>
        ` : ''}

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 1: CANTEEN KITCHEN ITEMS (COOKED - TOGGLE ONLY)     -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="margin-bottom: 2.5rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
            <h3 style="font-family: var(--font-display); font-size: 1.4rem; color: #6B4408; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>🍳</span>
              <span>KITCHEN PREPARED ITEMS (${cookedItems.length})</span>
            </h3>
            <span style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary);">
              Dosa, Roti-Bhaji, Chai, Meals (Direct In-Stock Toggles)
            </span>
          </div>

          ${cookedItems.length === 0 ? `
            <div style="background: #FFF; border: 1.5px dashed var(--border-light); border-radius: 12px; padding: 1.5rem; text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.85rem;">
              No kitchen prepared dishes match "${escapeHtml(menuSearchQuery || 'current filters')}".
            </div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.2rem;">
              ${cookedItems.map(item => {
                const isAvailable = item.available !== false;

                return `
                  <div class="menu-card-admin" style="background: #FFF; border: 2px solid ${isAvailable ? 'var(--border-light)' : '#FCA5A5'}; border-radius: 14px; padding: 1.2rem; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                    <div>
                      <div style="display: flex; gap: 12px; align-items: flex-start;">
                        ${renderMenuVisualHtml(item, 56, 56)}
                        <div style="flex: 1; min-width: 0;">
                          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                            <div>
                              <h4 style="font-family: var(--font-sans); font-size: 1.1rem; font-weight: 800; color: var(--ink-primary); margin: 0; word-break: break-word;">
                                ${escapeHtml(item.name)}
                              </h4>
                              <div style="display: flex; gap: 6px; margin-top: 5px; flex-wrap: wrap; align-items: center;">
                                ${item.isPopular ? `
                                  <span style="font-family: var(--font-mono); font-size: 0.7rem; background: #FEF3C7; color: #B45309; padding: 2px 6px; border-radius: 4px; font-weight: 800;">
                                    🔥 POPULAR
                                  </span>
                                ` : ''}
                                <span style="font-family: var(--font-mono); font-size: 0.75rem; background: #FBE7BE; color: #6B4408; padding: 2px 8px; border-radius: 4px; font-weight: 700;">
                                  ~${item.prepMinutes || 5} min
                                </span>
                                <span style="font-family: var(--font-mono); font-size: 0.75rem; background: var(--bg-surface); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                                  ${escapeHtml(item.subCategory || item.category || '')}
                                </span>
                              </div>
                            </div>

                            <div style="text-align: right; flex-shrink: 0;">
                              <div style="font-family: var(--font-mono); font-size: 1.25rem; font-weight: 800; color: var(--ink-primary);">
                                ₹${item.price}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Kitchen Item Control: Big Stock Toggle & Edit -->
                    <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 1rem; border-top: 1.5px solid var(--border-light); margin-top: 1rem;">
                      <button 
                        class="toggle-cooked-btn" 
                        data-item-id="${item.id}" 
                        data-available="${isAvailable}"
                        style="padding: 8px 16px; border-radius: 999px; border: 1.5px solid ${isAvailable ? '#22C55E' : '#EF4444'}; background: ${isAvailable ? '#F0FDF4' : '#FEF2F2'}; color: ${isAvailable ? '#15803D' : '#B91C1C'}; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 6px;"
                      >
                        <span>${isAvailable ? '✓' : '✕'}</span>
                        <span>${isAvailable ? 'In Stock (Open)' : 'Out of Stock (Closed)'}</span>
                      </button>

                      <button 
                        class="edit-item-btn" 
                        data-item-id="${item.id}"
                        style="background: var(--bg-surface); border: 1px solid var(--border-light); padding: 6px 12px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; cursor: pointer; color: var(--ink-primary);"
                      >
                        ✏️ Edit
                      </button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- SECTION 2: PACKAGED STORE ITEMS (UNIT QUANTITY & BATCH)    -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        <div style="margin-bottom: 2rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
            <h3 style="font-family: var(--font-display); font-size: 1.4rem; color: #2C4A1E; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>📦</span>
              <span>STORE PACKAGED ITEMS & INVENTORY (${storeItems.length})</span>
            </h3>
            <span style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary);">
              Chocolates, Cold Drinks, Chips, Biscuits (Live Available Units)
            </span>
          </div>

          ${storeItems.length === 0 ? `
            <div style="background: #FFF; border: 1.5px dashed var(--border-light); border-radius: 12px; padding: 1.5rem; text-align: center; color: var(--ink-secondary); font-family: var(--font-mono); font-size: 0.85rem;">
              No store packaged items match "${escapeHtml(menuSearchQuery || 'current filters')}".
            </div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1.2rem;">
              ${storeItems.map(item => {
                const rawStock = item.stockOnHand !== undefined 
                  ? Number(item.stockOnHand) 
                  : (item.stockCount !== undefined ? Number(item.stockCount) : 0);
                const reserved = Number(item.reservedStock || 0);
                const netAvailable = Math.max(0, rawStock - reserved);
                const isSoldOut = item.available === false || item.availabilityStatus === 'OUT_OF_STOCK' || item.isOrderable === false || netAvailable <= 0;
                const stock = isSoldOut ? 0 : netAvailable;
                const isInStock = !isSoldOut && stock > 0;

                return `
                  <div class="menu-card-admin" style="background: ${isInStock ? '#FFF' : '#FFFDF7'}; border: 2px solid ${isInStock ? 'var(--border-light)' : '#FCA5A5'}; border-radius: 14px; padding: 1.2rem; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                    <div>
                      <div style="display: flex; gap: 12px; align-items: flex-start;">
                        ${renderMenuVisualHtml(item, 56, 56)}
                        <div style="flex: 1; min-width: 0;">
                          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                            <div>
                              <h4 style="font-family: var(--font-sans); font-size: 1.1rem; font-weight: 800; color: var(--ink-primary); margin: 0; word-break: break-word;">
                                ${escapeHtml(item.name)}
                              </h4>
                              <div style="display: flex; gap: 6px; margin-top: 5px; flex-wrap: wrap; align-items: center;">
                                ${item.isPopular ? `
                                  <span style="font-family: var(--font-mono); font-size: 0.7rem; background: #FEF3C7; color: #B45309; padding: 2px 6px; border-radius: 4px; font-weight: 800;">
                                    🔥 POPULAR
                                  </span>
                                ` : ''}
                                <span style="font-family: var(--font-mono); font-size: 0.75rem; background: #DCEACB; color: #2C4A1E; padding: 2px 8px; border-radius: 4px; font-weight: 700;">
                                  Store Item
                                </span>
                                ${item.batchDate ? `
                                  <span style="font-family: var(--font-mono); font-size: 0.75rem; background: var(--bg-surface); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border-light); color: var(--ink-secondary);">
                                    📦 Batch: ${escapeHtml(item.batchDate)}
                                  </span>
                                ` : ''}
                              </div>
                            </div>

                            <div style="text-align: right; flex-shrink: 0;">
                              <div style="font-family: var(--font-mono); font-size: 1.25rem; font-weight: 800; color: var(--ink-primary);">
                                ₹${item.price}
                              </div>
                              <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: ${isInStock ? '#16A34A' : '#DC2626'};">
                                ${isInStock ? `${stock} in stock` : '0 (Sold Out)'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Store Item Control: Available Quantity Stepper -->
                    <div style="padding-top: 1rem; border-top: 1.5px solid var(--border-light); margin-top: 1rem;">
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-secondary);">
                          AVAILABLE QUANTITY:
                        </span>
                        
                        <div style="display: flex; align-items: center; gap: 4px;">
                          <!-- Minus Button -->
                          <button 
                            class="stock-step-btn minus-stock-btn" 
                            data-item-id="${item.id}" 
                            data-current-stock="${stock}"
                            style="width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid var(--border-light); background: var(--bg-surface); font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center;"
                          >
                            –
                          </button>

                          <!-- Stock Count Display / Input -->
                          <input 
                            type="number" 
                            class="stock-count-input" 
                            data-item-id="${item.id}" 
                            value="${stock}" 
                            min="0"
                            style="width: 55px; padding: 4px; border-radius: 6px; border: 1.5px solid ${isInStock ? 'var(--border-light)' : '#EF4444'}; font-family: var(--font-mono); font-size: 1.05rem; font-weight: 800; text-align: center; color: ${isInStock ? 'var(--ink-primary)' : '#DC2626'};"
                          />

                          <!-- Plus Button -->
                          <button 
                            class="stock-step-btn plus-stock-btn" 
                            data-item-id="${item.id}" 
                            data-current-stock="${stock}"
                            style="width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid var(--border-light); background: var(--bg-surface); font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center;"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <!-- Quick Restock Chips (+5, +10, +25), Quick Sold Out & Edit Button -->
                      <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                          ${[5, 10, 25].map(add => `
                            <button 
                              class="quick-restock-btn" 
                              data-item-id="${item.id}" 
                              data-current-stock="${stock}" 
                              data-add="${add}"
                              style="padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border-light); background: var(--bg-surface); font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer; color: var(--ink-primary);"
                            >
                              +${add}
                            </button>
                          `).join('')}

                          ${isInStock ? `
                            <button 
                              class="mark-soldout-btn" 
                              data-item-id="${item.id}" 
                              title="Set quantity to 0 and mark sold out"
                              style="padding: 2px 8px; border-radius: 4px; border: 1px solid #FCA5A5; background: #FEF2F2; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer; color: #DC2626;"
                            >
                              ✕ Sold Out
                            </button>
                          ` : `
                            <button 
                              class="quick-restock-btn" 
                              data-item-id="${item.id}" 
                              data-current-stock="0" 
                              data-add="10"
                              title="Restock 10 units"
                              style="padding: 2px 8px; border-radius: 4px; border: 1px solid #86EFAC; background: #F0FDF4; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer; color: #166534;"
                            >
                              ✓ In Stock (+10)
                            </button>
                          `}
                        </div>

                        <button 
                          class="edit-item-btn" 
                          data-item-id="${item.id}"
                          style="background: transparent; border: 1px solid var(--border-light); padding: 4px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 600; cursor: pointer; color: var(--ink-primary);"
                        >
                          ✏️ Edit
                        </button>
                      </div>
                    </div>

                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- MODAL: EDIT ITEM DETAILS & PRICE (Infrequent changes)       -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        ${editingItem ? (() => {
          const canEditPrice = ['admin', 'manager'].includes(staffAuth.getRole() || '');
          return `
          <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem;">
            <div style="background: #FFF; border-radius: 18px; width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; padding: 2rem; box-shadow: 0 20px 40px rgba(0,0,0,0.25);">
              
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <div>
                  <h3 style="font-family: var(--font-display); font-size: 1.8rem; margin: 0; line-height: 1;">
                    EDIT DISH DETAILS
                  </h3>
                  <span style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--ink-secondary);">
                    Item ID: ${editingItem.id}
                  </span>
                </div>
                <button id="close-edit-modal-btn" style="background: transparent; border: none; font-size: 1.4rem; cursor: pointer; color: var(--ink-secondary);">✕</button>
              </div>

              <form id="edit-dish-form">
                <!-- Visual & Image Upload Section -->
                <div style="background: var(--bg-surface); border: 1.5px solid var(--border-light); border-radius: 12px; padding: 1rem; margin-bottom: 1.2rem;">
                  <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 8px;">
                    Visual Asset (3-Tier Resolver)
                  </label>
                  <div style="display: flex; gap: 14px; align-items: center;">
                    <div id="edit-image-preview-container">
                      ${renderMenuVisualHtml(editingItem, 72, 64)}
                    </div>
                    <div style="flex: 1;">
                      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap;">
                        <input type="file" id="edit-image-file" accept="image/png,image/jpeg,image/webp" style="display: none;" />
                        <button type="button" id="trigger-upload-btn" style="padding: 6px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); background: #FFF; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;">
                          📷 Upload Photo (≤2MB)
                        </button>
                        ${editingItem.imageUrl ? `
                          <button type="button" id="clear-image-btn" style="padding: 6px 10px; border-radius: 8px; border: 1px solid #DC2626; background: #FFF; color: #DC2626; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                            ✕ Remove Photo
                          </button>
                        ` : ''}
                      </div>
                      <div id="upload-status-text" style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink-secondary);">
                        ${editingItem.imageUrl ? 'Photo active. Falls back automatically if image breaks.' : 'No photo uploaded. Using curated visual family fallback.'}
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Dish Name -->
                <div style="margin-bottom: 1.2rem;">
                  <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Dish Name</label>
                  <input type="text" id="edit-name" value="${escapeHtml(editingItem.name)}" required style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 1rem; box-sizing: border-box;" />
                </div>

                <!-- Visual Family & Popular Toggle -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Fallback Visual Family</label>
                    <select id="edit-visual-key" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
                      ${Object.entries(VISUAL_FAMILIES).map(([key, fam]) => `
                        <option value="${key}" ${editingItem.visualKey === key ? 'selected' : ''}>${fam.emoji} ${fam.label}</option>
                      `).join('')}
                    </select>
                  </div>

                  <div style="display: flex; flex-direction: column; justify-content: center;">
                    <label style="display: flex; align-items: center; gap: 8px; font-family: var(--font-sans); font-size: 0.9rem; font-weight: 700; cursor: pointer; margin-top: 18px;">
                      <input type="checkbox" id="edit-is-popular" ${editingItem.isPopular ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;" />
                      <span>🔥 Mark as Popular</span>
                    </label>
                  </div>
                </div>

                <!-- Price & Prep Time -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">
                      Price (₹) ${!canEditPrice ? '<span style="color:#DC2626; font-size:0.7rem;">(🔒 Manager/Admin only)</span>' : ''}
                    </label>
                    <input type="number" id="edit-price" value="${editingItem.price}" required ${!canEditPrice ? 'disabled title="Price edits restricted to Manager or Admin"' : ''} style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; box-sizing: border-box; ${!canEditPrice ? 'background: #F3F4F6; cursor: not-allowed;' : ''}" />
                  </div>

                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Prep Time (mins)</label>
                    <input type="number" id="edit-prep" value="${editingItem.prepMinutes || 0}" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 1rem; box-sizing: border-box;" />
                  </div>
                </div>

                <!-- Taxonomy: Parent Category & Subcategory -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Parent Category</label>
                    <select id="edit-parent-category" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
                      <option value="FOOD" ${editingItem.parentCategory === 'FOOD' ? 'selected' : ''}>🍛 FOOD</option>
                      <option value="SNACKS" ${editingItem.parentCategory === 'SNACKS' ? 'selected' : ''}>🍟 SNACKS</option>
                      <option value="BEVERAGES" ${editingItem.parentCategory === 'BEVERAGES' ? 'selected' : ''}>🥤 BEVERAGES</option>
                    </select>
                  </div>

                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Subcategory</label>
                    <input type="text" id="edit-sub-category" value="${escapeHtml(editingItem.subCategory || editingItem.category || '')}" placeholder="e.g. South Indian, Sandwiches" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;" />
                  </div>
                </div>

                <!-- Tags & Sort Order -->
                <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Search Tags (comma-separated)</label>
                    <input type="text" id="edit-tags" value="${escapeHtml((editingItem.tags || []).join(', '))}" placeholder="e.g. spicy, butter, breakfast" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;" />
                  </div>
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Sort Order</label>
                    <input type="number" id="edit-sort-order" value="${editingItem.sortOrder !== undefined ? editingItem.sortOrder : 100}" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.95rem; box-sizing: border-box;" />
                  </div>
                </div>

                <!-- Dietary & Type -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Dietary Classification</label>
                    <select id="edit-dietary-type" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
                      <option value="VEG" ${editingItem.dietaryType === 'VEG' ? 'selected' : ''}>🟢 VEG</option>
                      <option value="NON_VEG" ${editingItem.dietaryType === 'NON_VEG' ? 'selected' : ''}>🔴 NON-VEG</option>
                      <option value="EGG" ${editingItem.dietaryType === 'EGG' ? 'selected' : ''}>🟡 EGG</option>
                    </select>
                  </div>

                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Item Type</label>
                    <select id="edit-type" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
                      <option value="cooked" ${editingItem.type === 'cooked' ? 'selected' : ''}>🍳 Kitchen Cooked</option>
                      <option value="instant" ${editingItem.type === 'instant' ? 'selected' : ''}>📦 Store Packaged</option>
                    </select>
                  </div>
                </div>

                <!-- Batch Date (for store items) -->
                <div style="margin-bottom: 1.8rem;">
                  <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Stock Batch / Arrival Date (Optional)</label>
                  <input type="text" id="edit-batch" value="${editingItem.batchDate || ''}" placeholder="e.g. 31-Aug / Lot #4" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.95rem; box-sizing: border-box;" />
                </div>

                <!-- Actions -->
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <button 
                    type="button" 
                    id="archive-edit-item-btn"
                    style="background: #FEF3C7; border: 1px solid #F59E0B; color: #92400E; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; padding: 8px 12px; border-radius: 8px;"
                  >
                    📦 Archive Item (Soft Delete)
                  </button>

                  <div style="display: flex; gap: 10px;">
                    <button 
                      type="button" 
                      id="cancel-edit-btn"
                      style="padding: 10px 18px; border-radius: 10px; border: 1.5px solid var(--border-light); background: var(--bg-surface); font-family: var(--font-sans); font-size: 0.9rem; font-weight: 600; cursor: pointer;"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      style="padding: 10px 24px; border-radius: 10px; background: var(--brand-red); color: #FFF; border: none; font-family: var(--font-sans); font-size: 0.95rem; font-weight: 700; cursor: pointer;"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </form>

            </div>
          </div>
          `;
        })() : ''}

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- MODAL: ADD NEW DISH                                        -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        ${showAddModal ? `
          <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem;">
            <div style="background: #FFF; border-radius: 18px; width: 100%; max-width: 500px; padding: 2rem; box-shadow: 0 20px 40px rgba(0,0,0,0.25);">
              
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <h3 style="font-family: var(--font-display); font-size: 1.8rem; margin: 0; line-height: 1;">
                  ADD NEW CANTEEN DISH
                </h3>
                <button id="close-add-modal-btn" style="background: transparent; border: none; font-size: 1.4rem; cursor: pointer; color: var(--ink-secondary);">✕</button>
              </div>

              <form id="add-dish-form">
                <div style="margin-bottom: 1.2rem;">
                  <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Dish Name</label>
                  <input type="text" id="add-name" required placeholder="e.g. Veg Cheese Sandwich" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 1rem; box-sizing: border-box;" />
                </div>

                <!-- Visual Family & Popular Toggle -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Fallback Visual Family</label>
                    <select id="add-visual-key" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
                      ${Object.entries(VISUAL_FAMILIES).map(([key, fam]) => `
                        <option value="${key}">${fam.emoji} ${fam.label}</option>
                      `).join('')}
                    </select>
                  </div>
                  <div style="display: flex; flex-direction: column; justify-content: center;">
                    <label style="display: flex; align-items: center; gap: 8px; font-family: var(--font-sans); font-size: 0.9rem; font-weight: 700; cursor: pointer; margin-top: 18px;">
                      <input type="checkbox" id="add-is-popular" style="width: 18px; height: 18px; cursor: pointer;" />
                      <span>🔥 Mark as Popular</span>
                    </label>
                  </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Price (₹)</label>
                    <input type="number" id="add-price" required placeholder="50" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; box-sizing: border-box;" />
                  </div>
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Initial Stock Quantity</label>
                    <input type="number" id="add-stock" value="25" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 1rem; box-sizing: border-box;" />
                  </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Parent Category</label>
                    <select id="add-parent-category" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
                      <option value="FOOD">🍛 FOOD</option>
                      <option value="SNACKS">🍟 SNACKS</option>
                      <option value="BEVERAGES">🥤 BEVERAGES</option>
                    </select>
                  </div>
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Subcategory</label>
                    <input type="text" id="add-sub-category" required placeholder="e.g. South Indian, Sandwiches" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;" />
                  </div>
                </div>

                <!-- Tags & Sort Order -->
                <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Search Tags (comma-separated)</label>
                    <input type="text" id="add-tags" placeholder="e.g. spicy, butter, breakfast" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;" />
                  </div>
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Sort Order</label>
                    <input type="number" id="add-sort-order" value="100" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.95rem; box-sizing: border-box;" />
                  </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Dietary</label>
                    <select id="add-dietary-type" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
                      <option value="VEG">🟢 VEG</option>
                      <option value="NON_VEG">🔴 NON-VEG</option>
                      <option value="EGG">🟡 EGG</option>
                    </select>
                  </div>
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Item Type</label>
                    <select id="add-type" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
                      <option value="cooked">🍳 Kitchen Cooked (~mins)</option>
                      <option value="instant">📦 Store Packaged (Unit Stock)</option>
                    </select>
                  </div>
                </div>

                <div style="margin-bottom: 1.8rem;">
                  <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Prep Time (mins, for cooked items)</label>
                  <input type="number" id="add-prep" value="5" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 1rem; box-sizing: border-box;" />
                </div>

                <button type="submit" style="width: 100%; padding: 14px; border-radius: 12px; background: var(--brand-red); color: #FFF; border: none; font-family: var(--font-sans); font-size: 1.05rem; font-weight: 700; cursor: pointer;">
                  Add Dish to Live Menu
                </button>
              </form>

            </div>
          </div>
        ` : ''}

        ${showCredModal ? `
          <div class="modal-overlay" style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem;">
            <div class="modal-content" style="background: #FFF; border-radius: 16px; width: 100%; max-width: 540px; padding: 2rem; box-shadow: 0 20px 40px rgba(0,0,0,0.15); max-height: 90vh; overflow-y: auto;">
              
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;">
                <h3 style="font-family: var(--font-display); font-size: 1.8rem; letter-spacing: 0.05em; margin: 0; color: var(--ink-primary);">
                  STAFF CREDENTIALS & WORKSTATION ACCESS
                </h3>
                <button id="close-cred-modal-btn" style="background: transparent; border: none; font-size: 1.4rem; cursor: pointer; color: var(--ink-secondary);">✕</button>
              </div>

              <!-- Tabs -->
              <div style="display: flex; gap: 6px; background: var(--bg-surface); padding: 4px; border-radius: 10px; border: 1.5px solid var(--border-light); margin-bottom: 1.5rem;">
                <button id="cred-tab-pin" style="flex: 1; padding: 8px; border-radius: 8px; border: none; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; background: ${credModalTab === 'pin' ? '#FFF' : 'transparent'}; color: ${credModalTab === 'pin' ? '#3B82F6' : 'var(--ink-secondary)'}; box-shadow: ${credModalTab === 'pin' ? '0 1px 4px rgba(0,0,0,0.06)' : 'none'};">
                  🔑 6-Digit Shift PIN
                </button>
                <button id="cred-tab-terminal" style="flex: 1; padding: 8px; border-radius: 8px; border: none; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer; background: ${credModalTab === 'terminal' ? '#FFF' : 'transparent'}; color: ${credModalTab === 'terminal' ? '#3B82F6' : 'var(--ink-secondary)'}; box-shadow: ${credModalTab === 'terminal' ? '0 1px 4px rgba(0,0,0,0.06)' : 'none'};">
                  🖥️ Terminal Invite Code
                </button>
              </div>

              ${credModalError ? `
                <div style="padding: 10px 14px; background: #FEE2E2; border: 1.5px solid #FCA5A5; border-radius: 8px; color: #DC2626; font-family: var(--font-mono); font-size: 0.82rem; margin-bottom: 1rem;">
                  ${escapeHtml(credModalError)}
                </div>
              ` : ''}

              ${credModalResult ? `
                <div style="background: #F0FDF4; border: 1.5px solid #86EFAC; border-radius: 12px; padding: 1.2rem; margin-bottom: 1.5rem; text-align: center;">
                  <div style="font-family: var(--font-mono); font-size: 0.8rem; color: #166534; font-weight: 700; margin-bottom: 6px;">
                    ${credModalResult.type === 'pin' ? '✅ SHIFT PIN GENERATED' : '✅ TERMINAL ENROLLMENT CODE GENERATED'}
                  </div>
                  <div style="font-family: var(--font-mono); font-size: 2.2rem; font-weight: 800; letter-spacing: 0.15em; color: #15803D; margin: 8px 0; background: #FFF; padding: 8px 16px; border-radius: 8px; border: 2px dashed #86EFAC; display: inline-block;">
                    ${escapeHtml(credModalResult.code)}
                  </div>
                  <div style="margin-top: 8px;">
                    <button id="copy-cred-code-btn" data-code="${escapeHtml(credModalResult.code)}" style="background: #166534; color: #FFF; border: none; padding: 6px 14px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                      📋 Copy to Clipboard
                    </button>
                  </div>
                  <p style="font-family: var(--font-sans); font-size: 0.8rem; color: #166534; margin: 10px 0 0 0;">
                    ${credModalResult.type === 'pin' 
                      ? `Role: <strong>${credModalResult.role.toUpperCase()}</strong> · Window: <strong>${credModalResult.window}</strong><br>Write this PIN down or provide to staff. Counter tablets can unlock with this PIN.`
                      : `Station: <strong>${credModalResult.stationName} (${credModalResult.stationType.toUpperCase()})</strong><br>Valid for 15 minutes. Enter this code on the tablet under Staff Workstation -> Enroll Terminal tab.`}
                  </p>
                </div>
              ` : ''}

              ${credModalTab === 'pin' ? `
                <div>
                  <div style="margin-bottom: 1.2rem;">
                    <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; margin-bottom: 6px; color: var(--ink-secondary);">
                      STATION / STAFF ROLE:
                    </label>
                    <select id="modal-shift-role" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.9rem;">
                      <option value="kitchen">🍳 Kitchen KDS</option>
                      <option value="pickup">🛍️ Pickup Counter</option>
                      <option value="cashier">💵 Cashier Workstation</option>
                    </select>
                  </div>

                  <div style="margin-bottom: 1.2rem;">
                    <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; margin-bottom: 6px; color: var(--ink-secondary);">
                      SHIFT TIME WINDOW:
                    </label>
                    <select id="modal-shift-window" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.9rem;">
                      <option value="FULL_DAY">☀️ FULL DAY (Operational until 23:59 IST)</option>
                      <option value="MORNING">🌅 MORNING SHIFT (Operational until 15:30 IST)</option>
                      <option value="AFTERNOON">🌇 AFTERNOON SHIFT (Operational until 22:00 IST)</option>
                    </select>
                  </div>

                  <div style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="modal-shift-force" checked style="width: 16px; height: 16px; cursor: pointer;" />
                    <label for="modal-shift-force" style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-primary); cursor: pointer;">
                      Replace / regenerate active PIN if one already exists for this shift
                    </label>
                  </div>

                  <button id="modal-generate-pin-btn" ${credModalLoading ? 'disabled' : ''} style="width: 100%; padding: 12px; border-radius: 10px; background: #3B82F6; color: #FFF; border: none; font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700; cursor: pointer;">
                    ${credModalLoading ? 'Generating Shift PIN...' : 'Generate 6-Digit Shift PIN →'}
                  </button>
                </div>
              ` : `
                <div>
                  <div style="margin-bottom: 1.2rem;">
                    <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; margin-bottom: 6px; color: var(--ink-secondary);">
                      STATION TYPE:
                    </label>
                    <select id="modal-terminal-type" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.9rem;">
                      <option value="kitchen">🍳 Kitchen KDS</option>
                      <option value="pickup">📦 Pickup Counter</option>
                      <option value="cashier">💵 Cashier Workstation</option>
                    </select>
                  </div>

                  <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; margin-bottom: 6px; color: var(--ink-secondary);">
                      TERMINAL / HARDWARE LABEL:
                    </label>
                    <input type="text" id="modal-terminal-name" placeholder="e.g. Kitchen Tablet Station 1" value="Kitchen Counter Tablet #1" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.9rem; box-sizing: border-box;" />
                  </div>

                  <button id="modal-generate-invite-btn" ${credModalLoading ? 'disabled' : ''} style="width: 100%; padding: 12px; border-radius: 10px; background: #0F172A; color: #FFF; border: none; font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700; cursor: pointer;">
                    ${credModalLoading ? 'Generating Enrollment Code...' : 'Generate 15-Minute Enrollment Code →'}
                  </button>
                </div>
              `}

            </div>
          </div>
        ` : ''}

        ${showOperationalModal && targetOperationalMode ? `
          <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem;">
            <div style="background: #FFF; border-radius: 16px; width: 100%; max-width: 520px; padding: 1.8rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2); border: 2px solid var(--border-light);">
              
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.2rem;">
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 1.5rem;">🚨</span>
                    <h3 style="font-family: var(--font-display); font-size: 1.6rem; letter-spacing: 0.05em; margin: 0; color: var(--ink-primary);">
                      CONFIRM OPERATIONAL STATUS
                    </h3>
                  </div>
                  <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin: 4px 0 0 0;">
                    Switching system-wide operational runtime to <strong>${escapeHtml(targetOperationalMode)}</strong>.
                  </p>
                </div>
                <button id="close-op-modal-btn" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--ink-secondary);">&times;</button>
              </div>

              <!-- Mode Explanation Banner -->
              <div style="padding: 12px 14px; border-radius: 10px; margin-bottom: 1.2rem; font-family: var(--font-mono); font-size: 0.82rem; ${targetOperationalMode === 'NORMAL' ? 'background: #F0FDF4; border: 1.5px solid #86EFAC; color: #166534;' : (targetOperationalMode === 'DEGRADED' ? 'background: #FFFBEB; border: 1.5px solid #FDE68A; color: #92400E;' : (targetOperationalMode === 'FINANCIAL_FROZEN' ? 'background: #FEF2F2; border: 1.5px solid #FCA5A5; color: #991B1B;' : 'background: #7F1D1D; border: 1.5px solid #991B1B; color: #FFF;'))}">
                <strong>${targetOperationalMode === 'NORMAL' ? '🟢 NORMAL OPERATIONAL MODE' : (targetOperationalMode === 'DEGRADED' ? '🟡 DEGRADED (PAUSE ONLINE)' : (targetOperationalMode === 'FINANCIAL_FROZEN' ? '🔴 FINANCIAL FREEZE' : '🛑 TOTAL EMERGENCY HALT'))}</strong>:
                <div style="margin-top: 4px; font-family: var(--font-sans); font-size: 0.8rem; opacity: 0.95;">
                  ${targetOperationalMode === 'NORMAL' ? 'Full online checkout, payment gateways, and counter ordering will be enabled for students and staff.' : (targetOperationalMode === 'DEGRADED' ? 'Student online ordering will be paused with a friendly notification. Only physical counter orders will be accepted.' : (targetOperationalMode === 'FINANCIAL_FROZEN' ? 'All payment gateways and checkouts are locked for financial audit or ledger reconciliation.' : 'TOTAL EMERGENCY SHUTDOWN: All student mutations, payments, and operational checkouts are halted immediately.'))}
                </div>
              </div>

              ${operationalModeError ? `
                <div style="padding: 10px 14px; background: #FEE2E2; border: 1.5px solid #FCA5A5; border-radius: 8px; color: #DC2626; font-family: var(--font-mono); font-size: 0.82rem; margin-bottom: 1.2rem;">
                  ${escapeHtml(operationalModeError)}
                </div>
              ` : ''}

              <!-- Preset Reasons -->
              <div style="margin-bottom: 1.2rem;">
                <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; margin-bottom: 6px; color: var(--ink-secondary);">
                  QUICK OPERATIONAL REASON:
                </label>
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                  <button type="button" class="op-preset-btn" data-reason="Resuming standard daily canteen operations" style="padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border-light); background: var(--bg-surface); font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">Standard Resume</button>
                  <button type="button" class="op-preset-btn" data-reason="Lunch rush load shedding - counter cash orders only" style="padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border-light); background: var(--bg-surface); font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">Kitchen Peak Rush</button>
                  <button type="button" class="op-preset-btn" data-reason="Midday double-entry accounting reconciliation audit" style="padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border-light); background: var(--bg-surface); font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">Financial Audit</button>
                  <button type="button" class="op-preset-btn" data-reason="Urgent emergency operational halt and campus safety review" style="padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border-light); background: var(--bg-surface); font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">Emergency Stop</button>
                </div>
              </div>

              <!-- Detailed Reason Input -->
              <div style="margin-bottom: 1.5rem;">
                <label style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; margin-bottom: 6px; color: var(--ink-secondary);">
                  OPERATIONAL AUDIT NOTE (REQUIRED):
                </label>
                <input type="text" id="op-modal-reason-input" value="${escapeHtml(operationalModeReason)}" placeholder="Provide operational reason for audit log" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.88rem; box-sizing: border-box;" />
              </div>

              <!-- Action Buttons -->
              <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="cancel-op-modal-btn" type="button" style="padding: 10px 16px; border-radius: 8px; background: transparent; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer; color: var(--ink-secondary);">
                  Cancel
                </button>
                <button id="submit-op-modal-btn" ${operationalModeLoading ? 'disabled' : ''} style="padding: 10px 20px; border-radius: 8px; background: ${targetOperationalMode === 'NORMAL' ? '#16A34A' : (targetOperationalMode === 'DEGRADED' ? '#D97706' : '#DC2626')}; color: #FFF; border: none; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                  ${operationalModeLoading ? 'Applying Transition...' : `Confirm: Switch to ${targetOperationalMode} →`}
                </button>
              </div>

            </div>
          </div>
        ` : ''}

      </div>
    `;

    // ─── Listeners & Interactions ───────────────────────────────────

    // Open/Close Add Modal
    const openAddBtn = container.querySelector('#open-add-modal-btn');
    if (openAddBtn) openAddBtn.addEventListener('click', () => { showAddModal = true; render(); });

    const closeAddBtn = container.querySelector('#close-add-modal-btn');
    if (closeAddBtn) closeAddBtn.addEventListener('click', () => { showAddModal = false; render(); });

    // Open/Close Edit Modal
    container.querySelectorAll('.edit-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-item-id');
        editingItem = currentItems.find(i => i.id === itemId);
        render();
      });
    });

    const closeEditBtn = container.querySelector('#close-edit-modal-btn');
    if (closeEditBtn) closeEditBtn.addEventListener('click', () => { editingItem = null; render(); });

    const cancelEditBtn = container.querySelector('#cancel-edit-btn');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => { editingItem = null; render(); });

    // 1. Cooked Item In-Stock Toggle
    container.querySelectorAll('.toggle-cooked-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-item-id');
        const currentAvail = btn.getAttribute('data-available') === 'true';
        btn.textContent = 'Updating...';
        await toggleItemAvailability(itemId, !currentAvail);
      });
    });

    // 2. Store Item Steppers (− / +)
    container.querySelectorAll('.minus-stock-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-item-id');
        const currentStock = Number(btn.getAttribute('data-current-stock') || 0);
        const targetStock = Math.max(0, currentStock - 1);
        const input = container.querySelector(`.stock-count-input[data-item-id="${itemId}"]`);
        if (input) input.value = targetStock;
        btn.disabled = true;
        try {
          await updateItemStockCount(itemId, targetStock);
        } catch (err) {
          console.error('Stock decrement error:', err);
        } finally {
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.plus-stock-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-item-id');
        const currentStock = Number(btn.getAttribute('data-current-stock') || 0);
        const targetStock = currentStock + 1;
        const input = container.querySelector(`.stock-count-input[data-item-id="${itemId}"]`);
        if (input) input.value = targetStock;
        btn.disabled = true;
        try {
          await updateItemStockCount(itemId, targetStock);
        } catch (err) {
          console.error('Stock increment error:', err);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // 3. Quick Restock (+5, +10, +25)
    container.querySelectorAll('.quick-restock-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-item-id');
        const currentStock = Number(btn.getAttribute('data-current-stock') || 0);
        const addAmount = Number(btn.getAttribute('data-add') || 5);
        const targetStock = currentStock + addAmount;
        const input = container.querySelector(`.stock-count-input[data-item-id="${itemId}"]`);
        if (input) input.value = targetStock;
        btn.disabled = true;
        try {
          await updateItemStockCount(itemId, targetStock);
        } catch (err) {
          console.error('Quick restock error:', err);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // 3b. Direct Mark Sold Out Button (Sets quantity to 0 and marks sold out)
    container.querySelectorAll('.mark-soldout-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-item-id');
        const input = container.querySelector(`.stock-count-input[data-item-id="${itemId}"]`);
        if (input) input.value = 0;
        btn.disabled = true;
        try {
          await updateItemStockCount(itemId, 0);
        } catch (err) {
          console.error('Mark sold out error:', err);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // 4. Direct Stock Count Input
    container.querySelectorAll('.stock-count-input').forEach(input => {
      input.addEventListener('change', async () => {
        const itemId = input.getAttribute('data-item-id');
        const val = Math.max(0, Number(input.value || 0));
        input.disabled = true;
        try {
          await updateItemStockCount(itemId, val);
        } catch (err) {
          console.error('Direct stock input error:', err);
        } finally {
          input.disabled = false;
        }
      });
    });

    // 4a. Menu Search & Stock Filter Listeners
    const searchInput = container.querySelector('#menu-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        menuSearchQuery = e.target.value;
        render();
        const nextInput = container.querySelector('#menu-search-input');
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
      });
    }

    const clearSearchBtn = container.querySelector('#clear-menu-search-btn');
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        menuSearchQuery = '';
        render();
        const nextInput = container.querySelector('#menu-search-input');
        if (nextInput) nextInput.focus();
      });
    }

    const sortFilterSelect = container.querySelector('#sort-filter-select');
    if (sortFilterSelect) {
      sortFilterSelect.addEventListener('change', (e) => {
        selectedSortOption = e.target.value;
        render();
      });
    }

    const stockFilterSelect = container.querySelector('#stock-filter-select');
    if (stockFilterSelect) {
      stockFilterSelect.addEventListener('change', (e) => {
        stockStatusFilter = e.target.value;
        render();
      });
    }

    const resetFiltersBtn = container.querySelector('#reset-all-filters-btn');
    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener('click', () => {
        menuSearchQuery = '';
        selectedParentFilter = 'ALL';
        selectedSubFilter = 'ALL';
        stockStatusFilter = 'ALL';
        selectedSortOption = 'DEFAULT';
        render();
      });
    }

    // 4b. Menu Category & Subcategory Filter Listeners
    container.querySelectorAll('.cat-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedParentFilter = btn.getAttribute('data-category');
        render();
      });
    });

    const subcatSelect = container.querySelector('#subcat-filter-select');
    if (subcatSelect) {
      subcatSelect.addEventListener('change', (e) => {
        selectedSubFilter = e.target.value;
        render();
      });
    }

    // 5. Edit Details Form Submission & Image Upload
    const editForm = container.querySelector('#edit-dish-form');
    if (editForm && editingItem) {
      const triggerUploadBtn = editForm.querySelector('#trigger-upload-btn');
      const imageFileInput = editForm.querySelector('#edit-image-file');
      const uploadStatusText = editForm.querySelector('#upload-status-text');
      const imagePreviewContainer = editForm.querySelector('#edit-image-preview-container');
      const clearImageBtn = editForm.querySelector('#clear-image-btn');

      if (triggerUploadBtn && imageFileInput) {
        triggerUploadBtn.addEventListener('click', () => imageFileInput.click());
        imageFileInput.addEventListener('change', async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) {
            alert('Image must be under 2MB.');
            return;
          }
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
            alert('Only PNG, JPEG, and WebP images are allowed.');
            return;
          }

          if (uploadStatusText) uploadStatusText.textContent = 'Uploading image...';
          triggerUploadBtn.disabled = true;

          try {
            const downloadUrl = await uploadMenuImage(editingItem.id, file);
            editingItem.imageUrl = downloadUrl;
            if (uploadStatusText) uploadStatusText.textContent = '✅ Image uploaded successfully!';
            if (imagePreviewContainer) {
              imagePreviewContainer.innerHTML = renderMenuVisualHtml(editingItem, 72, 64);
            }
          } catch (err) {
            console.error('Image upload failed:', err);
            if (uploadStatusText) uploadStatusText.textContent = '❌ Upload failed: ' + err.message;
            alert('Upload failed: ' + (err.message || err));
          } finally {
            triggerUploadBtn.disabled = false;
          }
        });
      }

      if (clearImageBtn) {
        clearImageBtn.addEventListener('click', () => {
          editingItem.imageUrl = null;
          if (uploadStatusText) uploadStatusText.textContent = 'Photo cleared. Visual family fallback will be active.';
          if (imagePreviewContainer) {
            imagePreviewContainer.innerHTML = renderMenuVisualHtml(editingItem, 72, 64);
          }
        });
      }

      editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = editForm.querySelector('#edit-name').value;
        const priceInput = editForm.querySelector('#edit-price');
        const price = priceInput && !priceInput.disabled ? Number(priceInput.value) : editingItem.price;
        const prepMinutes = Number(editForm.querySelector('#edit-prep').value || 0);
        const parentCategory = editForm.querySelector('#edit-parent-category').value;
        const subCategory = editForm.querySelector('#edit-sub-category').value;
        const dietaryType = editForm.querySelector('#edit-dietary-type').value;
        const type = editForm.querySelector('#edit-type').value;
        const batchDate = editForm.querySelector('#edit-batch').value;
        const visualKey = editForm.querySelector('#edit-visual-key') ? editForm.querySelector('#edit-visual-key').value : (editingItem.visualKey || 'food_default');
        const isPopular = editForm.querySelector('#edit-is-popular') ? editForm.querySelector('#edit-is-popular').checked : false;
        const tagsInput = editForm.querySelector('#edit-tags') ? editForm.querySelector('#edit-tags').value : '';
        const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
        const sortOrder = Number((editForm.querySelector('#edit-sort-order') && editForm.querySelector('#edit-sort-order').value) || 100);

        await updateItemDetails(editingItem.id, {
          name,
          price,
          prepMinutes,
          category: parentCategory,
          parentCategory,
          subCategory,
          dietaryType,
          type,
          batchDate,
          visualKey,
          isPopular,
          tags,
          sortOrder,
          imageUrl: editingItem.imageUrl || null
        });

        editingItem = null;
        render();
      });

      const archiveBtn = editForm.querySelector('#archive-edit-item-btn');
      if (archiveBtn) {
        archiveBtn.addEventListener('click', async () => {
          if (confirm(`Archive "${editingItem.name}"? It will be removed from customer view while preserving historical receipts.`)) {
            archiveBtn.disabled = true;
            archiveBtn.textContent = 'Archiving...';
            try {
              await archiveMenuItem(editingItem.id, 'Soft-archived from staff hub');
              editingItem = null;
              render();
            } catch (err) {
              alert('Archive Error: ' + (err.message || err));
              archiveBtn.disabled = false;
              archiveBtn.textContent = '📦 Archive Dish (Soft Delete)';
            }
          }
        });
      }

      const deleteBtn = editForm.querySelector('#delete-edit-item-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (confirm(`Are you sure you want to permanently delete "${editingItem.name}"? (Recommended: use Archive instead to preserve order history)`)) {
            await deleteMenuItem(editingItem.id);
            editingItem = null;
            render();
          }
        });
      }
    }

    // 6. Add Dish Form Submission
    const addForm = container.querySelector('#add-dish-form');
    if (addForm) {
      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = addForm.querySelector('#add-name').value;
        const price = Number(addForm.querySelector('#add-price').value);
        const stockCount = Number(addForm.querySelector('#add-stock').value || 0);
        const parentCategory = addForm.querySelector('#add-parent-category').value;
        const subCategory = addForm.querySelector('#add-sub-category').value;
        const dietaryType = addForm.querySelector('#add-dietary-type').value;
        const type = addForm.querySelector('#add-type').value;
        const prepMinutes = Number(addForm.querySelector('#add-prep').value || 0);
        const visualKey = addForm.querySelector('#add-visual-key') ? addForm.querySelector('#add-visual-key').value : 'food_default';
        const isPopular = addForm.querySelector('#add-is-popular') ? addForm.querySelector('#add-is-popular').checked : false;
        const tagsInput = addForm.querySelector('#add-tags') ? addForm.querySelector('#add-tags').value : '';
        const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
        const sortOrder = Number((addForm.querySelector('#add-sort-order') && addForm.querySelector('#add-sort-order').value) || 100);

        await saveMenuItem({
          name,
          price,
          category: parentCategory,
          parentCategory,
          subCategory,
          dietaryType,
          stockOnHand: type === 'instant' ? stockCount : 100,
          reservedStock: 0,
          prepMinutes: type === 'instant' ? 0 : prepMinutes,
          type,
          isPublished: true,
          isOrderable: true,
          available: true,
          visualKey,
          isPopular,
          tags,
          sortOrder
        });

        showAddModal = false;
        render();
      });
    }

    // 7. Emergency Operational Mode Controller Listeners
    container.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        targetOperationalMode = btn.getAttribute('data-mode');
        showOperationalModal = true;
        operationalModeError = null;
        if (targetOperationalMode === 'NORMAL') {
          operationalModeReason = 'Resuming standard daily canteen operations';
        } else if (targetOperationalMode === 'DEGRADED') {
          operationalModeReason = 'Lunch rush load shedding - counter cash orders only';
        } else if (targetOperationalMode === 'FINANCIAL_FROZEN') {
          operationalModeReason = 'Midday double-entry accounting reconciliation audit';
        } else if (targetOperationalMode === 'EMERGENCY_HALT') {
          operationalModeReason = 'Urgent emergency operational halt';
        }
        render();
      });
    });

    if (showOperationalModal) {
      container.querySelector('#close-op-modal-btn')?.addEventListener('click', () => {
        showOperationalModal = false;
        operationalModeError = null;
        render();
      });

      container.querySelector('#cancel-op-modal-btn')?.addEventListener('click', () => {
        showOperationalModal = false;
        operationalModeError = null;
        render();
      });

      container.querySelectorAll('.op-preset-btn').forEach(pBtn => {
        pBtn.addEventListener('click', () => {
          const r = pBtn.getAttribute('data-reason');
          const input = container.querySelector('#op-modal-reason-input');
          if (input) input.value = r;
          operationalModeReason = r;
        });
      });

      container.querySelector('#submit-op-modal-btn')?.addEventListener('click', async () => {
        const inputReason = container.querySelector('#op-modal-reason-input')?.value?.trim();
        const reason = inputReason || operationalModeReason || 'Manual staff operational status transition';
        operationalModeLoading = true;
        operationalModeError = null;
        render();

        try {
          const setModeFn = httpsCallable(functions, 'setSystemOperationalMode');
          await setModeFn({ mode: targetOperationalMode, reason });
          currentMode = targetOperationalMode;
          showOperationalModal = false;
          operationalModeLoading = false;
          render();
        } catch (err) {
          console.error("setSystemOperationalMode error:", err);
          operationalModeError = err.message || 'Failed to update system operational status.';
          operationalModeLoading = false;
          render();
        }
      });
    }
    // 8. Verification Applications Actions (Approve / Reject)
    container.querySelectorAll('.approve-app-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const appId = btn.getAttribute('data-app-id');
        if (!confirm(`Approve verification for application ${appId}? This will elevate the user to Teacher/Staff with Priority Queue access.`)) return;

        btn.disabled = true;
        btn.textContent = 'Approving...';
        let handled = false;
        try {
          const reviewFn = httpsCallable(functions, 'reviewVerificationApplication');
          await reviewFn({ applicationId: appId, decision: 'APPROVED' });
          handled = true;
        } catch (fnErr) {
          console.warn("reviewVerificationApplication function failed, falling back to direct Firestore update:", fnErr);
        }

        if (!handled) {
          try {
            const appRef = doc(db, 'verificationApplications', appId);
            const appSnap = await getDoc(appRef);
            if (appSnap.exists()) {
              const appData = appSnap.data();
              await updateDoc(appRef, {
                status: 'APPROVED',
                reviewedAt: Timestamp.now(),
              });
              if (appData.userId) {
                await updateDoc(doc(db, 'users', appData.userId), {
                  accountType: appData.applicationType || 'TEACHER',
                  verificationStatus: 'VERIFIED',
                  priorityLevel: 1,
                  isVerified: true,
                  updatedAt: Timestamp.now(),
                });
              }
            }
          } catch (fsErr) {
            alert('Approval Error: ' + (fsErr.message || fsErr));
            btn.disabled = false;
            btn.textContent = '✓ Approve Faculty';
          }
        }
      });
    });

    container.querySelectorAll('.reject-app-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const appId = btn.getAttribute('data-app-id');
        const reason = prompt('Reason for rejecting verification:', 'Invalid faculty proof');
        if (reason === null) return;

        btn.disabled = true;
        btn.textContent = 'Rejecting...';
        let handled = false;
        try {
          const reviewFn = httpsCallable(functions, 'reviewVerificationApplication');
          await reviewFn({ applicationId: appId, decision: 'REJECTED', reviewNotes: reason });
          handled = true;
        } catch (fnErr) {
          console.warn("reviewVerificationApplication reject function failed, falling back to direct Firestore update:", fnErr);
        }

        if (!handled) {
          try {
            const appRef = doc(db, 'verificationApplications', appId);
            const appSnap = await getDoc(appRef);
            if (appSnap.exists()) {
              const appData = appSnap.data();
              await updateDoc(appRef, {
                status: 'REJECTED',
                reviewNotes: reason,
                reviewedAt: Timestamp.now(),
              });
              if (appData.userId) {
                await updateDoc(doc(db, 'users', appData.userId), {
                  verificationStatus: 'REJECTED',
                  updatedAt: Timestamp.now(),
                });
              }
            }
          } catch (fsErr) {
            alert('Rejection Error: ' + (fsErr.message || fsErr));
            btn.disabled = false;
            btn.textContent = '✕ Reject';
          }
        }
      });
    });
    // 9. Shift PIN & Terminal Credential Modal Actions
    const genShiftPinBtn = container.querySelector('#generate-shift-pins-btn');
    if (genShiftPinBtn) {
      genShiftPinBtn.addEventListener('click', () => {
        showCredModal = true;
        credModalTab = 'pin';
        credModalResult = null;
        credModalError = null;
        render();
      });
    }

    const genTerminalInviteBtn = container.querySelector('#generate-terminal-invite-btn');
    if (genTerminalInviteBtn) {
      genTerminalInviteBtn.addEventListener('click', () => {
        showCredModal = true;
        credModalTab = 'terminal';
        credModalResult = null;
        credModalError = null;
        render();
      });
    }

    container.querySelector('#close-cred-modal-btn')?.addEventListener('click', () => {
      showCredModal = false;
      credModalResult = null;
      credModalError = null;
      render();
    });

    container.querySelector('#cred-tab-pin')?.addEventListener('click', () => {
      credModalTab = 'pin';
      credModalError = null;
      render();
    });

    container.querySelector('#cred-tab-terminal')?.addEventListener('click', () => {
      credModalTab = 'terminal';
      credModalError = null;
      render();
    });

    const copyBtn = container.querySelector('#copy-cred-code-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const code = copyBtn.getAttribute('data-code');
        if (code) {
          navigator.clipboard.writeText(code).then(() => {
            copyBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyBtn.textContent = '📋 Copy to Clipboard'; }, 2500);
          }).catch(() => {
            prompt('Copy code:', code);
          });
        }
      });
    }

    const modalGenPinBtn = container.querySelector('#modal-generate-pin-btn');
    if (modalGenPinBtn) {
      modalGenPinBtn.addEventListener('click', async () => {
        const role = container.querySelector('#modal-shift-role')?.value || 'kitchen';
        const shiftWindow = container.querySelector('#modal-shift-window')?.value || 'FULL_DAY';
        const forceRegenerate = Boolean(container.querySelector('#modal-shift-force')?.checked);

        credModalLoading = true;
        credModalError = null;
        render();

        try {
          const genFn = httpsCallable(functions, 'generateShiftPin');
          const res = await genFn({
            role: role.toLowerCase().trim(),
            shiftWindow: shiftWindow.toUpperCase().trim(),
            forceRegenerate,
          });
          const generatedPin = res.data?.pin;
          credModalResult = {
            type: 'pin',
            code: generatedPin,
            role,
            window: shiftWindow,
          };
        } catch (err) {
          credModalError = err.message || 'Failed to generate shift PIN.';
        } finally {
          credModalLoading = false;
          render();
        }
      });
    }

    const modalGenInviteBtn = container.querySelector('#modal-generate-invite-btn');
    if (modalGenInviteBtn) {
      modalGenInviteBtn.addEventListener('click', async () => {
        const type = container.querySelector('#modal-terminal-type')?.value || 'kitchen';
        const name = container.querySelector('#modal-terminal-name')?.value?.trim() || 'Counter Tablet';

        credModalLoading = true;
        credModalError = null;
        render();

        try {
          const createInviteFn = httpsCallable(functions, 'createWorkstationInvite');
          const res = await createInviteFn({ stationType: type, stationName: name });
          credModalResult = {
            type: 'terminal',
            code: res.data?.inviteCode,
            stationType: type,
            stationName: name,
          };
        } catch (err) {
          credModalError = err.message || 'Failed to generate terminal enrollment code.';
        } finally {
          credModalLoading = false;
          render();
        }
      });
    }

    container.querySelectorAll('.revoke-shift-pin-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pinId = btn.getAttribute('data-pin-id');
        if (!confirm(`Revoke shift PIN ${pinId}? All counter workstations currently logged in with this PIN will be disconnected.`)) return;

        btn.disabled = true;
        btn.textContent = 'Revoking...';
        try {
          const revokeFn = httpsCallable(functions, 'revokeShiftPin');
          await revokeFn({ pinId });
        } catch (err) {
          alert('Revoke Error: ' + (err.message || err));
          btn.disabled = false;
          btn.textContent = 'Revoke PIN';
        }
      });
    });
  }

  // Subscribe to menu items
  unsubscribeMenu = subscribeMenuItems((items) => {
    currentItems = items;
    render();
  });

  // Subscribe to operational status
  const statusDocRef = doc(db, 'publicSystemStatus', 'global');
  unsubscribeStatus = onSnapshot(statusDocRef, (snap) => {
    if (snap.exists()) {
      currentMode = snap.data()?.mode || 'NORMAL';
      render();
    }
  }, (err) => {
    console.error("Status subscription notice:", err);
  });

  if (!isStaffMode) {
    // Subscribe to verification applications (Platform 2.0)
    try {
      const appsQuery = query(
        collection(db, 'verificationApplications'),
        where('status', 'in', ['SUBMITTED', 'UNDER_REVIEW'])
      );
      unsubscribeApps = onSnapshot(appsQuery, (snap) => {
        currentApplications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        render();
      }, (err) => {
        console.warn("Verification applications subscription notice:", err);
      });
    } catch (err) {
      console.warn("Could not query verification applications:", err);
    }

    // Subscribe to active shift PINs (Platform 2.0)
    try {
      const pinsQuery = query(
        collection(db, 'shiftPins'),
        where('status', '==', 'ACTIVE')
      );
      unsubscribePins = onSnapshot(pinsQuery, (snap) => {
        currentShiftPins = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        render();
      }, (err) => {
        console.warn("Shift PINs subscription notice:", err);
      });
    } catch (err) {
      console.warn("Could not query shift PINs:", err);
    }
  }
}


