import { describe, expect, it } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import PizZip from 'pizzip';
import { newCtx, completeSetup, clientInput } from './helpers';
import { buildDocx, libreOfficeConverter } from './docx-fixture';
import { createCompany, getCompany } from '@/domain/companies';
import { createQuote, finalizeQuote, getQuote, newVersion, previewSnapshot, listVersions } from '@/domain/quotes';
import { createInvoiceDraft, issueInvoice, getInvoice } from '@/domain/invoices';
import { importTemplate, listTemplates, setDefaultTemplate, duplicateTemplate, getTemplate, parseLayout, saveLayout, resolveTemplate, archiveTemplate } from '@/domain/templates';
import { previewQuotePdf, storeInvoicePdf, storeQuoteVersionPdf, renderWithTemplate, fillWordTemplate } from '@/domain/docgen';
import { createSignatureRequest, openSigningSession, signQuote, verifySignature, signatureEvents, listSignatures } from '@/domain/signatures';
import { listDocuments, verifyDocument, findByHash, deleteDocument } from '@/domain/documents';
import { inspectDocx } from '@/pdf/docx';
import { readSignatureZone } from '@/pdf/sign';
import { sha256Hex } from '@/lib/crypto';
import type { DocLine } from '@/domain/docCommon';

const fs = (globalThis as any).process.getBuiltinModule('node:fs');
const save = (name: string, bytes: Uint8Array) => { fs.mkdirSync('test-output', { recursive: true }); fs.writeFileSync(`test-output/${name}`, bytes); };
const line = (d: string, price: number): DocLine => ({ kind: 'item', designation: d, quantity_milli: 1000, unit_price_cents: price, discount_type: 'none', discount_value: 0, vat_rate_bp: 2000, unit: 'forfait' });
const PNG = fs.readFileSync('assets/logo.png') as Uint8Array;

async function setup() {
  const ctx = await newCtx();
  await completeSetup(ctx.db);
  const companyId = await createCompany(ctx.db, clientInput);
  return { ...ctx, companyId };
}

describe('modèles de documents', () => {
  it('modèles fournis et modèle par défaut', async () => {
    const { db } = await setup();
    const t = await listTemplates(db);
    expect(t.length).toBe(2);
    expect((await resolveTemplate(db, null, 'devis')).name).toBe('Signal — Classique');
    await setDefaultTemplate(db, t[1].id, 'facture');
    expect((await resolveTemplate(db, null, 'facture')).id).toBe(t[1].id);
    expect((await resolveTemplate(db, null, 'devis')).id).toBe(t[0].id);
    await expect(archiveTemplate(db, t[0].id)).rejects.toThrow(/défaut/);
  });

  it('import PDF : fond conservé, zones modifiables, duplication indépendante', async () => {
    const ctx = await setup();
    const bg = await PDFDocument.create();
    const p = bg.addPage([595.28, 841.89]);
    p.drawRectangle({ x: 0, y: 742, width: 595.28, height: 100, color: rgb(0.1, 0.3, 0.6) });
    const r = await importTemplate(ctx, 'Mon modèle.pdf', await bg.save());
    const tpl = (await getTemplate(ctx.db, r.id))!;
    expect(tpl.background_type).toBe('pdf');
    expect(tpl.background_pages).toBe(1);
    expect(await ctx.files.exists(tpl.background_path!)).toBe(true);
    const layout = parseLayout(tpl);
    layout.table.y = 320;
    await saveLayout(ctx.db, tpl.id, layout);
    expect(parseLayout((await getTemplate(ctx.db, tpl.id))!).table.y).toBe(320);
    layout.table.bottom = layout.table.y + 10;
    await expect(saveLayout(ctx.db, tpl.id, layout)).rejects.toThrow(/trop petite/);
    const copy = await duplicateTemplate(ctx, tpl.id);
    const c = (await getTemplate(ctx.db, copy))!;
    expect(c.background_path).not.toBe(tpl.background_path);
    expect(await ctx.files.exists(c.background_path!)).toBe(true);
    // Rendu d'un devis avec ce modèle
    const q = await createQuote(ctx.db, { company_id: ctx.companyId, template_id: tpl.id, lines: [line('Audit', 49000)] });
    const pdf = await previewQuotePdf(ctx, q);
    expect(pdf.pageCount).toBe(1);
    expect(pdf.template.id).toBe(tpl.id);
  });

  it('import image PNG et refus des formats non pris en charge', async () => {
    const ctx = await setup();
    const r = await importTemplate(ctx, 'fond.png', PNG);
    expect((await getTemplate(ctx.db, r.id))!.background_type).toBe('image');
    await expect(importTemplate(ctx, 'fond.png', new Uint8Array([1, 2, 3]))).rejects.toThrow(/Image/);
    await expect(importTemplate(ctx, 'virus.exe', new Uint8Array([1]))).rejects.toThrow(/Format/);
    await expect(importTemplate(ctx, 'faux.pdf', new Uint8Array([1, 2, 3]))).rejects.toThrow(/PDF/);
  });

  it('import DOCX : champs détectés, remplissage (y compris champs découpés par Word et boucle de lignes)', async () => {
    const ctx = await setup();
    const docx = buildDocx();
    const info = inspectDocx(docx);
    expect(info.valid).toBe(true);
    expect(info.fields).toContain('client.nom');
    expect(info.loops).toContain('lignes');
    const r = await importTemplate(ctx, 'Modèle Word.docx', docx);
    const tpl = (await getTemplate(ctx.db, r.id))!;
    expect(tpl.engine).toBe('docx');
    const q = await createQuote(ctx.db, { company_id: ctx.companyId, lines: [line('Création site', 180000), line('Audit SEO', 49000), line('Maintenance', 6900)] });
    const filled = await fillWordTemplate(ctx, await previewSnapshot(ctx.db, q), tpl);
    const xml = new PizZip(filled).file('word/document.xml')!.asText();
    expect(xml).toContain('Boulangerie Martin');
    expect(xml).toContain('DEVIS');
    expect(xml).toContain('Création site');
    expect(xml).toContain('Maintenance');
    expect(xml).toContain('Total TTC : 2\u00a0830,80\u00a0€');
    expect(xml).not.toContain('{{');
    const noLoop = inspectDocx(buildDocx({ withLoop: false }));
    expect(noLoop.loops).not.toContain('lignes');
    expect(inspectDocx(new Uint8Array([1, 2, 3])).valid).toBe(false);
  });

  it('DOCX → PDF : conversion réelle par LibreOffice si installé, sinon message explicite', async () => {
    const ctx = await setup();
    const r = await importTemplate(ctx, 'Modèle Word.docx', buildDocx());
    const tpl = (await getTemplate(ctx.db, r.id))!;
    const lines = Array.from({ length: 60 }, (_, i) => line(`Prestation ${i + 1}`, 1000 + i));
    const q = await createQuote(ctx.db, { company_id: ctx.companyId, lines });
    const snap = await previewSnapshot(ctx.db, q);
    await expect(renderWithTemplate(ctx, snap, tpl)).rejects.toThrow(/LibreOffice/);
    const converter = libreOfficeConverter();
    if (!converter) return; // poste sans LibreOffice : seul le message est vérifié
    const pdf = await renderWithTemplate({ ...ctx, convertDocx: converter }, snap, tpl);
    save('devis-docx.pdf', pdf.bytes);
    expect(pdf.engine).toBe('docx');
    expect(pdf.pageCount).toBeGreaterThanOrEqual(2); // 60 lignes : pagination assurée par LibreOffice
  }, 180000);
});

