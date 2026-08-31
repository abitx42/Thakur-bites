// Phase 11 — Live Menu & Stock Management View with Distinct Cooked vs Store Item Logic
import { 
  db,
  subscribeMenuItems, 
  toggleItemAvailability, 
  updateItemStockCount, 
  updateItemDetails, 
  saveMenuItem, 
  deleteMenuItem 
} from '../firebase.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

let unsubscribeMenu = null;
let unsubscribeStatus = null;
let currentItems = [];
let showAddModal = false;
let editingItem = null; // Item object currently being edited in details modal
let currentMode = 'NORMAL';
let modeLoading = false;

export function renderAdminView(container) {
  if (unsubscribeMenu) unsubscribeMenu();
  if (unsubscribeStatus) unsubscribeStatus();

  function render() {
    const cookedItems = currentItems.filter(i => i.type === 'cooked');
    const storeItems = currentItems.filter(i => i.type === 'instant');

    const modeColors = {
      NORMAL: { bg: '#F0FDF4', border: '#86EFAC', text: '#166534', badge: '#16A34A' },
      DEGRADED: { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', badge: '#D97706' },
      FINANCIAL_FROZEN: { bg: '#FEF2F2', border: '#FCA5A5', text: '#991B1B', badge: '#DC2626' },
      EMERGENCY_HALT: { bg: '#450A0A', border: '#7F1D1D', text: '#FEF2F2', badge: '#991B1B' },
    };
    const activeColor = modeColors[currentMode] || modeColors.NORMAL;

    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1300px; margin: 0 auto; padding: 1.5rem 1rem;">
        
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
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; line-height: 1;">
                MENU & INVENTORY MANAGEMENT
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

          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.2rem;">
            ${cookedItems.map(item => {
              const isAvailable = item.available !== false;

              return `
                <div class="menu-card-admin" style="background: #FFF; border: 2px solid ${isAvailable ? 'var(--border-light)' : '#FCA5A5'}; border-radius: 14px; padding: 1.2rem; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                      <div>
                        <h4 style="font-family: var(--font-sans); font-size: 1.15rem; font-weight: 800; color: var(--ink-primary); margin: 0;">
                          ${item.name}
                        </h4>
                        <div style="display: flex; gap: 6px; margin-top: 5px;">
                          <span style="font-family: var(--font-mono); font-size: 0.75rem; background: #FBE7BE; color: #6B4408; padding: 2px 8px; border-radius: 4px; font-weight: 700;">
                            ~${item.prepMinutes || 5} min
                          </span>
                          <span style="font-family: var(--font-mono); font-size: 0.75rem; background: var(--bg-surface); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border-light);">
                            ${item.category}
                          </span>
                        </div>
                      </div>

                      <div style="text-align: right;">
                        <div style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 800; color: var(--ink-primary);">
                          ₹${item.price}
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

          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1.2rem;">
            ${storeItems.map(item => {
              const stock = item.stockCount || 0;
              const isInStock = stock > 0 && item.available !== false;

              return `
                <div class="menu-card-admin" style="background: ${isInStock ? '#FFF' : '#FFFDF7'}; border: 2px solid ${isInStock ? 'var(--border-light)' : '#FCA5A5'}; border-radius: 14px; padding: 1.2rem; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                      <div>
                        <h4 style="font-family: var(--font-sans); font-size: 1.15rem; font-weight: 800; color: var(--ink-primary); margin: 0;">
                          ${item.name}
                        </h4>
                        <div style="display: flex; gap: 6px; margin-top: 5px; flex-wrap: wrap;">
                          <span style="font-family: var(--font-mono); font-size: 0.75rem; background: #DCEACB; color: #2C4A1E; padding: 2px 8px; border-radius: 4px; font-weight: 700;">
                            Store Item
                          </span>
                          ${item.batchDate ? `
                            <span style="font-family: var(--font-mono); font-size: 0.75rem; background: var(--bg-surface); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border-light); color: var(--ink-secondary);">
                              📦 Batch: ${item.batchDate}
                            </span>
                          ` : ''}
                        </div>
                      </div>

                      <div style="text-align: right;">
                        <div style="font-family: var(--font-mono); font-size: 1.3rem; font-weight: 800; color: var(--ink-primary);">
                          ₹${item.price}
                        </div>
                        <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: ${isInStock ? '#16A34A' : '#DC2626'};">
                          ${isInStock ? `${stock} in stock` : '0 (Sold Out)'}
                        </span>
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

                    <!-- Quick Restock Chips (+5, +10, +25) & Edit Button -->
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div style="display: flex; gap: 4px;">
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
        </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- MODAL: EDIT ITEM DETAILS & PRICE (Infrequent changes)       -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        ${editingItem ? `
          <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem;">
            <div style="background: #FFF; border-radius: 18px; width: 100%; max-width: 500px; padding: 2rem; box-shadow: 0 20px 40px rgba(0,0,0,0.25);">
              
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
                <!-- Dish Name -->
                <div style="margin-bottom: 1.2rem;">
                  <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Dish Name</label>
                  <input type="text" id="edit-name" value="${editingItem.name}" required style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 1rem; box-sizing: border-box;" />
                </div>

                <!-- Price & Prep Time -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Price (₹)</label>
                    <input type="number" id="edit-price" value="${editingItem.price}" required style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; box-sizing: border-box;" />
                  </div>

                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Prep Time (mins)</label>
                    <input type="number" id="edit-prep" value="${editingItem.prepMinutes || 0}" style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 1rem; box-sizing: border-box;" />
                  </div>
                </div>

                <!-- Category & Type -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1.2rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Category</label>
                    <select id="edit-category" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
                      <option value="dosa" ${editingItem.category === 'dosa' ? 'selected' : ''}>Dosa</option>
                      <option value="rotibhaji" ${editingItem.category === 'rotibhaji' ? 'selected' : ''}>Roti-Bhaji</option>
                      <option value="drinks" ${editingItem.category === 'drinks' ? 'selected' : ''}>Drinks</option>
                      <option value="snacks" ${editingItem.category === 'snacks' ? 'selected' : ''}>Snacks</option>
                      <option value="lunch" ${editingItem.category === 'lunch' ? 'selected' : ''}>Lunch / Meals</option>
                      <option value="chinese" ${editingItem.category === 'chinese' ? 'selected' : ''}>Chinese</option>
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
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <button 
                    type="button" 
                    id="delete-edit-item-btn"
                    style="background: transparent; border: none; color: #DC2626; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer; padding: 8px;"
                  >
                    🗑️ Delete Item
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
        ` : ''}

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
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 700; margin-bottom: 4px;">Category</label>
                    <select id="add-category" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
                      <option value="dosa">Dosa</option>
                      <option value="rotibhaji">Roti-Bhaji</option>
                      <option value="drinks">Drinks</option>
                      <option value="snacks">Snacks</option>
                      <option value="lunch">Lunch / Meals</option>
                      <option value="chinese">Chinese</option>
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
        const currentStock = Number(btn.getAttribute('data-current-stock'));
        await updateItemStockCount(itemId, Math.max(0, currentStock - 1));
      });
    });

    container.querySelectorAll('.plus-stock-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-item-id');
        const currentStock = Number(btn.getAttribute('data-current-stock'));
        await updateItemStockCount(itemId, currentStock + 1);
      });
    });

    // 3. Quick Restock (+5, +10, +25)
    container.querySelectorAll('.quick-restock-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-item-id');
        const currentStock = Number(btn.getAttribute('data-current-stock'));
        const addAmount = Number(btn.getAttribute('data-add'));
        await updateItemStockCount(itemId, currentStock + addAmount);
      });
    });

    // 4. Direct Stock Count Input
    container.querySelectorAll('.stock-count-input').forEach(input => {
      input.addEventListener('change', async () => {
        const itemId = input.getAttribute('data-item-id');
        const val = Math.max(0, Number(input.value || 0));
        await updateItemStockCount(itemId, val);
      });
    });

    // 5. Edit Details Form Submission
    const editForm = container.querySelector('#edit-dish-form');
    if (editForm && editingItem) {
      editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = editForm.querySelector('#edit-name').value;
        const price = editForm.querySelector('#edit-price').value;
        const prepMinutes = editForm.querySelector('#edit-prep').value;
        const category = editForm.querySelector('#edit-category').value;
        const type = editForm.querySelector('#edit-type').value;
        const batchDate = editForm.querySelector('#edit-batch').value;

        await updateItemDetails(editingItem.id, {
          name,
          price,
          prepMinutes,
          category,
          type,
          batchDate
        });

        editingItem = null;
        render();
      });

      const deleteBtn = editForm.querySelector('#delete-edit-item-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (confirm(`Are you sure you want to delete "${editingItem.name}"?`)) {
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
        const price = addForm.querySelector('#add-price').value;
        const stockCount = addForm.querySelector('#add-stock').value;
        const category = addForm.querySelector('#add-category').value;
        const type = addForm.querySelector('#add-type').value;
        const prepMinutes = addForm.querySelector('#add-prep').value;

        await saveMenuItem({
          name,
          price: Number(price),
          stockOnHand: type === 'instant' ? Number(stockCount) : 100,
          reservedStock: 0,
          prepMinutes: type === 'instant' ? 0 : Number(prepMinutes),
          category,
          type,
          isPublished: true,
          isOrderable: true,
          available: true
        });

        showAddModal = false;
        render();
      });
    }

    // 7. Emergency Operational Mode Controller Listeners
    container.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetMode = btn.getAttribute('data-mode');
        const reason = prompt(`Reason for changing operational status to ${targetMode}:`, `Staff manual override to ${targetMode}`);
        if (reason === null) return; // User cancelled

        try {
          modeLoading = true;
          render();
          const functions = getFunctions();
          const setModeFn = httpsCallable(functions, 'setSystemOperationalMode');
          await setModeFn({ mode: targetMode, reason: reason || 'Manual admin override' });
          currentMode = targetMode;
        } catch (err) {
          alert('Mode Transition Error: ' + (err.message || err));
        } finally {
          modeLoading = false;
          render();
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
}

