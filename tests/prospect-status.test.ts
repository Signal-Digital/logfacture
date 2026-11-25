import { describe, expect, it } from 'vitest';
import { newCtx, completeSetup, clientInput } from './helpers';
import { createCompany, getCompany } from '@/domain/companies';
import { createQuote, finalizeQuote, refuseQuote, acceptQuote, expireQuotes } from '@/domain/quotes';
import { createActivity, listActivities } from '@/domain/activities';
import { setCommercialStatus, statusCounts } from '@/domain/prospectStatus';
import { createDb } from '@/lib/db';
import { nodeDriver } from '@/lib/db/nodeDriver';
import { migrations } from '@/lib/db/migrations';
import { addDays, today } from '@/lib/format';
import type { DocLine } from '@/domain/docCommon';

const line: DocLine = { kind: 'item', designation: 'Audit', quantity_milli: 1000, unit_price_cents: 49000, discount_type: 'none', discount_value: 0, vat_rate_bp: 2000 };
const status = async (db: any, id: number) => (await getCompany(db, id))!.commercial_status;

describe('statut commercial des prospects', () => {
  it('suit automatiquement le parcours : appel → RDV → devis en préparation → envoyé → gagné', async () => {
    const { db } = await newCtx();
    await completeSetup(db);
    const c = await createCompany(db, clientInput);
    expect(await status(db, c)).toBe('nouveau');
    await createActivity(db, { type: 'appel', title: 'Premier appel', company_id: c, status: 'fait' });
    expect(await status(db, c)).toBe('contacte');
    await createActivity(db, { type: 'audit', title: 'Audit gratuit', company_id: c, status: 'fait' });
    expect(await status(db, c)).toBe('rdv');
    await createActivity(db, { type: 'appel', title: 'Rappel', company_id: c, status: 'fait' });
    expect(await status(db, c)).toBe('rdv'); // ne recule jamais automatiquement
    const q = await createQuote(db, { company_id: c, lines: [line] });
    expect(await status(db, c)).toBe('devis_en_cours');
    await finalizeQuote(db, q);
    expect(await status(db, c)).toBe('devis_envoye');
    await acceptQuote(db, q, { via: 'manuel' });
    expect(await status(db, c)).toBe('client');
    expect((await getCompany(db, c))!.kind).toBe('client');
  });

  it('devis refusé → perdu (avec motif), sauf si un autre devis est en cours ; un nouveau devis réveille la fiche', async () => {
    const { db } = await newCtx();
    await completeSetup(db);
    const c = await createCompany(db, clientInput);
    const a = await createQuote(db, { company_id: c, lines: [line] });
    const b = await createQuote(db, { company_id: c, lines: [line] });
    await finalizeQuote(db, a);
    await refuseQuote(db, a, 'Trop cher');
    expect(await status(db, c)).toBe('devis_envoye'); // le devis b est encore en préparation
    await finalizeQuote(db, b);
    await refuseQuote(db, b, 'Trop cher');
    expect(await status(db, c)).toBe('perdu');
    expect((await getCompany(db, c))!.lost_reason).toBe('devis refusé : Trop cher');
    await createQuote(db, { company_id: c, lines: [line] });
    expect(await status(db, c)).toBe('devis_en_cours');
  });

  it('devis expiré → à recontacter', async () => {
    const { db } = await newCtx();
    await completeSetup(db);
    const c = await createCompany(db, clientInput);
    const q = await createQuote(db, { company_id: c, issue_date: addDays(today(), -40), validity_date: addDays(today(), -5), lines: [line] });
    await finalizeQuote(db, q);
    await expireQuotes(db);
    expect(await status(db, c)).toBe('a_recontacter');
  });

  it('changement manuel : perdu avec motif, à recontacter avec relance planifiée, gagné = client', async () => {
    const { db } = await newCtx();
    const c = await createCompany(db, clientInput);
    await setCommercialStatus(db, c, 'perdu', { reason: 'A choisi un concurrent' });
    expect((await getCompany(db, c))!).toMatchObject({ commercial_status: 'perdu', lost_reason: 'A choisi un concurrent' });
    await setCommercialStatus(db, c, 'a_recontacter', { followUpDate: addDays(today(), 30) });
    const comp = (await getCompany(db, c))!;
    expect(comp.commercial_status).toBe('a_recontacter');
    expect(comp.lost_reason).toBeNull();
    expect(comp.next_action_date).toBe(addDays(today(), 30));
    expect((await listActivities(db, { companyId: c, scope: 'open' })).some((a) => a.type === 'relance')).toBe(true);
    await setCommercialStatus(db, c, 'client');
    expect((await getCompany(db, c))!.kind).toBe('client');
    expect(await statusCounts(db, 'client')).toEqual({ client: 1 });
    await expect(setCommercialStatus(db, c, 'inconnu' as any)).rejects.toThrow();
  });

  it('migration des anciens statuts', async () => {
    const driver = nodeDriver();
    const db = createDb(driver);
    await db.batch('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT)');
    for (const m of migrations.filter((x) => x.version <= 2)) {
      await db.batch(m.sql);
      await db.run('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name]);
    }
    for (const [name, st] of [['A', 'a_qualifier'], ['B', 'interesse'], ['C', 'non_interesse'], ['D', 'bizarre']]) {
      await db.run('INSERT INTO companies (name, commercial_status) VALUES (?, ?)', [name, st]);
    }
    const { migrate } = await import('@/lib/db/migrations');
    await migrate(db);
    const rows = await db.all<any>('SELECT name, commercial_status FROM companies ORDER BY name');
    expect(rows.map((r) => r.commercial_status)).toEqual(['a_contacter', 'contacte', 'perdu', 'nouveau']);
  });
});
