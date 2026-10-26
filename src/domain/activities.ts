/** Activités, tâches et relances (appels, emails, rendez-vous, tâches de projet…). */
import type { Db } from '@/lib/db';
import { logEvent } from './audit';
import { BusinessError, assert } from './context';

export type ActivityType = 'appel' | 'email' | 'rdv' | 'relance' | 'audit' | 'tache' | 'note' | 'reunion';
export type Priority = 'basse' | 'normale' | 'haute' | 'urgente';
export type ActivityStatus = 'a_faire' | 'en_cours' | 'fait' | 'annule';

export const ACTIVITY_TYPES: { key: ActivityType; label: string }[] = [
  { key: 'appel', label: 'Appel' },
  { key: 'email', label: 'Email' },
  { key: 'rdv', label: 'Rendez-vous' },
  { key: 'relance', label: 'Relance' },
  { key: 'audit', label: 'Audit' },
  { key: 'tache', label: 'Tâche' },
  { key: 'note', label: 'Note' },
  { key: 'reunion', label: 'Réunion' },
];

export const PRIORITIES: { key: Priority; label: string }[] = [
  { key: 'basse', label: 'Basse' },
  { key: 'normale', label: 'Normale' },
  { key: 'haute', label: 'Haute' },
  { key: 'urgente', label: 'Urgente' },
];

export const ACTIVITY_STATUSES: { key: ActivityStatus; label: string }[] = [
  { key: 'a_faire', label: 'À faire' },
  { key: 'en_cours', label: 'En cours' },
  { key: 'fait', label: 'Fait' },
  { key: 'annule', label: 'Annulé' },
];

/**
 * Les dates d'échéance et de rappel sont stockées en heure locale, sans fuseau
 * (« 2026-10-26T09:00:00 »), et comparées à `datetime('now','localtime')`.
 */
