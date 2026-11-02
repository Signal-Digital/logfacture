/**
 * Devis réalisés en dehors de Signal Desk.
 *
 * Un devis externe est un devis Signal Desk ordinaire (numéro interne, version
 * figée, statut, facturation) marqué `origin = 'externe'`, avec sa référence
 * d'origine et, si fourni, le PDF d'origine comme document de la version.
 * Le détail des lignes n'est pas ressaisi : une ligne par montant / taux de TVA.
 * Signal Desk ne génère jamais de PDF à son nom pour un devis externe.
 */
import type { Ctx } from './context';
import type { Db } from '@/lib/db';
import { BusinessError, assert } from './context';
import { logEvent } from './audit';
import { createCompany, normalizeName, type Company, type CompanyKind } from './companies';
import { acceptQuote, createQuote, finalizeQuote, refuseQuote, attachVersionPdf, type QuoteStatus } from './quotes';
import { storeDocument } from './documents';
import { getAllSettings } from './settings';
import { csvToObjects } from '@/lib/csv';
import { parseEuros, parsePercent } from '@/lib/money';
import { today } from '@/lib/format';
import type { DocLine } from './docCommon';

export type ExternalStatus = Exclude<QuoteStatus, 'brouillon' | 'annule'>;

export const EXTERNAL_STATUSES: { key: ExternalStatus; label: string }[] = [
  { key: 'envoye', label: 'Envoyé (en attente de réponse)' },
  { key: 'attente_signature', label: 'En attente de signature' },
  { key: 'accepte', label: 'Accepté' },
  { key: 'refuse', label: 'Refusé' },
  { key: 'expire', label: 'Expiré' },
];

export interface ExternalAmount {
  label?: string | null;
  ht_cents: number;
  vat_rate_bp: number;
}

