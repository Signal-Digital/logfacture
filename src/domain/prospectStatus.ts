/**
 * Statut commercial des prospects : une seule échelle, qui suit le parcours
 * de vente, modifiable en un clic et mise à jour automatiquement par les devis
 * et le pipeline (devis en préparation, envoyé, signé, refusé…).
 */
import type { Db } from '@/lib/db';
import { BusinessError, assert } from './context';
import { logEvent } from './audit';

export type CommercialStatus =
  | 'nouveau' | 'a_contacter' | 'contacte' | 'rdv' | 'devis_en_cours' | 'devis_envoye' | 'client' | 'a_recontacter' | 'perdu';

export interface StatusDef {
  key: CommercialStatus;
  label: string;
  short: string;
  color: string;
  /** Position dans le parcours (étapes principales) ; null = statut de côté */
  step: number | null;
  hint: string;
}

export const COMMERCIAL_STATUS_DEFS: StatusDef[] = [
  { key: 'nouveau', label: 'Nouveau', short: 'Nouveau', color: '#94a3b8', step: 0, hint: 'Fiche créée, pas encore traitée' },
  { key: 'a_contacter', label: 'À contacter', short: 'À contacter', color: '#818cf8', step: 1, hint: 'Premier contact à faire' },
  { key: 'contacte', label: 'Contacté', short: 'Contacté', color: '#60a5fa', step: 2, hint: 'Échange en cours' },
  { key: 'rdv', label: 'Rendez-vous / audit', short: 'RDV / audit', color: '#22d3ee', step: 3, hint: 'Rendez-vous ou audit prévu ou réalisé' },
  { key: 'devis_en_cours', label: 'Devis en préparation', short: 'Devis en prépa.', color: '#f59e0b', step: 4, hint: 'Devis en brouillon' },
  { key: 'devis_envoye', label: 'Devis envoyé', short: 'Devis envoyé', color: '#f97316', step: 5, hint: 'En attente de la réponse ou de la signature' },
  { key: 'client', label: 'Gagné — client', short: 'Gagné', color: '#22c55e', step: 6, hint: 'Devis signé ou accepté' },
  { key: 'a_recontacter', label: 'À recontacter', short: 'À recontacter', color: '#a855f7', step: null, hint: 'Pas maintenant : relance planifiée' },
  { key: 'perdu', label: 'Perdu', short: 'Perdu', color: '#ef4444', step: null, hint: 'Pas intéressé, devis refusé…' },
];

export const MAIN_STEPS = COMMERCIAL_STATUS_DEFS.filter((d) => d.step != null);

export function statusDef(key: string | null | undefined): StatusDef {
  return COMMERCIAL_STATUS_DEFS.find((d) => d.key === key) ?? COMMERCIAL_STATUS_DEFS[0];
}

export const LOST_REASONS = ['Budget insuffisant', 'Pas de besoin actuellement', 'A choisi un concurrent', 'Pas de réponse', 'Devis refusé', 'Projet abandonné', 'Autre'];

export interface StatusChangeOptions {
  /** Motif (statut « Perdu ») */
  reason?: string | null;
  /** Date de relance (statut « À recontacter ») : crée une activité de relance */
  followUpDate?: string | null;
  /** Origine du changement, pour le journal */
  source?: string;
}

/** Changement manuel du statut commercial (un clic, glisser-déposer…). */
export async function setCommercialStatus(db: Db, companyId: number, status: CommercialStatus, opts: StatusChangeOptions = {}): Promise<void> {
  if (!COMMERCIAL_STATUS_DEFS.some((d) => d.key === status)) throw new BusinessError('Statut inconnu.');
  if (opts.followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(opts.followUpDate)) throw new BusinessError('Date de relance invalide.');
  await db.tx(async (t) => {
    const c = await t.get<any>('SELECT id, name, kind, commercial_status FROM companies WHERE id = ?', [companyId]);
    assert(c, 'Fiche introuvable.');
    if (status === 'client') {
      const { convertToClient } = await import('./companies');
      await convertToClient(t, companyId, 'statut « Gagné »');
    } else {
      await t.run(
        `UPDATE companies SET commercial_status = ?, lost_reason = ?, status_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        [status, status === 'perdu' ? opts.reason?.trim() || null : null, companyId],
      );
    }
    if (status === 'a_recontacter' && opts.followUpDate) {
      const { createActivity } = await import('./activities');
      await createActivity(t, { type: 'relance', title: `Recontacter ${c.name}`, company_id: companyId, due_at: `${opts.followUpDate}T09:00:00`, notes: opts.reason ?? null });
      await t.run('UPDATE companies SET next_action = ?, next_action_date = ? WHERE id = ?', [`Recontacter ${c.name}`, opts.followUpDate, companyId]);
    }
    if (c.commercial_status !== status) {
      await logEvent(t, {
        entity: 'entreprise', id: companyId, action: 'statut',
        summary: `Statut : ${statusDef(c.commercial_status).label} → ${statusDef(status).label}${status === 'perdu' && opts.reason ? ` (${opts.reason.trim()})` : ''}${opts.followUpDate ? ` — relance le ${opts.followUpDate.split('-').reverse().join('/')}` : ''}`,
        companyId,
      });
    }
  });
}

/**
 * Mise à jour automatique déclenchée par un événement (devis, pipeline).
 * Le statut n'avance que dans le sens du parcours : il ne recule jamais sur
 * une action automatique, sauf pour « réveiller » une fiche perdue ou à
 * recontacter quand un nouveau devis est préparé. « Gagné » n'est jamais
 * modifié automatiquement.
 */
export async function autoStatus(db: Db, companyId: number, target: CommercialStatus, reason: string): Promise<void> {
  const c = await db.get<{ commercial_status: string }>('SELECT commercial_status FROM companies WHERE id = ?', [companyId]);
  if (!c || c.commercial_status === target || c.commercial_status === 'client') return;
  const cur = statusDef(c.commercial_status);
  const tgt = statusDef(target);
  let apply = false;
  if (target === 'perdu' || target === 'a_recontacter') {
    // Seulement si plus aucun devis n'est en cours pour ce prospect.
    const open = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM quotes WHERE company_id = ? AND status IN ('brouillon','envoye','attente_signature') AND archived_at IS NULL", [companyId]);
    apply = (open?.n ?? 0) === 0 && (cur.key === 'devis_envoye' || cur.key === 'devis_en_cours');
  } else if (cur.step == null) {
    apply = true; // réveil d'une fiche perdue / à recontacter
  } else {
    apply = (tgt.step ?? -1) > cur.step;
  }
  if (!apply) return;
  await db.run(
    `UPDATE companies SET commercial_status = ?, lost_reason = ?, status_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [target, target === 'perdu' ? reason : null, companyId],
  );
  await logEvent(db, { entity: 'entreprise', id: companyId, action: 'statut_auto', summary: `Statut mis à jour automatiquement : ${cur.label} → ${tgt.label} (${reason})`, companyId });
}

export async function statusCounts(db: Db, kind: string | string[] | undefined): Promise<Record<string, number>> {
  const kinds = kind ? (Array.isArray(kind) ? kind : [kind]) : null;
  const rows = await db.all<{ s: string; n: number }>(
    `SELECT commercial_status AS s, COUNT(*) AS n FROM companies WHERE archived_at IS NULL AND merged_into_id IS NULL
     ${kinds ? `AND kind IN (${kinds.map(() => '?').join(',')})` : ''} GROUP BY commercial_status`,
    kinds ?? [],
  );
  return Object.fromEntries(rows.map((r) => [r.s, r.n]));
}
