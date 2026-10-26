import { describe, expect, it } from 'vitest';
import { newCtx, completeSetup, clientInput } from './helpers';
import { createCompany, getCompany, archiveCompany, clientFinancials, updateCompany } from '@/domain/companies';
import {
  createQuote, getQuote, saveQuoteDraft, finalizeQuote, acceptQuote, newVersion, listVersions, refuseQuote, duplicateQuote,
  deleteDraftQuote, expireQuotes, checkQuote, cancelQuote,
} from '@/domain/quotes';
import {
  createInvoiceFromQuote, issueInvoice, getInvoice, addPayment, deletePayment, createCreditNote, createInvoiceDraft,
  listInvoices, deleteDraftInvoice, saveInvoiceDraft, checkInvoice, attachInvoicePdf, suggestedReminderLevel,
} from '@/domain/invoices';
import { createOpportunity, listOpportunities } from '@/domain/pipeline';
import { patchSetting } from '@/domain/settings';
import type { DocLine } from '@/domain/docCommon';
import { addDays, today } from '@/lib/format';

const line = (designation: string, qty: number, price: number, vat = 2000, extra: Partial<DocLine> = {}): DocLine => ({
  kind: 'item', designation, quantity_milli: qty, unit_price_cents: price, discount_type: 'none', discount_value: 0, vat_rate_bp: vat, unit: 'forfait', ...extra,
});

async function setup(regime: 'franchise' | 'reel_simplifie' = 'reel_simplifie') {
  const ctx = await newCtx();
  await completeSetup(ctx.db, regime);
  const companyId = await createCompany(ctx.db, clientInput);
  return { ...ctx, companyId };
}

