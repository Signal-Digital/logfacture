import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Copy, Download, Eye, FileText, FileType2, Image as ImageIcon, Mail, Pencil, Plus, RotateCcw, Star, Upload } from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Alert, Badge, Button, Card, Dropdown, Empty, Field, Loading, Modal, PageHead, Tabs } from '../components/ui';
import { PdfPreviewModal } from '../doc/PdfActions';
import {
  archiveTemplate, createVisualTemplate, duplicateTemplate, importTemplate, listTemplates, renameTemplate, setDefaultTemplate, type DocTemplate,
} from '@/domain/templates';
import { renderWithTemplate } from '@/domain/docgen';
import { sampleSnapshot } from '@/pdf/sample';
import { inspectDocx, DOCX_LOOP_FIELDS } from '@/pdf/docx';
import { FIELD_LIBRARY } from '@/pdf/fields';
import { classicLayout, minimalLayout } from '@/pdf/builtinTemplates';
import { EMAIL_FIELDS, DEFAULT_EMAIL_TEMPLATES, deleteEmailTemplate, listEmailTemplates, resetEmailTemplate, saveEmailTemplate, type EmailTemplate } from '@/domain/emails';
import { formatDate } from '@/lib/format';

export function TemplatesPage() {
  const [tab, setTab] = useState<'documents' | 'emails' | 'champs'>('documents');
  return (
    <>
      <PageHead title="Modèles de documents" subtitle="Vos propres designs de devis et factures (PDF, Word, image ou éditeur visuel) et vos modèles d'emails" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'documents', label: 'Devis et factures' }, { key: 'emails', label: 'Emails' }, { key: 'champs', label: 'Champs dynamiques' }]} />
      {tab === 'documents' && <DocTemplates />}
      {tab === 'emails' && <EmailTemplates />}
      {tab === 'champs' && <FieldsHelp />}
    </>
  );
}

