/** Notifications calculées à partir des données (aucun service externe). */
import type { Db } from '@/lib/db';
import { activityCounts } from './activities';
import { duePeriods } from './contracts';
import { listInvoices } from './invoices';
import { checkAdministrativeSetup, getAllSettings } from './settings';
import { addDays, today } from '@/lib/format';

export interface Notice {
  key: string;
  level: 'info' | 'warning' | 'danger';
  title: string;
  detail: string;
  route: string;
}

export async function computeNotices(db: Db): Promise<Notice[]> {
  const out: Notice[] = [];
  const settings = await getAllSettings(db);
  const admin = checkAdministrativeSetup(settings).filter((i) => i.severity === 'bloquant');
  if (admin.length) {
    out.push({ key: 'admin', level: 'warning', title: 'Configuration administrative incomplète', detail: `${admin.length} information(s) obligatoire(s) manquante(s) avant d'émettre devis et factures.`, route: '/parametres' });
  }
  const acts = await activityCounts(db);
  if (acts.late) out.push({ key: 'late', level: 'danger', title: `${acts.late} tâche(s) ou relance(s) en retard`, detail: 'À traiter ou à replanifier.', route: '/activites?vue=retard' });
  if (acts.today) out.push({ key: 'today', level: 'info', title: `${acts.today} action(s) prévue(s) aujourd'hui`, detail: 'Appels, relances, rendez-vous et tâches du jour.', route: '/activites?vue=jour' });
  const invoices = await listInvoices(db, {});
  const overdue = invoices.filter((i) => i.display_status === 'en_retard');
  if (overdue.length) out.push({ key: 'overdue', level: 'danger', title: `${overdue.length} facture(s) en retard de paiement`, detail: 'Préparez une relance depuis la fiche facture.', route: '/factures?statut=en_retard' });
  const soon = invoices.filter((i) => i.display_status === 'emise' && i.due_date && i.due_date >= today() && i.due_date <= addDays(today(), 5));
  if (soon.length) out.push({ key: 'soon', level: 'info', title: `${soon.length} facture(s) à échéance dans 5 jours`, detail: 'Un rappel avant échéance peut être préparé.', route: '/factures' });
  const drafts = invoices.filter((i) => i.status === 'brouillon');
  if (drafts.length) out.push({ key: 'drafts', level: 'info', title: `${drafts.length} facture(s) en brouillon`, detail: 'Brouillons non émis.', route: '/factures?statut=brouillon' });
  const expiring = await db.all<any>("SELECT id FROM quotes WHERE status IN ('envoye','attente_signature') AND validity_date BETWEEN ? AND ?", [today(), addDays(today(), 7)]);
  if (expiring.length) out.push({ key: 'quotes', level: 'warning', title: `${expiring.length} devis expire(nt) dans 7 jours`, detail: 'Pensez à relancer le client.', route: '/devis?statut=envoye' });
  const periods = await duePeriods(db);
  if (periods.length) out.push({ key: 'recurring', level: 'warning', title: `${periods.length} facture(s) récurrente(s) à préparer`, detail: 'Contrats dont l\'échéance de facturation est atteinte.', route: '/contrats' });
  const b = settings.backup;
  const lastBackup = await db.get<{ at: string }>("SELECT MAX(at) AS at FROM audit_log WHERE entity_type = 'sauvegarde' AND action = 'creation'");
  const last = lastBackup?.at ?? b.last_auto_at;
  if (!last || Date.now() - new Date(last).getTime() > 7 * 86400000) {
    out.push({ key: 'backup', level: 'warning', title: last ? 'Dernière sauvegarde il y a plus de 7 jours' : 'Aucune sauvegarde effectuée', detail: 'Sauvegardez vos données sur un disque externe.', route: '/parametres/sauvegardes' });
  }
  return out;
}
