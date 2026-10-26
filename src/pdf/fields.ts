/**
 * Champs dynamiques : correspondance entre les clés logiques ({{client.nom}}…)
 * et les valeurs d'un document figé (instantané de devis ou de facture).
 */
import { formatDate, formatEuro, formatQuantity, formatRate } from '@/lib/format';
import { computeLine } from '@/lib/money';
import type { QuoteSnapshot } from '@/domain/quotes';
import type { InvoiceSnapshot } from '@/domain/invoices';
import type { DocLine } from '@/domain/docCommon';

export type DocSnapshot = QuoteSnapshot | InvoiceSnapshot;

export interface FieldDef {
  key: string;
  label: string;
  group: string;
}

export const FIELD_LIBRARY: FieldDef[] = [
  { key: 'entreprise.nom', label: 'Nom commercial', group: 'Votre entreprise' },
  { key: 'entreprise.denomination', label: 'Dénomination légale (avec EI)', group: 'Votre entreprise' },
  { key: 'entreprise.statut', label: 'Statut juridique', group: 'Votre entreprise' },
  { key: 'entreprise.dirigeant', label: 'Dirigeant', group: 'Votre entreprise' },
  { key: 'entreprise.adresse', label: 'Adresse (multiligne)', group: 'Votre entreprise' },
  { key: 'entreprise.siret', label: 'SIRET', group: 'Votre entreprise' },
  { key: 'entreprise.siren', label: 'SIREN', group: 'Votre entreprise' },
  { key: 'entreprise.tva_intra', label: 'N° TVA intracommunautaire', group: 'Votre entreprise' },
  { key: 'entreprise.ape', label: 'Code APE', group: 'Votre entreprise' },
  { key: 'entreprise.email', label: 'Email', group: 'Votre entreprise' },
  { key: 'entreprise.telephone', label: 'Téléphone', group: 'Votre entreprise' },
  { key: 'entreprise.site', label: 'Site Internet', group: 'Votre entreprise' },
  { key: 'entreprise.identification', label: 'Bloc identification (SIRET, TVA…)', group: 'Votre entreprise' },
  { key: 'client.nom', label: 'Nom du client', group: 'Client' },
  { key: 'client.contact', label: 'Contact', group: 'Client' },
  { key: 'client.adresse', label: 'Adresse (multiligne)', group: 'Client' },
  { key: 'client.email', label: 'Email', group: 'Client' },
  { key: 'client.telephone', label: 'Téléphone', group: 'Client' },
  { key: 'client.siren', label: 'SIREN', group: 'Client' },
  { key: 'client.siret', label: 'SIRET', group: 'Client' },
  { key: 'client.tva_intra', label: 'N° TVA intracommunautaire', group: 'Client' },
  { key: 'document.type', label: 'Type (DEVIS, FACTURE…)', group: 'Document' },
  { key: 'document.numero', label: 'Numéro', group: 'Document' },
  { key: 'document.date', label: "Date d'émission", group: 'Document' },
  { key: 'document.date_echeance', label: "Date d'échéance", group: 'Document' },
  { key: 'document.date_validite', label: 'Date de validité (devis)', group: 'Document' },
  { key: 'document.date_prestation', label: 'Date de prestation', group: 'Document' },
  { key: 'document.objet', label: 'Objet', group: 'Document' },
  { key: 'document.version', label: 'Version (devis)', group: 'Document' },
  { key: 'document.conditions', label: 'Conditions particulières', group: 'Document' },
  { key: 'document.conditions_paiement', label: 'Conditions de paiement', group: 'Document' },
  { key: 'document.mentions_legales', label: 'Mentions légales', group: 'Document' },
  { key: 'document.notes', label: 'Notes de bas de document', group: 'Document' },
  { key: 'document.reference_devis', label: 'Devis d\'origine', group: 'Document' },
  { key: 'document.facture_origine', label: 'Facture rectifiée (avoir)', group: 'Document' },
  { key: 'totaux.total_ht', label: 'Total HT', group: 'Totaux' },
  { key: 'totaux.total_tva', label: 'Total TVA', group: 'Totaux' },
  { key: 'totaux.total_ttc', label: 'Total TTC', group: 'Totaux' },
  { key: 'totaux.remise', label: 'Remise globale', group: 'Totaux' },
  { key: 'totaux.acompte', label: 'Acompte demandé', group: 'Totaux' },
  { key: 'paiement.iban', label: 'IBAN', group: 'Paiement' },
  { key: 'paiement.bic', label: 'BIC', group: 'Paiement' },
  { key: 'paiement.banque', label: 'Banque', group: 'Paiement' },
  { key: 'paiement.titulaire', label: 'Titulaire du compte', group: 'Paiement' },
  { key: 'pagination.page', label: 'Numéro de page', group: 'Pagination' },
  { key: 'pagination.total', label: 'Nombre de pages', group: 'Pagination' },
];

