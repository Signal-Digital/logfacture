/**
 * Génération des documents PDF à partir des instantanés figés et des modèles,
 * et enregistrement des versions définitives (verrouillées) dans la
 * bibliothèque documentaire.
 */
import type { Ctx } from './context';
import { BusinessError, assert } from './context';
import { sha256Hex } from '@/lib/crypto';
import { extensionOf } from '@/lib/files';
import { renderDocument, type SignatureStamp } from '@/pdf/render';
import { fillDocx } from '@/pdf/docx';
import type { DocSnapshot } from '@/pdf/fields';
import { getSetting } from './settings';
import { parseLayout, resolveTemplate, type DocTemplate } from './templates';
import { attachVersionPdf, getQuote, previewSnapshot, type QuoteSnapshot, type QuoteVersion } from './quotes';
import { attachInvoicePdf, getInvoice, invoiceSnapshot } from './invoices';
import { storeDocument } from './documents';

export interface GeneratedPdf {
  bytes: Uint8Array;
  pageCount: number;
  engine: 'visuel' | 'docx';
  template: DocTemplate;
}

function imageKind(path: string): 'png' | 'jpg' {
  return extensionOf(path) === 'png' ? 'png' : 'jpg';
}

async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  return (await PDFDocument.load(bytes)).getPageCount();
}

/** Rend un instantané avec un modèle donné (visuel ou Word). */
export async function renderWithTemplate(
  ctx: Ctx,
  snapshot: DocSnapshot,
  template: DocTemplate,
  opts: { watermark?: string | null; signature?: SignatureStamp | null } = {},
): Promise<GeneratedPdf> {
  if (template.engine === 'docx') {
    assert(template.docx_path, 'Fichier Word du modèle introuvable.');
    if (!ctx.convertDocx) {
      throw new BusinessError(
        'Aucun convertisseur DOCX → PDF n\'est disponible sur ce poste. Installez LibreOffice (gratuit) ou Microsoft Word, ou choisissez un modèle visuel. Le document Word rempli reste exportable.',
      );
    }
    const filled = fillDocx(await ctx.files.read(template.docx_path), snapshot);
    const pdf = await ctx.convertDocx(filled.bytes);
    return { bytes: pdf, pageCount: await countPdfPages(pdf), engine: 'docx', template };
  }
  const layout = parseLayout(template);
  const company = await getSetting(ctx.db, 'company');
  const logoPath = snapshot.seller.logo_path || company.logo_path;
  let logo = null;
  if (logoPath && (await ctx.files.exists(logoPath))) logo = { bytes: await ctx.files.read(logoPath), kind: imageKind(logoPath) };
  let background = null;
  if (template.background_type !== 'none' && template.background_path) {
    if (!(await ctx.files.exists(template.background_path))) throw new BusinessError('Le fond graphique du modèle est introuvable : réimportez-le dans « Modèles de documents ».');
    const bytes = await ctx.files.read(template.background_path);
    background = { bytes, kind: template.background_type === 'pdf' ? ('pdf' as const) : imageKind(template.background_path) };
  }
  const images: Record<string, { bytes: Uint8Array; kind: 'png' | 'jpg' }> = {};
  for (const e of layout.elements) {
    if (e.type === 'image' && e.src && e.src !== 'logo' && (await ctx.files.exists(e.src))) images[e.src] = { bytes: await ctx.files.read(e.src), kind: imageKind(e.src) };
  }
  const r = await renderDocument({ snapshot, layout, background, logo, images, watermark: opts.watermark, signature: opts.signature });
  return { bytes: r.bytes, pageCount: r.pageCount, engine: 'visuel', template };
}

/** Le DOCX rempli (export Word, sans conversion). */
export async function fillWordTemplate(ctx: Ctx, snapshot: DocSnapshot, template: DocTemplate): Promise<Uint8Array> {
  assert(template.engine === 'docx' && template.docx_path, 'Ce modèle n\'est pas un modèle Word.');
  return fillDocx(await ctx.files.read(template.docx_path), snapshot).bytes;
}

// ---------- Aperçus ----------

export async function previewQuotePdf(ctx: Ctx, quoteId: number, templateId?: number | null): Promise<GeneratedPdf> {
  const q = await getQuote(ctx.db, quoteId);
  assert(q, 'Devis introuvable.');
  let snapshot: QuoteSnapshot;
  let watermark: string | null = null;
  if (q.status === 'brouillon') {
    snapshot = await previewSnapshot(ctx.db, quoteId);
    watermark = 'BROUILLON';
  } else {
    const v = await ctx.db.get<QuoteVersion>('SELECT * FROM quote_versions WHERE quote_id = ? AND version = ?', [quoteId, q.version]);
    assert(v, 'Version du devis introuvable.');
    snapshot = JSON.parse(v.snapshot);
  }
  const tpl = await resolveTemplate(ctx.db, templateId ?? q.template_id, 'devis');
  return renderWithTemplate(ctx, snapshot, tpl, { watermark });
}

