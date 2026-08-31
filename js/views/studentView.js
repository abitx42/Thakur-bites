// Student Mobile View for Thakur Bites
import { MENU_CATEGORIES, MENU_ITEMS } from '../data/menu.js';
import { appState } from '../state.js';

export function renderStudentView(container) {
  const { 
    activeCategory, 
    searchQuery, 
    vegOnlyFilter, 
    todaysBoard, 
    cart, 
    outOfStockItems,
    lastPlacedOrder,
    selectedPickupSlot
  } = appState;

  // Filter items
  const filteredItems = MENU_ITEMS.filter(item => {
    if (activeCategory !== 'all' && item.category !== activeCategory) return false;
    if (vegOnlyFilter && !item.isVeg) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchDesc = item.description.toLowerCase().includes(q);
      const matchCat = item.category.toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchCat) return false;
    }
    return true;
  });

  const cartItemCount = cart.reduce((sum, ci) => sum + ci.quantity, 0);
  const cartTotal = appState.getCartTotal();
  const waitTime = appState.getCartEstimatedWaitTime();

  container.innerHTML = `
    <!-- Today's Board Pinned Banner -->
    <div class="todays-board-banner">
      <div class="todays-board-content">
        <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
          <span class="board-tag">📢 TODAY'S BOARD</span>
          <span class="board-sabji-pill">🍛 Sabji 1: ${todaysBoard.sabji1}</span>
          <span class="board-sabji-pill">🍲 Sabji 2: ${todaysBoard.sabji2}</span>
          <span class="board-sabji-pill" style="border-color: #F87171; color: #991B1B;">⭐ Special: ${todaysBoard.canteenSpecial}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="bread-status-pill ${todaysBoard.rotiAvailable ? 'bread-available' : 'bread-soldout'}">
            Roti: ${todaysBoard.rotiAvailable ? '✓ Ready' : '✗ Sold Out'}
          </span>
          <span class="bread-status-pill ${todaysBoard.puriAvailable ? 'bread-available' : 'bread-soldout'}">
            Puri: ${todaysBoard.puriAvailable ? '✓ Ready' : '✗ Sold Out'}
          </span>
        </div>
      </div>
    </div>

    <div class="main-wrapper">
      <!-- Search & Filter Controls -->
      <div style="display: flex; gap: 0.75rem; margin-bottom: 1.25rem; flex-wrap: wrap; align-items: center;">
        <div style="flex-grow: 1; min-width: 260px; position: relative;">
          <input 
            type="text" 
            id="student-search-input"
            placeholder="Search 80+ canteen items (e.g. Masala Dosa, Schezwan Rice, Chai)..." 
            value="${searchQuery}"
            style="width: 100%; padding: 10px 14px 10px 40px; border-radius: 10px; border: 2px solid var(--border-light); font-size: 0.95rem; font-family: var(--font-sans); outline: none; background: #FFF;"
          />
          <span style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); font-size: 1.1rem; opacity: 0.5;">🔍</span>
          ${searchQuery ? `<button id="clear-search-btn" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; font-weight: bold; cursor: pointer; color: var(--ink-muted);">✕</button>` : ''}
        </div>

        <button 
          id="veg-filter-toggle"
          style="padding: 9px 16px; border-radius: 10px; border: 2px solid ${vegOnlyFilter ? 'var(--curry-green)' : 'var(--border-light)'}; background: ${vegOnlyFilter ? 'var(--curry-green-light)' : '#FFF'}; color: ${vegOnlyFilter ? 'var(--curry-green)' : 'var(--ink-secondary)'}; font-weight: 700; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; gap: 6px;"
        >
          <span class="veg-symbol" style="border-color: var(--curry-green);"><span class="veg-dot" style="background: var(--curry-green);"></span></span>
          Pure Veg Only
        </button>

        ${lastPlacedOrder ? `
          <button 
            id="view-active-ticket-btn"
            style="padding: 9px 16px; border-radius: 10px; background: var(--chili-red); color: #FFF; border: none; font-family: var(--font-mono); font-weight: 700; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: var(--shadow-sm);"
          >
            🎟️ View Token #${lastPlacedOrder.tokenNumber}
          </button>
        ` : ''}
      </div>

      <!-- Category Filter Pills -->
      <div class="category-scroller">
        ${MENU_CATEGORIES.map(cat => `
          <button 
            class="cat-pill ${activeCategory === cat.id ? 'active' : ''}" 
            data-category="${cat.id}"
          >
            <span>${cat.icon}</span>
            <span>${cat.name}</span>
            ${cat.tag ? `<span style="font-size: 0.65rem; opacity: 0.8; font-family: var(--font-mono); background: rgba(0,0,0,0.1); padding: 1px 5px; border-radius: 4px;">${cat.tag}</span>` : ''}
          </button>
        `).join('')}
      </div>

      <!-- Menu Items Grid -->
      <div class="menu-grid">
        ${filteredItems.length === 0 ? `
          <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; background: #FFF; border-radius: 12px; border: 2px dashed var(--border-light);">
            <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🍽️</div>
            <h3 style="font-size: 1.25rem; font-weight: 700;">No items found matching "${searchQuery}"</h3>
            <p style="color: var(--ink-muted); font-size: 0.9rem; margin-top: 0.25rem;">Try searching for dosa, noodles, sandwich, thali, or chai.</p>
          </div>
        ` : filteredItems.map(item => {
          const isSoldOut = outOfStockItems.has(item.id);
          const qtyInCart = appState.getItemQtyInCart(item.id);
          
          let tierBadgeClass = 'tier-instant';
          let tierText = 'Instant ⚡ (0m)';
          if (item.tier === 'tier2_batch') {
            tierBadgeClass = 'tier-batch';
            tierText = 'Batch-Ready 🍲 (1-2m)';
          } else if (item.tier === 'tier3_cook') {
            tierBadgeClass = 'tier-cook';
            tierText = `Cook-to-Order 🍳 (~${item.prepTime}m)`;
          }

          return `
            <div class="item-card ${isSoldOut ? 'opacity-50' : ''}">
              <div>
                <div class="item-badge-row">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <div class="veg-symbol"><div class="veg-dot"></div></div>
                    ${item.isPopular ? `<span style="background: #FEF3C7; color: #B45309; font-size: 0.65rem; font-weight: 700; font-family: var(--font-mono); padding: 1px 6px; border-radius: 4px; border: 1px solid #FCD34D;">⭐ TOP SELLER</span>` : ''}
                  </div>
                  <span class="tier-badge ${tierBadgeClass}">${tierText}</span>
                </div>

                ${item.imageUrl ? `<img class="item-photo" src="${item.imageUrl}" alt="${item.name}" loading="lazy" />` : ''}
                <h3 class="item-title">${item.name}</h3>
                <p class="item-desc">${item.description}</p>

                ${item.customizable && item.options?.breadChoice ? `
                  <div style="margin-bottom: 0.75rem; background: #F8FAFC; padding: 6px 10px; border-radius: 6px; border: 1px dashed #CBD5E1; font-size: 0.75rem;">
                    <span style="font-weight: 600; color: var(--ink-secondary);">Bread Choice:</span>
                    <div style="display: flex; gap: 4px; margin-top: 4px;">
                      ${item.options.breadChoice.map((b, idx) => `
                        <label style="display: flex; align-items: center; gap: 3px; font-size: 0.75rem; cursor: pointer;">
                          <input type="radio" name="bread_${item.id}" value="${b}" ${idx === 0 ? 'checked' : ''} />
                          <span>${b}</span>
                        </label>
                      `).join('')}
                    </div>
                  </div>
                ` : ''}

                ${item.hasVariants ? `
                  <div style="display: flex; gap: 6px; margin-bottom: 0.75rem;">
                    ${item.variants.map((v, vIdx) => `
                      <button 
                        class="variant-btn ${vIdx === 0 ? 'active' : ''}"
                        data-item-id="${item.id}"
                        data-variant-name="${v.name}"
                        data-variant-price="${v.price}"
                        style="flex: 1; padding: 4px 8px; border: 1px solid var(--border-light); border-radius: 6px; font-size: 0.75rem; font-family: var(--font-mono); background: ${vIdx === 0 ? 'var(--ink-primary)' : '#FFF'}; color: ${vIdx === 0 ? '#FFF' : 'var(--ink-secondary)'}; cursor: pointer;"
                      >
                        ${v.name} · ₹${v.price}
                      </button>
                    `).join('')}
                  </div>
                ` : ''}
              </div>

              <div class="item-footer">
                <div>
                  <span class="item-price">₹${item.basePrice}</span>
                  ${item.hasVariants ? `<span style="font-size: 0.7rem; color: var(--ink-muted); margin-left: 4px;">onwards</span>` : ''}
                </div>

                ${isSoldOut ? `
                  <span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: #DC2626; background: #FEE2E2; padding: 4px 8px; border-radius: 6px;">SOLD OUT</span>
                ` : qtyInCart > 0 ? `
                  <div class="stepper-btn-group">
                    <button class="stepper-btn" data-action="decrement" data-item-id="${item.id}">−</button>
                    <span class="stepper-val">${qtyInCart}</span>
                    <button class="stepper-btn" data-action="increment" data-item-id="${item.id}">+</button>
                  </div>
                ` : `
                  <button class="add-btn" data-action="add-to-cart" data-item-id="${item.id}">+ ADD</button>
                `}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Floating Sticky Cart Bar -->
    ${cartItemCount > 0 ? `
      <div class="cart-floating-bar" id="open-cart-drawer-btn">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="background: var(--turmeric-yellow); color: var(--ink-primary); font-family: var(--font-mono); font-weight: 800; font-size: 0.9rem; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
            ${cartItemCount}
          </div>
          <div>
            <div style="font-family: var(--font-mono); font-weight: 700; font-size: 1rem;">₹${cartTotal} · View Order</div>
            <div style="font-size: 0.75rem; color: #D4D4D8;">Est. Ready in ~${waitTime} mins · Next Break Slot</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.9rem; color: var(--turmeric-yellow);">
          <span>PROCEED</span>
          <span>→</span>
        </div>
      </div>
    ` : ''}

    <!-- Cart Drawer Container (Hidden by default, opened by event) -->
    <div id="cart-drawer-container"></div>

    <!-- Active Ticket Modal Container -->
    <div id="active-ticket-modal-container"></div>
  `;

  attachStudentViewEvents(container);
}

function attachStudentViewEvents(container) {
  // Search input
  const searchInput = container.querySelector('#student-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      appState.setSearchQuery(e.target.value);
    });
  }

  // Clear search
  const clearSearchBtn = container.querySelector('#clear-search-btn');
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      appState.setSearchQuery('');
    });
  }

  // Veg filter
  const vegToggle = container.querySelector('#veg-filter-toggle');
  if (vegToggle) {
    vegToggle.addEventListener('click', () => {
      appState.toggleVegOnly();
    });
  }

  // Category Pills
  const catPills = container.querySelectorAll('.cat-pill');
  catPills.forEach(pill => {
    pill.addEventListener('click', () => {
      appState.setCategory(pill.getAttribute('data-category'));
    });
  });

  // Variant selector buttons
  const variantBtns = container.querySelectorAll('.variant-btn');
  variantBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const parent = e.target.parentElement;
      parent.querySelectorAll('.variant-btn').forEach(b => {
        b.style.background = '#FFF';
        b.style.color = 'var(--ink-secondary)';
        b.classList.remove('active');
      });
      btn.style.background = 'var(--ink-primary)';
      btn.style.color = '#FFF';
      btn.classList.add('active');
    });
  });

  // Add to cart buttons
  const addButtons = container.querySelectorAll('[data-action="add-to-cart"]');
  addButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const itemId = btn.getAttribute('data-item-id');
      const item = MENU_ITEMS.find(m => m.id === itemId);
      if (!item) return;

      // Check variant selection
      const card = btn.closest('.item-card');
      let selectedVariant = null;
      if (item.hasVariants) {
        const activeVarBtn = card.querySelector('.variant-btn.active');
        if (activeVarBtn) {
          selectedVariant = {
            name: activeVarBtn.getAttribute('data-variant-name'),
            price: Number(activeVarBtn.getAttribute('data-variant-price'))
          };
        }
      }

      // Check bread option
      let customOptions = {};
      const breadRadio = card.querySelector(`input[name="bread_${item.id}"]:checked`);
      if (breadRadio) {
        customOptions.bread = breadRadio.value;
      }

      appState.addToCart(item, selectedVariant, customOptions);
    });
  });

  // Stepper increment/decrement
  const steppers = container.querySelectorAll('.stepper-btn');
  steppers.forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = btn.getAttribute('data-item-id');
      const action = btn.getAttribute('data-action');
      const cartItem = appState.cart.find(ci => ci.menuItemId === itemId);
      if (cartItem) {
        appState.updateCartQty(cartItem.key, action === 'increment' ? 1 : -1);
      }
    });
  });

  // Open Cart Drawer
  const openCartBtn = container.querySelector('#open-cart-drawer-btn');
  if (openCartBtn) {
    openCartBtn.addEventListener('click', () => {
      openCartDrawer();
    });
  }

  // View Active Ticket Modal
  const viewTicketBtn = container.querySelector('#view-active-ticket-btn');
  if (viewTicketBtn) {
    viewTicketBtn.addEventListener('click', () => {
      openActiveTicketModal(appState.lastPlacedOrder);
    });
  }
}