export function docTypeLabel(s: DocSnapshot): string {
  if (s.type === 'devis') return 'DEVIS';
  switch (s.kind) {
    case 'acompte': return "FACTURE D'ACOMPTE";
    case 'solde': return 'FACTURE DE SOLDE';
    case 'avoir': return 'AVOIR';
    default: return 'FACTURE';
  }
}

export function docTypeKey(s: DocSnapshot): 'devis' | 'facture' | 'acompte' | 'solde' | 'avoir' {
  return s.type === 'devis' ? 'devis' : s.kind;
}

function joinLines(...parts: (string | null | undefined)[]): string {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean).join('\n');
}

export function buildFieldValues(s: DocSnapshot, extra: Record<string, string> = {}): Record<string, string> {
  const seller = s.seller;
  const client = s.client;
  const isQuote = s.type === 'devis';
  const isFranchise = seller.vat_regime === 'franchise';
  const ident = joinLines(
    seller.siret ? `SIRET ${seller.siret}` : '',
    seller.vat_number ? `TVA intracom. ${seller.vat_number}` : isFranchise ? '' : '',
    seller.ape_code ? `APE ${seller.ape_code}` : '',
    seller.rcs_rm ? seller.rcs_rm : '',
  );
  const values: Record<string, string> = {
    'entreprise.nom': seller.trade_name || seller.display_name,
    'entreprise.denomination': seller.display_name,
    'entreprise.statut': seller.legal_status,
    'entreprise.dirigeant': seller.manager,
    'entreprise.adresse': joinLines(seller.address_line1, seller.address_line2, [seller.postal_code, seller.city].filter(Boolean).join(' '), seller.country && seller.country !== 'France' ? seller.country : ''),
    'entreprise.siret': seller.siret,
    'entreprise.siren': seller.siren,
    'entreprise.tva_intra': seller.vat_number,
    'entreprise.ape': seller.ape_code,
    'entreprise.email': seller.email,
    'entreprise.telephone': seller.phone,
    'entreprise.site': seller.website,
    'entreprise.identification': ident,
    'client.nom': client.name,
    'client.contact': client.contact_name && client.contact_name !== client.name ? client.contact_name : '',
    'client.adresse': joinLines(client.address_line1, client.address_line2, [client.postal_code, client.city].filter(Boolean).join(' '), client.country && client.country !== 'France' ? client.country : ''),
    'client.email': client.email,
    'client.telephone': client.phone,
    'client.siren': client.siren,
    'client.siret': client.siret,
    'client.tva_intra': client.vat_number,
    'document.type': docTypeLabel(s),
    'document.numero': s.number,
    'document.date': formatDate(s.issue_date),
    'document.date_echeance': !isQuote ? formatDate((s as InvoiceSnapshot).due_date) : '',
    'document.date_validite': isQuote ? formatDate((s as QuoteSnapshot).validity_date) : '',
    'document.date_prestation': !isQuote ? formatDate((s as InvoiceSnapshot).service_date) : '',
    'document.objet': s.title,
    'document.version': isQuote && (s as QuoteSnapshot).version > 1 ? `v${(s as QuoteSnapshot).version}` : '',
    'document.conditions': isQuote ? (s as QuoteSnapshot).special_conditions : '',
    'document.conditions_paiement': s.payment_terms,
    'document.mentions_legales': s.legal_mentions.join('\n'),
    'document.notes': s.footer_notes,
    'document.reference_devis': !isQuote && (s as InvoiceSnapshot).quote_number ? `Devis n° ${(s as InvoiceSnapshot).quote_number}` : '',
    'document.facture_origine': !isQuote && (s as InvoiceSnapshot).credited_invoice_number
      ? `Avoir sur la facture n° ${(s as InvoiceSnapshot).credited_invoice_number} du ${formatDate((s as InvoiceSnapshot).credited_invoice_date)}`
      : '',
    'totaux.total_ht': formatEuro(s.totals.total_ht_cents),
    'totaux.total_tva': formatEuro(s.totals.total_vat_cents),
    'totaux.total_ttc': formatEuro(s.totals.total_ttc_cents),
    'totaux.remise': s.totals.global_discount_cents ? formatEuro(s.totals.global_discount_cents) : '',
    'totaux.acompte': isQuote && (s as QuoteSnapshot).deposit.ttc_cents ? formatEuro((s as QuoteSnapshot).deposit.ttc_cents) : '',
    'paiement.iban': seller.iban,
    'paiement.bic': seller.bic,
    'paiement.banque': seller.bank_name,
    'paiement.titulaire': seller.account_holder,
    'pagination.page': '',
    'pagination.total': '',
    ...extra,
  };
  return values;
}