describe('devis', () => {
  it('numérote automatiquement et calcule les totaux', async () => {
    const { db, companyId } = await setup();
    const id1 = await createQuote(db, { company_id: companyId, title: 'Site vitrine', lines: [line('Création site', 1000, 180000), line('Audit SEO', 1000, 49000)] });
    const id2 = await createQuote(db, { company_id: companyId });
    const q1 = (await getQuote(db, id1))!;
    const year = today().slice(0, 4);
    expect(q1.number).toBe(`D-${year}-0001`);
    expect((await getQuote(db, id2))!.number).toBe(`D-${year}-0002`);
    expect(q1.totals.total_ht_cents).toBe(229000);
    expect(q1.totals.total_ttc_cents).toBe(274800);
    expect(q1.validity_date).toBe(addDays(q1.issue_date, 30));
  });

  it('devis avec 100 lignes et désignations longues', async () => {
    const { db, companyId } = await setup();
    const lines = Array.from({ length: 100 }, (_, i) => line(`Prestation ${i + 1} ` + 'très longue désignation '.repeat(i % 7), 1000 + i, 1234 + i * 7, i % 3 === 0 ? 2000 : i % 3 === 1 ? 1000 : 550));
    const id = await createQuote(db, { company_id: companyId, lines });
    const q = (await getQuote(db, id))!;
    expect(q.lines.length).toBe(100);
    expect(q.totals.vat.length).toBe(3);
    expect(q.totals.total_ttc_cents).toBe(q.totals.total_ht_cents + q.totals.total_vat_cents);
  });

  it('bloque la finalisation si les informations administratives manquent', async () => {
    const ctx = await newCtx();
    const c = await createCompany(ctx.db, clientInput);
    const id = await createQuote(ctx.db, { company_id: c, lines: [line('Audit', 1000, 49000)] });
    const check = await checkQuote(ctx.db, id);
    expect(check.errors.some((e) => e.includes('Régime de TVA'))).toBe(true);
    expect(check.errors.some((e) => e.includes('Adresse professionnelle'))).toBe(true);
    await expect(finalizeQuote(ctx.db, id)).rejects.toThrow(/finalisé/);
  });

  it('un devis envoyé est verrouillé ; une nouvelle version conserve l’ancienne', async () => {
    const { db, companyId } = await setup();
    const id = await createQuote(db, { company_id: companyId, title: 'Refonte', lines: [line('Refonte', 1000, 100000)] });
    const v1 = await finalizeQuote(db, id);
    expect(v1.version).toBe(1);
    expect(v1.snapshot_sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(saveQuoteDraft(db, id, { title: 'Modifié' })).rejects.toThrow(/nouvelle version/);
    // Protection au niveau de la base, même en contournant le service
    await expect(db.run("UPDATE quote_lines SET unit_price_cents = 1 WHERE quote_id = ?", [id])).rejects.toThrow(/nouvelle version/);
    await expect(db.run("UPDATE quotes SET total_ttc_cents = 1 WHERE id = ?", [id])).rejects.toThrow(/verrouillé/);
    await expect(db.run("UPDATE quote_versions SET snapshot = '{}' WHERE id = ?", [v1.id])).rejects.toThrow(/immuable/);
    await newVersion(db, id, 'Ajout de la maintenance');
    const q = (await getQuote(db, id))!;
    expect(q.version).toBe(2);
    expect(q.status).toBe('brouillon');
    await saveQuoteDraft(db, id, {}, [...q.lines, line('Maintenance', 12000, 6900)]);
    const v2 = await finalizeQuote(db, id);
    expect(v2.version).toBe(2);
    const versions = await listVersions(db, id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(JSON.parse(versions[1].snapshot).lines.length).toBe(1);
    expect(JSON.parse(versions[0].snapshot).lines.length).toBe(2);
    await expect(deleteDraftQuote(db, id)).rejects.toThrow();
  });

  it('acceptation : le prospect devient client, l’opportunité passe à gagnée', async () => {
    const { db, companyId } = await setup();
    const opp = await createOpportunity(db, { company_id: companyId, title: 'Site' });
    const id = await createQuote(db, { company_id: companyId, opportunity_id: opp, lines: [line('Site', 1000, 150000)] });
    await finalizeQuote(db, id);
    expect((await listOpportunities(db))[0].stage_id).toBeDefined();
    const r = await acceptQuote(db, id, { via: 'manuel' });
    expect(r.convertedToClient).toBe(true);
    expect((await getCompany(db, companyId))!.kind).toBe('client');
    const o = (await listOpportunities(db, { includeClosed: true }))[0];
    expect(o.status).toBe('won');
    expect(o.amount_cents).toBe(150000);
    const q = (await getQuote(db, id))!;
    expect(q.status).toBe('accepte');
    expect(q.accepted_version_id).toBeTruthy();
    await expect(db.run("UPDATE quotes SET status = 'refuse' WHERE id = ?", [id])).rejects.toThrow();
  });

  it('refus, annulation, expiration, duplication, suppression de brouillon', async () => {
    const { db, companyId } = await setup();
    const a = await createQuote(db, { company_id: companyId, lines: [line('A', 1000, 1000)] });
    await finalizeQuote(db, a);
    await refuseQuote(db, a, 'Budget');
    expect((await getQuote(db, a))!.status).toBe('refuse');
    const b = await createQuote(db, { company_id: companyId, issue_date: addDays(today(), -40), validity_date: addDays(today(), -10), lines: [line('B', 1000, 1000)] });
    await finalizeQuote(db, b);
    expect(await expireQuotes(db)).toBe(1);
    expect((await getQuote(db, b))!.status).toBe('expire');
    const c = await duplicateQuote(db, b);
    const qc = (await getQuote(db, c))!;
    expect(qc.status).toBe('brouillon');
    expect(qc.lines.length).toBe(1);
    await cancelQuote(db, c);
    const d = await createQuote(db, { company_id: companyId });
    await deleteDraftQuote(db, d);
    expect(await getQuote(db, d)).toBeUndefined();
  });
});

describe('facturation', () => {
  async function acceptedQuote(db: any, companyId: number, lines: DocLine[], extra: any = {}) {
    const id = await createQuote(db, { company_id: companyId, title: 'Projet', lines, ...extra });
    await finalizeQuote(db, id);
    await acceptQuote(db, id, { via: 'manuel' });
    return id;
  }

  it('facture depuis un devis accepté, numérotation chronologique sans doublon', async () => {
    const { db, companyId } = await setup();
    const q = await acceptedQuote(db, companyId, [line('Site', 1000, 180000)]);
    const invId = await createInvoiceFromQuote(db, q, 'totale');
    const draft = (await getInvoice(db, invId))!;
    expect(draft.number).toBeNull();
    expect(draft.status).toBe('brouillon');
    const snap = await issueInvoice(db, invId);
    const year = today().slice(0, 4);
    expect(snap.number).toBe(`F-${year}-0001`);
    const inv = (await getInvoice(db, invId))!;
    expect(inv.status).toBe('emise');
    expect(inv.quote_id).toBe(q);
    expect(inv.total_ttc_cents).toBe(216000);
    expect(inv.due_date).toBe(addDays(today(), 30));
    await expect(createInvoiceFromQuote(db, q, 'totale')).rejects.toThrow(/déjà/);
    // Les brouillons supprimés ne consomment pas de numéro
    const d1 = await createInvoiceDraft(db, { company_id: companyId, lines: [line('X', 1000, 100)] });
    await deleteDraftInvoice(db, d1);
    const d2 = await createInvoiceDraft(db, { company_id: companyId, lines: [line('Y', 1000, 100)] });
    expect((await issueInvoice(db, d2)).number).toBe(`F-${year}-0002`);
    // Date antérieure à la dernière facture émise : refusée
    const d3 = await createInvoiceDraft(db, { company_id: companyId, lines: [line('Z', 1000, 100)] });
    await expect(issueInvoice(db, d3, { issueDate: addDays(today(), -3) })).rejects.toThrow();
    expect((await checkInvoice(db, d3, addDays(today(), -3))).errors.some((e) => e.includes('chronologique'))).toBe(true);
    await expect(issueInvoice(db, d3, { issueDate: addDays(today(), 1) })).rejects.toThrow();
  });

  it('une facture émise ne peut être ni supprimée, ni renumérotée, ni modifiée', async () => {
    const { db, companyId } = await setup();
    const id = await createInvoiceDraft(db, { company_id: companyId, lines: [line('Audit', 1000, 49000)] });
    await issueInvoice(db, id);
    await expect(deleteDraftInvoice(db, id)).rejects.toThrow(/avoir/);
    await expect(db.run('DELETE FROM invoices WHERE id = ?', [id])).rejects.toThrow(/supprimée/);
    await expect(db.run("UPDATE invoices SET number = 'F-X' WHERE id = ?", [id])).rejects.toThrow(/modification interdite/);
    await expect(db.run('UPDATE invoices SET total_ttc_cents = 1 WHERE id = ?', [id])).rejects.toThrow(/modification interdite/);
    await expect(db.run("UPDATE invoices SET status = 'brouillon' WHERE id = ?", [id])).rejects.toThrow(/modification interdite/);
    await expect(db.run('UPDATE invoice_lines SET unit_price_cents = 1 WHERE invoice_id = ?', [id])).rejects.toThrow(/non modifiables/);
    await expect(db.run("INSERT INTO invoice_lines (invoice_id, position, designation) VALUES (?, 99, 'ajout')", [id])).rejects.toThrow(/non modifiables/);
    await expect(saveInvoiceDraft(db, id, { title: 'x' })).rejects.toThrow(/avoir/);
    await expect(db.run('DELETE FROM audit_log')).rejects.toThrow();
    await attachInvoicePdf(db, id, 'documents/f.pdf', 'a'.repeat(64));
    await expect(attachInvoicePdf(db, id, 'documents/g.pdf', 'b'.repeat(64))).rejects.toThrow();
  });

  it('les coordonnées figées ne changent pas si le client est modifié', async () => {
    const { db, companyId } = await setup();
    const id = await createInvoiceDraft(db, { company_id: companyId, lines: [line('Audit', 1000, 49000)] });
    await issueInvoice(db, id);
    await updateCompany(db, companyId, { name: 'Nouveau nom', address_line1: 'Nouvelle adresse' });
    const inv = (await getInvoice(db, id))!;
    expect(JSON.parse(inv.client_snapshot!).name).toBe('Boulangerie Martin');
    expect(JSON.parse(inv.client_snapshot!).address_line1).toBe('3 place du Marché');
  });

  it('acompte puis facture de solde (plusieurs taux, remise globale)', async () => {
    const { db, companyId } = await setup();
    const q = await acceptedQuote(db, companyId, [line('Site', 1000, 200000, 2000), line('Formation', 1000, 50000, 550)], {
      global_discount_type: 'percent', global_discount_value: 1000, deposit_type: 'percent', deposit_value: 3000,
    });
    const quote = (await getQuote(db, q))!;
    expect(quote.totals.total_ht_cents).toBe(225000);
    const depId = await createInvoiceFromQuote(db, q, 'acompte');
    await issueInvoice(db, depId);
    const dep = (await getInvoice(db, depId))!;
    expect(dep.kind).toBe('acompte');
    expect(dep.total_ttc_cents).toBe(quote.deposit_ttc_cents);
    expect(dep.lines.length).toBe(2);
    const soldeId = await createInvoiceFromQuote(db, q, 'solde');
    const solde = (await getInvoice(db, soldeId))!;
    expect(solde.kind).toBe('solde');
    await issueInvoice(db, soldeId);
    const s2 = (await getInvoice(db, soldeId))!;
    // HT acompte + HT solde = HT devis (exact) ; TTC à ±1 centime par taux
    expect(dep.total_ht_cents + s2.total_ht_cents).toBe(quote.totals.total_ht_cents);
    expect(Math.abs(dep.total_ttc_cents + s2.total_ttc_cents - quote.totals.total_ttc_cents)).toBeLessThanOrEqual(2);
    await expect(createInvoiceFromQuote(db, q, 'solde')).rejects.toThrow();
  });

  it('paiements partiels, solde restant dû, retard, trop-perçu refusé', async () => {
    const { db, companyId } = await setup();
    const id = await createInvoiceDraft(db, { company_id: companyId, lines: [line('Maintenance', 12000, 6900)] });
    await issueInvoice(db, id, { issueDate: today(), dueDate: today() });
    let inv = (await getInvoice(db, id))!;
    expect(inv.total_ttc_cents).toBe(99360);
    await addPayment(db, id, { amount_cents: 40000, paid_at: today(), method: 'virement' });
    inv = (await getInvoice(db, id))!;
    expect(inv.status).toBe('partiellement_payee');
    expect(inv.balance).toMatchObject({ paid_cents: 40000, due_cents: 59360 });
    await expect(addPayment(db, id, { amount_cents: 60000, paid_at: today(), method: 'cheque' })).rejects.toThrow(/dépasse/);
    await expect(addPayment(db, id, { amount_cents: 0, paid_at: today(), method: 'cheque' })).rejects.toThrow();
    const p2 = await addPayment(db, id, { amount_cents: 59360, paid_at: today(), method: 'cheque', reference: 'CHQ 123' });
    inv = (await getInvoice(db, id))!;
    expect(inv.status).toBe('payee');
    expect(inv.balance.due_cents).toBe(0);
    await deletePayment(db, p2, 'Chèque rejeté');
    expect((await getInvoice(db, id))!.status).toBe('partiellement_payee');
    expect(await suggestedReminderLevel(db, id)).toBe('avant_echeance');
    const f = await clientFinancials(db, companyId);
    expect(f).toMatchObject({ invoiced_cents: 99360, paid_cents: 40000, due_cents: 59360 });
  });

  it('facture en retard (échéance dépassée) et niveau de relance', async () => {
    const { db, companyId } = await setup();
    const id = await createInvoiceDraft(db, { company_id: companyId, lines: [line('SEO', 1000, 45000)] });
    await issueInvoice(db, id, { issueDate: addDays(today(), -40), dueDate: addDays(today(), -10) });
    const rows = await listInvoices(db, { status: 'en_retard' });
    expect(rows.map((r) => r.id)).toEqual([id]);
    const inv = (await getInvoice(db, id))!;
    expect(inv.display_status).toBe('en_retard');
    expect(inv.balance.overdue).toBe(true);
    expect(inv.balance.days_late).toBe(10);
    expect(await suggestedReminderLevel(db, id)).toBe('relance_1');
    const { recordReminder } = await import('@/domain/invoices');
    await recordReminder(db, id, 'relance_1', 'copie', 'Objet', 'Texte');
    expect(await suggestedReminderLevel(db, id)).toBe('relance_finale');
    const f = await clientFinancials(db, companyId);
    expect(f.overdue_cents).toBe(54000);
  });

  it('avoir total : la facture est annulée ; avoir partiel : solde réduit', async () => {
    const { db, companyId } = await setup();
    const id = await createInvoiceDraft(db, { company_id: companyId, lines: [line('Site', 1000, 100000), line('Logo', 1000, 30000)] });
    await issueInvoice(db, id);
    const partial = await createCreditNote(db, id, { mode: 'partiel', reason: 'Logo non réalisé', lines: [line('Logo (annulation)', 1000, 30000)] });
    const snapAv = await issueInvoice(db, partial);
    const year = today().slice(0, 4);
    expect(snapAv.number).toBe(`AV-${year}-0001`);
    expect(snapAv.credited_invoice_number).toBe(`F-${year}-0001`);
    let inv = (await getInvoice(db, id))!;
    expect(inv.balance.credited_cents).toBe(36000);
    expect(inv.balance.due_cents).toBe(120000);
    expect(inv.status).toBe('partiellement_payee');
    await expect(createCreditNote(db, id, { mode: 'total', reason: 'x' })).rejects.toThrow();
    const tooBig = await createCreditNote(db, id, { mode: 'partiel', reason: 'erreur', lines: [line('Trop', 1000, 200000)] });
    await expect(issueInvoice(db, tooBig)).rejects.toThrow();
    await deleteDraftInvoice(db, tooBig);
    const rest = await createCreditNote(db, id, { mode: 'partiel', reason: 'Annulation', lines: [line('Site', 1000, 100000)] });
    await issueInvoice(db, rest);
    inv = (await getInvoice(db, id))!;
    expect(inv.status).toBe('annulee');
    expect(inv.balance.due_cents).toBe(0);
    expect(inv.number).toBe(`F-${year}-0001`); // jamais renumérotée
    const f = await clientFinancials(db, companyId);
    expect(f.invoiced_cents - f.credited_cents).toBe(0);
  });

  it('franchise en base : TVA à 0 obligatoire et mention légale', async () => {
    const { db, companyId } = await setup('franchise');
    const bad = await createInvoiceDraft(db, { company_id: companyId, lines: [line('Audit', 1000, 49000, 2000)] });
    await expect(issueInvoice(db, bad)).rejects.toThrow();
    const ok = await createInvoiceDraft(db, { company_id: companyId, lines: [line('Audit', 1000, 49000, 0)] });
    await issueInvoice(db, ok);
    const inv = (await getInvoice(db, ok))!;
    expect(inv.total_ttc_cents).toBe(49000);
    expect(JSON.parse(inv.legal_mentions!)).toContain('TVA non applicable, art. 293 B du CGI');
  });

  it('client archivé avec factures existantes : historique conservé', async () => {
    const { db, companyId } = await setup();
    const id = await createInvoiceDraft(db, { company_id: companyId, lines: [line('Audit', 1000, 49000)] });
    await issueInvoice(db, id);
    await archiveCompany(db, companyId);
    expect((await listInvoices(db, { companyId })).length).toBe(1);
    expect((await getInvoice(db, id))!.company_name).toBe('Boulangerie Martin');
    const f = await clientFinancials(db, companyId);
    expect(f.invoiced_cents).toBe(58800);
  });

  it('format de numérotation configurable', async () => {
    const { db, companyId } = await setup();
    await patchSetting(db, 'numbering', { invoice_format: 'FAC{AA}{MM}-{N}', min_digits: 3 });
    const id = await createInvoiceDraft(db, { company_id: companyId, lines: [line('A', 1000, 100)] });
    const snap = await issueInvoice(db, id);
    const t = today();
    expect(snap.number).toBe(`FAC${t.slice(2, 4)}${t.slice(5, 7)}-001`);
  });

  it('opérations financières atomiques : une erreur annule tout', async () => {
    const { db, companyId } = await setup();
    const id = await createInvoiceDraft(db, { company_id: companyId, lines: [line('A', 1000, 100)] });
    await expect(db.tx(async (t) => {
      await t.run("UPDATE number_sequences SET last_number = 999");
      throw new Error('panne');
    })).rejects.toThrow('panne');
    const snap = await issueInvoice(db, id);
    expect(snap.number.endsWith('0001')).toBe(true);
  });
});
