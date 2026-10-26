/**
 * Calculs monétaires.
 *
 * Représentation : centimes entiers (pas de flottants pour les montants).
 * Quantités en millièmes, taux (TVA, remises %) en points de base (1 % = 100).
 * Arrondi : au centime le plus proche, demi-valeur arrondie en s'éloignant de zéro.
 *
 * TVA : calculée par taux sur la somme des bases HT (méthode usuelle des
 * logiciels de facturation : un arrondi par taux, et non par ligne).
 */

export type DiscountType = 'none' | 'percent' | 'amount';

export interface LineInput {
  kind?: 'item' | 'section' | 'text';
  quantity_milli: number;
  unit_price_cents: number;
  discount_type: DiscountType;
  /** percent : points de base ; amount : centimes */
  discount_value: number;
  vat_rate_bp: number;
}

export interface LineResult {
  gross_cents: number;
  discount_cents: number;
  ht_cents: number;
  vat_cents: number;
  ttc_cents: number;
}

export interface VatBucket {
  rate_bp: number;
  base_cents: number;
  vat_cents: number;
}

export interface Totals {
  lines: LineResult[];
  subtotal_ht_cents: number;
  global_discount_cents: number;
  total_ht_cents: number;
  vat: VatBucket[];
  total_vat_cents: number;
  total_ttc_cents: number;
}

/** Division entière arrondie (demi s'éloignant de zéro), en BigInt pour éviter tout dépassement. */
export function roundDiv(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) throw new Error('Division par zéro');
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const neg = numerator < 0n;
  const abs = neg ? -numerator : numerator;
  const q = (abs * 2n + denominator) / (denominator * 2n);
  const r = neg ? -q : q;
  const n = Number(r);
  if (!Number.isSafeInteger(n)) throw new Error('Montant hors limites');
  return n;
}

export function mulRate(cents: number, rateBp: number): number {
  return roundDiv(BigInt(cents) * BigInt(rateBp), 10000n);
}

export function computeLine(l: LineInput): LineResult {
  if (l.kind && l.kind !== 'item') {
    return { gross_cents: 0, discount_cents: 0, ht_cents: 0, vat_cents: 0, ttc_cents: 0 };
  }
  assertInt(l.quantity_milli, 'quantité');
  assertInt(l.unit_price_cents, 'prix unitaire');
  assertInt(l.vat_rate_bp, 'taux de TVA');
  if (l.vat_rate_bp < 0 || l.vat_rate_bp > 10000) throw new Error('Taux de TVA invalide');
  const gross = roundDiv(BigInt(l.quantity_milli) * BigInt(l.unit_price_cents), 1000n);
  let discount = 0;
  if (l.discount_type === 'percent') {
    if (l.discount_value < 0 || l.discount_value > 10000) throw new Error('Remise en pourcentage invalide (0 à 100 %)');
    discount = mulRate(gross, l.discount_value);
  } else if (l.discount_type === 'amount') {
    if (l.discount_value < 0) throw new Error('Remise négative');
    discount = Math.sign(gross || 1) * l.discount_value;
    if (Math.abs(discount) > Math.abs(gross)) throw new Error('La remise dépasse le montant de la ligne');
  }
  const ht = gross - discount;
  const vat = mulRate(ht, l.vat_rate_bp);
  return { gross_cents: gross, discount_cents: discount, ht_cents: ht, vat_cents: vat, ttc_cents: ht + vat };
}

/**
 * Répartit `amount` proportionnellement à `weights` (méthode du plus fort reste) :
 * la somme des parts vaut exactement `amount`.
 */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (total === 0) {
    const out = weights.map(() => 0);
    out[0] = amount;
    return out;
  }
  const big = BigInt(amount);
  const bt = BigInt(total);
  const raw = weights.map((w) => {
    const num = big * BigInt(w);
    let q = num / bt;
    let rem = num % bt;
    if (rem < 0n) {
      q -= 1n;
      rem += bt;
    }
    return { q, rem };
  });
  let distributed = raw.reduce((a, r) => a + r.q, 0n);
  const order = raw.map((r, i) => ({ i, rem: r.rem })).sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  const out = raw.map((r) => r.q);
  let k = 0;
  while (distributed < big) {
    out[order[k % order.length].i] += 1n;
    distributed += 1n;
    k++;
  }
  return out.map(Number);
}

