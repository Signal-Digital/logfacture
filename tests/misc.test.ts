import { describe, expect, it } from 'vitest';
import { newCtx, completeSetup, clientInput } from './helpers';
import { createCompany, createContact } from '@/domain/companies';
import { createQuote } from '@/domain/quotes';
import { createInvoiceDraft, issueInvoice, invoiceSnapshot } from '@/domain/invoices';
import { globalSearch } from '@/domain/search';
import { computeNotices } from '@/domain/notifications';
import { setPassword, unlock, removePassword, isPasswordSet, passwordStrength } from '@/domain/security';
import { getSetting, checkAdministrativeSetup, getAllSettings, validateIban, validateSiret, sellerDisplayName } from '@/domain/settings';
import { invoiceToCii } from '@/domain/facturx';
import { createContract, duePeriods, prepareRecurringInvoice, runRecurring, recurringSummary, monthlyAmount } from '@/domain/contracts';
import { listInvoices } from '@/domain/invoices';
import { patchSetting } from '@/domain/settings';
import { dashboard, periodFor, monthlySeries, topServices, receivablesAging } from '@/domain/reports';
import { mergeTemplate, mailtoLink, listEmailTemplates, unresolvedFields } from '@/domain/emails';
import { createOpportunity } from '@/domain/pipeline';
import { addMonths, today } from '@/lib/format';
import type { DocLine } from '@/domain/docCommon';

const line = (d: string, price: number, vat = 2000): DocLine => ({ kind: 'item', designation: d, quantity_milli: 1000, unit_price_cents: price, discount_type: 'none', discount_value: 0, vat_rate_bp: vat, unit: 'forfait' });

describe('paramètres administratifs', () => {
  it('préconfiguration fournie, sans présumer du reste', async () => {
    const { db } = await newCtx();
    const c = await getSetting(db, 'company');
    expect(c).toMatchObject({ trade_name: 'Signal Digital', manager: 'Giovani Zunino', siret: '94478489100011', email: 'contact@qarvo-digital.fr', address_line1: '' });
    expect((await getSetting(db, 'vat')).regime).toBe('');
    const issues = checkAdministrativeSetup(await getAllSettings(db));
    expect(issues.filter((i) => i.severity === 'bloquant').map((i) => i.field)).toEqual(expect.arrayContaining(['address', 'regime']));
    expect(validateSiret('94478489100011')).toBeNull();
    expect(validateSiret('94478489100012')).not.toBeNull();
    expect(validateIban('FR76 3000 6000 0112 3456 7890 189')).toBeNull();
    expect(validateIban('FR76 3000 6000 0112 3456 7890 188')).not.toBeNull();
    expect(sellerDisplayName(c)).toBe('Giovani Zunino EI');
  });
});

describe('sécurité', () => {
  it('mot de passe haché (jamais en clair), vérification, changement, suppression', async () => {
    const { db } = await newCtx();
    expect(passwordStrength('court').ok).toBe(false);
    await expect(setPassword(db, 'motdepasse')).rejects.toThrow();
    await setPassword(db, 'Signal-Desk-2026');
    expect(await isPasswordSet(db)).toBe(true);
    const raw = await db.get<any>("SELECT value FROM settings WHERE key = 'security'");
    expect(raw.value).not.toContain('Signal-Desk-2026');
    expect(JSON.parse(raw.value).password.algo).toBe('PBKDF2-SHA256');
    expect(await unlock(db, 'Signal-Desk-2026')).toBe(true);
    expect(await unlock(db, 'mauvais')).toBe(false);
    await expect(setPassword(db, 'Nouveau-Mot-2027', 'faux')).rejects.toThrow(/incorrect/);
    await setPassword(db, 'Nouveau-Mot-2027', 'Signal-Desk-2026');
    expect(await unlock(db, 'Nouveau-Mot-2027')).toBe(true);
    await removePassword(db, 'Nouveau-Mot-2027');
    expect(await isPasswordSet(db)).toBe(false);
  });
});

describe('recherche globale et notifications', () => {
  it('trouve entreprises, contacts, devis', async () => {
    const { db } = await newCtx();
    const c = await createCompany(db, clientInput);
    await createContact(db, { company_id: c, first_name: 'Claire', last_name: 'Dubois' });
    await createQuote(db, { company_id: c, title: 'Refonte vitrine' });
    const hits = await globalSearch(db, 'boulang');
    expect(hits[0]).toMatchObject({ type: 'entreprise', title: 'Boulangerie Martin' });
    expect((await globalSearch(db, 'dubois')).some((h) => h.type === 'contact')).toBe(true);
    expect((await globalSearch(db, 'vitrine')).some((h) => h.type === 'devis')).toBe(true);
    expect(await globalSearch(db, 'a')).toEqual([]);
  });
  it('signale la configuration incomplète et l’absence de sauvegarde', async () => {
    const { db } = await newCtx();
    const n = await computeNotices(db);
    expect(n.map((x) => x.key)).toEqual(expect.arrayContaining(['admin', 'backup']));
  });
});

