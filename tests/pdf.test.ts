import { describe, expect, it, beforeAll } from 'vitest';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { newCtx, completeSetup, clientInput } from './helpers';
import { createCompany } from '@/domain/companies';
import { createQuote, previewSnapshot } from '@/domain/quotes';
import { createInvoiceDraft, issueInvoice, invoiceSnapshot } from '@/domain/invoices';
import { renderDocument } from '@/pdf/render';
import { classicLayout, minimalLayout, overlayLayout } from '@/pdf/builtinTemplates';
import type { DocLine } from '@/domain/docCommon';

const fs = (globalThis as any).process.getBuiltinModule('node:fs');
const OUT = 'test-output';
const save = (name: string, bytes: Uint8Array) => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/${name}`, bytes); };

const line = (designation: string, price: number, vat = 2000, description = ''): DocLine => ({
  kind: 'item', designation, description, quantity_milli: 1000, unit_price_cents: price, discount_type: 'none', discount_value: 0, vat_rate_bp: vat, unit: 'forfait',
});

let ctx: Awaited<ReturnType<typeof newCtx>>;
let companyId: number;
beforeAll(async () => {
  ctx = await newCtx();
  await completeSetup(ctx.db);
  companyId = await createCompany(ctx.db, { ...clientInput, name: 'Boulangerie Martin & Fils — Société très longue' });
});

describe('génération PDF', () => {
  it('devis court (1 ligne) : une page', async () => {
    const id = await createQuote(ctx.db, { company_id: companyId, title: 'Audit SEO', lines: [line('Audit SEO', 49000, 2000, 'Analyse technique et sémantique, rapport détaillé.')] });
    const snap = await previewSnapshot(ctx.db, id);
    const r = await renderDocument({ snapshot: snap, layout: classicLayout(), watermark: 'APERÇU' });
    save('devis-1-ligne.pdf', r.bytes);
    expect(r.pageCount).toBe(1);
    expect(r.signatureZone).not.toBeNull();
    const loaded = await PDFDocument.load(r.bytes);
    expect(loaded.getTitle()).toContain('DEVIS');
  });

  it('devis de 100 lignes : multipage, en-tête répété, aucune ligne coupée, totaux en fin', async () => {
    const lines: DocLine[] = [];
    for (let i = 1; i <= 100; i++) {
      if (i % 25 === 1) lines.push({ kind: 'section', designation: `Lot ${Math.ceil(i / 25)} — Prestations`, quantity_milli: 0, unit_price_cents: 0, discount_type: 'none', discount_value: 0, vat_rate_bp: 0 });
      lines.push(line(`Prestation n°${i} ${i % 10 === 0 ? '— désignation particulièrement longue qui doit passer sur plusieurs lignes dans la colonne désignation sans déborder' : ''}`, 1000 + i * 37, [2000, 1000, 550, 0][i % 4], i % 5 === 0 ? 'Description détaillée de la prestation, avec suffisamment de texte pour occuper deux lignes dans le tableau.' : ''));
    }
    const id = await createQuote(ctx.db, { company_id: companyId, title: 'Grand projet', lines, deposit_type: 'percent', deposit_value: 3000, global_discount_type: 'percent', global_discount_value: 500 });
    const snap = await previewSnapshot(ctx.db, id);
    const r = await renderDocument({ snapshot: snap, layout: classicLayout() });
    save('devis-100-lignes.pdf', r.bytes);
    expect(r.pageCount).toBeGreaterThanOrEqual(4);
    expect(r.rowsPerPage.reduce((a, b) => a + b, 0)).toBe(104); // aucune ligne perdue ni coupée
    expect(r.signatureZone!.page).toBe(r.pageCount - 1);
  });

  it('ligne unique extrêmement longue : découpée proprement sur plusieurs pages', async () => {
    const long = 'Texte très long. '.repeat(900);
    const id = await createQuote(ctx.db, { company_id: companyId, lines: [line('Cahier des charges', 100000, 2000, long)] });
    const r = await renderDocument({ snapshot: await previewSnapshot(ctx.db, id), layout: minimalLayout() });
    save('devis-ligne-geante.pdf', r.bytes);
    expect(r.pageCount).toBeGreaterThan(1);
  });

  it('facture émise (TVA multiple, TVA 0, acompte) avec le modèle épuré', async () => {
    const inv = await createInvoiceDraft(ctx.db, { company_id: companyId, title: 'Prestations octobre', lines: [line('Site', 180000, 2000), line('Livre blanc', 3000, 550), line('Débours', 4500, 0)] });
    await issueInvoice(ctx.db, inv);
    const snap = await invoiceSnapshot(ctx.db, inv);
    const r = await renderDocument({ snapshot: snap, layout: minimalLayout() });
    save('facture.pdf', r.bytes);
    expect(r.pageCount).toBe(1);
    expect(r.signatureZone).toBeNull(); // pas de zone de signature sur une facture
  });

  it('modèle importé : un PDF existant sert de fond graphique', async () => {
    // PDF « maison » simulé : bandeau, logo texte, pied de page
    const bg = await PDFDocument.create();
    const font = await bg.embedFont(StandardFonts.HelveticaBold);
    for (let i = 0; i < 2; i++) {
      const p = bg.addPage([595.28, 841.89]);
      p.drawRectangle({ x: 0, y: 760, width: 595.28, height: 82, color: rgb(0.55, 0.1, 0.35) });
      p.drawText(i === 0 ? 'MON AGENCE — en-tête page 1' : 'MON AGENCE — suite', { x: 40, y: 790, size: 18, font, color: rgb(1, 1, 1) });
      p.drawRectangle({ x: 0, y: 0, width: 595.28, height: 30, color: rgb(0.9, 0.9, 0.9) });
    }
    const bgBytes = await bg.save();
    const layout = overlayLayout();
    layout.background = { type: 'pdf', firstPage: 0, otherPages: 1 };
    // Zones définies comme dans l'éditeur : sous le bandeau importé, au-dessus de son pied de page
    layout.table.continuationTop = 100;
    layout.table.continuationBottom = 770;
    layout.elements = layout.elements.filter((e) => e.pages !== 'not_first');
    const lines = Array.from({ length: 45 }, (_, i) => line(`Ligne ${i + 1}`, 1000));
    const id = await createQuote(ctx.db, { company_id: companyId, lines });
    const r = await renderDocument({ snapshot: await previewSnapshot(ctx.db, id), layout, background: { bytes: bgBytes, kind: 'pdf' } });
    save('devis-fond-pdf.pdf', r.bytes);
    expect(r.pageCount).toBeGreaterThan(1);
  });

  it('modèle importé : image de fond PNG et logo', async () => {
    const png = fs.readFileSync('assets/logo.png');
    const layout = classicLayout();
    layout.background = { type: 'image' };
    const id = await createQuote(ctx.db, { company_id: companyId, lines: [line('Audit', 49000)] });
    const r = await renderDocument({ snapshot: await previewSnapshot(ctx.db, id), layout: minimalLayout(), logo: { bytes: png, kind: 'png' } });
    save('devis-logo.pdf', r.bytes);
    const r2 = await renderDocument({ snapshot: await previewSnapshot(ctx.db, id), layout, background: { bytes: png, kind: 'png' } });
    expect(r2.pageCount).toBe(1);
  });
});