function DocTemplates() {
  const { ctx, run, platform, confirm, settings, toast } = useApp();
  const nav = useNavigate();
  const { data, loading } = useData((c) => listTemplates(c.db));
  const [preview, setPreview] = useState<{ t: DocTemplate; kind: 'devis' | 'facture'; lines: number } | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [docxInfo, setDocxInfo] = useState<DocTemplate | null>(null);

  const doImport = async () => {
    const f = await platform.pickFile({ title: 'Importer un modèle', extensions: ['pdf', 'docx', 'png', 'jpg', 'jpeg'], label: 'Modèles (PDF, Word, image)' });
    if (!f) return;
    const r = await run(() => importTemplate(ctx, f.name, f.bytes), 'Modèle importé');
    if (r) {
      setWarnings(r.warnings);
      const t = (await listTemplates(ctx.db)).find((x) => x.id === r.id);
      if (t?.engine === 'visuel') nav(`/modeles/${r.id}`);
      else if (t) setDocxInfo(t);
    }
  };

  return (
    <>
      <div className="toolbar">
        <Button variant="accent" icon={Upload} onClick={doImport}>Importer un modèle (PDF, DOCX, PNG, JPEG)</Button>
        <Dropdown trigger={(o) => <Button icon={Plus} onClick={o}>Nouveau modèle</Button>}>
          {(close) => (
            <>
              <button onClick={async () => { close(); const id = await run(() => createVisualTemplate(ctx.db, 'Nouveau modèle', classicLayout())); if (id) nav(`/modeles/${id}`); }}><FileText /> À partir du modèle « Classique »</button>
              <button onClick={async () => { close(); const id = await run(() => createVisualTemplate(ctx.db, 'Nouveau modèle', minimalLayout())); if (id) nav(`/modeles/${id}`); }}><FileText /> À partir du modèle « Épuré »</button>
            </>
          )}
        </Dropdown>
      </div>
      {warnings && warnings.length > 0 && <div style={{ marginBottom: 14 }}><Alert tone="info" title="Import réussi — points d'attention"><ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert></div>}
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={FileText} title="Aucun modèle" /> : (
        <div className="grid-3">
          {data.map((t) => (
            <Card key={t.id} title={<div className="col" style={{ gap: 2 }}><span className="strong">{t.name}</span><span className="muted tiny">{t.engine === 'docx' ? 'Modèle Word (DOCX)' : t.background_type === 'pdf' ? `Fond PDF importé (${t.background_pages} p.)` : t.background_type === 'image' ? 'Fond image importé' : 'Modèle visuel'} · modifié le {formatDate(t.updated_at)}</span></div>}>
              <div className="col">
                <div className="row wrap" style={{ gap: 6 }}>
                  {t.engine === 'docx' ? <Badge tone="info" plain><FileType2 size={12} /> Word</Badge> : t.background_type === 'image' ? <Badge tone="info" plain><ImageIcon size={12} /> Image</Badge> : <Badge tone="accent" plain>Visuel</Badge>}
                  {t.is_default_quote ? <Badge tone="success">Défaut devis</Badge> : null}
                  {t.is_default_invoice ? <Badge tone="success">Défaut factures</Badge> : null}
                  {t.is_builtin ? <Badge tone="muted" plain>Fourni</Badge> : null}
                </div>
                <div className="row wrap">
                  {t.engine === 'visuel' && <Button size="sm" variant="primary" icon={Pencil} onClick={() => nav(`/modeles/${t.id}`)}>Éditer</Button>}
                  {t.engine === 'docx' && <Button size="sm" icon={FileType2} onClick={() => setDocxInfo(t)}>Champs détectés</Button>}
                  <Button size="sm" icon={Eye} onClick={() => setPreview({ t, kind: 'devis', lines: 4 })}>Aperçu</Button>
                  <Dropdown trigger={(o) => <Button size="sm" onClick={o}>…</Button>}>
                    {(close) => (
                      <>
                        <button onClick={() => { close(); setPreview({ t, kind: 'facture', lines: 4 }); }}><Eye /> Aperçu en facture</button>
                        <button onClick={() => { close(); setPreview({ t, kind: 'devis', lines: 60 }); }}><Eye /> Aperçu long (60 lignes, pagination)</button>
                        <div className="sep" />
                        <button onClick={() => { close(); run(() => setDefaultTemplate(ctx.db, t.id, 'devis'), 'Modèle par défaut des devis'); }}><Star /> Par défaut pour les devis</button>
                        <button onClick={() => { close(); run(() => setDefaultTemplate(ctx.db, t.id, 'facture'), 'Modèle par défaut des factures'); }}><Star /> Par défaut pour les factures</button>
                        <button onClick={async () => { close(); const name = await confirm({ title: 'Renommer', message: '', input: { label: 'Nom du modèle', initial: t.name, required: true }, confirmLabel: 'Renommer' }); if (name) run(() => renameTemplate(ctx.db, t.id, name)); }}><Pencil /> Renommer</button>
                        <button onClick={() => { close(); run(() => duplicateTemplate(ctx, t.id), 'Modèle dupliqué'); }}><Copy /> Dupliquer</button>
                        {t.docx_path && <button onClick={async () => { close(); const p = await platform.saveFile(`${t.name}.docx`, await ctx.files.read(t.docx_path!), { label: 'Word', extensions: ['docx'] }); if (p) toast('Modèle Word exporté', 'success'); }}><Download /> Télécharger le DOCX</button>}
                        <div className="sep" />
                        <button onClick={async () => { close(); if (await confirm({ title: 'Archiver le modèle', message: 'Les documents déjà générés ne sont pas affectés.' })) run(() => archiveTemplate(ctx.db, t.id), 'Modèle archivé'); }}><Archive /> Archiver</button>
                      </>
                    )}
                  </Dropdown>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <div style={{ marginTop: 18 }}>
        <Alert tone="info" title="Comment utiliser votre propre design ?">
          <ul>
            <li><b>PDF</b> (recommandé) : exportez votre maquette en PDF (Canva, Word, InDesign…). Elle sert de fond graphique fidèle (logo, couleurs, formes, pieds de page). Placez ensuite les champs et la zone du tableau dans l'éditeur. Une 2e page du PDF peut servir de fond aux pages suivantes.</li>
            <li><b>Word (DOCX)</b> : insérez des champs <code>{'{{client.nom}}'}</code> dans votre document et une ligne de tableau <code>{'{{#lignes}}…{{/lignes}}'}</code>. La structure Word est conservée ; la conversion en PDF nécessite LibreOffice (gratuit) ou Microsoft Word sur ce PC.</li>
            <li><b>Image</b> (PNG/JPEG) : fond pleine page, au format A4.</li>
          </ul>
        </Alert>
      </div>
      {preview && (
        <PdfPreviewModal
          title={`Aperçu — ${preview.t.name}`}
          fileName={`Aperçu ${preview.t.name}.pdf`}
          generate={() => renderWithTemplate(ctx, sampleSnapshot(settings, preview.kind, preview.lines), preview.t, { watermark: 'EXEMPLE' })}
          onClose={() => setPreview(null)}
        />
      )}
      {docxInfo && <DocxInfoModal t={docxInfo} onClose={() => setDocxInfo(null)} />}
    </>
  );
}

function DocxInfoModal({ t, onClose }: { t: DocTemplate; onClose: () => void }) {
  const { ctx, platform } = useApp();
  const { data: info } = useData(async (c) => inspectDocx(await c.files.read(t.docx_path!)), [t.id]);
  const { data: conv } = useData(() => platform.converters(), []);
  const known = new Set(FIELD_LIBRARY.map((f) => f.key));
  void ctx;
  return (
    <Modal title={`Modèle Word — ${t.name}`} onClose={onClose} size="lg" footer={<Button onClick={onClose}>Fermer</Button>}>
      {!info ? <Loading /> : (
        <div className="col">
          {conv && !conv.libreoffice && !conv.word && <Alert tone="warning" title="Aucun convertisseur DOCX → PDF détecté">Installez LibreOffice (gratuit, libreoffice.org) ou Microsoft Word pour générer des PDF à partir de ce modèle. Sans convertisseur, utilisez un modèle visuel (fond PDF) : c'est la méthode la plus fidèle et 100 % intégrée.</Alert>}
          {conv && (conv.libreoffice || conv.word) && <Alert tone="success">Convertisseur détecté : {conv.libreoffice ? 'LibreOffice' : 'Microsoft Word'}.</Alert>}
          <div>
            <div className="label">Champs trouvés ({info.fields.length})</div>
            <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
              {info.fields.map((f) => <span key={f} className="field-chip" style={{ borderColor: known.has(f) || DOCX_LOOP_FIELDS.some((d) => d.key === f) ? undefined : 'var(--danger)' }}>{`{{${f}}}`}</span>)}
            </div>
            {info.fields.some((f) => !known.has(f) && !DOCX_LOOP_FIELDS.some((d) => d.key === f) && !['taux', 'base', 'montant', 'texte', 'libelle', 'valeur'].includes(f)) && <p className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>Les champs en rouge ne sont pas reconnus : ils resteront vides.</p>}
          </div>
          <div><div className="label">Boucles</div><div className="small">{info.loops.length ? info.loops.map((l) => `{{#${l}}}`).join(', ') : 'Aucune'}</div></div>
          <Alert tone="info">La pagination d'un modèle Word (répétition de l'en-tête du tableau, sauts de page) est gérée par Word/LibreOffice : dans Word, cochez « Répéter en tant que ligne d'en-tête » sur la 1re ligne du tableau et décochez « Autoriser le fractionnement des lignes ».</Alert>
        </div>
      )}
    </Modal>
  );
}

function FieldsHelp() {
  const groups = [...new Set(FIELD_LIBRARY.map((f) => f.group))];
  return (
    <div className="grid-2">
      {groups.map((g) => (
        <Card key={g} title={g}>
          <table className="table compact"><tbody>{FIELD_LIBRARY.filter((f) => f.group === g).map((f) => <tr key={f.key}><td className="mono">{`{{${f.key}}}`}</td><td>{f.label}</td></tr>)}</tbody></table>
        </Card>
      ))}
      <Card title="Lignes (modèles Word)">
        <p className="small muted" style={{ marginBottom: 8 }}>Dans une ligne de tableau : <span className="mono">{'{{#lignes}}{{designation}}'}</span> … <span className="mono">{'{{total_ht}}{{/lignes}}'}</span></p>
        <table className="table compact"><tbody>{DOCX_LOOP_FIELDS.map((f) => <tr key={f.key}><td className="mono">{`{{${f.key}}}`}</td><td>{f.label}</td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}

function EmailTemplates() {
  const { ctx, run, confirm } = useApp();
  const { data } = useData((c) => listEmailTemplates(c.db));
  const [edit, setEdit] = useState<Partial<EmailTemplate> | null>(null);
  const cats = [...new Set((data ?? []).map((t) => t.category))];
  return (
    <>
      <div className="toolbar"><Button variant="accent" icon={Plus} onClick={() => setEdit({ name: '', category: 'Personnalisé', subject: '', body: '' })}>Nouveau modèle d'email</Button></div>
      <div className="grid-2">
        {cats.map((c) => (
          <Card key={c} title={c} pad={false}>
            {data?.filter((t) => t.category === c).map((t) => (
              <div key={t.id} className="list-row" style={{ padding: '10px 16px' }}>
                <Mail size={15} className="muted" />
                <div className="grow"><div className="strong small">{t.name}</div><div className="tiny muted">{t.subject}</div></div>
                <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(t)} aria-label="Modifier" />
                {DEFAULT_EMAIL_TEMPLATES.some((d) => d.key === t.key) ? (
                  <Button size="sm" variant="ghost" icon={RotateCcw} aria-label="Réinitialiser" title="Réinitialiser" onClick={async () => { if (await confirm({ title: 'Réinitialiser', message: 'Revenir au texte fourni par défaut ?' })) run(() => resetEmailTemplate(ctx.db, t.key), 'Modèle réinitialisé'); }} />
                ) : (
                  <Button size="sm" variant="ghost" icon={Archive} aria-label="Supprimer" onClick={async () => { if (await confirm({ title: 'Supprimer', message: `Supprimer « ${t.name} » ?`, danger: true })) run(() => deleteEmailTemplate(ctx.db, t.id)); }} />
                )}
              </div>
            ))}
          </Card>
        ))}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Modifier le modèle d\'email' : 'Nouveau modèle d\'email'} onClose={() => setEdit(null)} size="lg" footer={<><Button onClick={() => setEdit(null)}>Annuler</Button><Button variant="primary" onClick={async () => { const ok = await run(() => saveEmailTemplate(ctx.db, edit as any), 'Modèle enregistré'); if (ok) setEdit(null); }}>Enregistrer</Button></>}>
          <div className="form-grid">
            <Field label="Nom" required><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Catégorie"><input className="input" value={edit.category ?? ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></Field>
            <Field label="Objet" required className="span-2"><input className="input" value={edit.subject ?? ''} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
            <Field label="Message" required className="span-2"><textarea id="email-body" className="input" rows={12} value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            <div className="span-2">
              <div className="label" style={{ marginBottom: 4 }}>Insérer un champ</div>
              {EMAIL_FIELDS.map((f) => <span key={f.key} className="field-chip" onClick={() => setEdit({ ...edit, body: `${edit.body ?? ''}{{${f.key}}}` })} title={f.label}>{f.label}</span>)}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
