/** Enregistrement et import de devis réalisés en dehors de Signal Desk. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileUp, Plus, Trash2, Upload } from 'lucide-react';
import { useApp } from '../core/app';
import { Alert, Button, Field, Modal } from '../components/ui';
import { CompanyPicker, ContactSelect, DateInput, MoneyInput, VatSelect } from '../components/inputs';
import {
  EXTERNAL_CSV_COLUMNS, EXTERNAL_CSV_TEMPLATE, EXTERNAL_STATUSES, importExternalQuotesCsv, mapExternalHeaders, registerExternalQuote,
  validateExternal, type ExternalAmount, type ExternalImportReport, type ExternalStatus,
} from '@/domain/externalQuotes';
import { csvToObjects } from '@/lib/csv';
import { computeTotals } from '@/lib/money';
import { formatEuro, formatFileSize, today } from '@/lib/format';

export function ExternalQuoteModal({ companyId, onClose }: { companyId?: number | null; onClose: () => void }) {
  const { ctx, run, settings, platform } = useApp();
  const nav = useNavigate();
  const defaultRate = settings.vat.regime === 'franchise' ? 0 : settings.vat.default_rate_bp;
  const [company, setCompany] = useState<number | null>(companyId ?? null);
  const [contact, setContact] = useState<number | null>(null);
  const [ref, setRef] = useState('');
  const [title, setTitle] = useState('');
  const [issue, setIssue] = useState(today());
  const [validity, setValidity] = useState<string | null>(null);
  const [status, setStatus] = useState<ExternalStatus>('envoye');
  const [accepted, setAccepted] = useState<string | null>(today());
  const [amounts, setAmounts] = useState<ExternalAmount[]>([{ label: '', ht_cents: 0, vat_rate_bp: defaultRate }]);
  const [note, setNote] = useState('');
  const [pdf, setPdf] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const totals = (() => {
    try {
      return computeTotals(amounts.map((a) => ({ kind: 'item' as const, quantity_milli: 1000, unit_price_cents: a.ht_cents, discount_type: 'none' as const, discount_value: 0, vat_rate_bp: a.vat_rate_bp })));
    } catch {
      return null;
    }
  })();

  const save = async () => {
    const input = {
      company_id: company ?? 0, contact_id: contact, external_ref: ref, title, issue_date: issue, validity_date: validity,
      amounts, status, accepted_date: status === 'accepte' ? accepted : null, note, pdf,
    };
    const errs = validateExternal(input);
    setErrors(errs);
    if (errs.length) return;
    const id = await run(() => registerExternalQuote(ctx, input), 'Devis externe enregistré');
    if (id) {
      onClose();
      nav(`/devis/${id}`);
    }
  };

  return (
    <Modal
      title="Enregistrer un devis externe"
      subtitle="Devis réalisé hors de Signal Desk (Word, Excel, autre logiciel…) : il sera suivi, comptabilisé et facturable ici."
      onClose={onClose}
      size="lg"
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={save}>Enregistrer</Button></>}
    >
      <div className="col" style={{ gap: 14 }}>
        {errors.length > 0 && <Alert tone="danger"><ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
        <div className="form-grid">
          <Field label="Client" required className="span-2"><CompanyPicker value={company} onChange={(id) => { setCompany(id); setContact(null); }} /></Field>
          <Field label="Contact"><ContactSelect companyId={company} value={contact} onChange={setContact} /></Field>
          <Field label="Référence du devis d'origine" required help="Son numéro tel qu'il figure sur le document"><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="DEV-2025-012" /></Field>
          <Field label="Objet" className="span-2"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Création du site Internet" /></Field>
          <Field label="Date du devis" required><DateInput value={issue} max={today()} onChange={(v) => setIssue(v ?? today())} /></Field>
          <Field label="Valable jusqu'au"><DateInput value={validity} onChange={setValidity} /></Field>
          <Field label="Statut actuel">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ExternalStatus)}>
              {EXTERNAL_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          {status === 'accepte' && <Field label="Date d'acceptation"><DateInput value={accepted} max={today()} onChange={setAccepted} /></Field>}
        </div>

        <div>
          <div className="label" style={{ marginBottom: 6 }}>Montants (sans ressaisir le détail des lignes)</div>
          {amounts.map((a, i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <input className="input grow" placeholder={amounts.length > 1 ? `Libellé ${i + 1} (facultatif)` : 'Libellé (facultatif)'} value={a.label ?? ''} onChange={(e) => setAmounts(amounts.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
              <div style={{ width: 170 }}><MoneyInput value={a.ht_cents} ariaLabel="Montant HT" onChange={(v) => setAmounts(amounts.map((x, k) => (k === i ? { ...x, ht_cents: v } : x)))} /></div>
              <span className="small muted">HT</span>
              <div style={{ width: 100 }}><VatSelect value={a.vat_rate_bp} ariaLabel="Taux de TVA" onChange={(v) => setAmounts(amounts.map((x, k) => (k === i ? { ...x, vat_rate_bp: v } : x)))} /></div>
              {amounts.length > 1 && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Retirer" onClick={() => setAmounts(amounts.filter((_, k) => k !== i))} />}
            </div>
          ))}
          <div className="row between">
            <Button size="sm" icon={Plus} onClick={() => setAmounts([...amounts, { label: '', ht_cents: 0, vat_rate_bp: defaultRate }])}>Autre montant / autre taux de TVA</Button>
            {totals && <span className="small">Total : <b>{formatEuro(totals.total_ht_cents)} HT</b> · {formatEuro(totals.total_ttc_cents)} TTC</span>}
          </div>
        </div>

        <div className="form-grid">
          <Field label="PDF du devis d'origine" className="span-2" help="Conservé tel quel, verrouillé, avec son empreinte SHA-256. Nécessaire pour le faire signer dans Signal Desk.">
            <div className="row">
              <Button icon={FileUp} onClick={async () => { const f = await platform.pickFile({ title: 'PDF du devis', extensions: ['pdf'], label: 'PDF' }); if (f) setPdf({ name: f.name, bytes: f.bytes }); }}>{pdf ? 'Changer' : 'Joindre le PDF…'}</Button>
              <span className="small muted">{pdf ? `${pdf.name} (${formatFileSize(pdf.bytes.length)})` : 'Facultatif'}</span>
            </div>
          </Field>
          <Field label="Note interne" className="span-2"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. accord reçu par email le…" /></Field>
        </div>
        <p className="tiny muted">Le devis reçoit un numéro interne Signal Desk ; sa référence d'origine reste affichée et figure sur les factures qui en découlent. Un client qui accepte devient client automatiquement.</p>
      </div>
    </Modal>
  );
}

export function ExternalImportModal({ onClose }: { onClose: () => void }) {
  const { ctx, run, platform, toast } = useApp();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [report, setReport] = useState<ExternalImportReport | null>(null);
  const parsed = file ? csvToObjects(file.text) : null;
  const missing = EXTERNAL_CSV_COLUMNS.filter((c) => c.required && !Object.values(mapping).includes(c.key));

  const pick = async () => {
    const f = await platform.pickFile({ title: 'Fichier CSV', extensions: ['csv', 'txt'], label: 'CSV' });
    if (!f) return;
    let text = new TextDecoder('utf-8').decode(f.bytes);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(f.bytes);
    setFile({ name: f.name, text });
    setMapping(mapExternalHeaders(csvToObjects(text).headers));
    setReport(null);
  };

  return (
    <Modal
      title="Importer des devis externes (CSV)"
      onClose={onClose}
      size="xl"
      footer={report ? <Button variant="primary" onClick={onClose}>Terminer</Button> : <><Button onClick={onClose}>Annuler</Button><Button variant="primary" disabled={!file || missing.length > 0} onClick={async () => { const r = await run(() => importExternalQuotesCsv(ctx, file!.text, { mapping })); if (r) setReport(r); }}>Importer</Button></>}
    >
      {report ? (
        <div className="col">
          <Alert tone="success">{report.created} devis importé(s){report.companiesCreated ? `, ${report.companiesCreated} fiche(s) client créée(s)` : ''}.</Alert>
          {report.skipped.length > 0 && <Alert tone="warning" title="Ignorés"><ul>{report.skipped.map((s) => <li key={s.line}>Ligne {s.line} — {s.ref} : {s.reason}</li>)}</ul></Alert>}
          {report.errors.length > 0 && <Alert tone="danger" title="Lignes en erreur (non importées)"><ul>{report.errors.map((e) => <li key={e.line}>Ligne {e.line} : {e.message}</li>)}</ul></Alert>}
        </div>
      ) : (
        <div className="col">
          <Alert tone="info">
            Une ligne par devis (ou plusieurs lignes avec le même client et la même référence pour plusieurs montants / taux de TVA). Depuis Excel : « Enregistrer sous » → « CSV (séparateur : point-virgule) ». Colonnes obligatoires : Client, Référence, Date, Montant HT. Les clients sont retrouvés par leur nom, sinon une fiche est créée. Un devis déjà enregistré n'est jamais importé deux fois.
          </Alert>
          <div className="row">
            <Button variant="primary" icon={Upload} onClick={pick}>{file ? 'Choisir un autre fichier' : 'Choisir le fichier CSV…'}</Button>
            <Button icon={Download} onClick={async () => { const p = await platform.saveFile('modele-devis-externes.csv', new TextEncoder().encode(EXTERNAL_CSV_TEMPLATE), { label: 'CSV', extensions: ['csv'] }); if (p) toast('Modèle enregistré', 'success'); }}>Télécharger un modèle</Button>
            {file && <span className="small muted">{file.name} — {parsed?.rows.length ?? 0} ligne(s)</span>}
          </div>
          {parsed && parsed.headers.length > 0 && (
            <>
              {missing.length > 0 && <Alert tone="warning">Associez les colonnes obligatoires : {missing.map((m) => m.label).join(', ')}.</Alert>}
              <table className="table compact">
                <thead><tr><th>Colonne du fichier</th><th>Champ</th><th>Exemple</th></tr></thead>
                <tbody>
                  {parsed.headers.map((h) => (
                    <tr key={h}>
                      <td className="strong">{h}</td>
                      <td>
                        <select className="input sm" value={mapping[h] ?? ''} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                          <option value="">— Ignorer —</option>
                          {EXTERNAL_CSV_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}{c.required ? ' *' : ''}</option>)}
                        </select>
                      </td>
                      <td className="muted small">{parsed.rows[0]?.[h]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