describe('PDF définitifs et bibliothèque', () => {
  it('le PDF d’une facture émise est enregistré, verrouillé et vérifiable', async () => {
    const ctx = await setup();
    const id = await createInvoiceDraft(ctx.db, { company_id: ctx.companyId, lines: [line('Audit', 49000)] });
    await issueInvoice(ctx.db, id);
    const stored = await storeInvoicePdf(ctx, id);
    expect(stored.path).toMatch(/^documents\/\d{4}\/factures\/Facture F-\d{4}-0001\.pdf$/);
    expect((await storeInvoicePdf(ctx, id)).sha256).toBe(stored.sha256); // idempotent
    const inv = (await getInvoice(ctx.db, id))!;
    expect(inv.pdf_sha256).toBe(stored.sha256);
    const docs = await listDocuments(ctx.db, { invoiceId: id });
    expect(docs.length).toBe(1);
    expect(docs[0].locked).toBe(1);
    expect((await verifyDocument(ctx, docs[0].id)).ok).toBe(true);
    await expect(deleteDocument(ctx.db, docs[0].id)).rejects.toThrow(/verrouillé/);
    await expect(ctx.db.run('DELETE FROM documents WHERE id = ?', [docs[0].id])).rejects.toThrow();
    expect((await findByHash(ctx.db, stored.sha256)).found).toBe(true);
    // Altération du fichier détectée
    const bytes = await ctx.files.read(stored.path);
    bytes[bytes.length - 10] ^= 0xff;
    await ctx.files.write(stored.path, bytes);
    expect((await verifyDocument(ctx, docs[0].id)).ok).toBe(false);
  });
});

