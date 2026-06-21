// Shared colour chart for product specifications.
// Loaded same-origin (<script src="/colors.js">) by admin / vendor / storefront
// so the swatch palette and name→hex resolution live in one place.
window.RMColors = (function () {
  // Curated palette the admin picks from when building a "Colour" spec field.
  const PALETTE = [
    { name: 'Black',    hex: '#111827' }, { name: 'White',  hex: '#ffffff' },
    { name: 'Grey',     hex: '#9ca3af' }, { name: 'Silver', hex: '#cbd5e1' },
    { name: 'Red',      hex: '#ef4444' }, { name: 'Maroon', hex: '#7f1d1d' },
    { name: 'Pink',     hex: '#ec4899' }, { name: 'Rose',   hex: '#f43f5e' },
    { name: 'Orange',   hex: '#f97316' }, { name: 'Peach',  hex: '#fdba74' },
    { name: 'Yellow',   hex: '#facc15' }, { name: 'Gold',   hex: '#d4af37' },
    { name: 'Beige',    hex: '#e7d8b1' }, { name: 'Brown',  hex: '#92400e' },
    { name: 'Olive',    hex: '#65803b' }, { name: 'Green',  hex: '#22c55e' },
    { name: 'Teal',     hex: '#14b8a6' }, { name: 'Cyan',   hex: '#06b6d4' },
    { name: 'Sky Blue', hex: '#38bdf8' }, { name: 'Blue',   hex: '#3b82f6' },
    { name: 'Navy',     hex: '#1e3a8a' }, { name: 'Purple', hex: '#a855f7' },
    { name: 'Lavender', hex: '#c4b5fd' }, { name: 'Mustard', hex: '#d4a017' }
  ];

  const MAP = {};
  PALETTE.forEach(c => { MAP[c.name.toLowerCase()] = c.hex; });
  // Common synonyms so typed names still resolve to a swatch.
  Object.assign(MAP, {
    gray: '#9ca3af', 'light blue': '#38bdf8', skyblue: '#38bdf8',
    'dark blue': '#1e3a8a', 'sea green': '#22c55e', cream: '#e7d8b1'
  });

  // Hex for a colour name, or null when unknown (caller falls back to a neutral).
  function hexFor(name) {
    return MAP[String(name || '').trim().toLowerCase()] || null;
  }

  // A field is a colour field when its label reads like one. The admin colour
  // chart and the swatch rendering both key off this.
  function isColorField(label) {
    return /colou?r/i.test(label || '');
  }

  // True for very light swatches that need a darker ring to stay visible.
  function isLight(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return false;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 210;
  }

  return { PALETTE, hexFor, isColorField, isLight };
})();
