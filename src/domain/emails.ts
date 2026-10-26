/**
 * Modèles d'emails et fusion des champs dynamiques.
 *
 * Aucun envoi n'est réalisé sans action explicite : par défaut, le message
 * est prévisualisé puis copié ou ouvert dans la messagerie du poste (mailto:).
 */
import type { Db } from '@/lib/db';
import { BusinessError } from './context';

export interface EmailTemplate {
  id: number;
  key: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  updated_at: string;
}

export const DEFAULT_EMAIL_TEMPLATES: Omit<EmailTemplate, 'id' | 'updated_at'>[] = [
  {
    key: 'premier_contact', name: 'Premier contact', category: 'Prospection',
    subject: 'Améliorer la visibilité de {{client.nom}} sur Internet',
    body: `Bonjour {{contact.prenom}},

Je me permets de vous contacter au sujet de la présence en ligne de {{client.nom}}.

Je suis {{entreprise.dirigeant}}, de {{entreprise.nom}}. J'accompagne les entreprises locales pour gagner en visibilité sur Google (référencement naturel, fiche Google Business Profile, site Internet).

Seriez-vous disponible pour un échange de 15 minutes cette semaine ?

Bien cordialement,
{{signature}}`,
  },
  {
    key: 'relance_commerciale', name: 'Relance commerciale', category: 'Prospection',
    subject: 'Suite à notre échange — {{client.nom}}',
    body: `Bonjour {{contact.prenom}},

Je reviens vers vous suite à notre dernier échange. Avez-vous eu le temps de réfléchir à notre proposition ?

Je reste à votre disposition pour en discuter.

Bien cordialement,
{{signature}}`,
  },
  {
    key: 'audit_gratuit', name: "Proposition d'audit gratuit", category: 'Prospection',
    subject: 'Audit gratuit de votre visibilité en ligne',
    body: `Bonjour {{contact.prenom}},

Je vous propose de réaliser gratuitement un audit de la visibilité en ligne de {{client.nom}} : référencement de votre site, fiche Google Business Profile et positionnement face à vos concurrents.

L'audit est sans engagement et je vous le présente en 20 minutes.

Quelles sont vos disponibilités ?

Bien cordialement,
{{signature}}`,
  },
  {
    key: 'envoi_devis', name: 'Envoi de devis', category: 'Devis',
    subject: 'Devis {{document.numero}} — {{document.objet}}',
    body: `Bonjour {{contact.prenom}},

Veuillez trouver ci-joint notre devis n° {{document.numero}} d'un montant de {{totaux.total_ttc}} TTC ({{totaux.total_ht}} HT), valable jusqu'au {{document.date_validite}}.

Je reste à votre disposition pour toute question.

Bien cordialement,
{{signature}}`,
  },
  {
    key: 'confirmation_signature', name: 'Confirmation de signature', category: 'Devis',
    subject: 'Confirmation de votre accord — devis {{document.numero}}',
    body: `Bonjour {{contact.prenom}},

Je vous confirme la bonne réception de votre accord signé pour le devis n° {{document.numero}}. Vous trouverez ci-joint la version signée.

Je reviens vers vous très prochainement pour démarrer le projet.

Merci pour votre confiance,
{{signature}}`,
  },
  {
    key: 'suivi_projet', name: 'Suivi de projet', category: 'Projets',
    subject: 'Point d\'avancement — {{projet.nom}}',
    body: `Bonjour {{contact.prenom}},

Voici un point d'avancement sur le projet « {{projet.nom}} ».

[Détaillez ici les étapes réalisées et les prochaines étapes]

Bien cordialement,
{{signature}}`,
  },
  {
    key: 'envoi_facture', name: 'Envoi de facture', category: 'Factures',
    subject: 'Facture {{document.numero}}',
    body: `Bonjour {{contact.prenom}},

Veuillez trouver ci-joint la facture n° {{document.numero}} d'un montant de {{totaux.total_ttc}}, à régler avant le {{document.date_echeance}}.

Coordonnées bancaires : IBAN {{paiement.iban}} — BIC {{paiement.bic}}.

Merci pour votre confiance,
{{signature}}`,
  },
  {
    key: 'relance_avant_echeance', name: 'Rappel avant échéance', category: 'Relances de paiement',
    subject: 'Rappel : facture {{document.numero}} à échéance le {{document.date_echeance}}',
    body: `Bonjour {{contact.prenom}},

Pour rappel, la facture n° {{document.numero}} d'un montant de {{totaux.reste_du}} arrive à échéance le {{document.date_echeance}}.

Si le règlement a déjà été effectué, merci de ne pas tenir compte de ce message.

Bien cordialement,
{{signature}}`,
  },
  {
    key: 'relance_paiement_1', name: 'Première relance', category: 'Relances de paiement',
    subject: 'Facture {{document.numero}} — paiement en attente',
    body: `Bonjour {{contact.prenom}},

Sauf erreur de notre part, la facture n° {{document.numero}} du {{document.date}}, échue le {{document.date_echeance}}, reste impayée pour un montant de {{totaux.reste_du}}.

Pourriez-vous procéder à son règlement dans les meilleurs délais ? IBAN : {{paiement.iban}}.

Si le paiement a été effectué entre-temps, merci de ne pas tenir compte de ce message.

Bien cordialement,
{{signature}}`,
  },
  {
    key: 'relance_paiement_finale', name: 'Relance finale', category: 'Relances de paiement',
    subject: 'Dernière relance avant mise en demeure — facture {{document.numero}}',
    body: `Bonjour {{contact.prenom}},

Malgré nos précédentes relances, la facture n° {{document.numero}}, échue depuis le {{document.date_echeance}}, reste impayée pour un montant de {{totaux.reste_du}}.

Sans règlement de votre part sous 8 jours, nous serons contraints d'engager une procédure de recouvrement. Nous vous rappelons que des pénalités de retard et, pour les professionnels, une indemnité forfaitaire de 40 € sont exigibles.

Bien cordialement,
{{signature}}`,
  },
  {
    key: 'demande_avis', name: "Demande d'avis client", category: 'Fidélisation',
    subject: 'Votre avis compte pour nous',
    body: `Bonjour {{contact.prenom}},

Merci encore pour votre confiance. Si vous êtes satisfait de notre collaboration, pourriez-vous prendre une minute pour laisser un avis ? Cela nous aide énormément.

[Lien vers votre fiche Google]

Bien cordialement,
{{signature}}`,
  },
];

