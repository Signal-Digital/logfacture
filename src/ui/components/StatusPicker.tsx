/** Changement du statut commercial en un clic : pastille, menu, frise d'étapes. */
import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useApp } from '../core/app';
import { Button, Dropdown, Field, Modal } from './ui';
import { DateInput } from './inputs';
import {
  COMMERCIAL_STATUS_DEFS, LOST_REASONS, MAIN_STEPS, setCommercialStatus, statusDef, type CommercialStatus,
} from '@/domain/prospectStatus';
import { addDays, today } from '@/lib/format';

export function StatusPill({ status, size }: { status: string; size?: 'sm' }) {
  const d = statusDef(status);
  return (
    <span className="status-pill" style={{ ['--c' as any]: d.color, fontSize: size === 'sm' ? 11.5 : undefined }}>
      <i />
      {d.short}
    </span>
  );
}

/** Demande les précisions nécessaires (motif de perte, date de relance) puis applique le statut. */
export function useStatusChange() {
  const { ctx, run } = useApp();
  const [pending, setPending] = useState<{ companyId: number; name: string; status: CommercialStatus } | null>(null);
  const change = async (companyId: number, name: string, status: CommercialStatus) => {
    if (status === 'perdu' || status === 'a_recontacter') setPending({ companyId, name, status });
    else await run(() => setCommercialStatus(ctx.db, companyId, status), `${name} : ${statusDef(status).label}`);
  };
  const dialog = pending ? <StatusDetailsModal {...pending} onClose={() => setPending(null)} /> : null;
  return { change, dialog };
}

function StatusDetailsModal({ companyId, name, status, onClose }: { companyId: number; name: string; status: CommercialStatus; onClose: () => void }) {
  const { ctx, run } = useApp();
  const lost = status === 'perdu';
  const [reason, setReason] = useState(lost ? LOST_REASONS[0] : '');
  const [other, setOther] = useState('');
  const [date, setDate] = useState<string | null>(addDays(today(), 30));
  const save = async () => {
    const ok = await run(async () => {
      await setCommercialStatus(ctx.db, companyId, status, { reason: lost ? (reason === 'Autre' ? other : reason) : other || null, followUpDate: lost ? null : date });
      return true;
    }, `${name} : ${statusDef(status).label}`);
    if (ok) onClose();
  };
  return (
    <Modal title={lost ? `Marquer « ${name} » comme perdu` : `« ${name} » à recontacter`} onClose={onClose} footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={save}>Valider</Button></>}>
      <div className="col">
        {lost ? (
          <>
            <Field label="Motif">
              <div className="row wrap" style={{ gap: 6 }}>
                {LOST_REASONS.map((r) => <button key={r} className={`chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>{r}</button>)}
              </div>
            </Field>
            {reason === 'Autre' && <Field label="Précisez"><input className="input" autoFocus value={other} onChange={(e) => setOther(e.target.value)} /></Field>}
            <p className="small muted">La fiche et tout son historique sont conservés. Vous pourrez la réactiver à tout moment.</p>
          </>
        ) : (
          <>
            <Field label="Date de relance" help="Une relance est ajoutée à vos activités à cette date.">
              <div className="row wrap" style={{ gap: 6 }}>
                {[['Dans 2 semaines', 14], ['Dans 1 mois', 30], ['Dans 3 mois', 90], ['Dans 6 mois', 182]].map(([l, d]) => (
                  <button key={l} className={`chip ${date === addDays(today(), d as number) ? 'on' : ''}`} onClick={() => setDate(addDays(today(), d as number))}>{l}</button>
                ))}
              </div>
            </Field>
            <DateInput value={date} min={today()} onChange={setDate} />
            <Field label="Note (facultatif)"><input className="input" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Rappeler après la saison…" /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Pastille cliquable ouvrant la liste des statuts. */
export function StatusPicker({ companyId, name, status }: { companyId: number; name: string; status: string }) {
  const { change, dialog } = useStatusChange();
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Dropdown
        width={250}
        trigger={(open) => (
          <button className="status-pill clickable" style={{ ['--c' as any]: statusDef(status).color }} onClick={open} title="Changer le statut">
            <i />
            {statusDef(status).short}
            <ChevronDown size={12} />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="menu-title">Statut commercial</div>
            {COMMERCIAL_STATUS_DEFS.map((d) => (
              <button key={d.key} onClick={() => { close(); if (d.key !== status) change(companyId, name, d.key); }} title={d.hint}>
                <span className="dot" style={{ background: d.color }} />
                <span className="grow">{d.label}</span>
                {d.key === status && <Check size={14} />}
              </button>
            ))}
          </>
        )}
      </Dropdown>
      {dialog}
    </span>
  );
}

/** Frise des étapes du parcours, cliquable, avec les sorties « À recontacter » et « Perdu ». */
export function StatusStepper({ companyId, name, status }: { companyId: number; name: string; status: string }) {
  const { change, dialog } = useStatusChange();
  const cur = statusDef(status);
  return (
    <div className="stepper">
      <div className="steps">
        {MAIN_STEPS.map((d) => {
          const done = cur.step != null && d.step! < cur.step;
          const active = d.key === cur.key;
          return (
            <button key={d.key} className={`step ${done ? 'done' : ''} ${active ? 'active' : ''}`} style={{ ['--c' as any]: d.color }} onClick={() => !active && change(companyId, name, d.key)} title={d.hint}>
              <span className="bullet">{done ? <Check size={11} /> : d.step! + 1}</span>
              <span className="lbl">{d.short}</span>
            </button>
          );
        })}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {(['a_recontacter', 'perdu'] as const).map((k) => {
          const d = statusDef(k);
          return (
            <button key={k} className={`chip ${cur.key === k ? 'on' : ''}`} style={cur.key === k ? { borderColor: d.color, color: d.color, background: 'transparent' } : undefined} onClick={() => cur.key !== k && change(companyId, name, k)}>
              <span className="dot" style={{ background: d.color }} /> {d.label}
            </button>
          );
        })}
      </div>
      {dialog}
    </div>
  );
}