/**
 * Remplace les champs. Une ligne du modèle dont tous les champs sont vides est
 * supprimée avec son libellé (ex. « Échéance : {{document.date_echeance}} » sur un devis).
 */
export function fillText(text: string, values: Record<string, string>): { text: string; hadFields: boolean; anyValue: boolean } {
  let hadFields = false;
  let anyValue = false;
  const re = /\{\{\s*([a-z_.]+)\s*\}\}/gi;
  const out: string[] = [];
  for (const line of text.split('\n')) {
    let lineHasField = false;
    let lineHasValue = false;
    const filled = line.replace(re, (_m, key: string) => {
      hadFields = lineHasField = true;
      const v = values[key.toLowerCase()] ?? '';
      if (v.trim()) anyValue = lineHasValue = true;
      return v;
    });
    // Ligne contenant uniquement des champs vides (avec son libellé) : supprimée.
    if (lineHasField && !lineHasValue) continue;
    out.push(filled);
  }
  return { text: out.join('\n'), hadFields, anyValue };
}

/** Lignes formatées pour les tableaux (PDF et DOCX). */
export interface FormattedLine {
  kind: DocLine['kind'];
  designation: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount: string;
  vat_rate: string;
  total_ht: string;
  total_ttc: string;
}

export function formatLines(lines: DocLine[]): FormattedLine[] {
  return lines.map((l) => {
    if (l.kind !== 'item') {
      return { kind: l.kind, designation: l.designation, description: l.description ?? '', quantity: '', unit: '', unit_price: '', discount: '', vat_rate: '', total_ht: '', total_ttc: '' };
    }
    const r = computeLine(l);
    return {
      kind: 'item',
      designation: l.designation,
      description: l.description ?? '',
      quantity: formatQuantity(l.quantity_milli),
      unit: l.unit ?? '',
      unit_price: formatEuro(l.unit_price_cents),
      discount: l.discount_type === 'percent' ? `-${formatRate(l.discount_value)}` : l.discount_type === 'amount' ? `-${formatEuro(l.discount_value)}` : '',
      vat_rate: formatRate(l.vat_rate_bp),
      total_ht: formatEuro(r.ht_cents),
      total_ttc: formatEuro(r.ttc_cents),
    };
  });
}

/** Lignes du bloc « totaux », selon le type de document et le régime de TVA. */
export function totalsRows(s: DocSnapshot): { label: string; value: string; strong?: boolean; muted?: boolean }[] {
  const t = s.totals;
  const rows: { label: string; value: string; strong?: boolean; muted?: boolean }[] = [];
  const franchise = s.seller.vat_regime === 'franchise';
  const isCredit = s.type === 'facture' && s.kind === 'avoir';
  if (t.global_discount_cents) {
    rows.push({ label: 'Sous-total HT', value: formatEuro(t.subtotal_ht_cents) });
    rows.push({ label: 'Remise', value: `-${formatEuro(t.global_discount_cents)}` });
  }
  rows.push({ label: 'Total HT', value: formatEuro(t.total_ht_cents), strong: franchise });
  if (franchise) {
    rows.push({ label: 'TVA non applicable', value: '—', muted: true });
    rows.push({ label: isCredit ? "Montant de l'avoir" : 'Net à payer', value: formatEuro(t.total_ttc_cents), strong: true });
  } else {
    for (const v of t.vat) {
      rows.push({ label: v.rate_bp === 0 ? 'TVA 0 %' : `TVA ${formatRate(v.rate_bp)} (base ${formatEuro(v.base_cents)})`, value: formatEuro(v.vat_cents), muted: true });
    }
    if (t.vat.length > 1) rows.push({ label: 'Total TVA', value: formatEuro(t.total_vat_cents) });
    rows.push({ label: isCredit ? "Total de l'avoir TTC" : 'Total TTC', value: formatEuro(t.total_ttc_cents), strong: true });
  }
  if (s.type === 'devis' && s.deposit.ttc_cents > 0) {
    rows.push({ label: s.deposit.type === 'percent' ? `Acompte demandé (${formatRate(s.deposit.value)})` : 'Acompte demandé', value: formatEuro(s.deposit.ttc_cents) });
  }
  return rows;
}