export async function previewInvoicePdf(ctx: Ctx, invoiceId: number, templateId?: number | null): Promise<GeneratedPdf> {
  const inv = await getInvoice(ctx.db, invoiceId);
  assert(inv, 'Facture introuvable.');
  const snapshot = await invoiceSnapshot(ctx.db, invoiceId);
  const tpl = await resolveTemplate(ctx.db, templateId ?? inv.template_id, 'facture');
  return renderWithTemplate(ctx, snapshot, tpl, { watermark: inv.status === 'brouillon' ? 'BROUILLON' : null });
}

// ---------- Versions définitives ----------

function yearOf(date: string | null | undefined): number {
  return Number((date ?? new Date().toISOString()).slice(0, 4));
}

/** Génère et enregistre le PDF d'une version de devis figée (une seule fois). */
export async function storeQuoteVersionPdf(ctx: Ctx, versionId: number): Promise<{ path: string; sha256: string }> {
  const v = await ctx.db.get<QuoteVersion>('SELECT * FROM quote_versions WHERE id = ?', [versionId]);
  assert(v, 'Version introuvable.');
  if (v.pdf_path && v.pdf_sha256) return { path: v.pdf_path, sha256: v.pdf_sha256 };
  const q = await getQuote(ctx.db, v.quote_id);
  assert(q, 'Devis introuvable.');
  const snapshot: QuoteSnapshot = JSON.parse(v.snapshot);
  const tpl = await resolveTemplate(ctx.db, q.template_id, 'devis');
  const pdf = await renderWithTemplate(ctx, snapshot, tpl);
  const doc = await storeDocument(ctx, {
    title: `Devis ${snapshot.number}${snapshot.version > 1 ? ' v' + snapshot.version : ''}`,
    docType: 'devis',
    fileName: `Devis ${snapshot.number}${snapshot.version > 1 ? '-v' + snapshot.version : ''}.pdf`,
    folder: `documents/${yearOf(snapshot.issue_date)}/devis`,
    year: yearOf(snapshot.issue_date),
    bytes: pdf.bytes,
    companyId: q.company_id,
    projectId: q.project_id,
    quoteId: q.id,
    locked: true,
  });
  await attachVersionPdf(ctx.db, versionId, doc.file_path, doc.sha256!);
  return { path: doc.file_path, sha256: doc.sha256! };
}

/** Génère et enregistre le PDF définitif d'une facture émise (une seule fois). */
export async function storeInvoicePdf(ctx: Ctx, invoiceId: number): Promise<{ path: string; sha256: string }> {
  const inv = await getInvoice(ctx.db, invoiceId);
  assert(inv, 'Facture introuvable.');
  assert(inv.status !== 'brouillon', 'La facture doit être émise avant de générer son PDF définitif.');
  if (inv.pdf_path && inv.pdf_sha256) return { path: inv.pdf_path, sha256: inv.pdf_sha256 };
  const snapshot = await invoiceSnapshot(ctx.db, invoiceId);
  const tpl = await resolveTemplate(ctx.db, inv.template_id, 'facture');
  const pdf = await renderWithTemplate(ctx, snapshot, tpl);
  const label = inv.kind === 'avoir' ? 'Avoir' : 'Facture';
  const doc = await storeDocument(ctx, {
    title: `${label} ${inv.number}`,
    docType: inv.kind === 'avoir' ? 'avoir' : 'facture',
    fileName: `${label} ${inv.number}.pdf`,
    folder: `documents/${yearOf(inv.issue_date)}/${inv.kind === 'avoir' ? 'avoirs' : 'factures'}`,
    year: yearOf(inv.issue_date),
    bytes: pdf.bytes,
    companyId: inv.company_id,
    projectId: inv.project_id,
    quoteId: inv.quote_id,
    invoiceId: inv.id,
    contractId: inv.contract_id,
    locked: true,
  });
  await attachInvoicePdf(ctx.db, invoiceId, doc.file_path, doc.sha256!);
  return { path: doc.file_path, sha256: doc.sha256! };
}

/** Vérifie qu'un PDF enregistré n'a pas été modifié. */
export async function verifyStoredPdf(ctx: Ctx, path: string, expected: string): Promise<boolean> {
  try {
    return (await sha256Hex(await ctx.files.read(path))) === expected;
  } catch {
    return false;
  }
}