export function computeTotals(
  lines: LineInput[],
  globalDiscount: { type: DiscountType; value: number } = { type: 'none', value: 0 },
): Totals {
  const results = lines.map(computeLine);
  const subtotal = results.reduce((a, r) => a + r.ht_cents, 0);

  // Bases par taux avant remise globale
  const byRate = new Map<number, number>();
  lines.forEach((l, i) => {
    if (l.kind && l.kind !== 'item') return;
    byRate.set(l.vat_rate_bp, (byRate.get(l.vat_rate_bp) ?? 0) + results[i].ht_cents);
  });
  const rates = [...byRate.keys()].sort((a, b) => b - a);

  let globalDiscount_cents = 0;
  if (globalDiscount.type === 'percent') {
    if (globalDiscount.value < 0 || globalDiscount.value > 10000) throw new Error('Remise globale invalide');
    globalDiscount_cents = mulRate(subtotal, globalDiscount.value);
  } else if (globalDiscount.type === 'amount') {
    if (globalDiscount.value < 0) throw new Error('Remise globale négative');
    if (globalDiscount.value > Math.max(subtotal, 0)) throw new Error('La remise globale dépasse le total HT');
    globalDiscount_cents = globalDiscount.value;
  }
  // La remise globale est répartie au prorata des bases de chaque taux.
  const shares = allocate(globalDiscount_cents, rates.map((r) => Math.max(byRate.get(r)!, 0)));
  const vat: VatBucket[] = rates.map((r, i) => {
    const base = byRate.get(r)! - shares[i];
    return { rate_bp: r, base_cents: base, vat_cents: mulRate(base, r) };
  });
  const total_ht = subtotal - globalDiscount_cents;
  const total_vat = vat.reduce((a, b) => a + b.vat_cents, 0);
  return {
    lines: results,
    subtotal_ht_cents: subtotal,
    global_discount_cents: globalDiscount_cents,
    total_ht_cents: total_ht,
    vat,
    total_vat_cents: total_vat,
    total_ttc_cents: total_ht + total_vat,
  };
}

/** Montant TTC d'acompte demandé sur un devis. */
export function depositAmount(totalTtc: number, type: DiscountType, value: number): number {
  if (type === 'percent') {
    if (value < 0 || value > 10000) throw new Error("Pourcentage d'acompte invalide");
    return mulRate(totalTtc, value);
  }
  if (type === 'amount') {
    if (value < 0 || value > totalTtc) throw new Error("Montant d'acompte invalide");
    return value;
  }
  return 0;
}

/**
 * Ventile un acompte (TTC) par taux de TVA, au prorata des montants TTC du devis.
 * Retourne pour chaque taux la base HT et la TVA correspondantes.
 */
export function splitDepositByRate(vat: VatBucket[], depositTtc: number): VatBucket[] {
  const ttcByRate = vat.map((v) => v.base_cents + v.vat_cents);
  const parts = allocate(depositTtc, ttcByRate.map((x) => Math.max(x, 0)));
  return vat.map((v, i) => {
    const ttc = parts[i];
    const base = roundDiv(BigInt(ttc) * 10000n, BigInt(10000 + v.rate_bp));
    return { rate_bp: v.rate_bp, base_cents: base, vat_cents: ttc - base };
  });
}

function assertInt(n: number, label: string) {
  if (!Number.isSafeInteger(n)) throw new Error(`Valeur invalide (${label})`);
}

// ---------- Conversions saisie ⇄ stockage ----------

/** "1 234,56" | "1234.56" | 1234.56 → 123456 centimes. Lève une erreur si invalide. */
export function parseEuros(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Montant invalide');
    return Math.round(input * 100);
  }
  const s = input.replace(/[\s  €]/g, '').replace(',', '.');
  if (s === '' || s === '-') return 0;
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) throw new Error(`Montant invalide : « ${input} »`);
  const neg = s.startsWith('-');
  const [intPart, dec = ''] = s.replace('-', '').split('.');
  const cents = Number(intPart) * 100 + Number((dec + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new Error('Montant trop grand');
  return neg ? -cents : cents;
}

/** "1,5" → 1500 millièmes (3 décimales max). */
export function parseQuantity(input: string | number): number {
  const s = String(input).replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return 0;
  if (!/^-?\d+(\.\d{0,3})?$/.test(s)) throw new Error(`Quantité invalide : « ${input} »`);
  const neg = s.startsWith('-');
  const [i, d = ''] = s.replace('-', '').split('.');
  const v = Number(i) * 1000 + Number((d + '000').slice(0, 3));
  return neg ? -v : v;
}

/** "20" | "5,5" → points de base (2000, 550). */
export function parsePercent(input: string | number): number {
  const s = String(input).replace(/[\s%]/g, '').replace(',', '.');
  if (s === '') return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) throw new Error(`Pourcentage invalide : « ${input} »`);
  const [i, d = ''] = s.split('.');
  const v = Number(i) * 100 + Number((d + '00').slice(0, 2));
  if (v > 10000) throw new Error('Pourcentage supérieur à 100 %');
  return v;
}

export function centsToInput(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
}

export function milliToInput(milli: number): string {
  const neg = milli < 0;
  const a = Math.abs(milli);
  const i = Math.floor(a / 1000);
  const d = String(a % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${i}${d ? ',' + d : ''}`;
}

export function bpToInput(bp: number): string {
  const i = Math.floor(bp / 100);
  const d = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return `${i}${d ? ',' + d : ''}`;
}
