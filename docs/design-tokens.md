# Thakur Bites Design Tokens

Canonical design system tokens shared across the **Flutter customer mobile/web app** (`thakur_bites/`) and the **Web staff/admin/TV portals** (`css/styles.css`, `web_tv/`).

---

## 1. Color Palette

### 1.1 Brand Palette

| Token Name | Hex Code | Flutter (`AppColors`) | CSS (`:root`) | Usage |
|---|---|---|---|---|
| **Chili Red** | `#DC2626` | `AppColors.red` | `--chili-red` | Primary brand accent, action buttons, alert state |
| **Chili Red Deep** | `#B91C1C` | `AppColors.redDeep` | `--chili-red-dark` | Pressed / active state for red buttons |
| **Chili Red Soft** | `#FEE2E2` | `AppColors.redSoft` | `--chili-red-light` | Danger/alert container, sold-out badge background |
| **Turmeric Yellow** | `#D97706` | `AppColors.mustard` | `--turmeric-yellow` | Secondary brand accent, cooked items, preparing status |
| **Turmeric Soft** | `#FEF3C7` | `AppColors.mustardSoft` | `--turmeric-yellow-light` | Warning badge background, cooked food card tint |
| **Turmeric Ink** | `#B45309` | `AppColors.mustardInk` | `--turmeric-yellow-dark` | Text/icon accents on turmeric backgrounds |
| **Curry Green** | `#16A34A` | `AppColors.green` | `--curry-green` | Success state, instant/ready-made items, ready status |
| **Curry Green Soft** | `#DCFCE7` | `AppColors.greenSoft` | `--curry-green-light` | Ready badge background, instant item card tint |
| **Curry Green Ink** | `#15803D` | `AppColors.greenInk` | `--curry-green-dark` | Text/icon accents on green backgrounds |
| **Chai Brown** | `#78350F` | `AppColors.chai` | `--chai-brown` | Warm meal indicators, roti-bhaji accents |
| **Chai Brown Soft** | `#F5EBE1` | `AppColors.chaiSoft` | `--chai-brown-light` | Warm container backgrounds |

### 1.2 Neutral & Surface Palette

| Token Name | Hex Code | Flutter (`AppColors`) | CSS (`:root`) | Usage |
|---|---|---|---|---|
| **Paper Background** | `#F5F1E9` | `AppColors.bg` | `--bg-paper` | Base app & portal canvas |
| **Paper Surface** | `#FBF8EF` | `AppColors.surface` | `--bg-surface` | Elevated card surfaces |
| **Paper Surface Alt** | `#F3EFE2` | `AppColors.surface2` | `--bg-surface-alt` | Inset backgrounds, secondary controls |
| **Ink Primary** | `#18181B` | `AppColors.ink` | `--ink-primary` | Headings, primary text, high-contrast buttons |
| **Ink Secondary** | `#52525B` | `AppColors.inkSecondary`| `--ink-secondary` | Secondary body text, captions |
| **Ink Muted / Soft** | `#71717A` | `AppColors.inkSoft` | `--ink-muted` | Placeholders, inactive icons, timestamps |
| **Border Light** | `#E4DCD0` | `AppColors.line` | `--border-light` | Card outlines, dividers, input borders |
| **Border Dark** | `#18181B` | `AppColors.lineDark` | `--border-dark` | High-contrast card edges, ticket borders |

### 1.3 Semantic Status Palette

| Semantic Token | Color | Background | Flutter | CSS |
|---|---|---|---|---|
| **Success** | `#16A34A` | `#DCFCE7` | `AppColors.success`, `AppColors.successBg` | `--color-success`, `--color-success-bg` |
| **Warning** | `#D97706` | `#FEF3C7` | `AppColors.warning`, `AppColors.warningBg` | `--color-warning`, `--color-warning-bg` |
| **Danger / Error** | `#DC2626` | `#FEE2E2` | `AppColors.danger`, `AppColors.dangerBg` | `--color-danger`, `--color-danger-bg` |
| **Info / Pending** | `#2563EB` | `#EFF6FF` | `AppColors.info`, `AppColors.infoBg` | `--color-info`, `--color-info-bg` |

---

## 2. Spacing Scale

Based on a strict 4-point harmonic grid:

| Step | Value | Flutter (`AppSpacing`) | CSS (`:root`) | Standard Usage |
|---|---|---|---|---|
| **xs** | `4px` | `AppSpacing.xs` | `--space-xs` | Badge inner padding, icon-text gap |
| **sm** | `8px` | `AppSpacing.sm` | `--space-sm` | Button gap, list item vertical margin |
| **md** | `12px` | `AppSpacing.md` | `--space-md` | Card inner padding, input field padding |
| **lg** | `16px` | `AppSpacing.lg` | `--space-lg` | Standard screen edge gutter, card margins |
| **xl** | `24px` | `AppSpacing.xl` | `--space-xl` | Section spacing, modal header separation |
| **xxl**| `32px` | `AppSpacing.xxl` | `--space-xxl` | Hero spacing, empty state padding |

---

## 3. Border Radius Scale

Strict 4-tier radius system eliminating ad-hoc corner variations:

| Step | Value | Flutter (`AppRadius`) | CSS (`:root`) | Standard Usage |
|---|---|---|---|---|
| **sm** | `6px` | `AppRadius.sm` | `--radius-sm` | Tags, small badges, inline chips |
| **md** | `10px` | `AppRadius.md` | `--radius-md` | Standard action buttons, input fields |
| **lg** | `16px` | `AppRadius.lg` | `--radius-lg` | Cards, sheets, dialog containers |
| **pill**| `999px` | `AppRadius.pill` | `--radius-pill` | Stepper bars, filter pills, round avatars |

---

## 4. Typography Scale

Three-typeface functional split:
- **Display / Brand**: `Bebas Neue` (uppercase, condensed display)
- **Mono / Data**: `IBM Plex Mono` (prices, order tokens, PIN codes, timestamps)
- **UI / Body**: `Inter` (readable body text, labels, button verbs)

---

## 5. Motion Tokens

| Token | Duration | Flutter (`AppMotion`) | CSS (`:root`) | Usage |
|---|---|---|---|---|
| **Fast** | `120ms` | `AppMotion.fast` | `--duration-fast` | Hover states, tab switch highlight |
| **Normal** | `200ms` | `AppMotion.normal` | `--duration-normal` | Button press, badge expand, card reveal |
| **Slow** | `320ms` | `AppMotion.slow` | `--duration-slow` | Modal entrance, drawer slide, receipt print |
| **Easing** | `cubic-bezier(0.16, 1, 0.3, 1)` | `AppMotion.curve` (`Curves.easeOutCubic`) | `--ease-standard` | Standard natural decel easing |
