/**
 * Préparation d'un email à partir d'un modèle : prévisualisation, copie,
 * ouverture dans la messagerie du poste. Aucun envoi automatique.
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy, Mail } from 'lucide-react';
import { Alert, Button, Field, Modal } from '../components/ui';
import { useApp, useData } from '../core/app';
import { listEmailTemplates, mailtoLink, mergeTemplate, unresolvedFields } from '@/domain/emails';
import { logEvent } from '@/domain/audit';
import { contactFullName, type Company, type Contact } from '@/domain/companies';
import { formatDate, formatEuro } from '@/lib/format';
import { sellerDisplayName, type AllSettings } from '@/domain/settings';

export interface EmailContext {
  company?: Pick<Company, 'id' | 'name' | 'email'> | null;
  contact?: Pick<Contact, 'first_name' | 'last_name' | 'email'> | null;
  document?: { numero?: string | null; objet?: string; date?: string | null; date_echeance?: string | null; date_validite?: string | null; total_ht?: number; total_ttc?: number; reste_du?: number };
  projet?: { nom: string };
}

export function emailValues(s: AllSettings, c: EmailContext): Record<string, string> {
  return {
    'client.nom': c.company?.name ?? '',
    'contact.prenom': c.contact?.first_name || (c.contact ? '' : 'Madame, Monsieur'),
    'contact.nom': c.contact?.last_name ?? '',
    'contact.nom_complet': contactFullName(c.contact ?? null),
    'document.numero': c.document?.numero ?? '',
    'document.objet': c.document?.objet ?? '',
    'document.date': formatDate(c.document?.date),
    'document.date_echeance': formatDate(c.document?.date_echeance),
    'document.date_validite': formatDate(c.document?.date_validite),
    'totaux.total_ht': c.document?.total_ht != null ? formatEuro(c.document.total_ht) : '',
    'totaux.total_ttc': c.document?.total_ttc != null ? formatEuro(c.document.total_ttc) : '',
    'totaux.reste_du': c.document?.reste_du != null ? formatEuro(c.document.reste_du) : '',
    'projet.nom': c.projet?.nom ?? '',
    'entreprise.nom': s.company.trade_name,
    'entreprise.dirigeant': s.company.manager,
    'entreprise.denomination': sellerDisplayName(s.company),
    'paiement.iban': s.payment.iban,
    'paiement.bic': s.payment.bic,
    signature: s.email.signature,
  };
}

export function EmailComposer({
  context,
  templateKey,
  categories,
  onClose,
  onPrepared,
  attachmentHint,
}: {
  context: EmailContext;
  templateKey?: string;
  categories?: string[];
  onClose: () => void;
  onPrepared?: (channel: 'copie' | 'messagerie', subject: string, body: string) => Promise<void> | void;
  attachmentHint?: string;
}) {
  const { ctx, settings, platform, toast } = useApp();
  const { data: templates } = useData((c) => listEmailTemplates(c.db));
  const list = useMemo(() => (templates ?? []).filter((t) => !categories || categories.includes(t.category)), [templates, categories]);
  const [key, setKey] = useState(templateKey ?? '');
  const [to, setTo] = useState(context.contact?.email || context.company?.email || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const values = useMemo(() => emailValues(settings, context), [settings, context]);

  useEffect(() => {
    if (!list.length) return;
    const t = list.find((x) => x.key === key) ?? list[0];
    if (t.key !== key) setKey(t.key);
    setSubject(mergeTemplate(t.subject, values));
    setBody(mergeTemplate(t.body, values));
  }, [key, list, values]);

  const missing = unresolvedFields(subject + body);
  const log = async (channel: 'copie' | 'messagerie') => {
    await onPrepared?.(channel, subject, body);
    if (context.company?.id) {
      await logEvent(ctx.db, { entity: 'email', action: channel, summary: `Email préparé (${channel === 'copie' ? 'texte copié' : 'ouvert dans la messagerie'}) : ${subject}`, companyId: context.company.id });
    }
  };

  return (
    <Modal
      title="Préparer un email"
      subtitle="Aucun message n'est envoyé automatiquement : copiez le texte ou ouvrez-le dans votre messagerie."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Fermer</Button>
          <Button icon={Copy} onClick={async () => { await platform.copyText(`${subject}\n\n${body}`); await log('copie'); toast('Texte copié dans le presse-papiers', 'success'); }}>Copier le texte</Button>
          <Button variant="primary" icon={Mail} disabled={!to} onClick={async () => { await platform.openUrl(mailtoLink(to, subject, body)); await log('messagerie'); onClose(); }}>Ouvrir dans la messagerie</Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="form-grid">
          <Field label="Modèle">
            <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
              {list.map((t) => <option key={t.key} value={t.key}>{t.category} — {t.name}</option>)}
            </select>
          </Field>
          <Field label="Destinataire">
            <input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@client.fr" />
          </Field>
          <Field label="Objet" className="span-2">
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Message" className="span-2">
            <textarea className="input" rows={13} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </div>
        {missing.length > 0 && <Alert tone="warning">Champs non remplis : {missing.map((m) => `{{${m}}}`).join(', ')}</Alert>}
        {attachmentHint && <Alert tone="info">{attachmentHint}</Alert>}
      </div>
    </Modal>
  );
}