// Render Cart Drawer
export function openCartDrawer() {
  const container = document.getElementById('cart-drawer-container');
  if (!container) return;

  const { cart, selectedPickupSlot, currentStudent } = appState;
  const total = appState.getCartTotal();
  const waitTime = appState.getCartEstimatedWaitTime();

  container.innerHTML = `
    <div class="cart-drawer-overlay" id="close-drawer-backdrop">
      <div class="cart-drawer" onclick="event.stopPropagation()">
        <div class="drawer-header">
          <div>
            <h2>YOUR CANTEEN TRAY</h2>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #D4D4D8;">
              ${cart.length} distinct item(s) · TCET / TSA Food Counter
            </div>
          </div>
          <button id="close-drawer-x" style="background: none; border: none; color: #FFF; font-size: 1.5rem; cursor: pointer;">✕</button>
        </div>

        <div class="drawer-body">
          <!-- Time Slot Selection Card -->
          <div style="background: #FFFFFF; border: 2px solid var(--border-light); border-radius: 10px; padding: 1rem; margin-bottom: 1.25rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
              <span style="font-weight: 700; font-size: 0.85rem; color: var(--ink-primary);">⏰ PICKUP TIME SLOT</span>
              <span style="font-family: var(--font-mono); font-size: 0.75rem; background: #DCFCE7; color: #166534; padding: 2px 8px; border-radius: 4px; font-weight: 700;">Live Kitchen Throttle</span>
            </div>
            <select id="pickup-slot-select" style="width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-light); font-family: var(--font-mono); font-size: 0.85rem; font-weight: 600; background: #F8FAFC;">
              <option value="Next Available (~${waitTime} mins)" selected>⚡ Next Available Slot (~${waitTime} mins wait)</option>
              <option value="Morning Break 1 (11:00 AM - 11:15 AM)">🏫 Morning Break 1 (11:00 AM - 11:15 AM)</option>
              <option value="Lunch Break (01:15 PM - 01:45 PM)">🍛 Lunch Break (01:15 PM - 01:45 PM)</option>
              <option value="Evening Break 2 (03:30 PM - 03:45 PM)">☕ Evening Break 2 (03:30 PM - 03:45 PM)</option>
            </select>
          </div>

          <!-- Items List -->
          <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            ${cart.map(item => `
              <div style="background: #FFFFFF; border: 1px solid var(--border-light); border-radius: 8px; padding: 0.85rem; display: flex; align-items: center; justify-content: space-between;">
                <div style="flex-grow: 1;">
                  <div style="font-weight: 700; font-size: 0.95rem;">${item.name}</div>
                  <div style="font-size: 0.75rem; font-family: var(--font-mono); color: var(--ink-muted);">
                    ${item.variantName !== 'Regular' ? `Variant: ${item.variantName} · ` : ''}
                    ${item.customOptions?.bread ? `Bread: ${item.customOptions.bread} · ` : ''}
                    ₹${item.price} each
                  </div>
                </div>

                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div class="stepper-btn-group" style="height: 28px;">
                    <button class="stepper-btn" style="width: 26px; height: 26px;" data-cart-key="${item.key}" data-delta="-1">−</button>
                    <span class="stepper-val" style="font-size: 0.8rem;">${item.quantity}</span>
                    <button class="stepper-btn" style="width: 26px; height: 26px;" data-cart-key="${item.key}" data-delta="1">+</button>
                  </div>
                  <div style="font-family: var(--font-mono); font-weight: 700; font-size: 0.95rem; min-width: 50px; text-align: right;">
                    ₹${item.price * item.quantity}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Student Information -->
          <div style="margin-top: 1.25rem; background: #FFFFFF; border: 1px solid var(--border-light); border-radius: 8px; padding: 0.85rem;">
            <div style="font-weight: 700; font-size: 0.8rem; color: var(--ink-secondary); margin-bottom: 0.5rem;">STUDENT VERIFICATION</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <input type="text" id="student-name-input" value="${currentStudent.name}" placeholder="Your Name" style="padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-light); font-size: 0.8rem;" />
              <input type="text" id="student-roll-input" value="${currentStudent.rollNo}" placeholder="Roll / ID" style="padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-light); font-size: 0.8rem; font-family: var(--font-mono);" />
            </div>
          </div>

          <!-- Payment Method -->
          <div style="margin-top: 1.25rem; background: #FFFFFF; border: 1px solid var(--border-light); border-radius: 8px; padding: 0.85rem;">
            <div style="font-weight: 700; font-size: 0.8rem; color: var(--ink-secondary); margin-bottom: 0.5rem;">PAYMENT MODE</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.8rem; font-family: var(--font-mono);">
              <label style="display: flex; align-items: center; gap: 6px; padding: 6px; border: 1px solid var(--border-light); border-radius: 6px; cursor: pointer;">
                <input type="radio" name="payment_mode" value="UPI (GPay / PhonePe)" checked />
                <span>📱 UPI / GPay</span>
              </label>
              <label style="display: flex; align-items: center; gap: 6px; padding: 6px; border: 1px solid var(--border-light); border-radius: 6px; cursor: pointer;">
                <input type="radio" name="payment_mode" value="Campus Card" />
                <span>💳 Campus Card</span>
              </label>
              <label style="display: flex; align-items: center; gap: 6px; padding: 6px; border: 1px solid var(--border-light); border-radius: 6px; cursor: pointer;">
                <input type="radio" name="payment_mode" value="Paytm Wallet" />
                <span>👛 Paytm</span>
              </label>
              <label style="display: flex; align-items: center; gap: 6px; padding: 6px; border: 1px solid var(--border-light); border-radius: 6px; cursor: pointer;">
                <input type="radio" name="payment_mode" value="Cash at Counter" />
                <span>💵 Pay at Desk</span>
              </label>
            </div>
          </div>
        </div>

        <div class="drawer-footer">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <div>
              <div style="font-size: 0.8rem; color: var(--ink-muted);">TOTAL BILL</div>
              <div style="font-family: var(--font-mono); font-size: 1.5rem; font-weight: 700; color: var(--ink-primary);">₹${total}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.75rem; color: var(--curry-green); font-weight: 700;">Zero Convenience Fee</div>
              <div style="font-size: 0.75rem; color: var(--ink-muted); font-family: var(--font-mono);">Instant Token Issuance</div>
            </div>
          </div>

          <button 
            id="checkout-confirm-btn"
            style="width: 100%; background: var(--chili-red); color: #FFF; border: none; padding: 12px; border-radius: 10px; font-family: var(--font-mono); font-size: 1rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 0 #991B1B;"
          >
            <span>PLACE ORDER & GET TOKEN 🎟️</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // Attach drawer events
  const closeBackdrop = container.querySelector('#close-drawer-backdrop');
  const closeBtn = container.querySelector('#close-drawer-x');
  const closeFn = () => { container.innerHTML = ''; };

  closeBackdrop.addEventListener('click', closeFn);
  closeBtn.addEventListener('click', closeFn);

  // Steppers inside cart
  container.querySelectorAll('[data-cart-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-cart-key');
      const delta = parseInt(btn.getAttribute('data-delta'));
      appState.updateCartQty(key, delta);
      if (appState.cart.length === 0) {
        closeFn();
      } else {
        openCartDrawer();
      }
    });
  });

  // Checkout confirm
  const confirmBtn = container.querySelector('#checkout-confirm-btn');
  confirmBtn.addEventListener('click', () => {
    const selectedPay = container.querySelector('input[name="payment_mode"]:checked')?.value || 'UPI (GPay)';
    const slotVal = container.querySelector('#pickup-slot-select').value;
    appState.selectedPickupSlot = slotVal;
    
    const nameInput = container.querySelector('#student-name-input').value.trim();
    const rollInput = container.querySelector('#student-roll-input').value.trim();
    if (nameInput) appState.currentStudent.name = nameInput;
    if (rollInput) appState.currentStudent.rollNo = rollInput;

    const order = appState.placeOrder(selectedPay);
    closeFn();
    openActiveTicketModal(order);
  });
}

