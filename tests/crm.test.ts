import { describe, expect, it } from 'vitest';
import { newCtx, clientInput } from './helpers';
import {
  createCompany, updateCompany, getCompany, listCompanies, convertToClient, archiveCompany, createContact, listContacts,
  findDuplicates, scanDuplicates, mergeCompanies, exportCompaniesCsv, importCompaniesCsv, companyTimeline,
} from '@/domain/companies';
import { createOpportunity, listStages, moveOpportunity, confirmWon, pipelineSummary, listOpportunities, saveStage, reorderStages } from '@/domain/pipeline';
import { createActivity, listActivities, setActivityStatus, activityCounts, dueReminders } from '@/domain/activities';
import { listProjects, listProjectTemplates } from '@/domain/projects';
import { listEvents } from '@/domain/audit';
import { addDays, today } from '@/lib/format';

describe('entreprises et contacts', () => {
  it('crée, modifie, recherche et archive une fiche', async () => {
    const { db } = await newCtx();
    const id = await createCompany(db, { ...clientInput, website: 'boulangerie-martin.fr', potential_cents: 150000 });
    const c = (await getCompany(db, id))!;
    expect(c.kind).toBe('prospect');
    expect(c.website).toBe('https://boulangerie-martin.fr');
    await updateCompany(db, id, { sector: 'Boulangerie', next_action: 'Rappeler', next_action_date: today() });
    expect((await getCompany(db, id))!.sector).toBe('Boulangerie');
    await createContact(db, { company_id: id, first_name: 'Claire', last_name: 'Martin', job_title: 'Gérante', email: 'Claire@Boulangerie-Martin.fr' });
    expect((await listContacts(db, { companyId: id }))[0].is_primary).toBe(1);
    expect((await listCompanies(db, { search: 'claire' })).length).toBe(1);
    expect((await listCompanies(db, { followUp: 'today' })).length).toBe(1);
    await archiveCompany(db, id);
    expect((await listCompanies(db, {})).length).toBe(0);
    expect((await listCompanies(db, { archived: true })).length).toBe(1);
  });

  it('valide les entrées', async () => {
    const { db } = await newCtx();
    await expect(createCompany(db, { name: '  ' })).rejects.toThrow(/obligatoire/);
    await expect(createCompany(db, { name: 'X', email: 'pas-un-email' })).rejects.toThrow(/email/);
    await expect(createCompany(db, { name: 'X', siret: '123' })).rejects.toThrow(/SIRET/);
  });

  it('résiste aux injections SQL', async () => {
    const { db } = await newCtx();
    const evil = "Robert'); DROP TABLE companies; --";
    const id = await createCompany(db, { name: evil });
    expect((await getCompany(db, id))!.name).toBe(evil);
    expect((await listCompanies(db, { search: "' OR 1=1 --" })).length).toBe(0);
  });

  it('convertit un prospect en client sans dupliquer la fiche', async () => {
    const { db } = await newCtx();
    const id = await createCompany(db, clientInput);
    await createActivity(db, { type: 'appel', title: 'Premier appel', company_id: id, status: 'fait' });
    expect(await convertToClient(db, id)).toBe(true);
    expect(await convertToClient(db, id)).toBe(false);
    const c = (await getCompany(db, id))!;
    expect(c.kind).toBe('client');
    expect(c.became_client_at).toBeTruthy();
    expect((await db.get<any>('SELECT COUNT(*) AS n FROM companies'))!.n).toBe(1);
    const timeline = await companyTimeline(db, id);
    expect(timeline.some((t) => t.title.includes('devient client'))).toBe(true);
    expect(timeline.some((t) => t.title === 'Premier appel')).toBe(true);
  });

  it('détecte les doublons et fusionne en conservant l’historique', async () => {
    const { db } = await newCtx();
    const a = await createCompany(db, { name: 'SARL Boulangerie Martin', phone: '04 78 00 00 00', email: 'contact@boulangerie-martin.fr' });
    const b = await createCompany(db, { name: 'Boulangerie Martin', phone: '+33 4 78 00 00 00', city: 'Lyon', notes: 'Vu au salon' });
    await createCompany(db, { name: 'Garage Durand', email: 'garage@gmail.com' });
    await createCompany(db, { name: 'Fleuriste Rose', email: 'rose@gmail.com' });
    const d = await findDuplicates(db, { name: 'Boulangerie Martin', phone: '0478000000' });
    expect(d.map((x) => x.company.id).sort()).toEqual([a, b]);
    const pairs = await scanDuplicates(db);
    expect(pairs.length).toBe(1); // deux gmail.com ne sont pas des doublons
    await createContact(db, { company_id: b, last_name: 'Martin', first_name: 'Paul' });
    await createActivity(db, { type: 'note', title: 'Note historique', company_id: b });
    await mergeCompanies(db, a, b);
    const merged = (await getCompany(db, a))!;
    expect(merged.city).toBe('Lyon');
    expect(merged.notes).toBe('Vu au salon');
    expect((await listContacts(db, { companyId: a })).length).toBe(1);
    expect((await listActivities(db, { companyId: a })).length).toBe(1);
    const source = (await getCompany(db, b))!;
    expect(source.merged_into_id).toBe(a);
    expect((await listCompanies(db, {})).map((c) => c.id)).not.toContain(b);
    await expect(mergeCompanies(db, a, a)).rejects.toThrow();
  });

  it('exporte et importe en CSV (séparateur ;, accents, doublons ignorés)', async () => {
    const { db } = await newCtx();
    await createCompany(db, { ...clientInput, notes: 'Ligne 1\nLigne 2 ; avec "guillemets"', potential_cents: 123456 });
    const csv = await exportCompaniesCsv(db, {});
    expect(csv.startsWith('﻿Entreprise;')).toBe(true);
    expect(csv).toContain('1234,56');
    const ctx2 = await newCtx();
    const report = await importCompaniesCsv(ctx2.db, csv);
    expect(report.errors).toEqual([]);
    expect(report.created).toBe(1);
    const imported = (await listCompanies(ctx2.db, {}))[0];
    expect(imported.notes).toBe('Ligne 1\nLigne 2 ; avec "guillemets"');
    expect(imported.potential_cents).toBe(123456);
    const again = await importCompaniesCsv(ctx2.db, csv);
    expect(again.created).toBe(0);
    expect(again.skippedDuplicates.length).toBe(1);
    const other = await importCompaniesCsv(ctx2.db, 'Nom,Ville,Téléphone,Prénom contact,Nom contact\n"Plomberie Dupuis",Nantes,0601020304,Jean,Dupuis\n,Paris,,,\n');
    expect(other.created).toBe(1);
    expect(other.errors.length).toBe(1);
    expect((await listContacts(ctx2.db, {})).some((c) => c.last_name === 'Dupuis')).toBe(true);
  });

  it('neutralise les formules dans les exports CSV', async () => {
    const { db } = await newCtx();
    await createCompany(db, { name: '=HYPERLINK("http://x")' });
    const csv = await exportCompaniesCsv(db, {});
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

describe('pipeline commercial', () => {
  it('a les étapes par défaut et calcule la valeur pondérée', async () => {
    const { db } = await newCtx();
    const stages = await listStages(db);
    expect(stages.map((s) => s.name)).toContain('Audit gratuit proposé');
    expect(stages.length).toBe(12);
    const c = await createCompany(db, clientInput);
    await createOpportunity(db, { company_id: c, title: 'Site vitrine', amount_cents: 200000, probability: 50 });
    await createOpportunity(db, { company_id: c, title: 'SEO', amount_cents: 100000, probability: 20 });
    const s = await pipelineSummary(db);
    expect(s.open_count).toBe(2);
    expect(s.total_cents).toBe(300000);
    expect(s.weighted_cents).toBe(120000);
  });

  it('glisser-déposer jusqu’à « Client gagné » puis création du client et du projet après confirmation', async () => {
    const { db } = await newCtx();
    const c = await createCompany(db, clientInput);
    const o = await createOpportunity(db, { company_id: c, title: 'Création site', amount_cents: 180000 });
    const stages = await listStages(db);
    const rdv = stages.find((s) => s.name === 'Rendez-vous prévu')!;
    const won = stages.find((s) => s.kind === 'won')!;
    let r = await moveOpportunity(db, o, rdv.id);
    expect(r.won).toBe(false);
    expect((await listOpportunities(db))[0].probability).toBe(40);
    r = await moveOpportunity(db, o, won.id);
    expect(r.won).toBe(true);
    // Rien n'est créé avant confirmation
    expect((await getCompany(db, c))!.kind).toBe('prospect');
    const tpl = (await listProjectTemplates(db)).find((t) => t.name === 'Création de site Internet')!;
    const { projectId } = await confirmWon(db, o, { createProject: true, templateId: tpl.id });
    expect((await getCompany(db, c))!.kind).toBe('client');
    const projects = await listProjects(db, { companyId: c });
    expect(projects.length).toBe(1);
    expect(projects[0].id).toBe(projectId);
    expect(projects[0].tasks_total).toBe(tpl.tasks.length);
    expect(projects[0].contract_amount_cents).toBe(180000);
  });

  it('étapes configurables et réordonnables', async () => {
    const { db } = await newCtx();
    const id = await saveStage(db, { name: 'Relance devis', kind: 'open', default_probability: 55 });
    const ids = (await listStages(db)).map((s) => s.id);
    await reorderStages(db, [id, ...ids.filter((x) => x !== id)]);
    expect((await listStages(db))[0].name).toBe('Relance devis');
  });

  it('ordonne les cartes dans une colonne', async () => {
    const { db } = await newCtx();
    const c = await createCompany(db, clientInput);
    const stage = (await listStages(db))[0];
    const a = await createOpportunity(db, { company_id: c, title: 'A', stage_id: stage.id });
    const b = await createOpportunity(db, { company_id: c, title: 'B', stage_id: stage.id });
    await moveOpportunity(db, b, stage.id, a);
    expect((await listOpportunities(db)).map((o) => o.title)).toEqual(['B', 'A']);
  });
});

describe('activités et relances', () => {
  it('liste du jour, retards, échéances et rappels', async () => {
    const { db } = await newCtx();
    const c = await createCompany(db, clientInput);
    const t = today();
    await createActivity(db, { type: 'relance', title: 'Relance devis', company_id: c, due_at: `${t}T23:59:00`, priority: 'haute' });
    await createActivity(db, { type: 'appel', title: 'Appel en retard', company_id: c, due_at: `${addDays(t, -2)}T10:00:00` });
    await createActivity(db, { type: 'rdv', title: 'Rendez-vous', company_id: c, due_at: `${addDays(t, 3)}T14:00:00`, remind_at: `${addDays(t, -1)}T09:00:00` });
    const done = await createActivity(db, { type: 'tache', title: 'Fait', company_id: c, due_at: `${addDays(t, -5)}T10:00:00` });
    await setActivityStatus(db, done, 'fait');
    expect((await listActivities(db, { scope: 'today' })).map((a) => a.title)).toEqual(['Relance devis']);
    expect((await listActivities(db, { scope: 'late' })).map((a) => a.title)).toEqual(['Appel en retard']);
    expect((await listActivities(db, { scope: 'upcoming' })).map((a) => a.title)).toEqual(['Rendez-vous']);
    expect(await activityCounts(db)).toEqual({ today: 1, late: 1, upcoming7: 1 });
    expect((await dueReminders(db)).map((a) => a.title)).toEqual(['Rendez-vous']);
    // La relance planifiée met à jour la prochaine action de la fiche
    expect((await getCompany(db, c))!.next_action_date).toBe(addDays(t, -2));
    expect((await listEvents(db, { companyId: c })).length).toBeGreaterThan(0);
  });
});
