import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowUp, Building2, CheckCircle2, Database, FileDigit, FolderOpen, HardDriveDownload, HelpCircle, KanbanSquare, KeyRound, Landmark,
  ListChecks, Mail, Palette, Percent, Plus, RotateCcw, ScrollText, ShieldCheck, Trash2, Upload, Workflow, Zap,
} from 'lucide-react';
import { useApp, useData } from '../core/app';
import { useLeaveGuard } from '../core/guard';
import { Alert, Badge, Button, Card, Field, Loading, Modal, PageHead, Switch } from '../components/ui';
import {
  checkAdministrativeSetup, setSetting, validateIban, validateSiret, sellerDisplayName, type AllSettings, type SettingsKey,
} from '@/domain/settings';
import { archiveStage, listStages, reorderStages, saveStage, type Stage } from '@/domain/pipeline';
import { listProjectStatuses, listProjectTemplates, saveProjectStatus, saveProjectTemplate, deleteProjectTemplate, type ProjectTemplate } from '@/domain/projects';
import { formatNumber as fmtDocNumber } from '@/domain/docCommon';
import { isPasswordSet, passwordStrength, removePassword, setPassword } from '@/domain/security';
import { logEvent } from '@/domain/audit';
import { bpToInput, parsePercent } from '@/lib/money';
import { formatDateTime, formatFileSize, today } from '@/lib/format';
import type { BackupListItem, VerifyReport } from '@/platform/types';

