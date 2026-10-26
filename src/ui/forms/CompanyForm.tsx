import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button, Field, Modal } from '../components/ui';
import { MoneyInput, DateInput } from '../components/inputs';
import { useApp } from '../core/app';
import {
  COMMERCIAL_STATUSES, SOURCES, createCompany, createContact, findDuplicates, updateCompany, validateCompany,
  type Company, type CompanyInput, type CompanyKind, type DuplicateMatch,
} from '@/domain/companies';

export function CompanyFormModal({ company, kind = 'prospect', onClose, onSaved, navigateOnCreate = true }: { company?: Company; kind?: CompanyKind; onClose: () => void; onSaved?: (id: number) => void; navigateOnCreate?: boolean }) {
  const { ctx, run } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState<CompanyInput>(() => (company ? { ...company } : { name: '', kind, country: 'France', commercial_status: kind === 'client' ? 'client' : 'nouveau', potential_cents: 0 }));
  const [contact, setContact] = useState({ first_name: '', last_name: '', job_title: '', email: '', phone: '' });
  const [dups, setDups] = useState<DuplicateMatch[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: keyof CompanyInput, v: any) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!f.name?.trim() && !f.email && !f.phone && !f.website) return setDups([]);
      setDups(await findDuplicates(ctx.db, f, company?.id));
    }, 300);
    return () => clearTimeout(t);
  }, [f.name, f.email, f.phone, f.website, f.siret, ctx.db, company?.id]);

  const save = async () => {
    const errs = validateCompany(f);
    if (!f.name?.trim()) errs.unshift("Le nom de l'entreprise est obligatoire.");
    setErrors(errs);
    if (errs.length) return;
    const id = await run(async () => {
      if (company) {
        await updateCompany(ctx.db, company.id, f);
        return company.id;
      }
      const newId = await createCompany(ctx.db, f);
      if (contact.last_name.trim() || contact.first_name.trim()) {
        await createContact(ctx.db, { ...contact, company_id: newId, is_primary: 1 });
      }
      return newId;
    }, company ? 'Fiche enregistrée' : `${f.kind === 'client' ? 'Client' : 'Prospect'} créé`);
    if (id) {
      onSaved?.(id);
      onClose();
      if (!company && navigateOnCreate) nav(`/entreprises/${id}`);
    }
  };

  return (
    <Modal
      title={company ? `Modifier « ${company.name} »` : f.kind === 'client' ? 'Nouveau client' : 'Nouveau prospect'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={save}>{company ? 'Enregistrer' : 'Créer la fiche'}</Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        {errors.length > 0 && (
          <div className="alert danger">
            <AlertTriangle />
            <ul style={{ margin: 0, paddingLeft: 16 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {dups.length > 0 && (
          <div className="alert warning">
            <AlertTriangle />
            <div className="grow">
              <div className="strong">Doublon potentiel</div>
              {dups.slice(0, 3).map((d) => (
                <div key={d.company.id} className="small">
                  <a href={`#/entreprises/${d.company.id}`} onClick={onClose}>{d.company.name}</a> — {d.reasons.join(', ')}
                </div>
              ))}
              <div className="small muted">Vous pouvez continuer ; une fusion reste possible depuis la fiche.</div>
            </div>
          </div>
        )}
        <div className="form-grid">
          <div className="form-section">Entreprise</div>
          <Field label="Nom de l'entreprise" required className="span-2">
            <input className="input" autoFocus value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Type">
            <select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)} disabled={!!company}>
              <option value="prospect">Prospect</option>
              <option value="client">Client</option>
              <option value="partenaire">Partenaire</option>
              <option value="ancien_client">Ancien client</option>
            </select>
          </Field>
          <Field label="Secteur d'activité">
            <input className="input" value={f.sector ?? ''} onChange={(e) => set('sector', e.target.value)} placeholder="Restauration, artisanat…" />
          </Field>
          <Field label="Adresse" className="span-2">
            <input className="input" value={f.address_line1 ?? ''} onChange={(e) => set('address_line1', e.target.value)} />
          </Field>
          <Field label="Code postal">
            <input className="input" value={f.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} />
          </Field>
          <Field label="Ville">
            <input className="input" value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="Téléphone">
            <input className="input" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Site Internet">
            <input className="input" value={f.website ?? ''} onChange={(e) => set('website', e.target.value)} placeholder="www.exemple.fr" />
          </Field>
          <Field label="URL Google Business Profile">
            <input className="input" value={f.gbp_url ?? ''} onChange={(e) => set('gbp_url', e.target.value)} placeholder="https://g.page/…" />
          </Field>
          <Field label="SIRET" help="14 chiffres — utile pour les factures entre professionnels">
            <input className="input" value={f.siret ?? ''} onChange={(e) => set('siret', e.target.value)} />
          </Field>
          <Field label="N° TVA intracommunautaire">
            <input className="input" value={f.vat_number ?? ''} onChange={(e) => set('vat_number', e.target.value)} />
          </Field>
          <label className="check span-2">
            <input type="checkbox" checked={!!f.is_individual} onChange={(e) => set('is_individual', e.target.checked ? 1 : 0)} /> Particulier (client non professionnel)
          </label>

          <div className="form-section">Suivi commercial</div>
          <Field label="Statut commercial">
            <select className="input" value={f.commercial_status ?? 'nouveau'} onChange={(e) => set('commercial_status', e.target.value)}>
              {COMMERCIAL_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Source du prospect">
            <input className="input" list="sources" value={f.source ?? ''} onChange={(e) => set('source', e.target.value)} />
            <datalist id="sources">{SOURCES.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Potentiel commercial estimé">
            <MoneyInput value={f.potential_cents ?? 0} onChange={(v) => set('potential_cents', v)} />
          </Field>
          <Field label="Date de relance">
            <DateInput value={f.next_action_date} onChange={(v) => set('next_action_date', v)} />
          </Field>
          <Field label="Prochaine action" className="span-2">
            <input className="input" value={f.next_action ?? ''} onChange={(e) => set('next_action', e.target.value)} placeholder="Rappeler pour proposer un audit gratuit" />
          </Field>
          <Field label="Notes internes" className="span-2">
            <textarea className="input" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>

          {!company && (
            <>
              <div className="form-section">Contact principal (facultatif)</div>
              <Field label="Prénom">
                <input className="input" value={contact.first_name} onChange={(e) => setContact({ ...contact, first_name: e.target.value })} />
              </Field>
              <Field label="Nom">
                <input className="input" value={contact.last_name} onChange={(e) => setContact({ ...contact, last_name: e.target.value })} />
              </Field>
              <Field label="Fonction">
                <input className="input" value={contact.job_title} onChange={(e) => setContact({ ...contact, job_title: e.target.value })} />
              </Field>
              <Field label="Email du contact">
                <input className="input" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
              </Field>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
