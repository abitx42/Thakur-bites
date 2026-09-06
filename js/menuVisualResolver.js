// Thakur Bites — Universal Menu Visual Resolver (Web Portals)
// 3-Tier Fallback: Real Photo -> Food Family Visual -> Clean Icon Badge

export const VISUAL_FAMILIES = {
  dosa: { label: 'Dosa', emoji: '🥞', icon: '🥞', color: '#D97706', bg: '#FEF3C7' },
  uttappa: { label: 'Uttappa', emoji: '🍳', icon: '🍳', color: '#B45309', bg: '#FFFBEB' },
  idli_vada: { label: 'Idli & Vada', emoji: '🥥', icon: '🥥', color: '#D97706', bg: '#FEF3C7' },
  sandwich_grill: { label: 'Grill Sandwich', emoji: '🥪', icon: '🥪', color: '#EA580C', bg: '#FFEDD5' },
  sandwich_toast: { label: 'Toast Sandwich', emoji: '🍞', icon: '🍞', color: '#D97706', bg: '#FEF3C7' },
  sandwich_plain: { label: 'Fresh Sandwich', emoji: '🥪', icon: '🥪', color: '#059669', bg: '#D1FAE5' },
  noodles: { label: 'Hakka Noodles', emoji: '🍜', icon: '🍜', color: '#DC2626', bg: '#FEE2E2' },
  fried_rice: { label: 'Fried Rice', emoji: '🍚', icon: '🍚', color: '#D97706', bg: '#FEF3C7' },
  manchurian: { label: 'Manchurian', emoji: '🥢', icon: '🥢', color: '#B91C1C', bg: '#FEE2E2' },
  chinese_soup: { label: 'Chinese Soup', emoji: '🍲', icon: '🍲', color: '#C2410C', bg: '#FFEDD5' },
  thali: { label: 'Campus Thali', emoji: '🍱', icon: '🍱', color: '#B45309', bg: '#FEF3C7' },
  pav_bhaji: { label: 'Pav Bhaji', emoji: '🍛', icon: '🍛', color: '#DC2626', bg: '#FEE2E2' },
  meals_plate: { label: 'Meals Plate', emoji: '🍲', icon: '🍲', color: '#0D9488', bg: '#CCFBF1' },
  vada_pav: { label: 'Vada Pav', emoji: '🥖', icon: '🥖', color: '#D97706', bg: '#FEF3C7' },
  samosa_snack: { label: 'Samosa & Snacks', emoji: '🥟', icon: '🥟', color: '#B45309', bg: '#FEF3C7' },
  fries: { label: 'Fries', emoji: '🍟', icon: '🍟', color: '#D97706', bg: '#FEF3C7' },
  packaged_snack: { label: 'Packaged Bites', emoji: '🍫', icon: '🍫', color: '#7C3AED', bg: '#EDE9FE' },
  tea: { label: 'Chai & Tea', emoji: '☕', icon: '☕', color: '#92400E', bg: '#FEF3C7' },
  coffee: { label: 'Coffee', emoji: '☕', icon: '☕', color: '#78350F', bg: '#FFEDD5' },
  cold_drink: { label: 'Cold Drink', emoji: '🥤', icon: '🥤', color: '#0284C7', bg: '#E0F2FE' },
  fresh_juice: { label: 'Fresh Juice', emoji: '🧃', icon: '🧃', color: '#EA580C', bg: '#FFEDD5' },
  milkshake: { label: 'Milkshake', emoji: '🥛', icon: '🥛', color: '#DB2777', bg: '#FCE7F3' },
  food_default: { label: 'Food', emoji: '🍽️', icon: '🍽️', color: '#475569', bg: '#F1F5F9' },
};

export function getVisualFamily(item) {
  if (item && item.visualKey && VISUAL_FAMILIES[item.visualKey]) {
    return VISUAL_FAMILIES[item.visualKey];
  }
  const name = ((item && item.name) || '').toLowerCase();
  const cat = ((item && item.category) || '').toLowerCase();
  const sub = ((item && item.subCategory) || '').toLowerCase();

  if (sub.includes('dosa') || cat.includes('dosa') || name.includes('dosa')) return VISUAL_FAMILIES.dosa;
  if (sub.includes('uttappa') || name.includes('uttappa')) return VISUAL_FAMILIES.uttappa;
  if (sub.includes('sandwich') || cat.includes('sandwich') || name.includes('sandwich')) return VISUAL_FAMILIES.sandwich_grill;
  if (sub.includes('noodle') || cat.includes('chinese') || name.includes('noodle')) return VISUAL_FAMILIES.noodles;
  if (sub.includes('rice') || name.includes('rice')) return VISUAL_FAMILIES.fried_rice;
  if (sub.includes('pav bhaji') || name.includes('pav bhaji')) return VISUAL_FAMILIES.pav_bhaji;
  if (sub.includes('thali') || name.includes('thali')) return VISUAL_FAMILIES.thali;
  if (sub.includes('fries') || name.includes('fries')) return VISUAL_FAMILIES.fries;
  if (sub.includes('tea') || name.includes('chai') || cat.includes('tea')) return VISUAL_FAMILIES.tea;
  if (sub.includes('coffee') || name.includes('coffee') || cat.includes('coffee')) return VISUAL_FAMILIES.coffee;
  if (sub.includes('shake') || name.includes('shake')) return VISUAL_FAMILIES.milkshake;
  if (sub.includes('juice') || name.includes('juice')) return VISUAL_FAMILIES.fresh_juice;
  if (sub.includes('drink') || cat.includes('drink') || name.includes('soda')) return VISUAL_FAMILIES.cold_drink;

  return VISUAL_FAMILIES.food_default;
}

export function renderMenuVisualHtml(item, width = 64, height = 54) {
  const family = getVisualFamily(item);
  const imageUrl = item && item.imageUrl ? item.imageUrl : '';

  const fallbackHtml = `
    <div style="width: ${width}px; height: ${height}px; background: ${family.bg}; border: 1.2px solid ${family.color}33; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: ${Math.round(height * 0.44)}px; position: relative; flex-shrink: 0;">
      <span>${family.icon}</span>
      <span style="position: absolute; top: 2px; right: 3px; font-size: 10px; line-height: 1;">${family.emoji}</span>
    </div>
  `;

  if (imageUrl) {
    return `
      <div style="position: relative; width: ${width}px; height: ${height}px; flex-shrink: 0;">
        <img src="${imageUrl}" alt="${item.name || 'dish'}"
          style="width: ${width}px; height: ${height}px; object-fit: cover; border-radius: 8px; display: block;"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
        <div style="display: none; width: ${width}px; height: ${height}px; background: ${family.bg}; border: 1.2px solid ${family.color}33; border-radius: 8px; align-items: center; justify-content: center; font-size: ${Math.round(height * 0.44)}px; position: relative;">
          <span>${family.icon}</span>
          <span style="position: absolute; top: 2px; right: 3px; font-size: 10px; line-height: 1;">${family.emoji}</span>
        </div>
      </div>
    `;
  }

  return fallbackHtml;
}