export interface ExternalQuoteInput {
  company_id: number;
  contact_id?: number | null;
  opportunity_id?: number | null;
  external_ref: string;
  title?: string | null;
  issue_date: string;
  validity_date?: string | null;
  amounts: ExternalAmount[];
  status: ExternalStatus;
  /** Date d'acceptation (devis acceptés) ; par défaut la date du jour */
  accepted_date?: string | null;
  note?: string | null;
  pdf?: { name: string; bytes: Uint8Array } | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function validateExternal(input: ExternalQuoteInput): string[] {
  const e: string[] = [];
  if (!input.company_id) e.push('Sélectionnez le client.');
  if (!input.external_ref?.trim()) e.push('Indiquez la référence (numéro) du devis d\'origine.');
  if (!ISO.test(input.issue_date ?? '')) e.push('Date du devis invalide.');
  else if (input.issue_date > today()) e.push('La date du devis ne peut pas être dans le futur.');
  if (input.validity_date && !ISO.test(input.validity_date)) e.push('Date de validité invalide.');
  if (input.validity_date && input.issue_date && input.validity_date < input.issue_date) e.push('La date de validité précède la date du devis.');
  if (!input.amounts?.length) e.push('Indiquez au moins un montant HT.');
  input.amounts?.forEach((a, i) => {
    if (!Number.isSafeInteger(a.ht_cents) || a.ht_cents <= 0) e.push(`Montant ${i + 1} : le montant HT doit être positif.`);
    if (a.vat_rate_bp < 0 || a.vat_rate_bp > 10000) e.push(`Montant ${i + 1} : taux de TVA invalide.`);
  });
  if (!EXTERNAL_STATUSES.some((s) => s.key === input.status)) e.push('Statut invalide.');
  if (input.accepted_date && !ISO.test(input.accepted_date)) e.push('Date d\'acceptation invalide.');
  if (input.pdf && !(input.pdf.bytes[0] === 0x25 && input.pdf.bytes[1] === 0x50 && input.pdf.bytes[2] === 0x44 && input.pdf.bytes[3] === 0x46)) {
    e.push('Le fichier joint n\'est pas un PDF valide.');
  }
  return e;
}

export async function findExternal(db: Db, companyId: number, ref: string) {
  return db.get<{ id: number; number: string }>(
    "SELECT id, number FROM quotes WHERE company_id = ? AND origin = 'externe' AND lower(trim(external_ref)) = lower(trim(?))",
    [companyId, ref],
  );
}

/** Enregistre un devis externe. Retourne l'identifiant du devis créé. */
export async function registerExternalQuote(ctx: Ctx, input: ExternalQuoteInput): Promise<number> {
  const errors = validateExternal(input);
  if (errors.length) throw new BusinessError(errors[0], errors);
  const ref = input.external_ref.trim();
  if (await findExternal(ctx.db, input.company_id, ref)) {
    throw new BusinessError(`Le devis externe « ${ref} » est déjà enregistré pour ce client.`);
  }
  const lines: DocLine[] = input.amounts.map((a, i) => ({
    kind: 'item',
    designation: a.label?.trim() || (input.amounts.length > 1 ? `Devis ${ref} — partie ${i + 1}` : `Devis ${ref}${input.title ? ' — ' + input.title.trim() : ''}`),
    description: null,
    quantity_milli: 1000,
    unit: 'forfait',
    unit_price_cents: a.ht_cents,
    discount_type: 'none',
    discount_value: 0,
    vat_rate_bp: a.vat_rate_bp,
  }));
  return ctx.db.tx(async (t) => {
    const tctx: Ctx = { ...ctx, db: t };
    const id = await createQuote(t, {
      company_id: input.company_id,
      contact_id: input.contact_id ?? null,
      opportunity_id: input.opportunity_id ?? null,
      title: input.title?.trim() || `Devis ${ref}`,
      issue_date: input.issue_date,
      validity_date: input.validity_date ?? null,
      notes_internal: input.note?.trim() || null,
      payment_terms: null,
      special_conditions: null,
      lines,
    });
    // Validité : uniquement celle du document d'origine (aucune durée par défaut inventée).
    await t.run("UPDATE quotes SET origin = 'externe', external_ref = ?, validity_date = ? WHERE id = ?", [ref, input.validity_date ?? null, id]);
    const version = await finalizeQuote(t, id, { external: true, awaitingSignature: input.status === 'attente_signature' });
    await t.run('UPDATE quotes SET sent_at = ? WHERE id = ?', [`${input.issue_date}T12:00:00.000Z`, id]);
    const q = await t.get<{ company_id: number; project_id: number | null; number: string }>('SELECT company_id, project_id, number FROM quotes WHERE id = ?', [id]);
    if (input.pdf) {
      const year = Number(input.issue_date.slice(0, 4));
      const doc = await storeDocument(tctx, {
        title: `Devis externe ${ref}`,
        docType: 'devis',
        fileName: input.pdf.name.toLowerCase().endsWith('.pdf') ? input.pdf.name : `${input.pdf.name}.pdf`,
        folder: `documents/${year}/devis-externes`,
        year,
        bytes: input.pdf.bytes,
        companyId: q!.company_id,
        projectId: q!.project_id,
        quoteId: id,
        locked: true,
        notes: `Devis réalisé hors de Signal Desk (référence d'origine ${ref}), enregistré sous ${q!.number}.`,
      });
      await attachVersionPdf(t, version.id, doc.file_path, doc.sha256!);
    }
    if (input.status === 'accepte') {
      await acceptQuote(t, id, { versionId: version.id, via: 'manuel', note: input.note?.trim() || `Devis externe ${ref} accepté` });
      if (input.accepted_date) await t.run('UPDATE quotes SET accepted_at = ? WHERE id = ?', [`${input.accepted_date}T12:00:00.000Z`, id]);
    } else if (input.status === 'refuse') {
      await refuseQuote(t, id, input.note?.trim() || undefined);
    } else if (input.status === 'expire') {
      await t.run("UPDATE quotes SET status = 'expire' WHERE id = ?", [id]);
    }
    await logEvent(t, {
      entity: 'devis', id, action: 'devis_externe',
      summary: `Devis externe « ${ref} » enregistré sous ${q!.number}${input.pdf ? ' (PDF d\'origine joint)' : ''}`,
      companyId: q!.company_id,
    });
    return id;
  });
}

/** Ajoute le PDF d'origine à un devis externe qui n'en avait pas. */
export async function attachExternalPdf(ctx: Ctx, quoteId: number, pdf: { name: string; bytes: Uint8Array }): Promise<void> {
  const q = await ctx.db.get<any>('SELECT * FROM quotes WHERE id = ?', [quoteId]);
  assert(q && q.origin === 'externe', 'Devis externe introuvable.');
  if (!(pdf.bytes[0] === 0x25 && pdf.bytes[1] === 0x50 && pdf.bytes[2] === 0x44 && pdf.bytes[3] === 0x46)) throw new BusinessError('Le fichier n\'est pas un PDF valide.');
  const v = await ctx.db.get<any>('SELECT * FROM quote_versions WHERE quote_id = ? AND version = ?', [quoteId, q.version]);
  assert(v, 'Version du devis introuvable.');
  if (v.pdf_path) throw new BusinessError('Un PDF est déjà associé à ce devis.');
  const year = Number(q.issue_date.slice(0, 4));
  const doc = await storeDocument(ctx, {
    title: `Devis externe ${q.external_ref}`, docType: 'devis', fileName: pdf.name, folder: `documents/${year}/devis-externes`, year,
    bytes: pdf.bytes, companyId: q.company_id, projectId: q.project_id, quoteId, locked: true,
  });
  await attachVersionPdf(ctx.db, v.id, doc.file_path, doc.sha256!);
}

// ---------- Import CSV ----------

export const EXTERNAL_CSV_COLUMNS: { key: string; label: string; aliases: string[]; required?: boolean }[] = [
  { key: 'client', label: 'Client', aliases: ['client', 'entreprise', 'société', 'societe', 'raison sociale', 'nom client'], required: true },
  { key: 'ref', label: 'Référence', aliases: ['référence', 'reference', 'numéro', 'numero', 'n°', 'num', 'devis', 'n° devis'], required: true },
  { key: 'date', label: 'Date', aliases: ['date', 'date du devis', 'date devis', "date d'émission"], required: true },
  { key: 'ht', label: 'Montant HT', aliases: ['montant ht', 'total ht', 'ht', 'montant'], required: true },
  { key: 'tva', label: 'Taux TVA', aliases: ['taux tva', 'tva', 'taux de tva', 'tva %'] },
  { key: 'designation', label: 'Désignation', aliases: ['désignation', 'designation', 'libellé', 'libelle', 'prestation'] },
  { key: 'objet', label: 'Objet', aliases: ['objet', 'titre', 'sujet'] },
  { key: 'validite', label: 'Validité', aliases: ['validité', 'validite', 'date de validité', "valable jusqu'au"] },
  { key: 'statut', label: 'Statut', aliases: ['statut', 'état', 'etat', 'status'] },
  { key: 'acceptation', label: "Date d'acceptation", aliases: ["date d'acceptation", 'date acceptation', 'accepté le', 'signé le'] },
  { key: 'email', label: 'Email', aliases: ['email', 'e-mail', 'mail'] },
  { key: 'adresse', label: 'Adresse', aliases: ['adresse'] },
  { key: 'cp', label: 'Code postal', aliases: ['code postal', 'cp'] },
  { key: 'ville', label: 'Ville', aliases: ['ville'] },
];

export function mapExternalHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const n = h.trim().toLowerCase();
    const col = EXTERNAL_CSV_COLUMNS.find((c) => c.label.toLowerCase() === n || c.aliases.includes(n));
    if (col && !Object.values(map).includes(col.key)) map[h] = col.key;
  }
  return map;
}

