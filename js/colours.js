// Item colours: twelve soft hues of the same lightness, used as a faint wash
// over the glass when a page's Look is Multicolour (👁 menu, viewcog.js).
// A record keeps the colour it was given (`colour`: one of the ids below);
// until then its colour comes from its id, so it never changes and is the
// same on every device.
//
//   tintHex(record)                      the colour to show for it
//   tintId(record)                       its colour id (given or from its id)
//   colourMenu(anchor, current, onPick)  the swatch picker (onPick gets an id)

import { pillMenu } from './pillmenu.js';

export const TINTS = [
  { id: 'rose', label: 'Rose', hex: '#ff9aa2' },
  { id: 'coral', label: 'Coral', hex: '#ffab91' },
  { id: 'peach', label: 'Peach', hex: '#ffc285' },
  { id: 'butter', label: 'Butter', hex: '#ffe27a' },
  { id: 'lime', label: 'Lime', hex: '#d4ef8a' },
  { id: 'mint', label: 'Mint', hex: '#9be7a8' },
  { id: 'teal', label: 'Teal', hex: '#86e3d0' },
  { id: 'sky', label: 'Sky', hex: '#8fd3ff' },
  { id: 'periwinkle', label: 'Periwinkle', hex: '#a8b8ff' },
  { id: 'lavender', label: 'Lavender', hex: '#c3a6ff' },
  { id: 'orchid', label: 'Orchid', hex: '#f4a6e0' },
  { id: 'sand', label: 'Sand', hex: '#e3c9a8' },
];

const hash = s => { let h = 5381; for (const ch of String(s)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return h; };
export const tintId = rec => (TINTS.some(c => c.id === rec?.colour) ? rec.colour : TINTS[hash(rec?.id) % TINTS.length].id);
export const tintHex = rec => TINTS.find(c => c.id === tintId(rec)).hex;

// Doesn't take the cursor out of a note being written in.
// keyboard: true (opened by a key): the cursor goes into the menu, for ← / → and Enter.
export function colourMenu(anchor, current, onPick, { keyboard = false } = {}) {
  return pillMenu(anchor, TINTS.map(c => ({ value: c.id, label: `<span class="swatch" style="--sw:${c.hex}"></span>`, title: c.label, current: c.id === current })),
    onPick, { focus: keyboard, back: !keyboard, className: 'colour-menu' });
}