export interface Activity {
  id: number;
  type: ActivityType;
  title: string;
  notes: string | null;
  company_id: number | null;
  contact_id: number | null;
  opportunity_id: number | null;
  project_id: number | null;
  quote_id: number | null;
  invoice_id: number | null;
  due_at: string | null;
  duration_min: number | null;
  priority: Priority;
  status: ActivityStatus;
  done_at: string | null;
  remind_at: string | null;
  reminded_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ActivityRow extends Activity {
  company_name: string | null;
  project_name: string | null;
  opportunity_title: string | null;
  contact_name: string | null;
}

export type ActivityInput = Partial<Omit<Activity, 'id' | 'created_at' | 'updated_at' | 'done_at' | 'reminded_at'>> & { type: ActivityType; title: string };

const FIELDS = ['type', 'title', 'notes', 'company_id', 'contact_id', 'opportunity_id', 'project_id', 'quote_id', 'invoice_id', 'due_at', 'duration_min', 'priority', 'status', 'remind_at', 'position'] as const;

function validate(input: Partial<ActivityInput>) {
  if ('title' in input) assert(String(input.title ?? '').trim(), "L'intitulé est obligatoire.");
  if (input.type && !ACTIVITY_TYPES.some((t) => t.key === input.type)) throw new BusinessError("Type d'activité invalide.");
  for (const k of ['due_at', 'remind_at'] as const) {
    const v = input[k];
    if (v && isNaN(new Date(v).getTime())) throw new BusinessError('Date invalide.');
  }
}

/** Les notes sont considérées comme faites dès leur création. */
export async function createActivity(db: Db, input: ActivityInput): Promise<number> {
  validate(input);
  const data: Record<string, any> = {};
  for (const f of FIELDS) if (f in input) data[f] = (input as any)[f] ?? null;
  data.title = String(data.title).trim();
  if (!data.status) data.status = input.type === 'note' ? 'fait' : 'a_faire';
  if (!data.priority) data.priority = 'normale';
  if (data.project_id && data.position == null) {
    const m = await db.get<{ p: number }>('SELECT COALESCE(MAX(position), 0) AS p FROM activities WHERE project_id = ?', [data.project_id]);
    data.position = (m?.p ?? 0) + 1;
  }
  if (data.company_id == null && data.project_id) {
    const p = await db.get<{ company_id: number }>('SELECT company_id FROM projects WHERE id = ?', [data.project_id]);
    data.company_id = p?.company_id ?? null;
  }
  if (data.company_id == null && data.opportunity_id) {
    const o = await db.get<{ company_id: number }>('SELECT company_id FROM opportunities WHERE id = ?', [data.opportunity_id]);
    data.company_id = o?.company_id ?? null;
  }
  const keys = Object.keys(data);
  const r = await db.run(
    `INSERT INTO activities (${keys.join(', ')}${data.status === 'fait' ? ', done_at' : ''}) VALUES (${keys.map(() => '?').join(', ')}${data.status === 'fait' ? ", strftime('%Y-%m-%dT%H:%M:%fZ','now')" : ''})`,
    keys.map((k) => data[k]),
  );
  if (data.company_id) await refreshNextAction(db, data.company_id);
  return r.lastInsertId;
}

export async function updateActivity(db: Db, id: number, input: Partial<ActivityInput>): Promise<void> {
  validate(input);
  const keys = FIELDS.filter((f) => f in input);
  if (!keys.length) return;
  await db.run(
    `UPDATE activities SET ${keys.map((k) => `${k} = ?`).join(', ')},
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [...keys.map((k) => (input as any)[k] ?? null), id],
  );
  // done_at reflète le nouveau statut (les expressions SET voient l'ancienne ligne, d'où une 2e requête)
  await db.run(
    `UPDATE activities SET done_at = CASE WHEN status = 'fait' THEN COALESCE(done_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE NULL END WHERE id = ?`,
    [id],
  );
  const a = await db.get<{ company_id: number | null }>('SELECT company_id FROM activities WHERE id = ?', [id]);
  if (a?.company_id) await refreshNextAction(db, a.company_id);
}

export async function setActivityStatus(db: Db, id: number, status: ActivityStatus): Promise<void> {
  const a = await db.get<Activity>('SELECT * FROM activities WHERE id = ?', [id]);
  assert(a, 'Activité introuvable.');
  await db.run(
    `UPDATE activities SET status = ?, done_at = CASE WHEN ? = 'fait' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [status, status, id],
  );
  if (status === 'fait' && a.company_id) {
    await logEvent(db, { entity: 'activite', id, action: 'terminee', summary: `${ACTIVITY_TYPES.find((t) => t.key === a.type)?.label} terminé(e) : ${a.title}`, companyId: a.company_id });
    // Si c'était la prochaine action de la fiche, on la libère.
    await db.run(
      `UPDATE companies SET next_action = NULL, next_action_date = NULL WHERE id = ? AND next_action = ? AND next_action_date = ?`,
      [a.company_id, a.title, a.due_at ? a.due_at.slice(0, 10) : null],
    );
  }
  if (a.company_id) await refreshNextAction(db, a.company_id);
}

const FOLLOW_UP_TYPES = "('relance','appel','rdv','email','reunion','audit')";

/**
 * Prochaine action d'une fiche : la plus proche des actions commerciales en
 * attente, sauf si une prochaine action saisie manuellement est plus proche.
 */
export async function refreshNextAction(db: Db, companyId: number): Promise<void> {
  const next = await db.get<{ title: string; d: string }>(
    `SELECT title, date(due_at) AS d FROM activities WHERE company_id = ? AND status IN ('a_faire','en_cours')
       AND due_at IS NOT NULL AND type IN ${FOLLOW_UP_TYPES} ORDER BY due_at LIMIT 1`,
    [companyId],
  );
  if (!next) return;
  await db.run(
    `UPDATE companies SET next_action = ?, next_action_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ? AND (next_action_date IS NULL OR next_action IS NULL OR next_action_date > ?)`,
    [next.title, next.d, companyId, next.d],
  );
}

export async function deleteActivity(db: Db, id: number): Promise<void> {
  const a = await db.get<Activity>('SELECT * FROM activities WHERE id = ?', [id]);
  assert(a, 'Activité introuvable.');
  await db.run('DELETE FROM activities WHERE id = ?', [id]);
  if (a.company_id) await logEvent(db, { entity: 'activite', id, action: 'suppression', summary: `Activité supprimée : ${a.title}`, companyId: a.company_id });
}

export interface ActivityFilter {
  scope?: 'today' | 'late' | 'upcoming' | 'open' | 'done' | 'all';
  type?: ActivityType;
  companyId?: number;
  projectId?: number;
  opportunityId?: number;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
}

export async function listActivities(db: Db, f: ActivityFilter = {}): Promise<ActivityRow[]> {
  const where: string[] = [];
  const params: any[] = [];
  const todayExpr = "date('now','localtime')";
  switch (f.scope) {
    case 'today': where.push(`a.status IN ('a_faire','en_cours') AND date(a.due_at) = ${todayExpr}`); break;
    case 'late': where.push(`a.status IN ('a_faire','en_cours') AND a.due_at IS NOT NULL AND date(a.due_at) < ${todayExpr}`); break;
    case 'upcoming': where.push(`a.status IN ('a_faire','en_cours') AND date(a.due_at) > ${todayExpr}`); break;
    case 'open': where.push("a.status IN ('a_faire','en_cours')"); break;
    case 'done': where.push("a.status = 'fait'"); break;
  }
  if (f.type) { where.push('a.type = ?'); params.push(f.type); }
  if (f.companyId != null) { where.push('a.company_id = ?'); params.push(f.companyId); }
  if (f.projectId != null) { where.push('a.project_id = ?'); params.push(f.projectId); }
  if (f.opportunityId != null) { where.push('a.opportunity_id = ?'); params.push(f.opportunityId); }
  if (f.from) { where.push("date(a.due_at) >= ?"); params.push(f.from); }
  if (f.to) { where.push("date(a.due_at) <= ?"); params.push(f.to); }
  if (f.search?.trim()) {
    where.push("(lower(a.title) LIKE ? OR lower(COALESCE(a.notes,'')) LIKE ? OR lower(COALESCE(c.name,'')) LIKE ?)");
    const q = `%${f.search.trim().toLowerCase()}%`;
    params.push(q, q, q);
  }
  params.push(f.limit ?? 1000);
  const order = f.scope === 'done' ? 'a.done_at DESC' : f.projectId != null ? 'a.position, a.id' : "CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END, a.due_at ASC, CASE a.priority WHEN 'urgente' THEN 0 WHEN 'haute' THEN 1 WHEN 'normale' THEN 2 ELSE 3 END";
  return db.all<ActivityRow>(
    `SELECT a.*, c.name AS company_name, p.name AS project_name, o.title AS opportunity_title,
       TRIM(COALESCE(k.first_name,'') || ' ' || COALESCE(k.last_name,'')) AS contact_name
     FROM activities a
     LEFT JOIN companies c ON c.id = a.company_id
     LEFT JOIN projects p ON p.id = a.project_id
     LEFT JOIN opportunities o ON o.id = a.opportunity_id
     LEFT JOIN contacts k ON k.id = a.contact_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`,
    params,
  );
}

export interface ActivityCounts {
  today: number;
  late: number;
  upcoming7: number;
}

export async function activityCounts(db: Db): Promise<ActivityCounts> {
  const r = await db.get<any>(
    `SELECT
       SUM(CASE WHEN date(due_at) = date('now','localtime') THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN due_at IS NOT NULL AND date(due_at) < date('now','localtime') THEN 1 ELSE 0 END) AS late,
       SUM(CASE WHEN date(due_at) > date('now','localtime') AND date(due_at) <= date('now','localtime','+7 days') THEN 1 ELSE 0 END) AS upcoming7
     FROM activities WHERE status IN ('a_faire','en_cours')`,
  );
  return { today: r?.today ?? 0, late: r?.late ?? 0, upcoming7: r?.upcoming7 ?? 0 };
}

/** Rappels locaux arrivés à échéance et pas encore notifiés. */
export async function dueReminders(db: Db): Promise<ActivityRow[]> {
  return db.all<ActivityRow>(
    `SELECT a.*, c.name AS company_name, NULL AS project_name, NULL AS opportunity_title, NULL AS contact_name
     FROM activities a LEFT JOIN companies c ON c.id = a.company_id
     WHERE a.status IN ('a_faire','en_cours') AND a.remind_at IS NOT NULL AND a.reminded_at IS NULL AND datetime(a.remind_at) <= datetime('now','localtime')`,
  );
}

export async function markReminded(db: Db, id: number): Promise<void> {
  await db.run("UPDATE activities SET reminded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [id]);
}
