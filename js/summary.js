// Long lines typed as a task (or plan item) become a short title plus a note
// holding the whole line as typed.
//
//   summarise('Call the council about the bins: they missed us twice …')
//   → { title: 'Call the council about the bins', notes: '<the whole line>' }
//
// Only lines over MAX characters are touched. The title is the text before
// the first colon, comma or full stop (not one inside a number, time, email
// or web address), else before a " - " / " – " / " (" or a joining phrase
// ("because", "so that", …), else the words that fit with "…". Leading
// filler ("I need to", "remember to") is dropped.

export const MAX = 50;

const FILLER = /^(?:(?:i|we)\s+(?:really\s+)?(?:need|have|want|ought)\s+to|(?:i|we)\s+(?:must|should)|(?:need|have|got|ought)\s+to|gotta|remember\s+to|don'?t\s+forget\s+to|must|should|todo:?|to\s*do:?)\s+/i;
const JOINERS = /\s(?:because|so that|so I|so we|in order to|which|then|and then|but|as|since|to see if|to check if)\s/i;

// A cut at i is fine unless the punctuation sits inside a number (3.30,
// 1,000), an email or a web address.
function cleanCut(text, i) {
  const before = text[i - 1] || '';
  const after = text[i + 1] || '';
  if (/\d/.test(before) && /\d/.test(after)) return false;
  if (text[i] === '.' && after && !/\s/.test(after)) return false; // e.g. example.com, e.g.
  if (text[i] === ':' && after === '/') return false; // https://
  return true;
}

const tidy = s => {
  const t = s.replace(FILLER, '').replace(/[\s,;:.–—-]+$/, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

// A title for free text (like iPhone Notes): its first line, without
// markdown or link syntax, shortened if it's long.
export const cleanLine = line => line.trim().replace(/\[([^\]]*)\]\(sift:[^)]*\)/g, '$1').replace(/^#{1,6}\s+/, '').replace(/^[-*•]\s+/, '')
  .replace(/\*\*|~~/g, '').replace(/(^|\s)_(\S.*?)_(?=$|[\s).,!?:;])/g, '$1$2').trim();

export function titleFrom(text) {
  const first = (text || '').split('\n').map(l => l.trim()).find(Boolean) || '';
  return summarise(cleanLine(first)).title;
}

export function summarise(text, max = MAX) {
  const whole = text.trim();
  if (whole.length <= max) return { title: whole, notes: '' };
  const min = 4; // a title needs a few characters at least

  // 1. The earliest of: a colon, comma or full stop; a dash; a bracket; a
  //    joining phrase.
  let punct = -1;
  for (let i = min; i < whole.length - 1; i++) {
    if (/[:,.]/.test(whole[i]) && cleanCut(whole, i)) { punct = i; break; }
  }
  const cuts = [punct, whole.search(/\s[-–—]\s/), whole.indexOf(' ('), whole.search(JOINERS)].filter(i => i >= min).sort((a, b) => a - b);
  for (const at of cuts) {
    const title = tidy(whole.slice(0, at));
    if (title.length >= min) return { title, notes: whole };
  }
  // 2. As many whole words as fit, then "…".
  const cut = tidy(whole).slice(0, max);
  const title = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), min)).trim()}…`;
  return { title, notes: whole };
}
