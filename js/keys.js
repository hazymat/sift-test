// A key combination drawn as one box per key: keys('Shift+Enter') is
// <kbd>Shift</kbd><kbd>Enter</kbd>, and a Mac's '⌘↵' is <kbd>⌘</kbd><kbd>↵</kbd>.
// Every shortcut shown on a button uses it, so they all look the same.
const MODIFIER = /[⌘⌥⇧⌃]/;
export const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
// Ctrl+Enter, or ⌘+Enter on a Mac.
export const CTRL_ENTER = MAC ? '⌘+Enter' : 'Ctrl+Enter';
const parts = combo => (combo.includes('+') && combo.length > 1 ? combo.split('+') : [...combo.matchAll(/[⌘⌥⇧⌃]|[^⌘⌥⇧⌃]+/g)].map(m => m[0])).filter(Boolean);
export const keys = combo => parts(combo).map(k => `<kbd>${k}</kbd>`).join('');
// The same, as elements (for code that builds buttons without HTML).
export const keyEls = combo => parts(combo).map(k => Object.assign(document.createElement('kbd'), { textContent: k }));
export { MODIFIER };
