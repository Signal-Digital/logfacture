import { describe, expect, it } from 'vitest';
import { newCtx, completeSetup, clientInput } from './helpers';
import { createCompany, getCompany, updateCompany } from '@/domain/companies';
import { createOpportunity, listOpportunities, listStages, moveOpportunity } from '@/domain/pipeline';
import { setCommercialStatus, backfillPipeline } from '@/domain/prospectStatus';
import { createQuote, finalizeQuote, acceptQuote, refuseQuote, getQuote } from '@/domain/quotes';
import { createActivity } from '@/domain/activities';
import type { DocLine } from '@/domain/docCommon';

const line: DocLine = { kind: 'item', designation: 'Site', quantity_milli: 1000, unit_price_cents: 180000, discount_type: 'none', discount_value: 0, vat_rate_bp: 2000 };
const stageName = async (db: any, companyId: number) => {
  const o = (await listOpportunities(db, { companyId, includeClosed: true }))[0];
  return (await listStages(db)).find((s) => s.id === o.stage_id)!.name;
};

describe('pipeline relié aux statuts des prospects', () => {
  it('un nouveau prospect apparaît dans le pipeline et suit son statut jusqu’au devis signé', async () => {
    const { db } = await newCtx();
    await completeSetup(db);
    const c = await createCompany(db, { ...clientInput, potential_cents: 150000 });
    let opps = await listOpportunities(db, { companyId: c });
    expect(opps).toHaveLength(1);
    expect(opps[0]).toMatchObject({ title: 'Boulangerie Martin', amount_cents: 150000 });
    expect(await stageName(db, c)).toBe('Nouveau prospect');
    await createActivity(db, { type: 'appel', title: 'Appel', company_id: c, status: 'fait' });
    expect(await stageName(db, c)).toBe('Contact établi');
    await setCommercialStatus(db, c, 'rdv');
    expect(await stageName(db, c)).toBe('Audit gratuit proposé');
    const q = await createQuote(db, { company_id: c, lines: [line] });
    expect((await getQuote(db, q))!.opportunity_id).toBe(opps[0].id); // devis rattaché à la carte
    expect(await stageName(db, c)).toBe('Proposition commerciale envoyée');
    await finalizeQuote(db, q);
    expect(await stageName(db, c)).toBe('Devis envoyé');
    await acceptQuote(db, q, { via: 'manuel' });
    opps = await listOpportunities(db, { companyId: c, includeClosed: true });
    expect(opps).toHaveLength(1);
    expect(opps[0].status).toBe('won');
    expect(await stageName(db, c)).toBe('Client gagné');
  });

  it('déplacer la carte dans le pipeline met à jour le statut du prospect', async () => {
    const { db } = await newCtx();
    const c = await createCompany(db, clientInput);
    const o = (await listOpportunities(db, { companyId: c }))[0];
    const stages = await listStages(db);
    await moveOpportunity(db, o.id, stages.find((s) => s.name === 'Rendez-vous prévu')!.id);
    expect((await getCompany(db, c))!.commercial_status).toBe('rdv');
    await moveOpportunity(db, o.id, stages.find((s) => s.kind === 'lost')!.id);
    expect((await getCompany(db, c))!.commercial_status).toBe('perdu');
    await moveOpportunity(db, o.id, stages.find((s) => s.name === 'À recontacter')!.id);
    expect((await getCompany(db, c))!.commercial_status).toBe('a_recontacter');
    // « Gagné » passe par la confirmation (création du client), pas par le simple déplacement
    await moveOpportunity(db, o.id, stages.find((s) => s.kind === 'won')!.id);
    expect((await getCompany(db, c))!.kind).toBe('prospect');
  });

  it('marquer perdu déplace la carte ; un devis refusé aussi', async () => {
    const { db } = await newCtx();
    await completeSetup(db);
    const a = await createCompany(db, clientInput);
    await setCommercialStatus(db, a, 'perdu', { reason: 'Budget insuffisant' });
    const oa = (await listOpportunities(db, { companyId: a, includeClosed: true }))[0];
    expect(oa).toMatchObject({ status: 'lost', lost_reason: 'Budget insuffisant' });
    const b = await createCompany(db, { name: 'Garage Durand', address_line1: '1 rue', postal_code: '44000', city: 'Nantes' });
    const q = await createQuote(db, { company_id: b, lines: [line] });
    await finalizeQuote(db, q);
    await refuseQuote(db, q, 'Trop cher');
    expect((await listOpportunities(db, { companyId: b, includeClosed: true }))[0].status).toBe('lost');
    // Statut modifié depuis le formulaire de la fiche : la carte suit aussi
    const c = await createCompany(db, { name: 'Fleuriste Rose' });
    await updateCompany(db, c, { commercial_status: 'a_contacter' });
    expect(await stageName(db, c)).toBe('À qualifier');
  });

  it('la première opportunité saisie remplace la carte automatique (pas de doublon) ; plusieurs affaires restent indépendantes', async () => {
    const { db } = await newCtx();
    const c = await createCompany(db, clientInput);
    await createOpportunity(db, { company_id: c, title: 'Refonte du site', amount_cents: 250000 });
    let opps = await listOpportunities(db, { companyId: c });
    expect(opps.map((o) => o.title)).toEqual(['Refonte du site']);
    await createOpportunity(db, { company_id: c, title: 'Maintenance', amount_cents: 80000 });
    opps = await listOpportunities(db, { companyId: c });
    expect(opps).toHaveLength(2);
    await setCommercialStatus(db, c, 'rdv'); // plusieurs affaires : aucune n'est déplacée d'office
    const stages = await listStages(db);
    expect(new Set((await listOpportunities(db, { companyId: c })).map((o) => stages.find((s) => s.id === o.stage_id)!.name))).toEqual(new Set(['Nouveau prospect']));
  });

  it('rattrapage : les prospects existants sans carte sont ajoutés au pipeline une seule fois', async () => {
    const { db } = await newCtx();
    const c = await createCompany(db, clientInput);
    await db.run('DELETE FROM opportunities WHERE company_id = ?', [c]);
    await db.run("UPDATE companies SET commercial_status = 'devis_envoye' WHERE id = ?", [c]);
    expect(await backfillPipeline(db)).toBe(1);
    expect(await stageName(db, c)).toBe('Devis envoyé');
    expect(await backfillPipeline(db)).toBe(0);
    expect((await listOpportunities(db, { companyId: c }))).toHaveLength(1);
  });
});
