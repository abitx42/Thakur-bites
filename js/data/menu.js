// Thakur Bites - Complete Canteen Menu Catalog
// Tier Types:
//   tier1_instant: Packaged stock, bottled beverages, snacks (0-1 min)
//   tier2_batch:   Batch-ready plated food e.g., Thali, Roti-Bhaji, Dal Rice (1-2 mins)
//   tier3_cook:    Made-to-order dishes e.g., Dosa, Chinese wok, Grilled sandwiches (5-12 mins)

export const MENU_CATEGORIES = [
  { id: 'all', name: 'All Items', icon: '🍽️' },
  { id: 'lunch_thali', name: 'Daily Thali & Lunch', icon: '🍲', tag: 'Batch-Ready' },
  { id: 'south_indian', name: 'South Indian Tawa', icon: '🥞', tag: 'Live Tawa' },
  { id: 'chinese_wok', name: 'Chinese Wok Corner', icon: '🥢', tag: 'Live Wok' },
  { id: 'sandwiches', name: 'Sandwiches & Burgers', icon: '🥪', tag: 'Grill' },
  { id: 'chaat_snacks', name: 'Chaat & Quick Bites', icon: '🍟', tag: 'Express' },
  { id: 'hot_beverages', name: 'Chai & Hot Drinks', icon: '☕', tag: 'Fresh Brew' },
  { id: 'cold_beverages', name: 'Shakes & Coolers', icon: '🧃', tag: 'Chilled' }
];

