// Thakur Bites Platform 2.0 — Daily Board & Rotating Specials Modal
import { subscribeDailyBoard, saveDailyBoard } from '../firebase.js?v=9';
import { escapeHtml } from './escapeHtml.js';

const WEEKLY_DEFAULTS = {
  1: { // Monday
    day: 'MONDAY',
    sabji1: 'Paneer Kadhai',
    sabji2: 'Aloo Gobi Mutter',
    sweet: 'Suji Halwa',
    dal: 'Dal Tadka',
    rice: 'Steamed Jeera Rice',
    special: 'Fresh Hot Samosa Chole',
    badge: 'CHEF SPECIAL',
  },
  2: { // Tuesday
    day: 'TUESDAY',
    sabji1: 'Chole Masala',
    sabji2: 'Bhindi Masala Fry',
    sweet: 'Kheer',
    dal: 'Dal Fry',
    rice: 'Steamed Basmati Rice',
    special: 'Chole Bhature Platter',
    badge: 'CAMPUS HIT',
  },
  3: { // Wednesday
    day: 'WEDNESDAY',
    sabji1: 'Rajma Masala',
    sabji2: 'Jeera Aloo Fry',
    sweet: 'Elaichi Shrikhand',
    dal: 'Dal Makhani',
    rice: 'Jeera Basmati Rice',
    special: 'Veg Dum Biryani with Raita',
    badge: 'WEDNESDAY SPECIAL 🔥',
  },
  4: { // Thursday
    day: 'THURSDAY',
    sabji1: 'Dum Aloo Kashmiri',
    sabji2: 'Mix Veg Kolhapuri',
    sweet: 'Moong Dal Halwa',
    dal: 'Panchmel Dal',
    rice: 'Veg Pulao',
    special: 'Paneer Bhurji & Pav',
    badge: 'HOT PICK',
  },
  5: { // Friday
    day: 'FRIDAY',
    sabji1: 'Paneer Butter Masala',
    sabji2: 'Chana Masala',
    sweet: 'Hot Gulab Jamun',
    dal: 'Dal Tadka',
    rice: 'Jeera Rice',
    special: 'Butter Pav Bhaji & Extra Pav',
    badge: 'FRIDAY SPECIAL 🔥',
  },
  6: { // Saturday
    day: 'SATURDAY',
    sabji1: 'Veg Handi Special',
    sabji2: 'Baingan Bharta',
    sweet: 'Crispy Jalebi',
    dal: 'Dal Fry',
    rice: 'Steamed Jeera Rice',
    special: 'Triple Schezwan Rice Combo',
    badge: 'WEEKEND SPECIAL 🌶️',
  },
  0: { // Sunday
    day: 'SUNDAY',
    sabji1: 'Paneer Tikka Masala',
    sabji2: 'Mix Seasonal Veg',
    sweet: 'Gulab Jamun',
    dal: 'Dal Tadka',
    rice: 'Jeera Rice',
    special: 'Chef Weekend Special Thali',
    badge: 'SPECIAL',
  }
};