// Signature Digital Thermal Receipt Modal
export function openActiveTicketModal(order) {
  if (!order) return;
  const container = document.getElementById('active-ticket-modal-container');
  if (!container) return;

  let statusBg = '#FEF3C7';
  let statusColor = '#B45309';
  let statusLabel = '1. Order Received by Kitchen';
  
  if (order.status === 'cooking') {
    statusBg = '#EFF6FF';
    statusColor = '#1D4ED8';
    statusLabel = '2. Active on Station Tawa/Wok';
  } else if (order.status === 'ready') {
    statusBg = '#DCFCE7';
    statusColor = '#15803D';
    statusLabel = '3. READY FOR PICKUP AT COUNTER!';
  } else if (order.status === 'served') {
    statusBg = '#F3F4F6';
    statusColor = '#4B5563';
    statusLabel = '4. Order Handed Over & Closed';
  }

  container.innerHTML = `
    <div class="cart-drawer-overlay" style="align-items: center; justify-content: center; padding: 1rem;" id="ticket-modal-backdrop">
      <div class="ticket-wrapper" onclick="event.stopPropagation()">
        <div class="ticket-stub">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
            <div>
              <div style="font-family: var(--font-display); font-size: 1.6rem; color: var(--ink-primary); line-height: 1;">THAKUR BITES</div>
              <div style="font-size: 0.65rem; color: var(--ink-muted); text-transform: uppercase;">Thakur College Canteen · Mumbai</div>
            </div>
            <button id="close-ticket-modal-btn" style="background: none; border: none; font-size: 1.25rem; cursor: pointer; color: var(--ink-muted);">✕</button>
          </div>

          <!-- Token Big Display -->
          <div style="text-align: center; margin: 1rem 0 0.5rem 0;">
            <div style="font-size: 0.75rem; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.1em;">DIGITAL TOKEN NUMBER</div>
            <div class="ticket-token-large">${order.tokenNumber}</div>
          </div>

          <!-- 4-Digit Pickup PIN -->
          <div class="ticket-pin-box">
            <div style="font-size: 0.7rem; color: var(--ink-muted); text-transform: uppercase; font-weight: 600;">COUNTER PICKUP 4-DIGIT PIN</div>
            <div style="font-size: 1.75rem; font-weight: 800; letter-spacing: 0.25em; color: var(--ink-primary);">${order.pinCode}</div>
          </div>

          <!-- Status Indicator -->
          <div style="text-align: center; margin: 0.75rem 0;">
            <span class="ticket-status-pill" style="background: ${statusBg}; color: ${statusColor};">
              ${statusLabel}
            </span>
          </div>

          <!-- Cutline -->
          <div class="ticket-cutline"></div>

          <!-- Order Summary Monospace -->
          <div style="font-size: 0.8rem; margin-bottom: 0.75rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: var(--ink-muted);">Student:</span>
              <span style="font-weight: 600;">${order.studentName} (${order.studentRoll})</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: var(--ink-muted);">Slot:</span>
              <span style="font-weight: 600;">${order.pickupSlot}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: var(--ink-muted);">Payment:</span>
              <span style="font-weight: 700; color: ${order.paymentStatus === 'PAID' ? 'var(--curry-green)' : 'var(--chili-red)'};">${order.paymentMethod} [${order.paymentStatus}]</span>
            </div>
          </div>

          <div style="border-top: 1px dashed #E4E4E7; padding-top: 0.5rem; margin-bottom: 0.5rem;">
            ${order.items.map(item => `
              <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 3px;">
                <span>${item.quantity}x ${item.name} ${item.variant && item.variant !== 'Regular' ? `(${item.variant})` : ''}</span>
                <span style="font-weight: 600;">₹${item.price * item.quantity}</span>
              </div>
            `).join('')}
          </div>

          <div style="border-top: 2px solid var(--ink-primary); padding-top: 0.5rem; display: flex; justify-content: space-between; font-size: 1rem; font-weight: 700;">
            <span>TOTAL PAID:</span>
            <span>₹${order.totalAmount}</span>
          </div>

          <!-- Interactive Test Stage Simulator for demo -->
          <div style="margin-top: 1.25rem; padding-top: 0.75rem; border-top: 1px dashed #CBD5E1; text-align: center;">
            <button 
              id="simulate-next-stage-btn"
              style="background: #F4F4F5; border: 1px solid #D4D4D8; padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; font-family: var(--font-mono); cursor: pointer; color: var(--ink-primary);"
            >
              🔄 Fast-Forward Kitchen Status (${order.status})
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  const backdrop = container.querySelector('#ticket-modal-backdrop');
  const closeBtn = container.querySelector('#close-ticket-modal-btn');
  const closeFn = () => { container.innerHTML = ''; };

  backdrop.addEventListener('click', closeFn);
  closeBtn.addEventListener('click', closeFn);

  // Fast-Forward Simulator Button
  const simBtn = container.querySelector('#simulate-next-stage-btn');
  if (simBtn) {
    simBtn.addEventListener('click', () => {
      let nextStatus = 'cooking';
      if (order.status === 'ordered') nextStatus = 'cooking';
      else if (order.status === 'cooking') nextStatus = 'ready';
      else if (order.status === 'ready') nextStatus = 'served';
      else nextStatus = 'ordered';

      appState.updateOrderStatus(order.id, nextStatus);
      openActiveTicketModal(order);
    });
  }
}
