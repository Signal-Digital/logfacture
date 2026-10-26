import { describe, expect, it } from 'vitest';
import { allocate, computeLine, computeTotals, depositAmount, parseEuros, parsePercent, parseQuantity, roundDiv, splitDepositByRate, centsToInput, milliToInput } from '@/lib/money';
import { formatEuro, formatDate, addMonths } from '@/lib/format';

const item = (qty: number, price: number, vat = 2000, extra: any = {}) => ({ kind: 'item' as const, quantity_milli: qty, unit_price_cents: price, discount_type: 'none' as const, discount_value: 0, vat_rate_bp: vat, ...extra });

describe('arrondis', () => {
  it('arrondit au centime, demi-valeur en s’éloignant de zéro', () => {
    expect(roundDiv(5n, 10n)).toBe(1);
    expect(roundDiv(4n, 10n)).toBe(0);
    expect(roundDiv(-5n, 10n)).toBe(-1);
    expect(roundDiv(-4n, 10n)).toBe(0);
    expect(roundDiv(15n, 10n)).toBe(2);
  });
  it('évite les erreurs des flottants (0,1 + 0,2)', () => {
    const t = computeTotals([item(1000, 10), item(1000, 20)]);
    expect(t.total_ht_cents).toBe(30);
  });
  it('quantités décimales', () => {
    expect(computeLine(item(1500, 3333)).ht_cents).toBe(5000); // 1,5 × 33,33 = 49,995 → 50,00
    expect(computeLine(item(333, 100)).ht_cents).toBe(33);
  });
});

describe('calcul HT / TVA / TTC', () => {
  it('ligne simple à 20 %', () => {
    const t = computeTotals([item(2000, 49000)]);
    expect(t.total_ht_cents).toBe(98000);
    expect(t.total_vat_cents).toBe(19600);
    expect(t.total_ttc_cents).toBe(117600);
  });
  it('plusieurs taux de TVA : un arrondi par taux', () => {
    const t = computeTotals([item(1000, 1001, 2000), item(1000, 1001, 2000), item(1000, 999, 550), item(1000, 500, 1000), item(1000, 700, 0)]);
    expect(t.vat.map((v) => v.rate_bp)).toEqual([2000, 1000, 550, 0]);
    expect(t.vat[0]).toEqual({ rate_bp: 2000, base_cents: 2002, vat_cents: 400 });
    expect(t.vat[2]).toEqual({ rate_bp: 550, base_cents: 999, vat_cents: 55 });
    expect(t.vat[3].vat_cents).toBe(0);
    expect(t.total_ttc_cents).toBe(t.total_ht_cents + t.total_vat_cents);
  });
  it('TVA à zéro', () => {
    const t = computeTotals([item(3000, 12000, 0)]);
    expect(t.total_vat_cents).toBe(0);
    expect(t.total_ttc_cents).toBe(36000);
  });
  it('ignore les sections et textes', () => {
    const t = computeTotals([{ ...item(1000, 999999), kind: 'section' as const }, item(1000, 100)]);
    expect(t.total_ht_cents).toBe(100);
  });
});

describe('remises', () => {
  it('remise ligne en pourcentage', () => {
    expect(computeLine(item(1000, 10000, 2000, { discount_type: 'percent', discount_value: 1500 })).ht_cents).toBe(8500);
  });
  it('remise ligne en montant', () => {
    expect(computeLine(item(2000, 10000, 2000, { discount_type: 'amount', discount_value: 2500 })).ht_cents).toBe(17500);
  });
  it('refuse une remise supérieure au montant', () => {
    expect(() => computeLine(item(1000, 100, 2000, { discount_type: 'amount', discount_value: 200 }))).toThrow();
    expect(() => computeLine(item(1000, 100, 2000, { discount_type: 'percent', discount_value: 10001 }))).toThrow();
  });
  it('remise globale répartie au prorata des taux, somme exacte', () => {
    const t = computeTotals([item(1000, 10000, 2000), item(1000, 5000, 550)], { type: 'percent', value: 1000 });
    expect(t.global_discount_cents).toBe(1500);
    expect(t.total_ht_cents).toBe(13500);
    expect(t.vat.find((v) => v.rate_bp === 2000)!.base_cents).toBe(9000);
    expect(t.vat.find((v) => v.rate_bp === 550)!.base_cents).toBe(4500);
    expect(t.vat.reduce((a, v) => a + v.base_cents, 0)).toBe(t.total_ht_cents);
  });
  it('remise globale en montant non divisible', () => {
    const t = computeTotals([item(1000, 100, 2000), item(1000, 100, 1000), item(1000, 100, 550)], { type: 'amount', value: 100 });
    expect(t.vat.reduce((a, v) => a + v.base_cents, 0)).toBe(200);
  });
  it('allocate conserve la somme', () => {
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocate(7, [0, 0])).toEqual([7, 0]);
  });
});

describe('acomptes', () => {
  it('acompte en pourcentage', () => {
    expect(depositAmount(117600, 'percent', 3000)).toBe(35280);
  });
  it('acompte en montant borné', () => {
    expect(() => depositAmount(1000, 'amount', 2000)).toThrow();
  });
  it('ventilation par taux : somme TTC exacte', () => {
    const t = computeTotals([item(1000, 100000, 2000), item(1000, 50000, 550)]);
    const parts = splitDepositByRate(t.vat, 50000);
    expect(parts.reduce((a, p) => a + p.base_cents + p.vat_cents, 0)).toBe(50000);
  });
});

describe('saisie et formatage français', () => {
  it('parse les montants', () => {
    expect(parseEuros('1 234,56')).toBe(123456);
    expect(parseEuros('1234.5')).toBe(123450);
    expect(parseEuros('12 €')).toBe(1200);
    expect(parseEuros('-3,2')).toBe(-320);
    expect(() => parseEuros('12,345')).toThrow();
    expect(() => parseEuros('abc')).toThrow();
  });
  it('parse quantités et pourcentages', () => {
    expect(parseQuantity('1,5')).toBe(1500);
    expect(parsePercent('5,5')).toBe(550);
    expect(parsePercent('20 %')).toBe(2000);
    expect(() => parsePercent('120')).toThrow();
  });
  it('formatte en euros et dates françaises', () => {
    expect(formatEuro(123456)).toBe('1 234,56 €');
    expect(formatDate('2026-03-05')).toBe('05/03/2026');
    expect(centsToInput(-12345)).toBe('-123,45');
    expect(milliToInput(1500)).toBe('1,5');
  });
  it('ajoute des mois en fin de mois', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });
});
