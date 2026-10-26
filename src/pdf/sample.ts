/** Document d'exemple pour prévisualiser un modèle (court ou long). */
import { computeTotals, depositAmount } from '@/lib/money';
import { addDays, today } from '@/lib/format';
import type { AllSettings } from '@/domain/settings';
import { sellerSnapshot, legalMentions, type DocLine } from '@/domain/docCommon';
import type { QuoteSnapshot } from '@/domain/quotes';
import type { InvoiceSnapshot } from '@/domain/invoices';
import type { ClientSnapshot } from '@/domain/companies';

const CLIENT: ClientSnapshot = {
  company_id: 0, name: 'Boulangerie Exemple', is_individual: false, contact_name: 'Claire Exemple', address_line1: '3 place du Marché', address_line2: '',
  postal_code: '69001', city: 'Lyon', country: 'France', email: 'contact@boulangerie-exemple.fr', phone: '04 00 00 00 00', siren: '552100554', siret: '', vat_number: '',
};

const BASE: Omit<DocLine, 'vat_rate_bp'>[] = [
  { kind: 'item', designation: 'Audit SEO', description: 'Analyse technique, sémantique et concurrentielle, avec plan d\'actions.', quantity_milli: 1000, unit: 'forfait', unit_price_cents: 49000, discount_type: 'none', discount_value: 0 },
  { kind: 'item', designation: 'Création de site Internet', description: 'Site vitrine responsive, 5 pages, optimisé pour le référencement.', quantity_milli: 1000, unit: 'forfait', unit_price_cents: 180000, discount_type: 'percent', discount_value: 1000 },
  { kind: 'item', designation: 'Rédaction d\'articles SEO', description: '', quantity_milli: 4000, unit: 'article', unit_price_cents: 12000, discount_type: 'none', discount_value: 0 },
  { kind: 'item', designation: 'Maintenance', description: 'Mises à jour et sauvegardes mensuelles.', quantity_milli: 12000, unit: 'mois', unit_price_cents: 6900, discount_type: 'none', discount_value: 0 },
];

export function sampleLines(settings: AllSettings, count = 4): DocLine[] {
  const vat = settings.vat.regime === 'franchise' ? 0 : settings.vat.default_rate_bp;
  const out: DocLine[] = [];
  for (let i = 0; i < count; i++) {
    const b = BASE[i % BASE.length];
    out.push({ ...b, designation: count > BASE.length ? `${b.designation} (${i + 1})` : b.designation, vat_rate_bp: vat });
  }
  return out;
}

export function sampleSnapshot(settings: AllSettings, kind: 'devis' | 'facture', lineCount = 4): QuoteSnapshot | InvoiceSnapshot {
  const lines = sampleLines(settings, lineCount);
  const totals = computeTotals(lines);
  const seller = sellerSnapshot(settings);
  if (kind === 'devis') {
    return {
      type: 'devis', quote_uuid: 'exemple', number: 'D-EXEMPLE-0001', version: 1, title: 'Refonte de votre présence en ligne', issue_date: today(),
      validity_date: addDays(today(), 30), seller, client: CLIENT, lines, global_discount: { type: 'none', value: 0 }, totals,
      deposit: { type: 'percent', value: 3000, ttc_cents: depositAmount(totals.total_ttc_cents, 'percent', 3000) },
      payment_terms: settings.payment.payment_terms_text, special_conditions: 'Délai de réalisation : 6 semaines à réception de l\'acompte.', footer_notes: '',
      legal_mentions: legalMentions(settings, 'devis', CLIENT),
    };
  }
  return {
    type: 'facture', kind: 'facture', invoice_uuid: 'exemple', number: 'F-EXEMPLE-0001', title: 'Prestations du mois', issue_date: today(), due_date: addDays(today(), 30),
    service_date: today(), seller, client: CLIENT, lines, global_discount: { type: 'none', value: 0 }, totals, payment_terms: settings.payment.payment_terms_text,
    legal_mentions: legalMentions(settings, 'facture', CLIENT), footer_notes: '', quote_number: 'D-EXEMPLE-0001', credited_invoice_number: null, credited_invoice_date: null,
  };
}
