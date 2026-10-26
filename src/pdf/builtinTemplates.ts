/** Modèles de documents fournis (modifiables et duplicables dans l'éditeur). */
import { A4, type LayoutElement, type TableConfig, type TemplateLayout } from './types';

const NAVY = '#0f1b3d';
const TEAL = '#14b8a6';
const TEXT = '#1e293b';
const MUTED = '#64748b';
const LIGHT = '#f1f5f9';

let n = 0;
const id = (p: string) => `${p}-${++n}`;

function el(e: Omit<LayoutElement, 'id' | 'pages' | 'anchor'> & Partial<Pick<LayoutElement, 'pages' | 'anchor'>>): LayoutElement {
  return { pages: 'first', anchor: 'fixed', ...e, id: id(e.type) } as LayoutElement;
}

export function defaultTable(overrides: Partial<TableConfig> = {}): TableConfig {
  return {
    x: 40,
    y: 292,
    w: 515.28,
    bottom: 760,
    continuationTop: 70,
    continuationBottom: 760,
    columns: [
      { key: 'designation', label: 'Désignation', width: 46, align: 'left' },
      { key: 'quantity', label: 'Qté', width: 8, align: 'right' },
      { key: 'unit_price', label: 'P.U. HT', width: 14, align: 'right' },
      { key: 'vat_rate', label: 'TVA', width: 10, align: 'right' },
      { key: 'total_ht', label: 'Total HT', width: 16, align: 'right' },
    ],
    header: { background: NAVY, color: '#ffffff', size: 8.5, height: 22 },
    row: { size: 9, descriptionSize: 8, color: TEXT, mutedColor: MUTED, paddingY: 6, zebra: '#f8fafc', borderColor: '#e2e8f0' },
    showDescriptions: true,
    repeatHeader: true,
    ...overrides,
  };
}

function footer(color = MUTED): LayoutElement[] {
  return [
    el({ type: 'line', x: 40, y: 790, w: 515.28, h: 0, pages: 'all', box: { borderColor: '#e2e8f0', borderWidth: 0.8 } }),
    el({
      type: 'text', name: 'Pied de page', x: 40, y: 797, w: 420, h: 30, pages: 'all',
      text: '{{entreprise.denomination}} — {{entreprise.statut}} — SIRET {{entreprise.siret}}\n{{entreprise.email}}  {{entreprise.telephone}}  {{entreprise.site}}',
      style: { size: 7, color, lineHeight: 1.35 },
    }),
    el({ type: 'text', name: 'Numéro de page', x: 455, y: 797, w: 100.28, h: 12, pages: 'all', text: 'Page {{pagination.page}} / {{pagination.total}}', style: { size: 7, color, align: 'right' } }),
  ];
}

function flowBlocks(accent: string): LayoutElement[] {
  return [
    el({ type: 'totals', name: 'Totaux', x: 315.28, y: 0, w: 240, h: 0, anchor: 'flow', pages: 'last', style: { size: 9, color: TEXT }, box: { background: LIGHT, radius: 4, padding: 10 } }),
    el({
      type: 'text', name: 'Coordonnées bancaires', x: 40, y: 0, w: 515.28, h: 0, anchor: 'flow', pages: 'last', hideIfEmpty: true,
      docTypes: ['facture', 'acompte', 'solde'],
      text: 'Règlement par virement — IBAN : {{paiement.iban}}   BIC : {{paiement.bic}}\nTitulaire : {{paiement.titulaire}}',
      style: { size: 8.5, color: TEXT, lineHeight: 1.4 }, box: { borderColor: accent, borderWidth: 0.8, radius: 4, padding: 8 },
    }),
    el({
      type: 'text', name: 'Conditions de paiement', x: 40, y: 0, w: 515.28, h: 0, anchor: 'flow', pages: 'last', hideIfEmpty: true,
      text: 'Conditions de paiement : {{document.conditions_paiement}}', style: { size: 8.5, color: TEXT, lineHeight: 1.4 },
    }),
    el({
      type: 'text', name: 'Conditions particulières', x: 40, y: 0, w: 515.28, h: 0, anchor: 'flow', pages: 'last', hideIfEmpty: true,
      docTypes: ['devis'], text: 'Conditions particulières :\n{{document.conditions}}', style: { size: 8.5, color: TEXT, lineHeight: 1.4 },
    }),
    el({
      type: 'text', name: 'Notes', x: 40, y: 0, w: 515.28, h: 0, anchor: 'flow', pages: 'last', hideIfEmpty: true,
      text: '{{document.notes}}', style: { size: 8.5, color: TEXT, lineHeight: 1.4 },
    }),
    el({
      type: 'text', name: 'Mentions légales', x: 40, y: 0, w: 515.28, h: 0, anchor: 'flow', pages: 'last', hideIfEmpty: true,
      text: '{{document.mentions_legales}}', style: { size: 7.5, color: MUTED, lineHeight: 1.4 },
    }),
    el({
      type: 'signature', name: 'Signature client', x: 315.28, y: 0, w: 240, h: 96, anchor: 'flow', pages: 'last', docTypes: ['devis'],
      text: 'Bon pour accord — date et signature du client', style: { size: 8, color: MUTED }, box: { borderColor: '#cbd5e1', borderWidth: 0.8, radius: 4, padding: 8 },
    }),
  ];
}