function parseDate(s: string): string | null {
  const v = (s ?? '').trim();
  if (!v) return null;
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
  if (ISO.test(v)) return v;
  throw new Error(`date invalide « ${v} » (format JJ/MM/AAAA attendu)`);
}

function parseStatus(s: string): ExternalStatus {
  const v = (s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!v) return 'envoye';
  if (/^(accept|sign|gagn|valid)/.test(v)) return 'accepte';
  if (/^(refus|perdu)/.test(v)) return 'refuse';
  if (/^expir/.test(v)) return 'expire';
  if (/attente.*sign/.test(v)) return 'attente_signature';
  if (/^(envoy|en attente|attente|ouvert)/.test(v)) return 'envoye';
  throw new Error(`statut inconnu « ${s} » (envoyé, accepté, refusé, expiré)`);
}

export interface ExternalImportReport {
  created: number;
  companiesCreated: number;
  skipped: { line: number; ref: string; reason: string }[];
  errors: { line: number; message: string }[];
}

/**
 * Importe des devis externes depuis un CSV (export Excel « CSV »).
 * Plusieurs lignes ayant le même client et la même référence forment un seul
 * devis (une ligne par montant, utile pour plusieurs taux de TVA).
 * Les clients sont retrouvés par leur nom ; à défaut, une fiche est créée.
 */
