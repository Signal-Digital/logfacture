/** Projets clients, statuts configurables et modèles de projet (listes de tâches). */
import type { Db } from '@/lib/db';
import { logEvent } from './audit';
import { assert } from './context';
import { addDays, today } from '@/lib/format';

export interface ProjectStatus {
  id: number;
  name: string;
  position: number;
  is_closed: number;
  color: string;
}

export interface Project {
  id: number;
  company_id: number;
  name: string;
  service_type: string | null;
  status_id: number | null;
  start_date: string | null;
  due_date: string | null;
  contract_amount_cents: number;
  quote_id: number | null;
  opportunity_id: number | null;
  notes: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow extends Project {
  company_name: string;
  status_name: string | null;
  status_color: string | null;
  status_closed: number | null;
  tasks_total: number;
  tasks_done: number;
  tasks_late: number;
  quote_number: string | null;
  invoiced_cents: number;
}

export const DEFAULT_PROJECT_STATUSES = [
  { name: 'À démarrer', is_closed: 0, color: '#94a3b8' },
  { name: 'En cours', is_closed: 0, color: '#14b8a6' },
  { name: 'En attente du client', is_closed: 0, color: '#f59e0b' },
  { name: "En attente d'une ressource", is_closed: 0, color: '#fb923c' },
  { name: 'À valider', is_closed: 0, color: '#6366f1' },
  { name: 'Terminé', is_closed: 1, color: '#22c55e' },
  { name: 'Suspendu', is_closed: 1, color: '#ef4444' },
];

export const DEFAULT_PROJECT_TEMPLATES: { name: string; service_type: string; tasks: { title: string; offset_days: number }[] }[] = [
  {
    name: 'Création de site Internet',
    service_type: 'Site Internet',
    tasks: [
      { title: 'Réunion de lancement et recueil des besoins', offset_days: 0 },
      { title: 'Collecte des contenus (textes, logo, photos)', offset_days: 5 },
      { title: 'Maquette de la page d\'accueil', offset_days: 10 },
      { title: 'Validation de la maquette par le client', offset_days: 14 },
      { title: 'Intégration des pages', offset_days: 24 },
      { title: 'Optimisation SEO de base', offset_days: 28 },
      { title: 'Recette et corrections', offset_days: 32 },
      { title: 'Mise en ligne', offset_days: 35 },
    ],
  },
  {
    name: 'Audit SEO',
    service_type: 'SEO',
    tasks: [
      { title: 'Récupération des accès (Search Console, Analytics)', offset_days: 0 },
      { title: 'Crawl technique du site', offset_days: 2 },
      { title: 'Analyse sémantique et concurrentielle', offset_days: 4 },
      { title: 'Rédaction du rapport d\'audit', offset_days: 6 },
      { title: 'Présentation au client', offset_days: 8 },
    ],
  },
  {
    name: 'Optimisation Google Business Profile',
    service_type: 'Référencement local',
    tasks: [
      { title: 'Obtenir l\'accès gestionnaire à la fiche', offset_days: 0 },
      { title: 'Optimiser catégories, description et services', offset_days: 2 },
      { title: 'Ajouter photos et publications', offset_days: 4 },
      { title: 'Mettre en place la stratégie d\'avis clients', offset_days: 6 },
    ],
  },
];

export async function listProjectStatuses(db: Db): Promise<ProjectStatus[]> {
  return db.all<ProjectStatus>('SELECT * FROM project_statuses ORDER BY position, id');
}

export async function saveProjectStatus(db: Db, s: Partial<ProjectStatus> & { name: string }): Promise<number> {
  assert(s.name.trim(), 'Le nom du statut est obligatoire.');
  if (s.id) {
    await db.run('UPDATE project_statuses SET name = ?, is_closed = ?, color = ? WHERE id = ?', [s.name.trim(), s.is_closed ? 1 : 0, s.color ?? '#64748b', s.id]);
    return s.id;
  }
  const m = await db.get<{ p: number }>('SELECT COALESCE(MAX(position),0) AS p FROM project_statuses');
  const r = await db.run('INSERT INTO project_statuses (name, position, is_closed, color) VALUES (?, ?, ?, ?)', [s.name.trim(), (m?.p ?? 0) + 1, s.is_closed ? 1 : 0, s.color ?? '#64748b']);
  return r.lastInsertId;
}

export interface ProjectInput {
  company_id: number;
  name: string;
  service_type?: string | null;
  status_id?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  contract_amount_cents?: number;
  quote_id?: number | null;
  opportunity_id?: number | null;
  notes?: string | null;
  template_id?: number | null;
}

export async function createProject(db: Db, input: ProjectInput): Promise<number> {
  assert(input.name?.trim(), 'Le nom du projet est obligatoire.');
  assert(input.company_id, 'Un client doit être associé au projet.');
  return db.tx(async (t) => {
    const statusId = input.status_id ?? (await t.get<{ id: number }>('SELECT id FROM project_statuses ORDER BY position LIMIT 1'))?.id ?? null;
    const start = input.start_date ?? today();
    let serviceType = input.service_type ?? null;
    const tpl = input.template_id ? await t.get<any>('SELECT * FROM project_templates WHERE id = ?', [input.template_id]) : null;
    if (tpl && !serviceType) serviceType = tpl.service_type;
    const r = await t.run(
      `INSERT INTO projects (company_id, name, service_type, status_id, start_date, due_date, contract_amount_cents, quote_id, opportunity_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.company_id, input.name.trim(), serviceType, statusId, start, input.due_date ?? null, input.contract_amount_cents ?? 0, input.quote_id ?? null, input.opportunity_id ?? null, input.notes ?? null],
    );
    const id = r.lastInsertId;
    if (tpl) {
      const tasks = await t.all<any>('SELECT * FROM project_template_tasks WHERE template_id = ? ORDER BY position, id', [tpl.id]);
      let pos = 1;
      let maxOffset = 0;
      for (const task of tasks) {
        maxOffset = Math.max(maxOffset, task.offset_days);
        await t.run(
          `INSERT INTO activities (type, title, company_id, project_id, due_at, priority, status, position) VALUES ('tache', ?, ?, ?, ?, 'normale', 'a_faire', ?)`,
          [task.title, input.company_id, id, `${addDays(start, task.offset_days)}T09:00:00`, pos++],
        );
      }
      if (!input.due_date && tasks.length) await t.run('UPDATE projects SET due_date = ? WHERE id = ?', [addDays(start, maxOffset), id]);
    }
    if (input.quote_id) await t.run('UPDATE quotes SET project_id = ? WHERE id = ? AND project_id IS NULL', [id, input.quote_id]);
    await logEvent(t, { entity: 'projet', id, action: 'creation', summary: `Projet créé : ${input.name.trim()}${tpl ? ` (modèle « ${tpl.name} »)` : ''}`, companyId: input.company_id });
    return id;
  });
}

export async function updateProject(db: Db, id: number, input: Partial<ProjectInput>): Promise<void> {
  const keys = (['name', 'service_type', 'status_id', 'start_date', 'due_date', 'contract_amount_cents', 'quote_id', 'notes', 'company_id'] as const).filter((k) => k in input);
  if (!keys.length) return;
  if ('name' in input) assert(String(input.name ?? '').trim(), 'Le nom du projet est obligatoire.');
  await db.tx(async (t) => {
    const p = await getProject(t, id);
    assert(p, 'Projet introuvable.');
    await t.run(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...keys.map((k) => (input as any)[k] ?? null), id]);
    if ('status_id' in input && input.status_id !== p.status_id) {
      const s = await t.get<ProjectStatus>('SELECT * FROM project_statuses WHERE id = ?', [input.status_id]);
      await t.run(`UPDATE projects SET completed_at = ${s?.is_closed ? "COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))" : 'NULL'} WHERE id = ?`, [id]);
      await logEvent(t, { entity: 'projet', id, action: 'changement_statut', summary: `Projet « ${p.name} » : statut « ${s?.name ?? '?'} »`, companyId: p.company_id });
    } else {
      await logEvent(t, { entity: 'projet', id, action: 'modification', summary: `Projet modifié : ${input.name ?? p.name}`, companyId: p.company_id });
    }
  });
}

export async function archiveProject(db: Db, id: number, archived = true): Promise<void> {
  const p = await getProject(db, id);
  assert(p, 'Projet introuvable.');
  await db.run(`UPDATE projects SET archived_at = ${archived ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'} WHERE id = ?`, [id]);
  await logEvent(db, { entity: 'projet', id, action: archived ? 'archivage' : 'desarchivage', summary: `Projet ${archived ? 'archivé' : 'restauré'} : ${p.name}`, companyId: p.company_id });
}

export async function getProject(db: Db, id: number): Promise<Project | undefined> {
  return db.get<Project>('SELECT * FROM projects WHERE id = ?', [id]);
}

export async function listProjects(db: Db, opts: { companyId?: number; archived?: boolean; activeOnly?: boolean; search?: string; statusId?: number } = {}): Promise<ProjectRow[]> {
  const where: string[] = [opts.archived ? 'p.archived_at IS NOT NULL' : 'p.archived_at IS NULL'];
  const params: any[] = [];
  if (opts.companyId != null) { where.push('p.company_id = ?'); params.push(opts.companyId); }
  if (opts.activeOnly) where.push('COALESCE(s.is_closed, 0) = 0');
  if (opts.statusId) { where.push('p.status_id = ?'); params.push(opts.statusId); }
  if (opts.search?.trim()) {
    where.push('(lower(p.name) LIKE ? OR lower(c.name) LIKE ?)');
    const q = `%${opts.search.trim().toLowerCase()}%`;
    params.push(q, q);
  }
  return db.all<ProjectRow>(
    `SELECT p.*, c.name AS company_name, s.name AS status_name, s.color AS status_color, s.is_closed AS status_closed,
       (SELECT COUNT(*) FROM activities a WHERE a.project_id = p.id AND a.status <> 'annule') AS tasks_total,
       (SELECT COUNT(*) FROM activities a WHERE a.project_id = p.id AND a.status = 'fait') AS tasks_done,
       (SELECT COUNT(*) FROM activities a WHERE a.project_id = p.id AND a.status IN ('a_faire','en_cours') AND date(a.due_at) < date('now','localtime')) AS tasks_late,
       (SELECT number FROM quotes q WHERE q.id = p.quote_id) AS quote_number,
       COALESCE((SELECT SUM(CASE WHEN i.kind = 'avoir' THEN -i.total_ttc_cents ELSE i.total_ttc_cents END) FROM invoices i WHERE i.project_id = p.id AND i.status <> 'brouillon'), 0) AS invoiced_cents
     FROM projects p JOIN companies c ON c.id = p.company_id LEFT JOIN project_statuses s ON s.id = p.status_id
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(s.is_closed, 0), CASE WHEN p.due_date IS NULL THEN 1 ELSE 0 END, p.due_date, p.id DESC`,
    params,
  );
}

// ---------- Modèles de projet ----------

export interface ProjectTemplate {
  id: number;
  name: string;
  description: string | null;
  service_type: string | null;
  tasks: { id?: number; title: string; offset_days: number; position: number }[];
}

export async function listProjectTemplates(db: Db): Promise<ProjectTemplate[]> {
  const tpls = await db.all<any>('SELECT * FROM project_templates ORDER BY name COLLATE NOCASE');
  const tasks = await db.all<any>('SELECT * FROM project_template_tasks ORDER BY position, id');
  return tpls.map((t) => ({ ...t, tasks: tasks.filter((k) => k.template_id === t.id) }));
}

export async function saveProjectTemplate(db: Db, tpl: Omit<ProjectTemplate, 'id'> & { id?: number }): Promise<number> {
  assert(tpl.name.trim(), 'Le nom du modèle est obligatoire.');
  return db.tx(async (t) => {
    let id = tpl.id;
    if (id) {
      await t.run('UPDATE project_templates SET name = ?, description = ?, service_type = ? WHERE id = ?', [tpl.name.trim(), tpl.description ?? null, tpl.service_type ?? null, id]);
      await t.run('DELETE FROM project_template_tasks WHERE template_id = ?', [id]);
    } else {
      id = (await t.run('INSERT INTO project_templates (name, description, service_type) VALUES (?, ?, ?)', [tpl.name.trim(), tpl.description ?? null, tpl.service_type ?? null])).lastInsertId;
    }
    let pos = 1;
    for (const task of tpl.tasks) {
      if (!task.title.trim()) continue;
      await t.run('INSERT INTO project_template_tasks (template_id, title, offset_days, position) VALUES (?, ?, ?, ?)', [id, task.title.trim(), Math.max(0, Math.round(task.offset_days || 0)), pos++]);
    }
    return id!;
  });
}

export async function deleteProjectTemplate(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM project_templates WHERE id = ?', [id]);
}
