import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { newCtx, completeSetup, clientInput } from './helpers';
import { createCompany, getCompany, listCompanies } from '@/domain/companies';
import { getQuote, listQuotes, listVersions, createQuote } from '@/domain/quotes';
import { registerExternalQuote, importExternalQuotesCsv, attachExternalPdf, EXTERNAL_CSV_TEMPLATE } from '@/domain/externalQuotes';
import { createInvoiceFromQuote, issueInvoice, getInvoice } from '@/domain/invoices';
import { storeQuoteVersionPdf } from '@/domain/docgen';
import { createSignatureRequest } from '@/domain/signatures';
import { listDocuments } from '@/domain/documents';
import { dashboard, periodFor } from '@/domain/reports';
import { globalSearch } from '@/domain/search';
import { addDays, today } from '@/lib/format';

async function pdfBytes() {
  const d = await PDFDocument.create();
  d.addPage();
  return d.save();
}

describe('devis externes', () => {
  it('enregistre un devis accepté avec son PDF, sans ressaisie des lignes, puis le facture', async () => {
    const ctx = await newCtx();
    await completeSetup(ctx.db);
    const c = await createCompany(ctx.db, clientInput);
    const pdf = await pdfBytes();
    const id = await registerExternalQuote(ctx, {
      company_id: c, external_ref: 'DEV-2025-012', title: 'Site vitrine', issue_date: addDays(today(), -30),
      amounts: [{ ht_cents: 180000, vat_rate_bp: 2000 }, { label: 'Formation', ht_cents: 30000, vat_rate_bp: 550 }],
      status: 'accepte', accepted_date: addDays(today(), -20), pdf: { name: 'devis-origine.pdf', bytes: pdf },
    });
    const q = (await getQuote(ctx.db, id))!;
    expect(q.origin).toBe('externe');
    expect(q.external_ref).toBe('DEV-2025-012');
    expect(q.status).toBe('accepte');
    expect(q.accepted_at!.slice(0, 10)).toBe(addDays(today(), -20));
    expect(q.totals.total_ht_cents).toBe(210000);
    expect(q.totals.vat.length).toBe(2);
    expect((await getCompany(ctx.db, c))!.kind).toBe('client');
    const v = (await listVersions(ctx.db, id))[0];
    expect(v.pdf_path).toMatch(/devis-externes/);
    const docs = await listDocuments(ctx.db, { quoteId: id });
    expect(docs[0].locked).toBe(1);
    // Facturation : le devis d'origine est cité par sa référence
    const inv = await createInvoiceFromQuote(ctx.db, id, 'totale');
    await issueInvoice(ctx.db, inv);
    const full = (await getInvoice(ctx.db, inv))!;
    expect(full.total_ttc_cents).toBe(216000 + 31650);
    expect(full.quote_number).toBe('DEV-2025-012');
    // Statistiques et recherche
    const d = await dashboard(ctx.db, periodFor('12_mois'));
    expect(d.quotes_accepted).toBe(1);
    expect((await globalSearch(ctx.db, 'DEV-2025')).some((h) => h.type === 'devis')).toBe(true);
  });

  it('refuse les doublons et les saisies invalides ; pas de PDF généré à la place de l’original', async () => {
    const ctx = await newCtx();
    const c = await createCompany(ctx.db, clientInput);
    const base = { company_id: c, external_ref: 'A-1', issue_date: today(), amounts: [{ ht_cents: 1000, vat_rate_bp: 2000 }], status: 'envoye' as const };
    const id = await registerExternalQuote(ctx, base); // pas de paramètres administratifs requis
    expect((await getQuote(ctx.db, id))!.validity_date).toBeNull();
    await expect(registerExternalQuote(ctx, { ...base, external_ref: ' a-1 ' })).rejects.toThrow(/déjà enregistré/);
    await expect(registerExternalQuote(ctx, { ...base, external_ref: 'B', amounts: [] })).rejects.toThrow();
    await expect(registerExternalQuote(ctx, { ...base, external_ref: 'B', issue_date: addDays(today(), 3) })).rejects.toThrow(/futur/);
    await expect(registerExternalQuote(ctx, { ...base, external_ref: 'B', pdf: { name: 'x.pdf', bytes: new Uint8Array([1, 2, 3, 4]) } })).rejects.toThrow(/PDF/);
    const v = (await listVersions(ctx.db, id))[0];
    await expect(storeQuoteVersionPdf(ctx, v.id)).rejects.toThrow(/origine/);
    await expect(createSignatureRequest(ctx, id)).rejects.toThrow(/PDF/);
    await attachExternalPdf(ctx, id, { name: 'a.pdf', bytes: await pdfBytes() });
    expect((await listVersions(ctx.db, id))[0].pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    const req = await createSignatureRequest(ctx, id);
    expect(req.token).toHaveLength(48);
    await expect(attachExternalPdf(ctx, id, { name: 'b.pdf', bytes: await pdfBytes() })).rejects.toThrow(/déjà/);
  });

  it('import CSV : regroupement par référence, clients retrouvés ou créés, statuts, erreurs par ligne', async () => {
    const ctx = await newCtx();
    await createCompany(ctx.db, { name: 'SARL Boulangerie Martin' });
    const csv = EXTERNAL_CSV_TEMPLATE +
      'Garage Durand;DEV-2025-013;02/10/2025;Audit SEO;Suivi;100,00;5,5;;Envoyé;\r\n' +
      'Fleuriste Rose;DEV-2025-014;03/10/2025;;;abc;20;;Refusé;\r\n' +
      'Fleuriste Rose;DEV-2025-015;03/10/2025;;;250;20;;Perdu;\r\n';
    const r = await importExternalQuotesCsv(ctx, csv);
    expect(r.errors.map((e) => e.line)).toEqual([5]);
    expect(r.created).toBe(3);
    expect(r.companiesCreated).toBe(2); // Boulangerie Martin retrouvée malgré « SARL »
    const quotes = await listQuotes(ctx.db, {});
    const garage = quotes.find((q) => q.external_ref === 'DEV-2025-013')!;
    expect(garage.total_ht_cents).toBe(59000); // deux lignes regroupées
    expect(quotes.find((q) => q.external_ref === 'DEV-2025-012')!.status).toBe('accepte');
    expect(quotes.find((q) => q.external_ref === 'DEV-2025-015')!.status).toBe('refuse');
    expect((await listCompanies(ctx.db, { kind: 'client' })).map((c) => c.name)).toEqual(['SARL Boulangerie Martin']);
    const again = await importExternalQuotesCsv(ctx, EXTERNAL_CSV_TEMPLATE);
    expect(again.created).toBe(0);
    expect(again.skipped.length).toBe(2);
  });

  it('la numérotation interne des devis saute un numéro déjà pris', async () => {
    const ctx = await newCtx();
    const c = await createCompany(ctx.db, clientInput);
    const year = today().slice(0, 4);
    const a = await createQuote(ctx.db, { company_id: c });
    // simule un numéro occupé par une ancienne donnée
    await ctx.db.run('UPDATE number_sequences SET last_number = 0 WHERE series = ?', ['devis']);
    const b = await createQuote(ctx.db, { company_id: c });
    expect((await getQuote(ctx.db, a))!.number).toBe(`D-${year}-0001`);
    expect((await getQuote(ctx.db, b))!.number).toBe(`D-${year}-0002`);
  });
});