export function renderDailyBoardModal(container, onClose) {
  if (!container) return;

  const todayDate = new Date();
  const todayWeekday = todayDate.getDay();
  const defaultToday = WEEKLY_DEFAULTS[todayWeekday] || WEEKLY_DEFAULTS[1];

  let currentBoard = {
    sabji1: defaultToday.sabji1,
    sabji2: defaultToday.sabji2,
    sweetOfTheDay: defaultToday.sweet,
    dalOfTheDay: defaultToday.dal,
    riceType: defaultToday.rice,
    canteenSpecial: defaultToday.special,
    specialBadge: defaultToday.badge,
    rotiAvailable: true,
    puriAvailable: true,
    announcement: '',
  };

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'daily-board-modal-backdrop';
  modalOverlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(4px); z-index: 1000;
    display: flex; align-items: center; justify-content: center;
    padding: 1rem; box-sizing: border-box; overflow-y: auto;
  `;

  function renderForm() {
    modalOverlay.innerHTML = `
      <div style="background: #FFF; border-radius: 16px; max-width: 640px; width: 100%; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); border: 2px solid var(--border-light); overflow: hidden;">
        
        <!-- Header -->
        <div style="padding: 1.2rem 1.5rem; background: #FFFBEB; border-bottom: 2px solid #FDE68A; display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 44px; height: 44px; background: #FEF3C7; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.6rem;">
              🍱
            </div>
            <div>
              <div style="font-family: var(--font-display); font-size: 1.5rem; color: #92400E; letter-spacing: 0.03em; line-height: 1.1;">
                CANTEEN DAILY BOARD & SPECIALS
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #B45309; font-weight: 700; margin-top: 3px;">
                TODAY: ${defaultToday.day} · LIVE REAL-TIME SYNC TO STUDENTS
              </div>
            </div>
          </div>
          <button id="board-close-btn" style="background: transparent; border: none; font-size: 1.5rem; color: #92400E; cursor: pointer; padding: 4px;">✕</button>
        </div>

        <!-- Form Body -->
        <div style="padding: 1.5rem; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 1.2rem;">
          
          <!-- Sabji 1 -->
          <div>
            <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-primary); margin-bottom: 6px;">
              🥘 SABJI 1 (MAIN / PANEER GRAVY)
            </label>
            <input type="text" id="board-sabji1-input" value="${escapeHtml(currentBoard.sabji1 || '')}" placeholder="e.g. Paneer Butter Masala" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;">
              ${['Paneer Butter Masala', 'Paneer Kadhai', 'Chole Masala', 'Rajma Masala', 'Dum Aloo'].map(opt => `
                <button type="button" class="preset-chip" data-field="sabji1" data-val="${opt}" style="background: #F1F5F9; border: 1px solid #CBD5E1; padding: 3px 8px; border-radius: 6px; font-family: var(--font-sans); font-size: 0.75rem; cursor: pointer; color: #334155;">
                  ${opt}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Sabji 2 -->
          <div>
            <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-primary); margin-bottom: 6px;">
              🍛 SABJI 2 (SEASONAL / DRY VEG)
            </label>
            <input type="text" id="board-sabji2-input" value="${escapeHtml(currentBoard.sabji2 || '')}" placeholder="e.g. Mix Veg Kolhapuri" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;">
              ${['Aloo Gobi Mutter', 'Mix Veg Kolhapuri', 'Bhindi Masala', 'Jeera Aloo', 'Baingan Bharta', 'Chana Masala'].map(opt => `
                <button type="button" class="preset-chip" data-field="sabji2" data-val="${opt}" style="background: #F1F5F9; border: 1px solid #CBD5E1; padding: 3px 8px; border-radius: 6px; font-family: var(--font-sans); font-size: 0.75rem; cursor: pointer; color: #334155;">
                  ${opt}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Sweet & Dal Row -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
              <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-primary); margin-bottom: 6px;">
                🍯 SWEET OF THE DAY
              </label>
              <input type="text" id="board-sweet-input" value="${escapeHtml(currentBoard.sweetOfTheDay || '')}" placeholder="e.g. Hot Gulab Jamun" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
              <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px;">
                ${['Hot Gulab Jamun', 'Suji Halwa', 'Kheer', 'Elaichi Shrikhand', 'Jalebi'].map(opt => `
                  <button type="button" class="preset-chip" data-field="sweet" data-val="${opt}" style="background: #F1F5F9; border: 1px solid #CBD5E1; padding: 2px 6px; border-radius: 4px; font-family: var(--font-sans); font-size: 0.72rem; cursor: pointer; color: #334155;">
                    ${opt}
                  </button>
                `).join('')}
              </div>
            </div>

            <div>
              <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-primary); margin-bottom: 6px;">
                🍲 DAL OF THE DAY
              </label>
              <input type="text" id="board-dal-input" value="${escapeHtml(currentBoard.dalOfTheDay || 'Dal Tadka')}" placeholder="e.g. Dal Tadka" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
              <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px;">
                ${['Dal Tadka', 'Dal Fry', 'Dal Makhani', 'Panchmel Dal'].map(opt => `
                  <button type="button" class="preset-chip" data-field="dal" data-val="${opt}" style="background: #F1F5F9; border: 1px solid #CBD5E1; padding: 2px 6px; border-radius: 4px; font-family: var(--font-sans); font-size: 0.72rem; cursor: pointer; color: #334155;">
                    ${opt}
                  </button>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- Canteen Special / Friday Pav Bhaji Row -->
          <div style="background: #FEF2F2; border: 1.5px solid #FCA5A5; border-radius: 12px; padding: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <label style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: #991B1B; display: flex; align-items: center; gap: 6px;">
                🔥 TODAY'S CANTEEN SPECIAL HIGHLIGHT
              </label>
              <input type="text" id="board-badge-input" value="${escapeHtml(currentBoard.specialBadge || '')}" placeholder="Badge: e.g. FRIDAY SPECIAL 🔥" style="padding: 4px 8px; border-radius: 6px; border: 1px solid #F87171; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: #991B1B; width: 160px;">
            </div>
            <input type="text" id="board-special-input" value="${escapeHtml(currentBoard.canteenSpecial || '')}" placeholder="e.g. Butter Pav Bhaji & Extra Pav" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid #FCA5A5; font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box; background: #FFF;">
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;">
              ${['Butter Pav Bhaji & Extra Pav', 'Veg Dum Biryani with Raita', 'Chole Bhature Platter', 'Triple Schezwan Rice Combo'].map(opt => `
                <button type="button" class="preset-chip" data-field="special" data-val="${opt}" style="background: #FFF; border: 1px solid #FCA5A5; padding: 3px 8px; border-radius: 6px; font-family: var(--font-sans); font-size: 0.72rem; cursor: pointer; color: #991B1B;">
                  ${opt}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Bread Availability Toggles (Roti & Puri) -->
          <div style="display: flex; gap: 16px; background: #F8FAFC; border: 1.5px solid #E2E8F0; padding: 12px 16px; border-radius: 12px;">
            <label style="display: flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #334155; cursor: pointer;">
              <input type="checkbox" id="board-roti-toggle" ${currentBoard.rotiAvailable !== false ? 'checked' : ''} style="width: 18px; height: 18px;">
              🫓 Roti Available
            </label>
            <label style="display: flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #334155; cursor: pointer;">
              <input type="checkbox" id="board-puri-toggle" ${currentBoard.puriAvailable !== false ? 'checked' : ''} style="width: 18px; height: 18px;">
              🟡 Puri Available
            </label>
          </div>

          <!-- Announcement -->
          <div>
            <label style="display: block; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; color: var(--ink-primary); margin-bottom: 6px;">
              📢 BANNER ANNOUNCEMENT (OPTIONAL)
            </label>
            <input type="text" id="board-announcement-input" value="${escapeHtml(currentBoard.announcement || '')}" placeholder="e.g. Fresh Hot Pav Bhaji served from 11:30 AM!" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-light); font-family: var(--font-sans); font-size: 0.95rem; box-sizing: border-box;">
          </div>

        </div>

        <!-- Footer Actions -->
        <div style="padding: 1rem 1.5rem; background: #F8FAFC; border-top: 1.5px solid var(--border-light); display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
          <button id="board-reset-btn" type="button" style="background: transparent; border: 1.5px solid #CBD5E1; color: #475569; padding: 9px 14px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; cursor: pointer;">
            ⚡ Reset to Today's Default
          </button>
          <div style="display: flex; gap: 10px;">
            <button id="board-cancel-btn" type="button" style="background: transparent; border: 1.5px solid #CBD5E1; color: #475569; padding: 9px 16px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; cursor: pointer;">
              Cancel
            </button>
            <button id="board-publish-btn" type="button" style="background: #16A34A; color: #FFF; border: none; padding: 10px 20px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.88rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 6px rgba(22,163,74,0.3);">
              🚀 Publish Board Live
            </button>
          </div>
        </div>

      </div>
    `;

    // Preset chip listeners
    modalOverlay.querySelectorAll('.preset-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.getAttribute('data-field');
        const val = btn.getAttribute('data-val');
        if (field === 'sabji1') {
          modalOverlay.querySelector('#board-sabji1-input').value = val;
        } else if (field === 'sabji2') {
          modalOverlay.querySelector('#board-sabji2-input').value = val;
        } else if (field === 'sweet') {
          modalOverlay.querySelector('#board-sweet-input').value = val;
        } else if (field === 'dal') {
          modalOverlay.querySelector('#board-dal-input').value = val;
        } else if (field === 'special') {
          modalOverlay.querySelector('#board-special-input').value = val;
        }
      });
    });

    // Reset button
    modalOverlay.querySelector('#board-reset-btn')?.addEventListener('click', () => {
      currentBoard = {
        sabji1: defaultToday.sabji1,
        sabji2: defaultToday.sabji2,
        sweetOfTheDay: defaultToday.sweet,
        dalOfTheDay: defaultToday.dal,
        riceType: defaultToday.rice,
        canteenSpecial: defaultToday.special,
        specialBadge: defaultToday.badge,
        rotiAvailable: true,
        puriAvailable: true,
        announcement: '',
      };
      renderForm();
    });

    // Cancel & Close
    modalOverlay.querySelector('#board-close-btn')?.addEventListener('click', () => {
      modalOverlay.remove();
      if (onClose) onClose();
    });
    modalOverlay.querySelector('#board-cancel-btn')?.addEventListener('click', () => {
      modalOverlay.remove();
      if (onClose) onClose();
    });

    // Publish
    modalOverlay.querySelector('#board-publish-btn')?.addEventListener('click', async () => {
      const publishBtn = modalOverlay.querySelector('#board-publish-btn');
      publishBtn.disabled = true;
      publishBtn.textContent = 'Publishing...';

      const sabji1 = modalOverlay.querySelector('#board-sabji1-input').value.trim();
      const sabji2 = modalOverlay.querySelector('#board-sabji2-input').value.trim();
      const sweet = modalOverlay.querySelector('#board-sweet-input').value.trim();
      const dal = modalOverlay.querySelector('#board-dal-input').value.trim();
      const special = modalOverlay.querySelector('#board-special-input').value.trim();
      const badge = modalOverlay.querySelector('#board-badge-input').value.trim();
      const roti = modalOverlay.querySelector('#board-roti-toggle').checked;
      const puri = modalOverlay.querySelector('#board-puri-toggle').checked;
      const announcement = modalOverlay.querySelector('#board-announcement-input').value.trim();

      const payload = {
        date: todayDate.toISOString().split('T')[0],
        dayOfWeek: defaultToday.day,
        sabji1: sabji1 || defaultToday.sabji1,
        sabji2: sabji2 || defaultToday.sabji2,
        sweetOfTheDay: sweet || defaultToday.sweet,
        dalOfTheDay: dal || defaultToday.dal,
        riceType: currentBoard.riceType || defaultToday.rice,
        canteenSpecial: special,
        specialBadge: badge || (special ? 'SPECIAL' : ''),
        rotiAvailable: roti,
        puriAvailable: puri,
        announcement,
      };

      try {
        await saveDailyBoard(payload);
        publishBtn.textContent = '✓ Published!';
        setTimeout(() => {
          modalOverlay.remove();
          if (onClose) onClose();
        }, 500);
      } catch (err) {
        console.error('Error publishing daily board:', err);
        alert('Failed to publish daily board: ' + (err.message || err));
        publishBtn.disabled = false;
        publishBtn.textContent = '🚀 Publish Board Live';
      }
    });
  }

  // Subscribe to live daily board to pre-populate form
  const unsub = subscribeDailyBoard((liveData) => {
    if (liveData) {
      currentBoard = { ...currentBoard, ...liveData };
    }
    renderForm();
  });

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      unsub();
      modalOverlay.remove();
      if (onClose) onClose();
    }
  });

  container.appendChild(modalOverlay);
  renderForm();
}
