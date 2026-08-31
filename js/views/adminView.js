// Phase 11 — Live Menu & Stock Management View
import { subscribeMenuItems, toggleItemAvailability, updateItemPrice, saveMenuItem, deleteMenuItem } from '../firebase.js';

let unsubscribeMenu = null;
let currentItems = [];
let showAddModal = false;

export function renderAdminView(container) {
  if (unsubscribeMenu) {
    unsubscribeMenu();
  }

  function render() {
    container.innerHTML = `
      <div class="main-wrapper" style="max-width: 1200px; margin: 0 auto; padding: 1.5rem 1rem;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <h2 style="font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.05em; margin: 0; line-height: 1;">
              MENU & STOCK MANAGEMENT
            </h2>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--ink-secondary); margin-top: 4px;">
              Live canteen catalog. Toggling availability updates the student app in real time.
            </p>
          </div>

          <button 
            id="open-add-modal-btn"
            style="padding: 10px 18px; border-radius: 999px; background: var(--brand-red); color: #FFF; border: none; font-family: var(--font-sans); font-size: 0.9rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px;"
          >
            <span>+</span>
            <span>Add New Dish</span>
          </button>
        </div>

        <!-- Menu Items Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.2rem; margin-bottom: 2rem;">
          ${currentItems.map(item => {
            const isAvailable = item.available !== false;

            return `
              <div class="menu-admin-card" style="background: #FFF; border: 2px solid ${isAvailable ? 'var(--border-light)' : '#FCA5A5'}; border-radius: 12px; padding: 1.2rem; display: flex; flex-direction: column; justify-content: space-between; opacity: ${isAvailable ? '1' : '0.85'};">
                <div>
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem;">
                    <div>
                      <h4 style="font-family: var(--font-sans); font-size: 1.1rem; font-weight: 700; color: var(--ink-primary); margin: 0;">
                        ${item.name}
                      </h4>
                      <div style="display: flex; gap: 6px; margin-top: 4px;">
                        <span style="font-family: var(--font-mono); font-size: 0.75rem; background: var(--bg-surface); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-light);">
                          ${item.category || 'general'}
                        </span>
                        <span style="font-family: var(--font-mono); font-size: 0.75rem; background: ${item.type === 'cooked' ? '#FBE7BE' : '#DCEACB'}; color: ${item.type === 'cooked' ? '#6B4408' : '#2C4A1E'}; padding: 2px 6px; border-radius: 4px; font-weight: 600;">
                          ${item.type === 'cooked' ? `~${item.prepMinutes || 5} min` : 'Instant'}
                        </span>
                      </div>
                    </div>

                    <!-- Price Editor -->
                    <div style="display: flex; align-items: center; gap: 4px;">
                      <span style="font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700;">₹</span>
                      <input 
                        type="number" 
                        class="price-input" 
                        data-item-id="${item.id}" 
                        value="${item.price}" 
                        style="width: 60px; padding: 4px 6px; border-radius: 6px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); font-size: 1rem; font-weight: 700; text-align: center;"
                      />
                    </div>
                  </div>
                </div>

                <!-- Footer: Availability Toggle & Delete -->
                <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 0.8rem; border-top: 1px solid var(--border-light); margin-top: 0.8rem;">
                  <button 
                    class="toggle-stock-btn" 
                    data-item-id="${item.id}" 
                    data-available="${isAvailable}"
                    style="padding: 6px 12px; border-radius: 999px; border: 1.5px solid ${isAvailable ? '#22C55E' : '#EF4444'}; background: ${isAvailable ? '#F0FDF4' : '#FEF2F2'}; color: ${isAvailable ? '#15803D' : '#B91C1C'}; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;"
                  >
                    ${isAvailable ? '✓ In Stock' : '✕ Out of Stock'}
                  </button>

                  <button 
                    class="delete-item-btn" 
                    data-item-id="${item.id}"
                    data-item-name="${item.name}"
                    style="background: transparent; border: none; color: var(--ink-secondary); font-size: 0.8rem; cursor: pointer; padding: 4px 8px;"
                    title="Delete Item"
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Add New Dish Modal -->
        ${showAddModal ? `
          <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem;">
            <div style="background: #FFF; border-radius: 16px; width: 100%; max-width: 480px; padding: 1.8rem; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;">
                <h3 style="font-family: var(--font-display); font-size: 1.6rem; margin: 0;">ADD NEW MENU DISH</h3>
                <button id="close-modal-btn" style="background: transparent; border: none; font-size: 1.2rem; cursor: pointer;">✕</button>
              </div>

              <form id="add-dish-form">
                <div style="margin-bottom: 1rem;">
                  <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">Dish Name</label>
                  <input type="text" id="dish-name" required placeholder="e.g. Veg Cheese Sandwich" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); box-sizing: border-box;" />
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 1rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">Price (₹)</label>
                    <input type="number" id="dish-price" required placeholder="60" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); box-sizing: border-box;" />
                  </div>
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">Prep Time (mins)</label>
                    <input type="number" id="dish-prep" value="5" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-mono); box-sizing: border-box;" />
                  </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 1.5rem;">
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">Category</label>
                    <select id="dish-category" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); box-sizing: border-box;">
                      <option value="dosa">Dosa</option>
                      <option value="rotibhaji">Roti-Bhaji</option>
                      <option value="drinks">Drinks</option>
                      <option value="snacks">Snacks</option>
                      <option value="chinese">Chinese</option>
                      <option value="lunch">Lunch / Thali</option>
                    </select>
                  </div>
                  <div>
                    <label style="display: block; font-family: var(--font-sans); font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">Type</label>
                    <select id="dish-type" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); box-sizing: border-box;">
                      <option value="cooked">Cooked (~mins)</option>
                      <option value="instant">Instant (Ready)</option>
                    </select>
                  </div>
                </div>

                <button type="submit" style="width: 100%; padding: 12px; border-radius: 10px; background: var(--brand-red); color: #FFF; border: none; font-family: var(--font-sans); font-size: 1rem; font-weight: 700; cursor: pointer;">
                  Save to Firestore
                </button>
              </form>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Listeners
    const openAddBtn = container.querySelector('#open-add-modal-btn');
    if (openAddBtn) {
      openAddBtn.addEventListener('click', () => {
        showAddModal = true;
        render();
      });
    }

    const closeBtn = container.querySelector('#close-modal-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        showAddModal = false;
        render();
      });
    }

    // Toggle stock
    container.querySelectorAll('.toggle-stock-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-item-id');
        const currentAvail = btn.getAttribute('data-available') === 'true';
        btn.textContent = 'Updating...';
        await toggleItemAvailability(itemId, !currentAvail);
      });
    });

    // Inline price change
    container.querySelectorAll('.price-input').forEach(input => {
      input.addEventListener('change', async () => {
        const itemId = input.getAttribute('data-item-id');
        const newPrice = input.value;
        if (newPrice && Number(newPrice) > 0) {
          await updateItemPrice(itemId, newPrice);
        }
      });
    });

    // Delete item
    container.querySelectorAll('.delete-item-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-item-id');
        const itemName = btn.getAttribute('data-item-name');
        if (confirm(`Are you sure you want to delete "${itemName}"?`)) {
          await deleteMenuItem(itemId);
        }
      });
    });

    // Add form submission
    const form = container.querySelector('#add-dish-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = form.querySelector('#dish-name').value;
        const price = form.querySelector('#dish-price').value;
        const prepMinutes = form.querySelector('#dish-prep').value;
        const category = form.querySelector('#dish-category').value;
        const type = form.querySelector('#dish-type').value;

        await saveMenuItem({
          name,
          price,
          prepMinutes: type === 'instant' ? 0 : prepMinutes,
          category,
          type,
          available: true
        });

        showAddModal = false;
        render();
      });
    }
  }

  unsubscribeMenu = subscribeMenuItems((items) => {
    currentItems = items;
    render();
  });
}
