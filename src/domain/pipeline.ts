/** Pipeline commercial : étapes configurables et opportunités (Kanban). */
import type { Db } from '@/lib/db';
import { logEvent } from './audit';
import { BusinessError, assert } from './context';
import { convertToClient } from './companies';

export interface Stage {
  id: number;
  name: string;
  position: number;
  kind: 'open' | 'won' | 'lost';
  default_probability: number;
  color: string;
  archived_at: string | null;
}

export interface Opportunity {
  id: number;
  company_id: number;
  contact_id: number | null;
  title: string;
  stage_id: number;
  amount_cents: number;
  probability: number;
  expected_close_date: string | null;
  status: 'open' | 'won' | 'lost';
  lost_reason: string | null;
  notes: string | null;
  position: number;
  closed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpportunityRow extends Opportunity {
  company_name: string;
  company_kind: string;
  contact_name: string | null;
  open_tasks: number;
  quotes_count: number;
}

export const DEFAULT_STAGES: Omit<Stage, 'id' | 'archived_at'>[] = [
  { name: 'Nouveau prospect', position: 1, kind: 'open', default_probability: 5, color: '#94a3b8' },
  { name: 'À qualifier', position: 2, kind: 'open', default_probability: 10, color: '#a5b4fc' },
  { name: 'À contacter', position: 3, kind: 'open', default_probability: 10, color: '#818cf8' },
  { name: 'Contact établi', position: 4, kind: 'open', default_probability: 20, color: '#60a5fa' },
  { name: 'Audit gratuit proposé', position: 5, kind: 'open', default_probability: 30, color: '#38bdf8' },
  { name: 'Rendez-vous prévu', position: 6, kind: 'open', default_probability: 40, color: '#22d3ee' },
  { name: 'Proposition commerciale envoyée', position: 7, kind: 'open', default_probability: 50, color: '#2dd4bf' },
  { name: 'Devis envoyé', position: 8, kind: 'open', default_probability: 60, color: '#14b8a6' },
  { name: 'Négociation', position: 9, kind: 'open', default_probability: 75, color: '#f59e0b' },
  { name: 'Client gagné', position: 10, kind: 'won', default_probability: 100, color: '#22c55e' },
  { name: 'Perdu', position: 11, kind: 'lost', default_probability: 0, color: '#ef4444' },
  { name: 'À recontacter', position: 12, kind: 'open', default_probability: 10, color: '#a855f7' },
];

export async function listStages(db: Db, includeArchived = false): Promise<Stage[]> {
  return db.all<Stage>(`SELECT * FROM pipeline_stages ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY position, id`);
}

export async function saveStage(db: Db, s: Partial<Stage> & { name: string }): Promise<number> {
  assert(s.name.trim(), "Le nom de l'étape est obligatoire.");
  if (s.id) {
    await db.run('UPDATE pipeline_stages SET name = ?, kind = ?, default_probability = ?, color = ? WHERE id = ?', [
      s.name.trim(), s.kind ?? 'open', s.default_probability ?? 10, s.color ?? '#64748b', s.id,
    ]);
    return s.id;
  }
  const max = await db.get<{ p: number }>('SELECT COALESCE(MAX(position), 0) AS p FROM pipeline_stages');
  const r = await db.run('INSERT INTO pipeline_stages (name, position, kind, default_probability, color) VALUES (?, ?, ?, ?, ?)', [
    s.name.trim(), (max?.p ?? 0) + 1, s.kind ?? 'open', s.default_probability ?? 10, s.color ?? '#64748b',
  ]);
  return r.lastInsertId;
}

export async function reorderStages(db: Db, orderedIds: number[]): Promise<void> {
  await db.tx(async (t) => {
    for (let i = 0; i < orderedIds.length; i++) await t.run('UPDATE pipeline_stages SET position = ? WHERE id = ?', [i + 1, orderedIds[i]]);
  });
}

export async function archiveStage(db: Db, id: number): Promise<void> {
  const used = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM opportunities WHERE stage_id = ? AND archived_at IS NULL AND status = 'open'", [id]);
  if (used && used.n > 0) throw new BusinessError(`Cette étape contient encore ${used.n} opportunité(s) ouverte(s). Déplacez-les avant de la supprimer.`);
  await db.run("UPDATE pipeline_stages SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [id]);
}

export interface OpportunityInput {
  company_id: number;
  contact_id?: number | null;
  title: string;
  stage_id?: number;
  amount_cents?: number;
  probability?: number;
  expected_close_date?: string | null;
  notes?: string | null;
}

export async function createOpportunity(db: Db, input: OpportunityInput): Promise<number> {
  assert(input.title?.trim(), "L'intitulé de l'opportunité est obligatoire.");
  assert(input.company_id, 'Une entreprise doit être associée.');
  if (input.amount_cents != null && (input.amount_cents < 0 || !Number.isSafeInteger(input.amount_cents))) throw new BusinessError('Montant invalide.');
  return db.tx(async (t) => {
    const stages = await listStages(t);
    const stage = input.stage_id ? stages.find((s) => s.id === input.stage_id) : stages.find((s) => s.kind === 'open');
    assert(stage, 'Étape du pipeline introuvable.');
    const maxPos = await t.get<{ p: number }>('SELECT COALESCE(MAX(position), 0) AS p FROM opportunities WHERE stage_id = ?', [stage.id]);
    const status = stage.kind === 'won' ? 'won' : stage.kind === 'lost' ? 'lost' : 'open';
    const r = await t.run(
      `INSERT INTO opportunities (company_id, contact_id, title, stage_id, amount_cents, probability, expected_close_date, notes, status, position, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.company_id, input.contact_id ?? null, input.title.trim(), stage.id, input.amount_cents ?? 0,
        clampProb(input.probability ?? stage.default_probability), input.expected_close_date ?? null, input.notes ?? null,
        status, (maxPos?.p ?? 0) + 1, status === 'open' ? null : new Date().toISOString(),
      ],
    );
    await logEvent(t, { entity: 'opportunite', id: r.lastInsertId, action: 'creation', summary: `Opportunité créée : ${input.title.trim()} (${stage.name})`, companyId: input.company_id });
    return r.lastInsertId;
  });
}

function clampProb(p: number): number {
  return Math.max(0, Math.min(100, Math.round(p)));
}

export async function updateOpportunity(db: Db, id: number, input: Partial<OpportunityInput> & { lost_reason?: string | null }): Promise<void> {
  const fields: string[] = [];
  const params: any[] = [];
  for (const k of ['company_id', 'contact_id', 'title', 'amount_cents', 'probability', 'expected_close_date', 'notes', 'lost_reason'] as const) {
    if (k in input) {
      let v: any = (input as any)[k];
      if (k === 'probability') v = clampProb(v);
      if (k === 'title') { assert(String(v).trim(), "L'intitulé est obligatoire."); v = String(v).trim(); }
      if (k === 'amount_cents' && (v < 0 || !Number.isSafeInteger(v))) throw new BusinessError('Montant invalide.');
      fields.push(`${k} = ?`);
      params.push(v ?? null);
    }
  }
  if (!fields.length) return;
  const o = await getOpportunity(db, id);
  assert(o, 'Opportunité introuvable.');
  await db.run(`UPDATE opportunities SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...params, id]);
  await logEvent(db, { entity: 'opportunite', id, action: 'modification', summary: `Opportunité modifiée : ${input.title ?? o.title}`, companyId: o.company_id });
}

export async function getOpportunity(db: Db, id: number): Promise<Opportunity | undefined> {
  return db.get<Opportunity>('SELECT * FROM opportunities WHERE id = ?', [id]);
}

export async function listOpportunities(db: Db, opts: { companyId?: number; includeClosed?: boolean; search?: string } = {}): Promise<OpportunityRow[]> {
  const where = ['o.archived_at IS NULL'];
  const params: any[] = [];
  if (opts.companyId != null) { where.push('o.company_id = ?'); params.push(opts.companyId); }
  if (!opts.includeClosed) where.push("(o.status = 'open' OR o.closed_at >= date('now','-60 days'))");
  if (opts.search?.trim()) {
    where.push("(lower(o.title) LIKE ? OR lower(c.name) LIKE ?)");
    const q = `%${opts.search.trim().toLowerCase()}%`;
    params.push(q, q);
  }
  return db.all<OpportunityRow>(
    `SELECT o.*, c.name AS company_name, c.kind AS company_kind,
       (SELECT TRIM(COALESCE(k.first_name,'') || ' ' || k.last_name) FROM contacts k WHERE k.id = o.contact_id) AS contact_name,
       (SELECT COUNT(*) FROM activities a WHERE a.opportunity_id = o.id AND a.status IN ('a_faire','en_cours')) AS open_tasks,
       (SELECT COUNT(*) FROM quotes q WHERE q.opportunity_id = o.id) AS quotes_count
     FROM opportunities o JOIN companies c ON c.id = o.company_id
     WHERE ${where.join(' AND ')} ORDER BY o.position, o.id`,
    params,
  );
}

export interface MoveResult {
  /** L'opportunité arrive dans une étape « gagnée » : l'interface propose la création du client et du projet. */
  won: boolean;
  lost: boolean;
  companyId: number;
}

/** Déplace une opportunité (glisser-déposer) vers une étape, à une position donnée. */
export async function moveOpportunity(db: Db, id: number, stageId: number, beforeId?: number | null): Promise<MoveResult> {
  return db.tx(async (t) => {
    const o = await getOpportunity(t, id);
    assert(o, 'Opportunité introuvable.');
    const stage = await t.get<Stage>('SELECT * FROM pipeline_stages WHERE id = ?', [stageId]);
    assert(stage, 'Étape introuvable.');
    let position: number;
    if (beforeId) {
      const before = await t.get<{ position: number }>('SELECT position FROM opportunities WHERE id = ?', [beforeId]);
      const prev = await t.get<{ position: number }>('SELECT MAX(position) AS position FROM opportunities WHERE stage_id = ? AND position < ? AND id <> ?', [stageId, before?.position ?? 0, id]);
      position = ((prev?.position ?? (before?.position ?? 1) - 1) + (before?.position ?? 1)) / 2;
    } else {
      const max = await t.get<{ p: number }>('SELECT COALESCE(MAX(position), 0) AS p FROM opportunities WHERE stage_id = ? AND id <> ?', [stageId, id]);
      position = (max?.p ?? 0) + 1;
    }
    const status = stage.kind === 'won' ? 'won' : stage.kind === 'lost' ? 'lost' : 'open';
    const probability = stage.kind === 'open' ? (o.stage_id === stageId ? o.probability : Math.max(o.probability, stage.default_probability)) : stage.default_probability;
    await t.run(
      `UPDATE opportunities SET stage_id = ?, position = ?, status = ?, probability = ?,
         closed_at = CASE WHEN ? = 'open' THEN NULL ELSE COALESCE(closed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [stageId, position, status, probability, status, id],
    );
    if (o.stage_id !== stageId) {
      const from = await t.get<{ name: string }>('SELECT name FROM pipeline_stages WHERE id = ?', [o.stage_id]);
      await logEvent(t, { entity: 'opportunite', id, action: 'changement_etape', summary: `« ${o.title} » : ${from?.name ?? '?'} → ${stage.name}`, companyId: o.company_id });
    }
    return { won: status === 'won' && o.status !== 'won', lost: status === 'lost', companyId: o.company_id };
  });
}

/**
 * Finalise le gain d'une opportunité (après confirmation de l'utilisateur) :
 * conversion du prospect en client et, si demandé, création du projet.
 */
export async function confirmWon(db: Db, id: number, opts: { createProject: boolean; projectName?: string; templateId?: number | null }): Promise<{ projectId: number | null }> {
  const o = await getOpportunity(db, id);
  assert(o, 'Opportunité introuvable.');
  await convertToClient(db, o.company_id, `opportunité gagnée : ${o.title}`);
  let projectId: number | null = null;
  if (opts.createProject) {
    const { createProject } = await import('./projects');
    projectId = await createProject(db, {
      company_id: o.company_id,
      name: opts.projectName?.trim() || o.title,
      opportunity_id: o.id,
      contract_amount_cents: o.amount_cents,
      template_id: opts.templateId ?? null,
    });
  }
  return { projectId };
}

export async function archiveOpportunity(db: Db, id: number): Promise<void> {
  const o = await getOpportunity(db, id);
  assert(o, 'Opportunité introuvable.');
  await db.run("UPDATE opportunities SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [id]);
  await logEvent(db, { entity: 'opportunite', id, action: 'archivage', summary: `Opportunité archivée : ${o.title}`, companyId: o.company_id });
}

export interface PipelineSummary {
  open_count: number;
  total_cents: number;
  weighted_cents: number;
  byStage: { stage_id: number; name: string; count: number; total_cents: number; weighted_cents: number }[];
}

export async function pipelineSummary(db: Db): Promise<PipelineSummary> {
  const rows = await db.all<any>(
    `SELECT s.id AS stage_id, s.name, s.position, COUNT(o.id) AS count,
       COALESCE(SUM(o.amount_cents), 0) AS total_cents,
       COALESCE(SUM(o.amount_cents * o.probability), 0) AS weighted_raw
     FROM pipeline_stages s LEFT JOIN opportunities o ON o.stage_id = s.id AND o.status = 'open' AND o.archived_at IS NULL
     WHERE s.archived_at IS NULL AND s.kind = 'open' GROUP BY s.id ORDER BY s.position`,
  );
  const byStage = rows.map((r) => ({ stage_id: r.stage_id, name: r.name, count: r.count, total_cents: r.total_cents, weighted_cents: Math.round(r.weighted_raw / 100) }));
  return {
    open_count: byStage.reduce((a, b) => a + b.count, 0),
    total_cents: byStage.reduce((a, b) => a + b.total_cents, 0),
    weighted_cents: byStage.reduce((a, b) => a + b.weighted_cents, 0),
    byStage,
  };
}