const SECTIONS = [
  { key: 'entreprise', label: 'Entreprise', icon: Building2 },
  { key: 'tva', label: 'TVA', icon: Percent },
  { key: 'paiement', label: 'Paiement et pénalités', icon: Landmark },
  { key: 'numerotation', label: 'Numérotation', icon: FileDigit },
  { key: 'devis', label: 'Devis et signature', icon: ScrollText },
  { key: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
  { key: 'projets', label: 'Projets', icon: ListChecks },
  { key: 'automatisations', label: 'Automatisations', icon: Zap },
  { key: 'emails', label: 'Emails', icon: Mail },
  { key: 'sauvegardes', label: 'Sauvegardes', icon: HardDriveDownload },
  { key: 'securite', label: 'Sécurité', icon: ShieldCheck },
  { key: 'apparence', label: 'Apparence', icon: Palette },
  { key: 'aide', label: 'Aide et réglementation', icon: HelpCircle },
] as const;

export function SettingsPage() {
  const section = useParams().section ?? 'entreprise';
  const nav = useNavigate();
  const { settings } = useApp();
  const issues = checkAdministrativeSetup(settings);
  return (
    <>
      <PageHead title="Paramètres" subtitle="Informations administratives, règles de facturation, sauvegardes et sécurité" />
      <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        <div className="card" style={{ padding: 6, position: 'sticky', top: 0 }}>
          {SECTIONS.map((s) => (
            <button key={s.key} className={`layer ${section === s.key ? 'sel' : ''}`} style={{ width: '100%', border: 0, background: section === s.key ? undefined : 'none', font: 'inherit', padding: '8px 10px' }} onClick={() => nav(`/parametres/${s.key}`)}>
              <s.icon size={16} /> <span className="grow" style={{ textAlign: 'left' }}>{s.label}</span>
              {s.key === 'entreprise' && issues.some((i) => i.severity === 'bloquant' && i.section === 'company') && <AlertTriangle size={14} color="var(--warning)" />}
              {s.key === 'tva' && issues.some((i) => i.section === 'vat') && <AlertTriangle size={14} color="var(--warning)" />}
            </button>
          ))}
        </div>
        <div>
          {section === 'entreprise' && <CompanySection />}
          {section === 'tva' && <VatSection />}
          {section === 'paiement' && <PaymentSection />}
          {section === 'numerotation' && <NumberingSection />}
          {section === 'devis' && <QuoteSection />}
          {section === 'pipeline' && <PipelineSection />}
          {section === 'projets' && <ProjectsSection />}
          {section === 'automatisations' && <AutomationSection />}
          {section === 'emails' && <EmailSection />}
          {section === 'sauvegardes' && <BackupSection />}
          {section === 'securite' && <SecuritySection />}
          {section === 'apparence' && <AppearanceSection />}
          {section === 'aide' && <HelpSection />}
        </div>
      </div>
    </>
  );
}

/** Formulaire générique d'une section de paramètres, avec enregistrement explicite. */
function useSection<K extends SettingsKey>(key: K) {
  const { settings, ctx, run, reloadSettings } = useApp();
  const [value, setValue] = useState<AllSettings[K]>(settings[key]);
  const [dirty, setDirty] = useState(false);
  useLeaveGuard(dirty);
  const set = (patch: Partial<AllSettings[K]>) => {
    setValue((v) => ({ ...v, ...patch }));
    setDirty(true);
  };
  const save = async (extra?: () => Promise<void>) => {
    const ok = await run(async () => {
      await setSetting(ctx.db, key, value);
      await logEvent(ctx.db, { entity: 'parametres', action: 'modification', summary: `Paramètres modifiés : ${key}` });
      await extra?.();
      await reloadSettings();
      return true;
    }, 'Paramètres enregistrés');
    if (ok) setDirty(false);
  };
  return { value, set, save, dirty };
}

function SaveBar({ dirty, onSave }: { dirty: boolean; onSave: () => void }) {
  return (
    <div className="card-foot" style={{ position: 'sticky', bottom: -40, background: 'var(--surface)', borderRadius: '0 0 14px 14px' }}>
      {dirty && <span className="muted small grow">Modifications non enregistrées</span>}
      <Button variant="primary" disabled={!dirty} onClick={onSave}>Enregistrer</Button>
    </div>
  );
}

function CompanySection() {
  const { value: c, set, save, dirty } = useSection('company');
  const { ctx, platform, run, settings } = useApp();
  const issues = checkAdministrativeSetup({ ...settings, company: c });
  const siretError = c.siret ? validateSiret(c.siret) : null;
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    if (c.logo_path) ctx.files.read(c.logo_path).then((b) => setLogo(URL.createObjectURL(new Blob([b as BlobPart])))).catch(() => setLogo(null));
    else setLogo(null);
  }, [c.logo_path, ctx.files]);
  const pickLogo = async () => {
    const f = await platform.pickFile({ title: 'Logo', extensions: ['png', 'jpg', 'jpeg'], label: 'Image PNG ou JPEG' });
    if (!f) return;
    await run(async () => {
      const rel = `branding/logo-${Date.now()}.${f.name.toLowerCase().endsWith('.png') ? 'png' : 'jpg'}`;
      await ctx.files.write(rel, f.bytes);
      set({ logo_path: rel });
    });
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      {issues.length > 0 ? (
        <Alert tone="warning" title="Vérification de la configuration administrative">
          <ul>{issues.map((i) => <li key={i.field + i.label}><b>{i.severity === 'bloquant' ? 'Obligatoire' : 'Recommandé'}</b> — {i.label}</li>)}</ul>
        </Alert>
      ) : <Alert tone="success">Configuration administrative complète pour l'émission de documents.</Alert>}
      <Card title="Identité de l'entreprise">
        <div className="form-grid">
          <Field label="Nom commercial"><input className="input" value={c.trade_name} onChange={(e) => set({ trade_name: e.target.value })} /></Field>
          <Field label="Nom et prénom de l'entrepreneur" required help="Dénomination légale d'un entrepreneur individuel"><input className="input" value={c.legal_name} onChange={(e) => set({ legal_name: e.target.value })} /></Field>
          <Field label="Statut juridique"><input className="input" value={c.legal_status} onChange={(e) => set({ legal_status: e.target.value })} /></Field>
          <Field label="Dirigeant"><input className="input" value={c.manager} onChange={(e) => set({ manager: e.target.value })} /></Field>
          <div className="span-2"><Switch checked={c.ei_mention} onChange={(v) => set({ ei_mention: v })} label={<span>Ajouter la mention « EI » à la dénomination (obligatoire pour un entrepreneur individuel) — affiché : <b>{sellerDisplayName(c)}</b></span>} /></div>
          <Field label="SIRET" required error={siretError}><input className="input" value={c.siret} onChange={(e) => set({ siret: e.target.value.replace(/\s/g, ''), siren: e.target.value.replace(/\s/g, '').slice(0, 9) })} /></Field>
          <Field label="SIREN" help="9 premiers chiffres du SIRET"><input className="input" value={c.siren} onChange={(e) => set({ siren: e.target.value })} /></Field>
          <Field label="Code APE / NAF"><input className="input" value={c.ape_code} onChange={(e) => set({ ape_code: e.target.value })} /></Field>
          <Field label="Immatriculation RCS / RM" help="Si applicable (ex. « RCS Lyon 123 456 789 »)"><input className="input" value={c.rcs_rm} onChange={(e) => set({ rcs_rm: e.target.value })} /></Field>
          <Field label="N° de TVA intracommunautaire" help="Obligatoire si vous êtes assujetti à la TVA"><input className="input" value={c.vat_number} onChange={(e) => set({ vat_number: e.target.value })} /></Field>
          <div />
          <div className="form-section">Adresse professionnelle (obligatoire sur les factures)</div>
          <Field label="Adresse" required className="span-2"><input className="input" value={c.address_line1} onChange={(e) => set({ address_line1: e.target.value })} /></Field>
          <Field label="Complément" className="span-2"><input className="input" value={c.address_line2} onChange={(e) => set({ address_line2: e.target.value })} /></Field>
          <Field label="Code postal" required><input className="input" value={c.postal_code} onChange={(e) => set({ postal_code: e.target.value })} /></Field>
          <Field label="Ville" required><input className="input" value={c.city} onChange={(e) => set({ city: e.target.value })} /></Field>
          <div className="form-section">Coordonnées</div>
          <Field label="Email"><input className="input" value={c.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Téléphone"><input className="input" value={c.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Site Internet"><input className="input" value={c.website} onChange={(e) => set({ website: e.target.value })} /></Field>
          <Field label="Logo (devis, factures)">
            <div className="row">
              {logo && <img src={logo} alt="Logo" style={{ height: 40, maxWidth: 140, objectFit: 'contain', background: '#fff', borderRadius: 6, border: '1px solid var(--border)' }} />}
              <Button size="sm" icon={Upload} onClick={pickLogo}>{logo ? 'Changer' : 'Importer un logo'}</Button>
              {logo && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => set({ logo_path: '' })} aria-label="Retirer le logo" />}
            </div>
          </Field>
        </div>
        <SaveBar dirty={dirty} onSave={() => save()} />
      </Card>
    </div>
  );
}