describe('signature électronique', () => {
  async function sentQuote(ctx: any) {
    const id = await createQuote(ctx.db, { company_id: ctx.companyId, title: 'Refonte du site', lines: [line('Refonte', 250000), line('Audit SEO', 49000)] });
    await finalizeQuote(ctx.db, id);
    return id;
  }

  it('signature complète : PDF signé, certificat, original conservé, devis accepté, client converti', async () => {
    const ctx = await setup();
    const q = await sentQuote(ctx);
    const req = await createSignatureRequest(ctx, q);
    expect((await getQuote(ctx.db, q))!.status).toBe('attente_signature');
    const session = await openSigningSession(ctx, req.token);
    expect(session.snapshot.number).toBe((await getQuote(ctx.db, q))!.number);
    const original = await ctx.files.read(session.pdfPath);
    expect(readSignatureZone(await PDFDocument.load(original))).not.toBeNull();

    await expect(signQuote(ctx, req.token, { signerName: 'Claire Martin', consent: false, mention: 'Bon pour accord', signaturePng: PNG })).rejects.toThrow(/consentement/);
    await expect(signQuote(ctx, req.token, { signerName: 'Claire Martin', consent: true, mention: 'ok', signaturePng: PNG })).rejects.toThrow(/mention/);
    await expect(signQuote(ctx, req.token, { signerName: 'Claire Martin', consent: true, mention: 'Bon pour accord', signaturePng: new Uint8Array(10) })).rejects.toThrow(/vide/);

    const sig = await signQuote(ctx, req.token, { signerName: 'Claire Martin', signerRole: 'Gérante', consent: true, mention: 'bon pour accord', signaturePng: PNG, userAgent: 'test' });
    expect(sig.original_sha256).toBe(await sha256Hex(original));
    const signed = await ctx.files.read(sig.signed_pdf_path!);
    save('devis-signe.pdf', signed);
    const signedDoc = await PDFDocument.load(signed);
    expect(signedDoc.getPageCount()).toBe((await PDFDocument.load(original)).getPageCount() + 1); // + certificat
    // L'original n'a pas changé
    expect(await sha256Hex(await ctx.files.read(session.pdfPath))).toBe(sig.original_sha256);
    const quote = (await getQuote(ctx.db, q))!;
    expect(quote.status).toBe('accepte');
    expect(quote.accepted_version_id).toBe(sig.quote_version_id);
    expect((await getCompany(ctx.db, ctx.companyId))!.kind).toBe('client');
    expect((await verifySignature(ctx, sig.id)).ok).toBe(true);
    const events = (await signatureEvents(ctx.db, q)).map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(['demande_creee', 'consultation', 'consentement', 'signature', 'pdf_signe']));
    expect((await listSignatures(ctx.db, q)).length).toBe(1);
    // Rejeu impossible
    await expect(signQuote(ctx, req.token, { signerName: 'Claire Martin', consent: true, mention: 'Bon pour accord', signaturePng: PNG })).rejects.toThrow(/déjà été signé/);
    // Signature et journal immuables
    await expect(ctx.db.run("UPDATE signatures SET signer_name = 'X' WHERE id = ?", [sig.id])).rejects.toThrow(/immuable/);
    await expect(ctx.db.run('DELETE FROM signature_events')).rejects.toThrow();
    // Les documents (original + signé) sont dans la bibliothèque, verrouillés
    const docs = await listDocuments(ctx.db, { quoteId: q });
    expect(docs.map((d) => d.doc_type).sort()).toEqual(['devis', 'devis_signe']);
    expect(docs.every((d) => d.locked === 1)).toBe(true);
    // Altération détectée a posteriori
    const s = await ctx.files.read(sig.signed_pdf_path!);
    s[100] ^= 0xff;
    await ctx.files.write(sig.signed_pdf_path!, s);
    expect((await verifySignature(ctx, sig.id)).ok).toBe(false);
  });

  it('la signature est liée à la bonne version : une nouvelle version invalide la demande', async () => {
    const ctx = await setup();
    const q = await sentQuote(ctx);
    const req = await createSignatureRequest(ctx, q);
    await newVersion(ctx.db, q, 'Remise accordée');
    await expect(openSigningSession(ctx, req.token)).rejects.toThrow();
    await finalizeQuote(ctx.db, q);
    const req2 = await createSignatureRequest(ctx, q);
    const sig = await signQuote(ctx, req2.token, { signerName: 'Claire Martin', consent: true, mention: 'Bon pour accord', signaturePng: PNG });
    const versions = await listVersions(ctx.db, q);
    expect(sig.quote_version_id).toBe(versions[0].id);
    expect(versions[0].version).toBe(2);
  });

  it('refuse de signer un PDF original modifié', async () => {
    const ctx = await setup();
    const q = await sentQuote(ctx);
    const req = await createSignatureRequest(ctx, q);
    const v = (await listVersions(ctx.db, q))[0];
    const bytes = await ctx.files.read(v.pdf_path!);
    bytes[200] ^= 0xff;
    await ctx.files.write(v.pdf_path!, bytes);
    await expect(signQuote(ctx, req.token, { signerName: 'Claire Martin', consent: true, mention: 'Bon pour accord', signaturePng: PNG })).rejects.toThrow(/modifié/);
    expect((await getQuote(ctx.db, q))!.status).toBe('attente_signature');
  });

  it('jeton invalide refusé ; brouillon non signable', async () => {
    const ctx = await setup();
    await expect(openSigningSession(ctx, "' OR 1=1 --")).rejects.toThrow(/invalide/);
    const draft = await createQuote(ctx.db, { company_id: ctx.companyId, lines: [line('A', 100)] });
    await expect(createSignatureRequest(ctx, draft)).rejects.toThrow(/Finalisez/);
  });

  it('PDF de version de devis stocké une seule fois', async () => {
    const ctx = await setup();
    const q = await sentQuote(ctx);
    const v = (await listVersions(ctx.db, q))[0];
    const a = await storeQuoteVersionPdf(ctx, v.id);
    const b = await storeQuoteVersionPdf(ctx, v.id);
    expect(a).toEqual(b);
  });
});