export const MENU_ITEMS = [
  // ----------------------------------------------------
  // DAILY LUNCH & THALI (Tier 2: Batch Ready)
  // ----------------------------------------------------
  {
    id: 'thali_deluxe',
    name: 'Thakur Special Deluxe Thali',
    category: 'lunch_thali',
    tier: 'tier2_batch',
    station: 'thali_station',
    basePrice: 110,
    prepTime: 2,
    rating: 4.8,
    isVeg: true,
    isPopular: true,
    description: '2 Daily Sabjis, Dal Tadka, Jeera Rice, 4 Rotis or 4 Puris, Salad, Pickle, Roasted Papad & Sweet (Gulab Jamun).',
    customizable: true,
    options: {
      breadChoice: ['4 Rotis', '4 Puris', '2 Roti + 2 Puri']
    }
  },
  {
    id: 'roti_bhaji_combo',
    name: 'Executive Roti Bhaji Combo',
    category: 'lunch_thali',
    tier: 'tier2_batch',
    station: 'thali_station',
    basePrice: 65,
    prepTime: 2,
    rating: 4.6,
    isVeg: true,
    isPopular: true,
    description: 'Choice of today\'s rotating special sabji with 4 fresh hot phulkas/rotis and spiced green chutney salad.',
    customizable: true,
    options: {
      sabjiChoice: ['Today\'s Sabji 1 (Paneer Makhani)', 'Today\'s Sabji 2 (Aloo Gobi Gravy)'],
      breadChoice: ['4 Rotis', '4 Puris']
    }
  },
  {
    id: 'puri_bhaji',
    name: 'Bombay Puri Bhaji Plate',
    category: 'lunch_thali',
    tier: 'tier2_batch',
    station: 'thali_station',
    basePrice: 60,
    prepTime: 2,
    rating: 4.7,
    isVeg: true,
    isPopular: true,
    description: '5 golden fluffy puris served with spiced aloo rasawala bhaji and lemon-chilli pickle.'
  },
  {
    id: 'dal_rice_combo',
    name: 'Home-Style Dal Rice Combo',
    category: 'lunch_thali',
    tier: 'tier2_batch',
    station: 'thali_station',
    basePrice: 55,
    prepTime: 1,
    rating: 4.5,
    isVeg: true,
    hasVariants: true,
    variants: [
      { name: 'Half Plate', price: 35 },
      { name: 'Full Plate', price: 55 }
    ],
    description: 'Slow-cooked yellow dal tadka with aromatic steamed rice, fried papad and desi pickle.'
  },
  {
    id: 'veg_pulao_raita',
    name: 'Veg Dum Pulao with Boondi Raita',
    category: 'lunch_thali',
    tier: 'tier2_batch',
    station: 'thali_station',
    basePrice: 70,
    prepTime: 2,
    rating: 4.4,
    isVeg: true,
    hasVariants: true,
    variants: [
      { name: 'Half Plate', price: 45 },
      { name: 'Full Plate', price: 70 }
    ],
    description: 'Fragrant basmati rice tossed with fresh garden vegetables, whole spices, served with chilled boondi raita.'
  },
  {
    id: 'chhole_bhature',
    name: 'Amritsari Chhole Bhature (2 pcs)',
    category: 'lunch_thali',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 85,
    prepTime: 6,
    rating: 4.9,
    isVeg: true,
    isPopular: true,
    description: '2 large crisp bhatures served with robust spiced Punjabi pindi chhole, pickled onions & green chilli.'
  },
  {
    id: 'rajma_chawal',
    name: 'Punjabi Rajma Chawal Bowl',
    category: 'lunch_thali',
    tier: 'tier2_batch',
    station: 'thali_station',
    basePrice: 65,
    prepTime: 1,
    rating: 4.5,
    isVeg: true,
    description: 'Rich slow-cooked Kashmiri rajma gravy over hot steamed basmati rice with sliced onions.'
  },

  // ----------------------------------------------------
  // SOUTH INDIAN TAWA (Tier 3: Live Made to Order)
  // ----------------------------------------------------
  {
    id: 'masala_dosa',
    name: 'Crispy Butter Masala Dosa',
    category: 'south_indian',
    tier: 'tier3_cook',
    station: 'dosa_tawa',
    basePrice: 65,
    prepTime: 5,
    rating: 4.9,
    isVeg: true,
    isPopular: true,
    description: 'Golden roasted fermented crepe filled with seasoned potato bhaji, served with piping hot sambhar & 2 chutneys.'
  },
  {
    id: 'mysore_masala_dosa',
    name: 'Spicy Mysore Masala Dosa',
    category: 'south_indian',
    tier: 'tier3_cook',
    station: 'dosa_tawa',
    basePrice: 75,
    prepTime: 6,
    rating: 4.9,
    isVeg: true,
    isPopular: true,
    description: 'Dosa smeared with signature fiery red garlic chutney, filled with potato masala, fresh coriander & butter.'
  },
  {
    id: 'cheese_masala_dosa',
    name: 'Amul Cheese Burst Masala Dosa',
    category: 'south_indian',
    tier: 'tier3_cook',
    station: 'dosa_tawa',
    basePrice: 90,
    prepTime: 6,
    rating: 4.8,
    isVeg: true,
    description: 'Generously loaded with shredded Amul processed cheese and spiced aloo filling.'
  },
  {
    id: 'sada_dosa',
    name: 'Crispy Sada Dosa',
    category: 'south_indian',
    tier: 'tier3_cook',
    station: 'dosa_tawa',
    basePrice: 50,
    prepTime: 4,
    rating: 4.3,
    isVeg: true,
    description: 'Paper-thin golden crisp plain dosa served with aromatic drumstick sambhar and coconut chutney.'
  },
  {
    id: 'onion_uttapam',
    name: 'Butter Onion Tomato Uttapam',
    category: 'south_indian',
    tier: 'tier3_cook',
    station: 'dosa_tawa',
    basePrice: 70,
    prepTime: 7,
    rating: 4.6,
    isVeg: true,
    description: 'Thick, fluffy fermented pancake topped with caramelized onions, juicy tomatoes, and green chillies.'
  },
  {
    id: 'idli_sambhar',
    name: 'Steamed Idli Sambhar (2 pcs)',
    category: 'south_indian',
    tier: 'tier2_batch',
    station: 'dosa_tawa',
    basePrice: 40,
    prepTime: 2,
    rating: 4.6,
    isVeg: true,
    description: 'Soft, melt-in-mouth steamed rice cakes served with unlimited piping hot sambhar & coconut chutney.'
  },
  {
    id: 'medu_vada',
    name: 'Crispy Medu Vada Plate (2 pcs)',
    category: 'south_indian',
    tier: 'tier3_cook',
    station: 'dosa_tawa',
    basePrice: 50,
    prepTime: 4,
    rating: 4.7,
    isVeg: true,
    description: 'Crisp on the outside, fluffy on the inside lentil donuts with roasted coconut chutney and spicy sambhar.'
  },
  {
    id: 'idli_vada_combo',
    name: 'Idli Vada Mix Combo (1 Idli + 1 Vada)',
    category: 'south_indian',
    tier: 'tier2_batch',
    station: 'dosa_tawa',
    basePrice: 45,
    prepTime: 2,
    rating: 4.7,
    isVeg: true,
    isPopular: true,
    description: 'The best of both worlds: 1 steamed soft idli and 1 golden crispy medu vada with hot sambhar.'
  },

  // ----------------------------------------------------
  // CHINESE WOK CORNER (Tier 3: Live Made to Order)
  // ----------------------------------------------------
  {
    id: 'schezwan_fried_rice',
    name: 'Veg Schezwan Fried Rice',
    category: 'chinese_wok',
    tier: 'tier3_cook',
    station: 'chinese_wok',
    basePrice: 85,
    prepTime: 7,
    rating: 4.9,
    isVeg: true,
    isPopular: true,
    hasVariants: true,
    variants: [
      { name: 'Half Plate', price: 55 },
      { name: 'Full Plate', price: 85 }
    ],
    description: 'Wok-tossed basmati rice with shredded cabbage, carrots, bell peppers, spring onion and house-made fiery schezwan sauce.'
  },
  {
    id: 'veg_hakka_noodles',
    name: 'Classic Veg Hakka Noodles',
    category: 'chinese_wok',
    tier: 'tier3_cook',
    station: 'chinese_wok',
    basePrice: 80,
    prepTime: 6,
    rating: 4.7,
    isVeg: true,
    isPopular: true,
    hasVariants: true,
    variants: [
      { name: 'Half Plate', price: 50 },
      { name: 'Full Plate', price: 80 }
    ],
    description: 'Thin egg-less noodles tossed with crisp julienned veggies, soya, dark vinegar and toasted garlic.'
  },
  {
    id: 'triple_schezwan_rice',
    name: 'Thakur Giant Triple Schezwan Rice',
    category: 'chinese_wok',
    tier: 'tier3_cook',
    station: 'chinese_wok',
    basePrice: 120,
    prepTime: 9,
    rating: 5.0,
    isVeg: true,
    isPopular: true,
    description: 'Campus legend: Combination of Schezwan rice + Schezwan noodles served with a bowl of thick hot Manchurian gravy & fried noodles.'
  },
  {
    id: 'veg_manchurian_dry',
    name: 'Crispy Veg Manchurian Dry (8 pcs)',
    category: 'chinese_wok',
    tier: 'tier3_cook',
    station: 'chinese_wok',
    basePrice: 80,
    prepTime: 6,
    rating: 4.8,
    isVeg: true,
    hasVariants: true,
    variants: [
      { name: 'Half (4 pcs)', price: 50 },
      { name: 'Full (8 pcs)', price: 80 }
    ],
    description: 'Deep-fried minced vegetable dumplings tossed with ginger, garlic, green chillies, spring onions and tangy dark soy.'
  },
  {
    id: 'veg_manchurian_gravy',
    name: 'Veg Manchurian with Thick Gravy',
    category: 'chinese_wok',
    tier: 'tier3_cook',
    station: 'chinese_wok',
    basePrice: 85,
    prepTime: 6,
    rating: 4.6,
    isVeg: true,
    description: 'Golden vegetable dumplings immersed in a glossy, garlicky schezwan brown gravy.'
  },
  {
    id: 'paneer_chilli_dry',
    name: 'Wok-Tossed Paneer Chilli Dry',
    category: 'chinese_wok',
    tier: 'tier3_cook',
    station: 'chinese_wok',
    basePrice: 110,
    prepTime: 7,
    rating: 4.8,
    isVeg: true,
    description: 'Crispy batter-fried fresh malai paneer cubes tossed with diced capsicum, onions, green chillies and soy sauce.'
  },
  {
    id: 'manchow_soup',
    name: 'Hot & Spicy Veg Manchow Soup',
    category: 'chinese_wok',
    tier: 'tier3_cook',
    station: 'chinese_wok',
    basePrice: 50,
    prepTime: 4,
    rating: 4.5,
    isVeg: true,
    description: 'Hearty dark soup flavored with ginger, coriander, diced mushroom & veggies, served with crispy fried noodles.'
  },

  // ----------------------------------------------------
  // SANDWICHES & BURGERS (Tier 3: Live Grill / Made to Order)
  // ----------------------------------------------------
  {
    id: 'veg_cheese_grill_sw',
    name: 'Mumbai Veg Cheese Grill Sandwich',
    category: 'sandwiches',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 75,
    prepTime: 5,
    rating: 4.9,
    isVeg: true,
    isPopular: true,
    description: '3-layer jumbo bread filled with potato, cucumber, tomato, beetroot, spicy mint chutney, chaat masala and melted Amul cheese.'
  },
  {
    id: 'paneer_tikka_grill_sw',
    name: 'Tandoori Paneer Tikka Grill Sandwich',
    category: 'sandwiches',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 95,
    prepTime: 6,
    rating: 4.8,
    isVeg: true,
    description: 'Marinated paneer chunks, crunchy capsicum and tandoori mayo grilled to golden crisp perfection.'
  },
  {
    id: 'veg_toast_sandwich',
    name: 'Classic Bombay Veg Toast Sandwich',
    category: 'sandwiches',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 45,
    prepTime: 4,
    rating: 4.5,
    isVeg: true,
    description: 'Toasted buttery bread with spiced potato slices, onions, cucumber and spicy coriander-mint dip.'
  },
  {
    id: 'veg_crispy_burger',
    name: 'Campus Crispy Veg Aloo Tikki Burger',
    category: 'sandwiches',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 60,
    prepTime: 5,
    rating: 4.6,
    isVeg: true,
    description: 'Golden herb-crusted potato patty in a toasted sesame bun with lettuce, tomatoes, onions and thousand island sauce.'
  },
  {
    id: 'cheese_burger',
    name: 'Cheesy Double Crunch Veg Burger',
    category: 'sandwiches',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 75,
    prepTime: 5,
    rating: 4.7,
    isVeg: true,
    description: 'Crispy veggie patty with an Amul cheese slice, jalapeños, spicy mayo and crunchy onions.'
  },
  {
    id: 'paneer_frankie',
    name: 'Spicy Schezwan Paneer Frankie / Roll',
    category: 'sandwiches',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 70,
    prepTime: 4,
    rating: 4.7,
    isVeg: true,
    isPopular: true,
    description: 'Flaky warm paratha wrap rolled with spicy cottage cheese fingers, vinegar onions, masala and schezwan drizzle.'
  },
  {
    id: 'veg_roll',
    name: 'Classic Aloo Noodle Frankie Roll',
    category: 'sandwiches',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 50,
    prepTime: 4,
    rating: 4.4,
    isVeg: true,
    description: 'Kolkata-style soft roll stuffed with spiced potato filling, crunchy cabbage and spicy chilli sauce.'
  },

  // ----------------------------------------------------
  // CHAAT & QUICK BITES (Tier 2 & Tier 3: Express Station)
  // ----------------------------------------------------
  {
    id: 'pav_bhaji',
    name: 'Special Amul Butter Pav Bhaji (2 Pav)',
    category: 'chaat_snacks',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 80,
    prepTime: 5,
    rating: 4.9,
    isVeg: true,
    isPopular: true,
    description: 'Mashed vegetable curry cooked with Mumbai spices and excessive Amul butter, served with 2 buttery toasted ladi pavs & lemon.'
  },
  {
    id: 'extra_pav_pair',
    name: 'Extra Butter Pav (Pair)',
    category: 'chaat_snacks',
    tier: 'tier2_batch',
    station: 'grill_chaat',
    basePrice: 15,
    prepTime: 1,
    rating: 4.5,
    isVeg: true,
    description: 'Pair of fresh soft pavs pan-roasted with yellow butter and a pinch of pav bhaji masala.'
  },
  {
    id: 'vada_pav',
    name: 'Mumbai Ghati Vada Pav',
    category: 'chaat_snacks',
    tier: 'tier2_batch',
    station: 'snack_counter',
    basePrice: 18,
    prepTime: 1,
    rating: 4.9,
    isVeg: true,
    isPopular: true,
    description: 'Spiced hot batata vada tucked inside fresh pav with garlic red chutney, green chutney and fried salted chilli.'
  },
  {
    id: 'samosa_pav',
    name: 'Crispy Samosa Pav',
    category: 'chaat_snacks',
    tier: 'tier2_batch',
    station: 'snack_counter',
    basePrice: 20,
    prepTime: 1,
    rating: 4.8,
    isVeg: true,
    isPopular: true,
    description: 'Punjabi aloo samosa squashed in fresh pav with sweet tamarind and spicy mint chutneys.'
  },
  {
    id: 'maggi_cheese_masala',
    name: 'Hostel Special Cheese Masala Maggi',
    category: 'chaat_snacks',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 55,
    prepTime: 5,
    rating: 4.8,
    isVeg: true,
    description: 'Double masala Maggi cooked with butter, sweet corn, diced capsicum and topped with grated cheese.'
  },
  {
    id: 'plain_masala_maggi',
    name: 'Classic Veg Masala Maggi',
    category: 'chaat_snacks',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 40,
    prepTime: 4,
    rating: 4.5,
    isVeg: true,
    description: 'Comforting piping hot 2-minute noodles with mixed vegetables and aromatic masala seasoning.'
  },
  {
    id: 'french_fries_peri',
    name: 'Crispy Peri Peri French Fries',
    category: 'chaat_snacks',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 65,
    prepTime: 5,
    rating: 4.7,
    isVeg: true,
    description: 'Golden potato crinkle fries dusted with zesty African peri peri spice blend, served with garlic mayo.'
  },
  {
    id: 'sev_puri',
    name: 'Mumbai Chowpatty Sev Puri (6 pcs)',
    category: 'chaat_snacks',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 45,
    prepTime: 3,
    rating: 4.8,
    isVeg: true,
    description: 'Crisp flat puris layered with diced potatoes, onions, 3 types of chutneys and loaded with nylon sev.'
  },
  {
    id: 'pani_puri',
    name: 'Spicy & Tangy Pani Puri (7 pcs)',
    category: 'chaat_snacks',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 35,
    prepTime: 2,
    rating: 4.8,
    isVeg: true,
    description: 'Crispy semolina puris filled with hot ragda or spiced aloo and dunked in chilled mint-coriander spicy water.'
  },
  {
    id: 'dahi_puri',
    name: 'Chilled Sweet Dahi Puri (6 pcs)',
    category: 'chaat_snacks',
    tier: 'tier3_cook',
    station: 'grill_chaat',
    basePrice: 55,
    prepTime: 3,
    rating: 4.7,
    isVeg: true,
    description: 'Puris loaded with potato mash, sweet curd, tamarind chutney, pomegranate pearls and crunchy sev.'
  },

  // ----------------------------------------------------
  // CHAI & HOT DRINKS (Tier 3 & Tier 2: Beverage Station)
  // ----------------------------------------------------
  {
    id: 'cutting_chai',
    name: 'Special Adrak Elaichi Cutting Chai',
    category: 'hot_beverages',
    tier: 'tier2_batch',
    station: 'beverage_counter',
    basePrice: 12,
    prepTime: 1,
    rating: 5.0,
    isVeg: true,
    isPopular: true,
    description: 'Strong, aromatic tapri-style milk tea simmered with fresh crushed ginger and green cardamom.'
  },
  {
    id: 'special_full_chai',
    name: 'Full Cup Masala Chai',
    category: 'hot_beverages',
    tier: 'tier2_batch',
    station: 'beverage_counter',
    basePrice: 20,
    prepTime: 1,
    rating: 4.8,
    isVeg: true,
    description: 'Large ceramic cup of robust Indian masala chai brewed to perfection.'
  },
  {
    id: 'filter_coffee',
    name: 'South Indian Filter Kaapi',
    category: 'hot_beverages',
    tier: 'tier3_cook',
    station: 'beverage_counter',
    basePrice: 25,
    prepTime: 2,
    rating: 4.9,
    isVeg: true,
    isPopular: true,
    description: 'Traditional decoction brewed coffee frothed with hot creamy milk in stainless steel tumbler & davara.'
  },
  {
    id: 'hot_bournvita',
    name: 'Steaming Hot Bournvita / Horlicks',
    category: 'hot_beverages',
    tier: 'tier3_cook',
    station: 'beverage_counter',
    basePrice: 30,
    prepTime: 2,
    rating: 4.6,
    isVeg: true,
    description: 'Thick malt chocolate beverage served hot with a creamy frothy top.'
  },
  {
    id: 'green_tea_lemon',
    name: 'Honey Lemon Organic Green Tea',
    category: 'hot_beverages',
    tier: 'tier2_batch',
    station: 'beverage_counter',
    basePrice: 25,
    prepTime: 1,
    rating: 4.3,
    isVeg: true,
    description: 'Detoxifying warm green tea infused with natural honey and freshly squeezed lemon juice.'
  },

  // ----------------------------------------------------
  // SHAKES & COOLERS (Tier 1 & Tier 3: Chilled Station)
  // ----------------------------------------------------
  {
    id: 'cold_coffee_icecream',
    name: 'Thick Cold Coffee with Vanilla Ice Cream',
    category: 'cold_beverages',
    tier: 'tier3_cook',
    station: 'beverage_counter',
    basePrice: 60,
    prepTime: 3,
    rating: 5.0,
    isVeg: true,
    isPopular: true,
    description: 'Rich blended espresso cold coffee poured over a scoop of vanilla ice cream and chocolate drizzle.'
  },
  {
    id: 'chocolate_milkshake',
    name: 'Belgium Chocolate Thick Shake',
    category: 'cold_beverages',
    tier: 'tier3_cook',
    station: 'beverage_counter',
    basePrice: 65,
    prepTime: 3,
    rating: 4.8,
    isVeg: true,
    description: 'Ultra-creamy thick shake made with dairy chocolate fudge, milk and crushed choco chips.'
  },
  {
    id: 'mango_lassi',
    name: 'Alphonso Mango Sweet Lassi',
    category: 'cold_beverages',
    tier: 'tier2_batch',
    station: 'beverage_counter',
    basePrice: 45,
    prepTime: 1,
    rating: 4.8,
    isVeg: true,
    description: 'Thick churned sweet yogurt blended with Ratnagiri alphonso mango pulp and cardamom.'
  },
  {
    id: 'masala_chaas',
    name: 'Spiced Matka Chaas (Buttermilk)',
    category: 'cold_beverages',
    tier: 'tier2_batch',
    station: 'beverage_counter',
    basePrice: 20,
    prepTime: 1,
    rating: 4.7,
    isVeg: true,
    description: 'Chilled refreshing buttermilk tempered with roasted cumin, rock salt, ginger and fresh coriander.'
  },
  {
    id: 'fresh_lime_soda',
    name: 'Fresh Lime Soda (Sweet & Salt)',
    category: 'cold_beverages',
    tier: 'tier3_cook',
    station: 'beverage_counter',
    basePrice: 35,
    prepTime: 2,
    rating: 4.6,
    isVeg: true,
    description: 'Fizzy soda with fresh lime juice, mint leaves, rock salt and sugar syrup.'
  },
  {
    id: 'frooti_tetra',
    name: 'Frooti Mango Tetra Pack (160ml)',
    category: 'cold_beverages',
    tier: 'tier1_instant',
    station: 'snack_counter',
    basePrice: 15,
    prepTime: 0,
    rating: 4.6,
    isVeg: true,
    description: 'Chilled iconic mango juice drink. Grab and go!'
  },
  {
    id: 'coca_cola_can',
    name: 'Coca Cola Can / Thums Up (300ml)',
    category: 'cold_beverages',
    tier: 'tier1_instant',
    station: 'snack_counter',
    basePrice: 40,
    prepTime: 0,
    rating: 4.7,
    isVeg: true,
    description: 'Chilled fizzy soda can.'
  },
  {
    id: 'packaged_water',
    name: 'Bisleri Mineral Water Bottle (500ml)',
    category: 'cold_beverages',
    tier: 'tier1_instant',
    station: 'snack_counter',
    basePrice: 10,
    prepTime: 0,
    rating: 4.9,
    isVeg: true,
    description: 'Sealed mineral water bottle.'
  }
];

export const STATIONS = [
  { id: 'dosa_tawa', name: '🥞 Dosa Tawa Station', avgThroughputSec: 90, capacityPerBatch: 3 },
  { id: 'chinese_wok', name: '🥢 Chinese Wok Station', avgThroughputSec: 180, capacityPerBatch: 2 },
  { id: 'grill_chaat', name: '🥪 Grill, Chaat & Pav Bhaji', avgThroughputSec: 120, capacityPerBatch: 4 },
  { id: 'thali_station', name: '🍲 Lunch & Thali Plating', avgThroughputSec: 30, capacityPerBatch: 6 },
  { id: 'beverage_counter', name: '☕ Chai & Beverage Bar', avgThroughputSec: 45, capacityPerBatch: 5 },
  { id: 'snack_counter', name: '🍟 Vada Pav & Instant Snacks', avgThroughputSec: 20, capacityPerBatch: 10 }
];