function VatSection() {
  const { value: v, set, save, dirty } = useSection('vat');
  const [newRate, setNewRate] = useState('');
  return (
    <Card title="Régime de TVA">
      <div className="col">
        <Alert tone="warning" title="À confirmer par vous (ou votre comptable)">Signal Desk ne suppose jamais votre régime de TVA. Une micro-entreprise peut bénéficier de la franchise en base de TVA <b>tant qu'elle ne dépasse pas les seuils légaux</b>, ou être assujettie (option, dépassement). Vérifiez votre situation sur impots.gouv.fr ou auprès d'un professionnel.</Alert>
        <div className="form-grid">
          <Field label="Régime" required className="span-2">
            <select className="input" value={v.regime} onChange={(e) => set({ regime: e.target.value as any })}>
              <option value="">— Non renseigné (émission bloquée) —</option>
              <option value="franchise">Franchise en base de TVA (art. 293 B du CGI) — TVA non facturée</option>
              <option value="reel_simplifie">Assujetti — régime réel simplifié</option>
              <option value="reel_normal">Assujetti — régime réel normal</option>
              <option value="mini_reel">Assujetti — mini-réel</option>
            </select>
          </Field>
          {v.regime === 'franchise' && <Field label="Mention légale de franchise" className="span-2"><input className="input" value={v.franchise_mention} onChange={(e) => set({ franchise_mention: e.target.value })} /></Field>}
          {v.regime && v.regime !== 'franchise' && (
            <>
              <Field label="Taux par défaut">
                <select className="input" value={v.default_rate_bp} onChange={(e) => set({ default_rate_bp: Number(e.target.value) })}>
                  {v.rates_bp.map((r) => <option key={r} value={r}>{bpToInput(r)} %</option>)}
                </select>
              </Field>
              <div className="field"><label>&nbsp;</label><Switch checked={v.vat_on_debits} onChange={(x) => set({ vat_on_debits: x })} label="Option pour le paiement de la TVA d'après les débits" /></div>
            </>
          )}
          <Field label="Taux disponibles" className="span-2">
            <div className="row wrap">
              {v.rates_bp.map((r) => (
                <span key={r} className="chip on">{bpToInput(r)} %<button className="btn ghost sm icon" style={{ height: 18, width: 18 }} onClick={() => set({ rates_bp: v.rates_bp.filter((x) => x !== r) })} aria-label="Retirer">×</button></span>
              ))}
              <input className="input sm" style={{ width: 90 }} placeholder="ex. 8,5" value={newRate} onChange={(e) => setNewRate(e.target.value)} />
              <Button size="sm" icon={Plus} onClick={() => { try { const r = parsePercent(newRate); if (!v.rates_bp.includes(r)) set({ rates_bp: [...v.rates_bp, r].sort((a, b) => b - a) }); setNewRate(''); } catch { /* saisie invalide */ } }}>Ajouter</Button>
            </div>
          </Field>
        </div>
      </div>
      <SaveBar dirty={dirty} onSave={() => save()} />
    </Card>
  );
}

function PaymentSection() {
  const { value: p, set, save, dirty } = useSection('payment');
  const ibanError = p.iban ? validateIban(p.iban) : null;
  return (
    <Card title="Paiement, pénalités et moyens de paiement">
      <div className="form-grid">
        <div className="form-section">Coordonnées bancaires (affichées sur les factures)</div>
        <Field label="IBAN" error={ibanError} className="span-2"><input className="input mono" value={p.iban} onChange={(e) => set({ iban: e.target.value.toUpperCase() })} placeholder="FR76 …" /></Field>
        <Field label="BIC"><input className="input mono" value={p.bic} onChange={(e) => set({ bic: e.target.value.toUpperCase() })} /></Field>
        <Field label="Banque"><input className="input" value={p.bank_name} onChange={(e) => set({ bank_name: e.target.value })} /></Field>
        <Field label="Titulaire du compte" className="span-2"><input className="input" value={p.account_holder} onChange={(e) => set({ account_holder: e.target.value })} placeholder="Par défaut : dénomination de l'entreprise" /></Field>
        <div className="form-section">Conditions et mentions obligatoires</div>
        <Field label="Délai de paiement par défaut (jours)" help="Entre professionnels : 30 jours par défaut, 60 jours maximum (ou 45 jours fin de mois)"><input className="input num" type="number" min={0} max={60} value={p.default_terms_days} onChange={(e) => set({ default_terms_days: Number(e.target.value) })} /></Field>
        <div />
        <Field label="Conditions de paiement" className="span-2"><textarea className="input" rows={2} value={p.payment_terms_text} onChange={(e) => set({ payment_terms_text: e.target.value })} /></Field>
        <Field label="Pénalités de retard" required className="span-2"><textarea className="input" rows={2} value={p.late_penalty_text} onChange={(e) => set({ late_penalty_text: e.target.value })} /></Field>
        <Field label="Indemnité forfaitaire de recouvrement (clients professionnels)" className="span-2"><textarea className="input" rows={2} value={p.recovery_fee_text} onChange={(e) => set({ recovery_fee_text: e.target.value })} /></Field>
        <Field label="Escompte pour paiement anticipé" className="span-2"><input className="input" value={p.early_payment_text} onChange={(e) => set({ early_payment_text: e.target.value })} /></Field>
        <div className="form-section">Moyens de paiement acceptés</div>
        <div className="span-2 col" style={{ gap: 6 }}>
          {p.methods.map((m, i) => (
            <Switch key={m.key} checked={m.enabled} onChange={(v) => set({ methods: p.methods.map((x, k) => (k === i ? { ...x, enabled: v } : x)) })} label={m.label} />
          ))}
        </div>
      </div>
      <SaveBar dirty={dirty} onSave={() => save()} />
    </Card>
  );
}

function NumberingSection() {
  const { value: n, set, save, dirty } = useSection('numbering');
  const t = today();
  const ex = (f: string) => { try { return fmtDocNumber(f, 1, t, n.min_digits); } catch { return '—'; } };
  return (
    <Card title="Numérotation des documents">
      <div className="col">
        <Alert tone="info">Les factures sont numérotées <b>à l'émission</b>, de façon chronologique et continue, sans doublon (séquence enregistrée en base, protégée par transaction). Les brouillons n'ont pas de numéro. Les avoirs ont leur propre série. <b>Évitez de changer de format en cours d'année.</b></Alert>
        <div className="form-grid">
          <Field label="Factures (et acomptes, soldes)" help={`Exemple : ${ex(n.invoice_format)}`}><input className="input mono" value={n.invoice_format} onChange={(e) => set({ invoice_format: e.target.value })} /></Field>
          <Field label="Avoirs" help={`Exemple : ${ex(n.credit_format)}`}><input className="input mono" value={n.credit_format} onChange={(e) => set({ credit_format: e.target.value })} /></Field>
          <Field label="Devis" help={`Exemple : ${ex(n.quote_format)}`}><input className="input mono" value={n.quote_format} onChange={(e) => set({ quote_format: e.target.value })} /></Field>
          <Field label="Nombre minimum de chiffres"><input className="input num" type="number" min={1} max={8} value={n.min_digits} onChange={(e) => set({ min_digits: Number(e.target.value) })} /></Field>
        </div>
        <p className="small muted">Variables : <span className="mono">{'{AAAA}'}</span> année (la séquence repart à 1 chaque année), <span className="mono">{'{AA}'}</span> année sur 2 chiffres, <span className="mono">{'{MM}'}</span> mois, <span className="mono">{'{N}'}</span> numéro (obligatoire).</p>
      </div>
      <SaveBar dirty={dirty} onSave={() => save()} />
    </Card>
  );
}