export async function importExternalQuotesCsv(ctx: Ctx, text: string, opts: { mapping?: Record<string, string> } = {}): Promise<ExternalImportReport> {
  const { headers, rows } = csvToObjects(text);
  const mapping = opts.mapping ?? mapExternalHeaders(headers);
  for (const c of EXTERNAL_CSV_COLUMNS.filter((x) => x.required)) {
    if (!Object.values(mapping).includes(c.key)) throw new BusinessError(`Colonne « ${c.label} » introuvable dans le fichier.`);
  }
  const settings = await getAllSettings(ctx.db);
  const defaultRate = settings.vat.regime === 'franchise' ? 0 : settings.vat.default_rate_bp;
  const report: ExternalImportReport = { created: 0, companiesCreated: 0, skipped: [], errors: [] };

  // Regroupement par (client, référence)
  const groups = new Map<string, { line: number; r: Record<string, string> }[]>();
  rows.forEach((raw, i) => {
    const r: Record<string, string> = {};
    for (const [h, key] of Object.entries(mapping)) r[key] = (raw[h] ?? '').trim();
    if (!r.client && !r.ref && !r.ht) return;
    const key = `${normalizeName(r.client ?? '')}|${(r.ref ?? '').toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ line: i + 2, r });
  });

  const companies = await ctx.db.all<Company>('SELECT * FROM companies WHERE merged_into_id IS NULL ORDER BY archived_at IS NOT NULL, id');
  const byName = new Map<string, Company>();
  for (const c of companies) if (!byName.has(normalizeName(c.name))) byName.set(normalizeName(c.name), c);

  for (const items of groups.values()) {
    const first = items[0];
    try {
      const r = first.r;
      if (!r.client) throw new Error('nom du client manquant');
      if (!r.ref) throw new Error('référence du devis manquante');
      const issue = parseDate(r.date);
      if (!issue) throw new Error('date du devis manquante');
      const status = parseStatus(r.statut);
      const amounts: ExternalAmount[] = items.map(({ r: x }) => {
        if (!x.ht) throw new Error('montant HT manquant');
        return { label: x.designation || null, ht_cents: parseEuros(x.ht), vat_rate_bp: x.tva ? parsePercent(x.tva) : defaultRate };
      });
      let company = byName.get(normalizeName(r.client));
      if (company) {
        const dup = await findExternal(ctx.db, company.id, r.ref);
        if (dup) {
          report.skipped.push({ line: first.line, ref: r.ref, reason: `déjà enregistré (${dup.number})` });
          continue;
        }
      } else {
        const kind: CompanyKind = 'prospect';
        const id = await createCompany(ctx.db, { name: r.client, kind, email: r.email || null, address_line1: r.adresse || null, postal_code: r.cp || null, city: r.ville || null, source: 'Import devis externes' });
        company = (await ctx.db.get<Company>('SELECT * FROM companies WHERE id = ?', [id]))!;
        byName.set(normalizeName(company.name), company);
        report.companiesCreated++;
      }
      await registerExternalQuote(ctx, {
        company_id: company.id,
        external_ref: r.ref,
        title: r.objet || null,
        issue_date: issue,
        validity_date: parseDate(r.validite),
        amounts,
        status,
        accepted_date: status === 'accepte' ? parseDate(r.acceptation) : null,
        note: `Importé depuis un fichier CSV (ligne ${first.line})`,
      });
      report.created++;
    } catch (e: any) {
      report.errors.push({ line: first.line, message: e?.message ?? String(e) });
    }
  }
  return report;
}

/** Modèle de fichier CSV proposé à l'utilisateur. */
export const EXTERNAL_CSV_TEMPLATE =
  '﻿Client;Référence;Date;Objet;Désignation;Montant HT;Taux TVA;Validité;Statut;Date d\'acceptation\r\n' +
  'Boulangerie Martin;DEV-2025-012;15/09/2025;Site vitrine;Création du site;1800,00;20;15/10/2025;Accepté;20/09/2025\r\n' +
  'Garage Durand;DEV-2025-013;02/10/2025;Audit SEO;Audit SEO;490,00;20;;Envoyé;\r\n';