describe('Factur-X (préparation)', () => {
  it('produit un XML CII avec les données de la facture', async () => {
    const { db } = await newCtx();
    await completeSetup(db);
    const c = await createCompany(db, clientInput);
    const id = await createInvoiceDraft(db, { company_id: c, lines: [line('Audit <SEO> & suivi', 49000), line('Livre', 1000, 550)] });
    await issueInvoice(db, id);
    const xml = invoiceToCii(await invoiceSnapshot(db, id));
    expect(xml).toContain('<ram:TypeCode>380</ram:TypeCode>');
    expect(xml).toContain('Audit &lt;SEO&gt; &amp; suivi');
    expect(xml).toContain('<ram:GrandTotalAmount>598.55</ram:GrandTotalAmount>');
    expect(xml).toContain('schemeID="0002">944784891<');
    expect((xml.match(/<ram:ApplicableTradeTax>/g) ?? []).length).toBe(4); // 2 lignes + 2 taux
  });
});

describe('contrats récurrents', () => {
  it('prépare les factures sans doublon, même après redémarrage', async () => {
    const { db } = await newCtx();
    await completeSetup(db);
    const c = await createCompany(db, { ...clientInput, kind: 'client' });
    const start = addMonths(today(), -2);
    const k = await createContract(db, { company_id: c, title: 'Maintenance site', amount_cents: 6900, vat_rate_bp: 2000, periodicity: 'mensuel', start_date: start });
    const due = await duePeriods(db);
    expect(due.length).toBe(3);
    const a = await prepareRecurringInvoice(db, k, due[0].period_start);
    const again = await prepareRecurringInvoice(db, k, due[0].period_start);
    expect(again).toEqual({ invoiceId: a.invoiceId, created: false });
    const r = await runRecurring(db);
    expect(r).toMatchObject({ prepared: 2, issued: 0 });
    expect((await runRecurring(db)).prepared).toBe(0);
    const inv = await listInvoices(db, { contractId: k });
    expect(inv.length).toBe(3);
    expect(inv.every((i) => i.status === 'brouillon')).toBe(true); // pas d'émission automatique sans activation
    expect((await recurringSummary(db)).mrr_cents).toBe(6900);
    expect(monthlyAmount({ amount_cents: 120000, periodicity: 'annuel' })).toBe(10000);
  });
  it('émission automatique uniquement si activée globalement ET sur le contrat', async () => {
    const { db } = await newCtx();
    await completeSetup(db);
    const c = await createCompany(db, { ...clientInput, kind: 'client' });
    await createContract(db, { company_id: c, title: 'SEO', amount_cents: 45000, vat_rate_bp: 2000, start_date: today(), auto_issue: 1 });
    expect((await runRecurring(db)).issued).toBe(0);
    await createContract(db, { company_id: c, title: 'SEO 2', amount_cents: 45000, vat_rate_bp: 2000, start_date: today(), auto_issue: 1 });
    await patchSetting(db, 'automation', { recurring_auto_issue: true });
    const r = await runRecurring(db);
    expect(r.issued).toBe(1);
    expect(r.errors).toEqual([]);
  });
});

describe('tableau de bord et rapports', () => {
  it('distingue facturé, encaissé, restant dû et prévisionnel', async () => {
    const { db } = await newCtx();
    await completeSetup(db);
    const c = await createCompany(db, clientInput);
    await createOpportunity(db, { company_id: c, title: 'Site', amount_cents: 300000, probability: 50 });
    const id = await createInvoiceDraft(db, { company_id: c, lines: [line('Audit', 100000)] });
    await issueInvoice(db, id);
    const { addPayment } = await import('@/domain/invoices');
    await addPayment(db, id, { amount_cents: 50000, paid_at: today(), method: 'virement' });
    const d = await dashboard(db, periodFor('mois'));
    expect(d.invoiced_ht_cents).toBe(100000);
    expect(d.invoiced_ttc_cents).toBe(120000);
    expect(d.collected_cents).toBe(50000);
    expect(d.unpaid_cents).toBe(70000);
    expect(d.pipeline_total_cents).toBe(300000);
    expect(d.pipeline_weighted_cents).toBe(150000);
    const series = await monthlySeries(db, periodFor('12_mois'));
    expect(series.length).toBe(12);
    expect(series[11].invoiced_ht_cents).toBe(100000);
    expect((await topServices(db, periodFor('annee')))[0]).toMatchObject({ name: 'Audit', ht_cents: 100000 });
    expect((await receivablesAging(db)).buckets.a_echoir).toBe(70000);
  });
  it('périodes', () => {
    expect(periodFor('trimestre', '2026-05-14')).toMatchObject({ from: '2026-04-01', to: '2026-06-30' });
    expect(periodFor('mois', '2026-02-10')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodFor('annee_precedente', '2026-02-10')).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
  });
});

describe('emails', () => {
  it('modèles fournis, fusion des champs, lien mailto sans envoi', async () => {
    const { db } = await newCtx();
    const t = await listEmailTemplates(db);
    expect(t.length).toBeGreaterThanOrEqual(11);
    const merged = mergeTemplate('Bonjour {{contact.prenom}}, facture {{document.numero}} {{inconnu.cle}}', { 'contact.prenom': 'Claire', 'document.numero': 'F-1' });
    expect(merged).toBe('Bonjour Claire, facture F-1 {{inconnu.cle}}');
    expect(unresolvedFields(merged)).toEqual(['inconnu.cle']);
    const link = mailtoLink('a@b.fr', 'Objet é', 'Ligne 1\nLigne 2 & co');
    expect(link).toBe('mailto:a%40b.fr?subject=Objet%20%C3%A9&body=Ligne%201%0D%0ALigne%202%20%26%20co');
  });
});