function QuoteSection() {
  const { value: q, set, save, dirty } = useSection('quotes');
  const legal = useSection('legal');
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Devis et signature électronique">
        <div className="form-grid">
          <Field label="Durée de validité par défaut (jours)"><input className="input num" type="number" min={1} value={q.validity_days} onChange={(e) => set({ validity_days: Number(e.target.value) })} /></Field>
          <Field label="Mention d'acceptation à recopier"><input className="input" value={q.acceptance_mention} onChange={(e) => set({ acceptance_mention: e.target.value })} /></Field>
          <Field label="Conditions particulières par défaut" className="span-2"><textarea className="input" rows={3} value={q.default_conditions} onChange={(e) => set({ default_conditions: e.target.value })} /></Field>
          <Field label="Texte de consentement (écran de signature)" className="span-2"><textarea className="input" rows={3} value={q.consent_text} onChange={(e) => set({ consent_text: e.target.value })} /></Field>
        </div>
        <SaveBar dirty={dirty} onSave={() => save()} />
      </Card>
      <Card title="Mentions complémentaires">
        <div className="form-grid">
          <Field label="Mentions ajoutées aux factures" className="span-2" help="Ex. assurance professionnelle (nom de l'assureur, couverture géographique) si vous y êtes tenu."><textarea className="input" rows={3} value={legal.value.invoice_extra_mentions} onChange={(e) => legal.set({ invoice_extra_mentions: e.target.value })} /></Field>
          <Field label="Mentions ajoutées aux devis" className="span-2"><textarea className="input" rows={3} value={legal.value.quote_extra_mentions} onChange={(e) => legal.set({ quote_extra_mentions: e.target.value })} /></Field>
          <Field label="Mention pour les clients particuliers" className="span-2" help="Ex. information sur la médiation de la consommation, droit de rétractation le cas échéant."><textarea className="input" rows={2} value={legal.value.b2c_mention} onChange={(e) => legal.set({ b2c_mention: e.target.value })} /></Field>
        </div>
        <SaveBar dirty={legal.dirty} onSave={() => legal.save()} />
      </Card>
    </div>
  );
}

