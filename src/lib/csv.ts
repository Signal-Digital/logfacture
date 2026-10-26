/** CSV (RFC 4180), séparateur « ; » par défaut (convention Excel français). */

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[], sep = ';'): string {
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v);
    // Neutralise l'injection de formules dans les tableurs.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(sep)];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c.key])).join(sep));
  // BOM UTF-8 pour Excel
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function detectSeparator(text: string): string {
  const first = text.split(/\r?\n/)[0] ?? '';
  const counts = [';', ',', '\t'].map((s) => [s, first.split(s).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ';';
}

export function parseCsv(text: string, sep?: string): string[][] {
  text = text.replace(/^﻿/, '');
  const s = sep ?? detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === s) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Transforme un CSV en objets à partir de la ligne d'en-tête. */
export function csvToObjects(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const all = parseCsv(text);
  if (all.length === 0) return { headers: [], rows: [] };
  const headers = all[0].map((h) => h.trim());
  return {
    headers,
    rows: all.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))),
  };
}
