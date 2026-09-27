// Minimal RFC 4180 CSV: quoted fields, embedded commas, quotes and newlines.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  text = text.replace(/^﻿/, ''); // Excel's byte order mark

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim()));
}

// Rows as objects keyed by the (lower-cased, trimmed) header row.
export function parseCsvObjects(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export function toCsv(rows) {
  const cell = v => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