function PipelineSection() {
  const { ctx, run, confirm } = useApp();
  const { data: stages } = useData((c) => listStages(c.db));
  const [edit, setEdit] = useState<Partial<Stage> | null>(null);
  const move = (i: number, d: number) => {
    if (!stages) return;
    const ids = stages.map((s) => s.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    run(() => reorderStages(ctx.db, ids));
  };
  return (
    <Card title="Étapes du pipeline commercial" actions={<Button size="sm" icon={Plus} onClick={() => setEdit({ name: '', kind: 'open', default_probability: 20, color: '#60a5fa' })}>Ajouter une étape</Button>}>
      {!stages ? <Loading /> : stages.map((s, i) => (
        <div key={s.id} className="list-row">
          <span className="dot" style={{ background: s.color }} />
          <span className="grow strong">{s.name}</span>
          <Badge tone={s.kind === 'won' ? 'success' : s.kind === 'lost' ? 'danger' : 'muted'} plain>{s.kind === 'won' ? 'Gagnée' : s.kind === 'lost' ? 'Perdue' : `${s.default_probability} %`}</Badge>
          <Button size="sm" variant="ghost" icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter" />
          <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label="Descendre" />
          <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Modifier</Button>
          <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={async () => { if (await confirm({ title: 'Supprimer l\'étape', message: `Supprimer « ${s.name} » ?`, danger: true })) run(() => archiveStage(ctx.db, s.id), 'Étape supprimée'); }} />
        </div>
      ))}
      {edit && (
        <Modal title={edit.id ? 'Modifier l\'étape' : 'Nouvelle étape'} onClose={() => setEdit(null)} footer={<><Button onClick={() => setEdit(null)}>Annuler</Button><Button variant="primary" onClick={async () => { const ok = await run(() => saveStage(ctx.db, edit as any), 'Étape enregistrée'); if (ok) setEdit(null); }}>Enregistrer</Button></>}>
          <div className="form-grid">
            <Field label="Nom" required className="span-2"><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Type"><select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as any })}><option value="open">En cours</option><option value="won">Gagnée (crée le client)</option><option value="lost">Perdue</option></select></Field>
            <Field label="Probabilité par défaut (%)"><input className="input num" type="number" min={0} max={100} value={edit.default_probability ?? 0} onChange={(e) => setEdit({ ...edit, default_probability: Number(e.target.value) })} /></Field>
            <Field label="Couleur"><input className="input" type="color" value={edit.color ?? '#64748b'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function ProjectsSection() {
  const { ctx, run, confirm } = useApp();
  const { data: statuses } = useData((c) => listProjectStatuses(c.db));
  const { data: templates } = useData((c) => listProjectTemplates(c.db));
  const [edit, setEdit] = useState<(Omit<ProjectTemplate, 'id'> & { id?: number }) | null>(null);
  const [newStatus, setNewStatus] = useState('');
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Statuts des projets">
        {statuses?.map((s) => (
          <div key={s.id} className="list-row">
            <input type="color" value={s.color} onChange={(e) => run(() => saveProjectStatus(ctx.db, { ...s, color: e.target.value }))} aria-label="Couleur" style={{ width: 28, height: 24, border: 0, background: 'none' }} />
            <input className="input sm grow" defaultValue={s.name} onBlur={(e) => e.target.value !== s.name && run(() => saveProjectStatus(ctx.db, { ...s, name: e.target.value }))} />
            <Switch checked={!!s.is_closed} onChange={(v) => run(() => saveProjectStatus(ctx.db, { ...s, is_closed: v ? 1 : 0 }))} label="Clôturé" />
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <input className="input sm" placeholder="Nouveau statut" value={newStatus} onChange={(e) => setNewStatus(e.target.value)} />
          <Button size="sm" icon={Plus} onClick={async () => { await run(() => saveProjectStatus(ctx.db, { name: newStatus }), 'Statut ajouté'); setNewStatus(''); }} disabled={!newStatus.trim()}>Ajouter</Button>
        </div>
      </Card>
      <Card title="Modèles de projet (listes de tâches)" actions={<Button size="sm" icon={Plus} onClick={() => setEdit({ name: '', description: '', service_type: '', tasks: [] })}>Nouveau modèle</Button>}>
        {templates?.map((t) => (
          <div key={t.id} className="list-row">
            <Workflow size={16} className="muted" />
            <div className="grow"><div className="strong">{t.name}</div><div className="small muted">{t.tasks.length} tâche(s){t.service_type ? ` · ${t.service_type}` : ''}</div></div>
            <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Modifier</Button>
            <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={async () => { if (await confirm({ title: 'Supprimer le modèle', message: `Supprimer « ${t.name} » ? Les projets existants ne sont pas affectés.`, danger: true })) run(() => deleteProjectTemplate(ctx.db, t.id)); }} />
          </div>
        ))}
      </Card>
      {edit && (
        <Modal title="Modèle de projet" onClose={() => setEdit(null)} size="lg" footer={<><Button onClick={() => setEdit(null)}>Annuler</Button><Button variant="primary" onClick={async () => { const ok = await run(() => saveProjectTemplate(ctx.db, edit), 'Modèle enregistré'); if (ok) setEdit(null); }}>Enregistrer</Button></>}>
          <div className="form-grid">
            <Field label="Nom" required><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Type de prestation"><input className="input" value={edit.service_type ?? ''} onChange={(e) => setEdit({ ...edit, service_type: e.target.value })} /></Field>
            <div className="span-2">
              <div className="label" style={{ marginBottom: 6 }}>Tâches (décalage en jours depuis le début du projet)</div>
              {edit.tasks.map((t, i) => (
                <div key={i} className="row" style={{ marginBottom: 6 }}>
                  <input className="input grow" value={t.title} onChange={(e) => setEdit({ ...edit, tasks: edit.tasks.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} />
                  <input className="input num" style={{ width: 80 }} type="number" min={0} value={t.offset_days} onChange={(e) => setEdit({ ...edit, tasks: edit.tasks.map((x, k) => (k === i ? { ...x, offset_days: Number(e.target.value) } : x)) })} aria-label="Jours" />
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setEdit({ ...edit, tasks: edit.tasks.filter((_, k) => k !== i) })} aria-label="Retirer" />
                </div>
              ))}
              <Button size="sm" icon={Plus} onClick={() => setEdit({ ...edit, tasks: [...edit.tasks, { title: '', offset_days: (edit.tasks.at(-1)?.offset_days ?? 0) + 2, position: edit.tasks.length + 1 }] })}>Ajouter une tâche</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AutomationSection() {
  const { value: a, set, save, dirty } = useSection('automation');
  return (
    <Card title="Automatisations locales">
      <div className="col" style={{ gap: 14 }}>
        <Alert tone="info">Aucune donnée n'est transmise à l'extérieur. Les automatisations s'exécutent uniquement lorsque Signal Desk est ouvert.</Alert>
        <Switch checked={a.local_notifications} onChange={(v) => set({ local_notifications: v })} label="Notifications Windows pour les rappels d'activités et les factures récurrentes" />
        <div>
          <Switch checked={a.recurring_auto_issue} onChange={(v) => set({ recurring_auto_issue: v })} label="Autoriser l'émission automatique des factures récurrentes" />
          <p className="small muted" style={{ marginLeft: 46 }}>Uniquement pour les contrats où l'option « émettre automatiquement » est cochée. Sinon, les factures sont préparées en brouillon. Aucun doublon : chaque période n'est facturée qu'une fois, même après un redémarrage.</p>
        </div>
        <div>
          <Switch checked={false} disabled onChange={() => undefined} label="Envoi automatique des relances de paiement" />
          <p className="small muted" style={{ marginLeft: 46 }}>Non disponible : les relances sont toujours préparées et prévisualisées, puis copiées ou ouvertes dans votre messagerie par vous-même (aucun envoi automatique sans intégration email configurée).</p>
        </div>
      </div>
      <SaveBar dirty={dirty} onSave={() => save()} />
    </Card>
  );
}

function EmailSection() {
  const { value: e, set, save, dirty } = useSection('email');
  const nav = useNavigate();
  return (
    <Card title="Emails">
      <div className="col">
        <Alert tone="info" title="Fonctionnement actuel">Les emails sont préparés à partir de modèles, prévisualisés, puis <b>copiés</b> ou <b>ouverts dans votre logiciel de messagerie</b> (Outlook, Thunderbird, Mail…). Signal Desk n'envoie aucun email lui-même. L'envoi direct par SMTP n'est pas inclus dans cette version (voir la documentation « Limites »).</Alert>
        <Field label="Signature de vos emails"><textarea className="input" rows={4} value={e.signature} onChange={(ev) => set({ signature: ev.target.value })} /></Field>
        <div><Button onClick={() => nav('/modeles')}>Modifier les modèles d'emails</Button></div>
      </div>
      <SaveBar dirty={dirty} onSave={() => save()} />
    </Card>
  );
}

function BackupSection() {
  const { platform, ctx, run, confirm, toast, settings } = useApp();
  const { value: b, set, save, dirty } = useSection('backup');
  const dir = b.directory || platform.info.default_backup_dir;
  const [list, setList] = useState<BackupListItem[] | null>(null);
  const [report, setReport] = useState<{ path: string; r: VerifyReport } | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const refresh = () => platform.backupList(dir).then(setList).catch(() => setList([]));
  useEffect(() => {
    if (platform.kind === 'tauri') refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);
  if (platform.kind !== 'tauri') return <Alert tone="warning">Les sauvegardes sont disponibles dans l'application Windows (mode démonstration navigateur : données en mémoire uniquement).</Alert>;

  const askPass = async (title: string, confirmTwice: boolean) => {
    const p = await confirm({ title, message: 'Cette phrase de passe chiffre la sauvegarde (AES-256). Elle n\'est jamais enregistrée : sans elle, la sauvegarde est irrécupérable.', input: { label: 'Phrase de passe', required: true }, confirmLabel: 'Continuer' });
    if (!p) return null;
    if (confirmTwice) {
      const p2 = await confirm({ title: 'Confirmez la phrase de passe', message: '', input: { label: 'Phrase de passe (confirmation)', required: true }, confirmLabel: 'Confirmer' });
      if (p2 !== p) {
        toast('Les phrases de passe ne correspondent pas.', 'error');
        return null;
      }
    }
    return p;
  };

  const backupNow = async (encrypted: boolean) => {
    const pass = encrypted ? await askPass('Sauvegarde chiffrée', true) : null;
    if (encrypted && !pass) return;
    const info = await run(async () => {
      const r = await platform.backupCreate(dir, pass, 'manuelle');
      await logEvent(ctx.db, { entity: 'sauvegarde', action: 'creation', summary: `Sauvegarde ${encrypted ? 'chiffrée ' : ''}créée : ${r.path} (${formatFileSize(r.size)})` });
      return r;
    });
    if (info) {
      toast(`Sauvegarde créée : ${info.path}`, 'success');
      refresh();
    }
  };

  const verify = async (item: { path: string; encrypted: boolean }) => {
    const pass = item.encrypted ? await askPass('Phrase de passe de la sauvegarde', false) : null;
    if (item.encrypted && !pass) return;
    const r = await run(() => platform.backupVerify(item.path, pass));
    if (r) setReport({ path: item.path, r });
  };

  const restore = async (item: { path: string; encrypted: boolean }) => {
    const pass = item.encrypted ? await askPass('Phrase de passe de la sauvegarde', false) : null;
    if (item.encrypted && !pass) return;
    const r = await run(() => platform.backupVerify(item.path, pass));
    if (!r) return;
    if (!r.ok) {
      setReport({ path: item.path, r });
      return;
    }
    const ok = await confirm({
      title: 'Restaurer cette sauvegarde ?',
      message: (
        <div className="col">
          <span>Sauvegarde du <b>{formatDateTime(r.created_at)}</b> (version {r.app_version}, {r.file_count} fichiers) — contrôle d'intégrité : <b>{r.integrity_check}</b>.</span>
          <span>Les données actuelles seront <b>remplacées</b>. Par sécurité, elles sont d'abord sauvegardées automatiquement, puis conservées dans le dossier « anciennes-donnees » (rien n'est supprimé).</span>
        </div>
      ),
      confirmLabel: 'Restaurer',
      danger: true,
    });
    if (!ok) return;
    setRestoring(item.path);
    const res = await run(() => platform.backupRestore(item.path, pass));
    setRestoring(null);
    if (res) {
      await confirm({ title: 'Restauration terminée', message: <div className="col"><span>Les données ont été restaurées. Sauvegarde de sécurité de l'état précédent : <span className="mono">{res.safety_backup}</span></span><span>L'application va se recharger.</span></div>, confirmLabel: 'Recharger' });
      location.reload();
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Sauvegarder maintenant">
        <div className="col">
          <p className="small muted">Une sauvegarde contient la base de données complète (instantané cohérent) et tous les fichiers : documents émis, devis signés, signatures, modèles importés, pièces jointes, logo. Chaque fichier est contrôlé par empreinte SHA-256. Une sauvegarde existante n'est jamais écrasée.</p>
          <Field label="Dossier de destination" help="Choisissez de préférence un disque externe ou un dossier synchronisé de votre choix.">
            <div className="row">
              <input className="input mono" readOnly value={dir} />
              <Button icon={FolderOpen} onClick={async () => { const d = await platform.pickDirectory('Dossier des sauvegardes'); if (d) set({ directory: d }); }}>Choisir…</Button>
            </div>
          </Field>
          {dirty && <div><Button variant="primary" onClick={() => save()}>Enregistrer le dossier</Button></div>}
          <div className="row">
            <Button variant="accent" icon={HardDriveDownload} onClick={() => backupNow(false)}>Sauvegarder maintenant</Button>
            <Button icon={KeyRound} onClick={() => backupNow(true)}>Sauvegarde chiffrée…</Button>
            <Button icon={FolderOpen} variant="ghost" onClick={() => run(() => platform.openFolder(dir))}>Ouvrir le dossier</Button>
          </div>
        </div>
      </Card>
      <Card title="Sauvegarde automatique">
        <div className="col">
          <Switch checked={b.auto_enabled} onChange={(v) => set({ auto_enabled: v })} label="Sauvegarder automatiquement (lorsque l'application est ouverte)" />
          <div className="row">
            <span className="small">Fréquence :</span>
            <select className="input sm" style={{ width: 200 }} value={b.frequency_hours} onChange={(e) => set({ frequency_hours: Number(e.target.value) })}>
              <option value={6}>Toutes les 6 heures</option><option value={24}>Tous les jours</option><option value={72}>Tous les 3 jours</option><option value={168}>Toutes les semaines</option>
            </select>
          </div>
          <p className="small muted">Les sauvegardes automatiques ne sont pas chiffrées (la phrase de passe n'est jamais stockée). Dernière sauvegarde automatique : {b.last_auto_at ? formatDateTime(b.last_auto_at) : 'jamais'}.</p>
          <div><Button variant="primary" disabled={!dirty} onClick={() => save()}>Enregistrer</Button></div>
        </div>
      </Card>
      <Card title="Historique, vérification et restauration" actions={<Button size="sm" icon={Upload} onClick={async () => { const p = await platform.pickBackupFile(); if (p) { const enc = await confirm({ title: 'Sauvegarde chiffrée ?', message: 'Cette sauvegarde est-elle chiffrée par une phrase de passe ?', confirmLabel: 'Oui, chiffrée' }); restore({ path: p, encrypted: !!enc }); } }}>Restaurer depuis un fichier…</Button>}>
        {!list ? <Loading /> : !list.length ? <div className="muted small">Aucune sauvegarde dans ce dossier.</div> : (
          <table className="table compact">
            <thead><tr><th>Fichier</th><th>Date</th><th className="num">Taille</th><th /></tr></thead>
            <tbody>
              {list.map((it) => (
                <tr key={it.path}>
                  <td><div className="strong small">{it.name}</div>{it.encrypted && <Badge tone="accent" plain>Chiffrée</Badge>}</td>
                  <td>{formatDateTime(it.modified)}</td>
                  <td className="num">{formatFileSize(it.size)}</td>
                  <td className="num nowrap">
                    <Button size="sm" icon={ShieldCheck} onClick={() => verify(it)}>Tester</Button>
                    <Button size="sm" icon={RotateCcw} busy={restoring === it.path} onClick={() => restore(it)}>Restaurer</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {report && (
          <div style={{ marginTop: 12 }}>
            <Alert tone={report.r.ok ? 'success' : 'danger'} title={report.r.ok ? 'Test de restauration réussi' : 'Sauvegarde invalide'}>
              {report.r.ok ? (
                <span>Déchiffrement, empreintes SHA-256 et contrôle d'intégrité SQLite : OK. {Object.entries(report.r.table_counts).map(([k, v]) => `${k} : ${v}`).join(' · ')}</span>
              ) : <ul>{report.r.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
            </Alert>
          </div>
        )}
      </Card>
      <Card title="Emplacement des données">
        <dl className="dl">
          <dt>Dossier de données</dt><dd className="mono">{platform.info.data_dir}</dd>
          <dt>Base SQLite</dt><dd className="mono">{platform.info.db_path}</dd>
          <dt>Fichiers</dt><dd className="mono">{platform.info.files_dir}</dd>
        </dl>
        <div style={{ marginTop: 10 }}><Button icon={Database} onClick={() => run(() => platform.openFolder(platform.info.data_dir))}>Ouvrir le dossier de données</Button></div>
        <p className="small muted" style={{ marginTop: 10 }}>Le stockage local n'est pas un archivage certifié. Conservez vos factures et pièces pendant les durées légales (en général 10 ans pour les pièces comptables) et gardez plusieurs sauvegardes sur des supports différents. {settings.backup.auto_enabled ? '' : 'Pensez à activer la sauvegarde automatique.'}</p>
      </Card>
    </div>
  );
}

function SecuritySection() {
  const { ctx, run, reloadSettings } = useApp();
  const { data: hasPw, reload } = useData((c) => isPasswordSet(c.db));
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const { value: s, set, save, dirty } = useSection('security');
  const strength = pw ? passwordStrength(pw) : null;
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Protection par mot de passe">
        <div className="col">
          {hasPw ? <Alert tone="success">Un mot de passe protège l'ouverture de Signal Desk (empreinte PBKDF2-SHA256, jamais stocké en clair).</Alert> : <Alert tone="warning">Aucun mot de passe : toute personne ayant accès à votre session Windows peut ouvrir Signal Desk.</Alert>}
          <div className="form-grid">
            {hasPw && <Field label="Mot de passe actuel" className="span-2"><input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>}
            <Field label="Nouveau mot de passe" help={strength?.message}><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
            <Field label="Confirmation" error={pw2 && pw !== pw2 ? 'Les mots de passe ne correspondent pas' : null}><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
          </div>
          <div className="row">
            <Button variant="primary" disabled={!pw || pw !== pw2 || !strength?.ok} onClick={async () => { const ok = await run(async () => { await setPassword(ctx.db, pw, cur || undefined); await reloadSettings(); return true; }, 'Mot de passe enregistré'); if (ok) { setPw(''); setPw2(''); setCur(''); reload(); } }}>{hasPw ? 'Changer le mot de passe' : 'Activer la protection'}</Button>
            {hasPw && <Button variant="danger" disabled={!cur} onClick={async () => { const ok = await run(async () => { await removePassword(ctx.db, cur); await reloadSettings(); return true; }, 'Protection désactivée'); if (ok) { setCur(''); reload(); } }}>Désactiver</Button>}
          </div>
          <p className="small muted">Mot de passe oublié : il n'existe pas de « porte dérobée ». Restaurez une sauvegarde antérieure à l'activation, ou contactez la personne qui gère votre poste.</p>
        </div>
      </Card>
      <Card title="Verrouillage automatique">
        <div className="col">
          <div className="row">
            <span className="small">Verrouiller après</span>
            <select className="input sm" style={{ width: 180 }} value={s.auto_lock_minutes} disabled={!hasPw} onChange={(e) => set({ auto_lock_minutes: Number(e.target.value) })}>
              <option value={0}>Jamais</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 heure</option>
            </select>
            <span className="small">d'inactivité</span>
            <Button size="sm" variant="primary" disabled={!dirty} onClick={() => save()}>Enregistrer</Button>
          </div>
          {!hasPw && <span className="small muted">Activez d'abord un mot de passe.</span>}
          <span className="small muted">Raccourci : Ctrl+L pour verrouiller immédiatement.</span>
        </div>
      </Card>
      <Card title="Limites de sécurité (à lire)">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Le mot de passe protège l'accès à l'interface. <b>Il ne chiffre pas la base de données sur le disque</b> et ne protège pas contre un administrateur Windows ou toute personne ayant un accès complet au poste.</li>
          <li>Pour protéger les données au repos, activez <b>BitLocker</b> (chiffrement du disque Windows) et un mot de passe de session Windows robuste.</li>
          <li>Les sauvegardes peuvent être chiffrées (AES-256-GCM) : conservez la phrase de passe en lieu sûr.</li>
          <li>Aucune télémétrie, aucun envoi de données : Signal Desk ne contacte aucun serveur. Les seules ouvertures externes sont celles que vous déclenchez (liens, messagerie).</li>
          <li>Les opérations sensibles (émission, paiements, signatures, restaurations, mot de passe) sont inscrites dans un journal non modifiable.</li>
        </ul>
      </Card>
    </div>
  );
}

function AppearanceSection() {
  const { value: a, set, save, dirty } = useSection('appearance');
  return (
    <Card title="Apparence">
      <div className="row">
        {(['clair', 'sombre', 'systeme'] as const).map((t) => <button key={t} className={`chip ${a.theme === t ? 'on' : ''}`} onClick={() => set({ theme: t })}>{t === 'clair' ? 'Clair' : t === 'sombre' ? 'Sombre' : 'Selon Windows'}</button>)}
      </div>
      <SaveBar dirty={dirty} onSave={() => save()} />
    </Card>
  );
}

function HelpSection() {
  const { platform } = useApp();
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Raccourcis clavier">
        <table className="table compact"><tbody>
          {[['Ctrl+K', 'Recherche globale'], ['Ctrl+Alt+P', 'Nouveau prospect'], ['Ctrl+Alt+D', 'Nouveau devis'], ['Ctrl+Alt+F', 'Nouvelle facture'], ['Ctrl+Alt+A', 'Nouvelle activité / relance'], ['Ctrl+L', 'Verrouiller (si mot de passe)'], ['Ctrl+Z / Ctrl+Y', 'Annuler / rétablir (éditeur de modèles)'], ['Ctrl+S', 'Enregistrer (éditeur de modèles)']].map(([k, l]) => <tr key={k}><td style={{ width: 180 }}><kbd>{k}</kbd></td><td>{l}</td></tr>)}
        </tbody></table>
      </Card>
      <Card title="Points réglementaires à vérifier (France)">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li><b>Mentions obligatoires des factures</b> : identité et adresse du vendeur et du client, SIREN/SIRET, n° de TVA (si assujetti), numéro unique et chronologique, dates d'émission et de prestation, désignation, quantités, prix unitaires HT, taux de TVA, remises, totaux, échéance, pénalités de retard, indemnité de 40 € (professionnels), mention « TVA non applicable, art. 293 B du CGI » en franchise, mention « EI ». Signal Desk contrôle la plupart de ces points avant émission.</li>
          <li><b>Facturation électronique</b> : la réforme rend progressivement obligatoires la réception (depuis le 1er septembre 2026 pour toutes les entreprises) puis l'émission (calendrier prévu au 1er septembre 2027 pour les PME et micro-entreprises) de factures électroniques entre entreprises assujetties à la TVA, via une plateforme agréée. <b>Un PDF classique ne suffira pas</b> dans ce cadre. Signal Desk prépare l'export XML (norme EN 16931) ; la connexion à une plateforme agréée reste à mettre en place. Calendrier et modalités à vérifier sur impots.gouv.fr.</li>
          <li><b>Logiciel de caisse / antifraude TVA</b> : les obligations de certification visent les systèmes de caisse enregistrant des paiements de particuliers ; à vérifier selon votre activité.</li>
          <li><b>Signature électronique</b> : signature « simple » au sens du règlement eIDAS ; suffisante pour de nombreux devis, mais sa valeur probante peut être discutée en cas de litige. Pour une signature avancée ou qualifiée, un prestataire de confiance est nécessaire.</li>
          <li><b>Conservation</b> : factures et pièces justificatives 10 ans (Code de commerce), 6 ans (livre des procédures fiscales). Le stockage local n'est pas un archivage à valeur probante certifié.</li>
          <li>Ces informations sont générales : faites valider votre configuration par un expert-comptable ou les services fiscaux.</li>
        </ul>
      </Card>
      <Card title="À propos">
        <dl className="dl">
          <dt>Application</dt><dd>Signal Desk {platform.info.version}</dd>
          <dt>Environnement</dt><dd>{platform.kind === 'tauri' ? `Application de bureau (${platform.info.os})` : 'Navigateur (démonstration, données en mémoire)'}</dd>
          <dt>Données</dt><dd className="mono">{platform.info.data_dir}</dd>
          <dt>Confidentialité</dt><dd>Aucune télémétrie, aucun compte, aucun service en ligne requis.</dd>
        </dl>
        <div className="row" style={{ marginTop: 10 }}><CheckCircle2 size={16} color="var(--success)" /><span className="small">Polices : Inter (interface) et Liberation Sans (PDF), sous licence SIL Open Font License.</span></div>
      </Card>
    </div>
  );
}