export function classicLayout(): TemplateLayout {
  return {
    version: 1,
    page: { ...A4 },
    colors: { primary: NAVY, accent: TEAL, text: TEXT, muted: MUTED, light: LIGHT },
    background: { type: 'none' },
    flowGap: 12,
    table: defaultTable(),
    elements: [
      el({ type: 'rect', name: 'Bandeau', x: 0, y: 0, w: A4.width, h: 112, box: { background: NAVY } }),
      el({ type: 'rect', name: 'Liseré', x: 0, y: 112, w: A4.width, h: 4, box: { background: TEAL } }),
      el({ type: 'image', name: 'Logo', src: 'logo', x: 40, y: 26, w: 150, h: 60, fit: 'contain', hideIfEmpty: true }),
      el({ type: 'text', name: 'Nom commercial', x: 40, y: 38, w: 300, h: 30, text: '{{entreprise.nom}}', style: { size: 20, weight: 'bold', color: '#ffffff' }, hideIfEmpty: true, showIf: 'no_logo' }),
      el({ type: 'text', name: 'Type de document', x: 315.28, y: 30, w: 240, h: 26, text: '{{document.type}}', style: { size: 20, weight: 'bold', color: '#ffffff', align: 'right' } }),
      el({ type: 'text', name: 'Numéro', x: 315.28, y: 60, w: 240, h: 16, text: 'N° {{document.numero}} {{document.version}}', style: { size: 10.5, weight: 'semibold', color: '#5eead4', align: 'right' } }),
      el({ type: 'text', name: 'Dates', x: 315.28, y: 78, w: 240, h: 26, text: 'Date : {{document.date}}\nÉchéance : {{document.date_echeance}}\nValable jusqu\'au : {{document.date_validite}}', style: { size: 8.5, color: '#cbd5e1', align: 'right', lineHeight: 1.3 } }),
      el({ type: 'text', name: 'Titre émetteur', x: 40, y: 136, w: 240, h: 12, text: 'ÉMETTEUR', style: { size: 7.5, weight: 'bold', color: TEAL } }),
      el({
        type: 'text', name: 'Émetteur', x: 40, y: 151, w: 250, h: 100,
        text: '{{entreprise.denomination}}\n{{entreprise.adresse}}\n{{entreprise.email}}\n{{entreprise.telephone}}\n{{entreprise.identification}}',
        style: { size: 8.5, color: TEXT, lineHeight: 1.4, firstLine: { weight: 'bold' } },
      }),
      el({ type: 'rect', name: 'Fond client', x: 315.28, y: 130, w: 240, h: 110, box: { background: LIGHT, radius: 6 } }),
      el({ type: 'text', name: 'Titre client', x: 329.28, y: 140, w: 212, h: 12, text: 'CLIENT', style: { size: 7.5, weight: 'bold', color: TEAL } }),
      el({
        type: 'text', name: 'Client', x: 329.28, y: 154, w: 212, h: 82,
        text: '{{client.nom}}\n{{client.contact}}\n{{client.adresse}}\n{{client.email}}\nSIREN : {{client.siren}}\nTVA : {{client.tva_intra}}',
        style: { size: 8.5, color: TEXT, lineHeight: 1.35, firstLine: { size: 10.5, weight: 'bold' } },
      }),
      el({ type: 'text', name: 'Objet', x: 40, y: 256, w: 515.28, h: 28, text: 'Objet : {{document.objet}}\n{{document.reference_devis}}{{document.facture_origine}}', style: { size: 9.5, weight: 'semibold', color: NAVY, lineHeight: 1.4 }, hideIfEmpty: true }),
      el({ type: 'text', name: 'En-tête des pages suivantes', x: 40, y: 34, w: 515.28, h: 16, pages: 'not_first', text: '{{entreprise.nom}} — {{document.type}} N° {{document.numero}} (suite)', style: { size: 9, weight: 'semibold', color: NAVY } }),
      el({ type: 'line', name: 'Filet pages suivantes', x: 40, y: 54, w: 515.28, h: 0, pages: 'not_first', box: { borderColor: TEAL, borderWidth: 1.2 } }),
      ...footer(),
      ...flowBlocks(TEAL),
    ],
  };
}

