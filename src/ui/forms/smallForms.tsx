/** Formulaires courts : contact, activité, opportunité. */
import { useState } from 'react';
import { Button, Field, Modal } from '../components/ui';
import { CompanyPicker, ContactSelect, DateInput, DateTimeInput, MoneyInput } from '../components/inputs';
import { useApp, useData } from '../core/app';
import { createContact, updateContact, type Contact, type ContactInput } from '@/domain/companies';
import { ACTIVITY_TYPES, PRIORITIES, ACTIVITY_STATUSES, createActivity, updateActivity, type Activity, type ActivityInput } from '@/domain/activities';
import { createOpportunity, listStages, updateOpportunity, type Opportunity, type OpportunityInput } from '@/domain/pipeline';
import { addDays, today } from '@/lib/format';

export function ContactFormModal({ contact, companyId, onClose }: { contact?: Contact; companyId?: number | null; onClose: () => void }) {
  const { ctx, run } = useApp();
  const [f, setF] = useState<ContactInput>(contact ? { ...contact } : { company_id: companyId ?? null, first_name: '', last_name: '' });
  const set = (k: keyof ContactInput, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const ok = await run(async () => {
      if (contact) await updateContact(ctx.db, contact.id, f);
      else await createContact(ctx.db, f);
      return true;
    }, 'Contact enregistré');
    if (ok) onClose();
  };
  return (
    <Modal title={contact ? 'Modifier le contact' : 'Nouveau contact'} onClose={onClose} footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={save}>Enregistrer</Button></>}>
      <div className="form-grid">
        {!companyId && (
          <Field label="Entreprise" className="span-2">
            <CompanyPicker value={f.company_id ?? null} onChange={(id) => set('company_id', id)} />
          </Field>
        )}
        <Field label="Prénom"><input className="input" autoFocus value={f.first_name ?? ''} onChange={(e) => set('first_name', e.target.value)} /></Field>
        <Field label="Nom" required><input className="input" value={f.last_name ?? ''} onChange={(e) => set('last_name', e.target.value)} /></Field>
        <Field label="Fonction"><input className="input" value={f.job_title ?? ''} onChange={(e) => set('job_title', e.target.value)} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Téléphone"><input className="input" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Mobile"><input className="input" value={f.mobile ?? ''} onChange={(e) => set('mobile', e.target.value)} /></Field>
        <label className="check span-2"><input type="checkbox" checked={!!f.is_primary} onChange={(e) => set('is_primary', e.target.checked ? 1 : 0)} /> Contact principal</label>
        <Field label="Notes" className="span-2"><textarea className="input" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function ActivityFormModal({ activity, preset, onClose }: { activity?: Activity; preset?: Partial<ActivityInput>; onClose: () => void }) {
  const { ctx, run } = useApp();
  const [f, setF] = useState<ActivityInput>(() =>
    activity ? { ...activity } : { type: 'relance', title: '', priority: 'normale', status: 'a_faire', due_at: `${addDays(today(), 1)}T09:00:00`, ...preset },
  );
  const set = (k: keyof ActivityInput, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const ok = await run(async () => {
      if (activity) await updateActivity(ctx.db, activity.id, f);
      else await createActivity(ctx.db, f);
      return true;
    }, activity ? 'Activité enregistrée' : 'Activité créée');
    if (ok) onClose();
  };
  const isNote = f.type === 'note';
  return (
    <Modal title={activity ? 'Modifier l\'activité' : 'Nouvelle activité'} onClose={onClose} size="lg" footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={save}>Enregistrer</Button></>}>
      <div className="form-grid">
        <div className="span-2 row wrap" style={{ gap: 6 }}>
          {ACTIVITY_TYPES.map((t) => (
            <button key={t.key} className={`chip ${f.type === t.key ? 'on' : ''}`} onClick={() => set('type', t.key)}>{t.label}</button>
          ))}
        </div>
        <Field label="Intitulé" required className="span-2">
          <input className="input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} placeholder={isNote ? 'Compte rendu d\'appel…' : 'Relancer pour le devis'} />
        </Field>
        {!preset?.company_id && !preset?.project_id && (
          <Field label="Entreprise" className="span-2">
            <CompanyPicker value={f.company_id ?? null} onChange={(id) => set('company_id', id)} />
          </Field>
        )}
        {(f.company_id ?? null) !== null && (
          <Field label="Contact">
            <ContactSelect companyId={f.company_id ?? null} value={f.contact_id ?? null} onChange={(id) => set('contact_id', id)} />
          </Field>
        )}
        {!isNote && (
          <>
            <Field label="Date et heure / échéance">
              <DateTimeInput value={f.due_at} onChange={(v) => set('due_at', v)} />
            </Field>
            <Field label="Priorité">
              <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value)}>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Statut">
              <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
                {ACTIVITY_STATUSES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Rappel local" help="Notification Windows à cette date (application ouverte)">
              <DateTimeInput value={f.remind_at} onChange={(v) => set('remind_at', v)} />
            </Field>
            <Field label="Durée (minutes)">
              <input className="input num" type="number" min={0} value={f.duration_min ?? ''} onChange={(e) => set('duration_min', e.target.value ? Number(e.target.value) : null)} />
            </Field>
          </>
        )}
        <Field label="Notes" className="span-2">
          <textarea className="input" rows={5} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function OpportunityFormModal({ opportunity, preset, onClose }: { opportunity?: Opportunity; preset?: Partial<OpportunityInput>; onClose: () => void }) {
  const { ctx, run } = useApp();
  const { data: stages } = useData((c) => listStages(c.db));
  const [f, setF] = useState<OpportunityInput>(() => (opportunity ? { ...opportunity } : { company_id: 0, title: '', amount_cents: 0, probability: 10, ...preset }));
  const set = (k: keyof OpportunityInput, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const ok = await run(async () => {
      if (opportunity) await updateOpportunity(ctx.db, opportunity.id, f);
      else await createOpportunity(ctx.db, f);
      return true;
    }, 'Opportunité enregistrée');
    if (ok) onClose();
  };
  return (
    <Modal title={opportunity ? 'Modifier l\'opportunité' : 'Nouvelle opportunité'} onClose={onClose} size="lg" footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={save}>Enregistrer</Button></>}>
      <div className="form-grid">
        <Field label="Intitulé" required className="span-2"><input className="input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Refonte du site Internet" /></Field>
        <Field label="Entreprise" required className="span-2"><CompanyPicker value={f.company_id || null} onChange={(id) => set('company_id', id ?? 0)} /></Field>
        <Field label="Contact"><ContactSelect companyId={f.company_id || null} value={f.contact_id ?? null} onChange={(id) => set('contact_id', id)} /></Field>
        {!opportunity && (
          <Field label="Étape">
            <select className="input" value={f.stage_id ?? ''} onChange={(e) => {
              const st = stages?.find((s) => s.id === Number(e.target.value));
              setF((x) => ({ ...x, stage_id: st?.id, probability: st?.default_probability ?? x.probability }));
            }}>
              <option value="">Première étape</option>
              {stages?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Montant estimé (HT)"><MoneyInput value={f.amount_cents ?? 0} onChange={(v) => set('amount_cents', v)} /></Field>
        <Field label="Probabilité de conversion">
          <div className="row"><input type="range" min={0} max={100} step={5} value={f.probability ?? 0} onChange={(e) => set('probability', Number(e.target.value))} className="grow" /><span className="strong" style={{ width: 44 }}>{f.probability} %</span></div>
        </Field>
        <Field label="Date de clôture estimée"><DateInput value={f.expected_close_date} onChange={(v) => set('expected_close_date', v)} /></Field>
        <Field label="Notes" className="span-2"><textarea className="input" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
