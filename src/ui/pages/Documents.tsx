import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, Download, Eye, FileText, FolderOpen, Lock, Paperclip, Printer, Search, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, PageHead } from '../components/ui';
import { CompanyPicker } from '../components/inputs';
import { StoredPdfView } from '../doc/PdfActions';
import {
  DOC_TYPES, archiveDocument, deleteDocument, documentVersions, documentYears, findByHash, getDocument, listDocuments, storeDocument, verifyDocument,
  type DocType, type DocumentRow,
} from '@/domain/documents';
import { sha256Hex } from '@/lib/crypto';
import { formatDate, formatDateTime, formatFileSize } from '@/lib/format';

const typeLabel = (k: string) => DOC_TYPES.find((d) => d.key === k)?.label ?? k;

export function DocumentsPage() {
  const { ctx, run, platform, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const [year, setYear] = useState<number | ''>('');
  const [docType, setDocType] = useState<DocType | ''>('');
  const [companyId, setCompanyId] = useState<number | null>(Number(params.get('entreprise')) || null);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [view, setView] = useState<DocumentRow | null>(null);
  const [upload, setUpload] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const { data: years } = useData((c) => documentYears(c.db));
  const { data, loading } = useData((c) => listDocuments(c.db, { year: year || undefined, docType: docType || undefined, companyId: companyId ?? undefined, search, archived }), [year, docType, companyId, search, archived]);
  useEffect(() => {
    const id = Number(params.get('document'));
    if (id) getDocument(ctx.db, id).then((d) => d && setView(d));
  }, [params, ctx.db]);

  const checkExternal = async () => {
    const f = await platform.pickFile({ title: 'Vérifier un PDF', extensions: ['pdf'], label: 'PDF' });
    if (!f) return;
    const hash = await sha256Hex(f.bytes);
    const r = await findByHash(ctx.db, hash);
    setVerifyResult(
      r.found
        ? `✓ Ce fichier est identique à un document enregistré dans Signal Desk${r.invoices[0] ? ` (facture ${r.invoices[0].number})` : r.sigs[0] ? ' (devis signé)' : r.versions[0] ? ' (version de devis)' : r.docs[0] ? ` (${r.docs[0].title})` : ''}. Empreinte SHA-256 : ${hash}`
        : `✗ Aucun document enregistré ne correspond à ce fichier (empreinte ${hash}). Il a pu être modifié ou ne provient pas de Signal Desk.`,
    );
  };

  return (
    <>
      <PageHead
        title="Documents"
        subtitle="Devis, factures, avoirs, devis signés et pièces jointes — classés par année, client, projet et type"
        actions={<><Button icon={ShieldCheck} onClick={checkExternal}>Vérifier un PDF</Button>{platform.kind === 'tauri' && <Button icon={FolderOpen} onClick={() => run(() => platform.openFolder(platform.info.files_dir))}>Ouvrir le dossier</Button>}<Button variant="accent" icon={Upload} onClick={() => setUpload(true)}>Ajouter un fichier</Button></>}
      />
      {verifyResult && <div style={{ marginBottom: 14 }}><Alert tone={verifyResult.startsWith('✓') ? 'success' : 'danger'}>{verifyResult}</Alert></div>}
      <div className="toolbar">
        <div className="search"><Search /><input className="input" placeholder="Titre, fichier, client…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="input" style={{ width: 120 }} value={year} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : '')} aria-label="Année">
          <option value="">Années</option>
          {years?.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="input" style={{ width: 160 }} value={docType} onChange={(e) => setDocType(e.target.value as any)} aria-label="Type">
          <option value="">Tous les types</option>
          {DOC_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <div style={{ width: 260 }}><CompanyPicker value={companyId} onChange={setCompanyId} placeholder="Filtrer par client…" /></div>
        {companyId && <Button size="sm" variant="ghost" onClick={() => setCompanyId(null)}>Tous les clients</Button>}
        <label className="check small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archivés</label>
      </div>
      <Card pad={false}>
        {loading && !data ? <Loading /> : !data?.length ? <Empty icon={FileText} title="Aucun document" text="Les PDF des devis et factures émis sont enregistrés ici automatiquement." /> : (
          <table className="table">
            <thead><tr><th>Document</th><th>Type</th><th>Client</th><th>Projet</th><th>Date</th><th className="num">Taille</th><th /></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => setView(d)}>
                  <td><div className="cell-title row" style={{ gap: 6 }}>{d.locked ? <Lock size={13} className="muted" /> : <Paperclip size={13} className="muted" />}{d.title}{d.version > 1 && <Badge plain>v{d.version}</Badge>}</div><div className="cell-sub">{d.file_name}</div></td>
                  <td>{typeLabel(d.doc_type)}</td>
                  <td>{d.company_name}</td>
                  <td>{d.project_name}</td>
                  <td>{formatDate(d.created_at)}</td>
                  <td className="num muted">{formatFileSize(d.size)}</td>
                  <td className="num nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" icon={Printer} aria-label="Ouvrir" onClick={() => run(() => platform.openManagedFile(d.file_path))} />
                    <Button size="sm" variant="ghost" icon={Download} aria-label="Exporter" onClick={() => run(async () => { const p = await platform.saveFile(d.file_name, await ctx.files.read(d.file_path), { label: 'Fichier', extensions: [d.file_name.split('.').pop() ?? '*'] }); if (p) toast('Fichier exporté', 'success'); })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {view && <DocumentModal doc={view} onClose={() => { setView(null); if (params.get('document')) setParams({}); }} />}
      {upload && <UploadModal companyId={companyId} onClose={() => setUpload(false)} />}
    </>
  );
}

function DocumentModal({ doc, onClose }: { doc: DocumentRow; onClose: () => void }) {
  const { ctx, run, platform, confirm, toast } = useApp();
  const { data: versions } = useData((c) => documentVersions(c.db, doc.id), [doc.id]);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const isPdf = doc.file_name.toLowerCase().endsWith('.pdf');
  const addVersion = async () => {
    const f = await platform.pickFile({ title: 'Nouvelle version', extensions: ['pdf', 'docx', 'png', 'jpg', 'jpeg', 'xlsx', 'txt', 'zip'], label: 'Fichier' });
    if (!f) return;
    await run(() => storeDocument(ctx, { title: doc.title, docType: doc.doc_type, fileName: f.name, bytes: f.bytes, companyId: doc.company_id, projectId: doc.project_id, quoteId: doc.quote_id, invoiceId: doc.invoice_id, parentId: doc.parent_document_id ?? doc.id }), 'Nouvelle version enregistrée');
  };
  return (
    <Modal
      title={doc.title}
      subtitle={`${typeLabel(doc.doc_type)} · ${doc.file_name} · ${formatFileSize(doc.size)}`}
      onClose={onClose}
      size="xl"
      footer={
        <>
          {!doc.locked && <Button variant="ghost" icon={Trash2} onClick={async () => { if (await confirm({ title: 'Retirer de la bibliothèque', message: 'Le document est retiré de la liste. Le fichier reste présent dans le dossier de données.', danger: true, confirmLabel: 'Retirer' })) { await run(() => deleteDocument(ctx.db, doc.id), 'Document retiré'); onClose(); } }}>Retirer</Button>}
          <Button variant="ghost" icon={doc.archived_at ? ArchiveRestore : Archive} onClick={async () => { await run(() => archiveDocument(ctx.db, doc.id, !doc.archived_at)); onClose(); }}>{doc.archived_at ? 'Désarchiver' : 'Archiver'}</Button>
          <div className="grow" />
          <Button icon={ShieldCheck} onClick={async () => setCheck(await verifyDocument(ctx, doc.id))}>Vérifier l'intégrité</Button>
          {!doc.locked && <Button icon={Upload} onClick={addVersion}>Nouvelle version</Button>}
          {platform.kind === 'tauri' && <Button icon={FolderOpen} onClick={() => run(() => platform.revealManagedFile(doc.file_path))}>Dossier</Button>}
          <Button icon={Download} onClick={() => run(async () => { const p = await platform.saveFile(doc.file_name, await ctx.files.read(doc.file_path), { label: 'Fichier', extensions: [doc.file_name.split('.').pop() ?? '*'] }); if (p) toast('Exporté', 'success'); })}>Exporter</Button>
          <Button variant="primary" icon={Eye} onClick={() => run(() => platform.openManagedFile(doc.file_path))}>Ouvrir / imprimer</Button>
        </>
      }
    >
      <div className="grid-3">
        <div className="span-2">{isPdf ? <StoredPdfView path={doc.file_path} /> : <Empty icon={FileText} title="Aperçu indisponible pour ce format" text="Utilisez « Ouvrir » pour l'afficher avec l'application par défaut de Windows." />}</div>
        <div className="col">
          {check && <Alert tone={check.ok ? 'success' : 'danger'}>{check.message}</Alert>}
          <Card title="Informations">
            <dl className="dl" style={{ gridTemplateColumns: '90px 1fr' }}>
              <dt>Statut</dt><dd>{doc.locked ? 'Verrouillé (document émis/signé)' : 'Modifiable'}</dd>
              <dt>Ajouté le</dt><dd>{formatDateTime(doc.created_at)}</dd>
              <dt>Année</dt><dd>{doc.year}</dd>
              <dt>SHA-256</dt><dd className="mono">{doc.sha256}</dd>
              <dt>Chemin</dt><dd className="mono">{doc.file_path}</dd>
            </dl>
          </Card>
          {versions && versions.length > 1 && (
            <Card title="Versions">
              {versions.map((v) => <div key={v.id} className="row between small list-row"><span>v{v.version} — {formatDate(v.created_at)}</span><Button size="sm" onClick={() => platform.openManagedFile(v.file_path)}>Ouvrir</Button></div>)}
            </Card>
          )}
          {doc.notes && <Card title="Notes"><p className="small pre">{doc.notes}</p></Card>}
        </div>
      </div>
    </Modal>
  );
}

function UploadModal({ companyId, projectId, quoteId, onClose }: { companyId?: number | null; projectId?: number | null; quoteId?: number | null; onClose: () => void }) {
  const { ctx, run, platform } = useApp();
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocType>('piece_jointe');
  const [company, setCompany] = useState<number | null>(companyId ?? null);
  const [notes, setNotes] = useState('');
  const pick = async () => {
    const f = await platform.pickFile({ title: 'Choisir un fichier', extensions: ['pdf', 'docx', 'xlsx', 'png', 'jpg', 'jpeg', 'txt', 'csv', 'zip'], label: 'Documents' });
    if (f) {
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    }
  };
  const save = async () => {
    if (!file) return;
    const ok = await run(() => storeDocument(ctx, { title: title || file.name, docType, fileName: file.name, bytes: file.bytes, companyId: company, projectId, quoteId, notes }), 'Fichier ajouté');
    if (ok) onClose();
  };
  return (
    <Modal title="Ajouter un fichier" onClose={onClose} footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" disabled={!file} onClick={save}>Ajouter</Button></>}>
      <div className="form-grid">
        <div className="span-2 row"><Button icon={Upload} onClick={pick}>Choisir un fichier…</Button><span className="muted small">{file ? `${file.name} (${formatFileSize(file.bytes.length)})` : 'Aucun fichier'}</span></div>
        <Field label="Titre" className="span-2"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Type"><select className="input" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>{DOC_TYPES.filter((d) => !['devis', 'devis_signe', 'facture', 'avoir'].includes(d.key)).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></Field>
        {!companyId && <Field label="Client"><CompanyPicker value={company} onChange={setCompany} /></Field>}
        <Field label="Notes" className="span-2"><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** Pièces jointes liées à un devis, un projet ou un client. */
export function AttachmentsCard({ quoteId, projectId, companyId }: { quoteId?: number; projectId?: number; companyId?: number }) {
  const { platform } = useApp();
  const [upload, setUpload] = useState(false);
  const { data } = useData((c) => listDocuments(c.db, { quoteId, projectId }), [quoteId, projectId]);
  const attachments = (data ?? []).filter((d) => d.doc_type !== 'devis' && d.doc_type !== 'devis_signe' || projectId);
  return (
    <Card title="Pièces jointes et fichiers" actions={<Button size="sm" icon={Paperclip} onClick={() => setUpload(true)}>Ajouter</Button>}>
      {!attachments.length ? <div className="muted small">Aucun fichier.</div> : attachments.map((d) => (
        <div key={d.id} className="list-row small">
          {d.locked ? <Lock size={13} /> : <Paperclip size={13} />}
          <span className="grow">{d.title}</span>
          <Button size="sm" variant="ghost" onClick={() => platform.openManagedFile(d.file_path)}>Ouvrir</Button>
        </div>
      ))}
      {upload && <UploadModal companyId={companyId} projectId={projectId} quoteId={quoteId} onClose={() => setUpload(false)} />}
    </Card>
  );
}