export const EMAIL_FIELDS: { key: string; label: string }[] = [
  { key: 'client.nom', label: 'Nom du client' },
  { key: 'contact.prenom', label: 'Prénom du contact' },
  { key: 'contact.nom', label: 'Nom du contact' },
  { key: 'contact.nom_complet', label: 'Nom complet du contact' },
  { key: 'document.numero', label: 'Numéro du document' },
  { key: 'document.objet', label: 'Objet du document' },
  { key: 'document.date', label: 'Date du document' },
  { key: 'document.date_echeance', label: "Date d'échéance" },
  { key: 'document.date_validite', label: 'Date de validité' },
  { key: 'totaux.total_ht', label: 'Total HT' },
  { key: 'totaux.total_ttc', label: 'Total TTC' },
  { key: 'totaux.reste_du', label: 'Reste dû' },
  { key: 'projet.nom', label: 'Nom du projet' },
  { key: 'entreprise.nom', label: 'Votre entreprise' },
  { key: 'entreprise.dirigeant', label: 'Dirigeant' },
  { key: 'paiement.iban', label: 'IBAN' },
  { key: 'paiement.bic', label: 'BIC' },
  { key: 'signature', label: 'Signature email' },
];

/** Remplace {{cle}} par sa valeur ; les clés inconnues restent visibles pour être repérées. */
export function mergeTemplate(text: string, values: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (m, key: string) => {
    const v = values[key.toLowerCase()];
    return v == null || v === '' ? (key in values ? '' : m) : v;
  });
}

export function unresolvedFields(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([a-z_.]+)\s*\}\}/gi)].map((m) => m[1]))];
}

/** Lien mailto: (ouverture dans la messagerie du poste, sans envoi automatique). */
export function mailtoLink(to: string, subject: string, body: string): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '%20');
  return `mailto:${encodeURIComponent(to)}?subject=${enc(subject)}&body=${enc(body.replace(/\r?\n/g, '\r\n'))}`;
}

export async function listEmailTemplates(db: Db): Promise<EmailTemplate[]> {
  return db.all<EmailTemplate>('SELECT * FROM email_templates ORDER BY category, name');
}

export async function getEmailTemplate(db: Db, key: string): Promise<EmailTemplate | undefined> {
  return db.get<EmailTemplate>('SELECT * FROM email_templates WHERE key = ?', [key]);
}

export async function saveEmailTemplate(db: Db, t: { id?: number; key?: string; name: string; category: string; subject: string; body: string }): Promise<number> {
  if (!t.name.trim() || !t.subject.trim() || !t.body.trim()) throw new BusinessError('Nom, objet et contenu sont obligatoires.');
  if (t.id) {
    await db.run("UPDATE email_templates SET name = ?, category = ?, subject = ?, body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [t.name, t.category, t.subject, t.body, t.id]);
    return t.id;
  }
  const key = t.key ?? `perso_${Date.now()}`;
  return (await db.run('INSERT INTO email_templates (key, name, category, subject, body) VALUES (?, ?, ?, ?, ?)', [key, t.name, t.category, t.subject, t.body])).lastInsertId;
}

export async function resetEmailTemplate(db: Db, key: string): Promise<void> {
  const def = DEFAULT_EMAIL_TEMPLATES.find((d) => d.key === key);
  if (!def) throw new BusinessError('Modèle par défaut introuvable.');
  await db.run("UPDATE email_templates SET name = ?, category = ?, subject = ?, body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = ?", [def.name, def.category, def.subject, def.body, key]);
}

export async function deleteEmailTemplate(db: Db, id: number): Promise<void> {
  const t = await db.get<EmailTemplate>('SELECT * FROM email_templates WHERE id = ?', [id]);
  if (t && DEFAULT_EMAIL_TEMPLATES.some((d) => d.key === t.key)) throw new BusinessError('Les modèles fournis peuvent être modifiés ou réinitialisés, mais pas supprimés.');
  await db.run('DELETE FROM email_templates WHERE id = ?', [id]);
}