export function minimalLayout(): TemplateLayout {
  const table = defaultTable({
    y: 300,
    header: { background: '#ffffff', color: NAVY, size: 8.5, height: 22 },
    row: { size: 9, descriptionSize: 8, color: TEXT, mutedColor: MUTED, paddingY: 6, zebra: null, borderColor: '#e2e8f0' },
  });
  return {
    version: 1,
    page: { ...A4 },
    colors: { primary: NAVY, accent: TEAL, text: TEXT, muted: MUTED, light: LIGHT },
    background: { type: 'none' },
    flowGap: 12,
    table,
    elements: [
      el({ type: 'rect', name: 'Accent', x: 40, y: 40, w: 36, h: 4, box: { background: TEAL } }),
      el({ type: 'image', name: 'Logo', src: 'logo', x: 40, y: 54, w: 140, h: 50, fit: 'contain', hideIfEmpty: true }),
      el({ type: 'text', name: 'Nom commercial', x: 40, y: 56, w: 260, h: 26, text: '{{entreprise.nom}}', style: { size: 17, weight: 'bold', color: NAVY }, showIf: 'no_logo' }),
      el({ type: 'text', name: 'Émetteur', x: 40, y: 112, w: 250, h: 90, text: '{{entreprise.denomination}}\n{{entreprise.adresse}}\n{{entreprise.email}} {{entreprise.telephone}}\n{{entreprise.identification}}', style: { size: 8, color: MUTED, lineHeight: 1.4 } }),
      el({ type: 'text', name: 'Type de document', x: 315.28, y: 50, w: 240, h: 26, text: '{{document.type}}', style: { size: 22, weight: 'bold', color: NAVY, align: 'right' } }),
      el({ type: 'text', name: 'Numéro et dates', x: 315.28, y: 82, w: 240, h: 50, text: 'N° {{document.numero}} {{document.version}}\nDate : {{document.date}}\nÉchéance : {{document.date_echeance}}\nValable jusqu\'au : {{document.date_validite}}', style: { size: 9, color: TEXT, align: 'right', lineHeight: 1.4 } }),
      el({ type: 'text', name: 'Titre client', x: 315.28, y: 150, w: 240, h: 12, text: 'DESTINATAIRE', style: { size: 7.5, weight: 'bold', color: TEAL, align: 'right' } }),
      el({ type: 'text', name: 'Client', x: 315.28, y: 164, w: 240, h: 90, text: '{{client.nom}}\n{{client.contact}}\n{{client.adresse}}\n{{client.email}}\nSIREN : {{client.siren}}', style: { size: 9, color: TEXT, align: 'right', lineHeight: 1.4, firstLine: { size: 10.5, weight: 'bold' } } }),
      el({ type: 'text', name: 'Objet', x: 40, y: 266, w: 515.28, h: 28, text: 'Objet : {{document.objet}}\n{{document.reference_devis}}{{document.facture_origine}}', style: { size: 9.5, weight: 'semibold', color: NAVY, lineHeight: 1.4 }, hideIfEmpty: true }),
      el({ type: 'text', name: 'En-tête des pages suivantes', x: 40, y: 34, w: 515.28, h: 16, pages: 'not_first', text: '{{document.type}} N° {{document.numero}} (suite)', style: { size: 9, weight: 'semibold', color: NAVY } }),
      ...footer(),
      ...flowBlocks(TEAL),
    ],
  };
}

/** Modèle de base pour un fond importé (PDF/image) : pas de décor, uniquement des champs. */
export function overlayLayout(page = A4): TemplateLayout {
  const base = minimalLayout();
  return {
    ...base,
    page: { ...page },
    elements: base.elements.filter((e) => !['Accent', 'Logo'].includes(e.name ?? '')),
  };
}

export const BUILTIN_TEMPLATES: { name: string; layout: TemplateLayout; defaultQuote: boolean; defaultInvoice: boolean }[] = [
  { name: 'Signal — Classique', layout: classicLayout(), defaultQuote: true, defaultInvoice: true },
  { name: 'Signal — Épuré', layout: minimalLayout(), defaultQuote: false, defaultInvoice: false },
];
