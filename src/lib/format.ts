/** Formatage à la française (montants, dates, nombres). */

const euroFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const numFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });

/** Remplace les espaces insécables fines par des espaces insécables classiques (compatibilité PDF/polices). */
export function plainSpaces(s: string): string {
  return s.replace(/ /g, ' ');
}

export function formatEuro(cents: number | null | undefined): string {
  return plainSpaces(euroFmt.format((cents ?? 0) / 100));
}

export function formatNumber(n: number): string {
  return plainSpaces(numFmt.format(n));
}

export function formatQuantity(milli: number): string {
  return formatNumber(milli / 1000);
}

export function formatRate(bp: number): string {
  return `${formatNumber(bp / 100)} %`;
}

/** Date ISO (YYYY-MM-DD ou complète) → JJ/MM/AAAA. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = parseIsoDate(iso);
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = parseIsoDate(iso);
  if (!d) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${formatDate(toLocalIsoDate(d))} à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Interprète 'YYYY-MM-DD' comme une date locale (pas UTC), sinon Date standard. */
export function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function toLocalIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function today(): string {
  return toLocalIsoDate(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso)!;
  d.setDate(d.getDate() + days);
  return toLocalIsoDate(d);
}

/** Ajoute des mois en restant sur une date valide (31/01 + 1 mois → 28 ou 29/02). */
export function addMonths(iso: string, months: number): string {
  const d = parseIsoDate(iso)!;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toLocalIsoDate(d);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = parseIsoDate(fromIso)!;
  const b = parseIsoDate(toIso)!;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${formatNumber(Math.round(bytes / 102.4) / 10)} Ko`;
  return `${formatNumber(Math.round(bytes / (1024 * 102.4)) / 10)} Mo`;
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return `${formatNumber(n)} ${Math.abs(n) >= 2 ? plural ?? singular + 's' : singular}`;
}
