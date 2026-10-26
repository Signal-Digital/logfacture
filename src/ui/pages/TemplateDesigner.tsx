/**
 * Éditeur visuel de modèles : fond importé, éléments déplaçables et
 * redimensionnables, champs dynamiques, zones du tableau (1re page et pages
 * suivantes), blocs après le tableau, annuler/rétablir, zoom, aperçu PDF.
 * Unités affichées en millimètres (stockées en points PDF).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowDown, ArrowUp, Copy, Eye, Image as ImageIcon, Layers, Minus, PenLine, Redo2, Save, Sigma, Square, Table2, Trash2, Type, Undo2, Upload, ZoomIn, ZoomOut, Braces,
} from 'lucide-react';
import { useApp, useData } from '../core/app';
import { useLeaveGuard } from '../core/guard';
import { Button, Empty, Field, Loading, Tabs } from '../components/ui';
import { renderPdfPageToDataUrl } from '../components/PdfViewer';
import { PdfPreviewModal } from '../doc/PdfActions';
import { getTemplate, parseLayout, replaceBackground, saveLayout, renameTemplate, validateLayout, type DocTemplate } from '@/domain/templates';
import { renderWithTemplate } from '@/domain/docgen';
import { sampleSnapshot } from '@/pdf/sample';
import { FIELD_LIBRARY, buildFieldValues, fillText, totalsRows } from '@/pdf/fields';
import type { Align, ColumnKey, FontWeight, LayoutElement, PageRule, TemplateLayout } from '@/pdf/types';

const MM = 72 / 25.4;
const toMm = (pt: number) => Math.round((pt / MM) * 10) / 10;
const toPt = (mm: number) => Math.round(mm * MM * 100) / 100;
let idSeq = Date.now();
const newId = (p: string) => `${p}-${(idSeq++).toString(36)}`;

const COLUMN_LABELS: Record<ColumnKey, string> = {
  designation: 'Désignation', quantity: 'Quantité', unit: 'Unité', unit_price: 'Prix unitaire HT', discount: 'Remise', vat_rate: 'TVA', total_ht: 'Total HT', total_ttc: 'Total TTC',
};

type Sel = { kind: 'el'; id: string } | { kind: 'table' } | { kind: 'cont' } | null;

export function TemplateDesigner() {
  const id = Number(useParams().id);
  const { data: tpl, loading } = useData((c) => getTemplate(c.db, id), [id]);
  if (loading && !tpl) return <Loading />;
  if (!tpl) return <Empty icon={Layers} title="Modèle introuvable" />;
  if (tpl.engine !== 'visuel') return <Empty icon={Layers} title="Ce modèle Word se modifie dans Microsoft Word ou LibreOffice" text="Téléchargez le DOCX depuis la liste des modèles, modifiez-le puis réimportez-le." />;
  return <Designer key={tpl.id + tpl.updated_at} tpl={tpl} />;
}

function Designer({ tpl }: { tpl: DocTemplate }) {
  const { ctx, run, settings, toast, platform } = useApp();
  const [layout, setLayoutRaw] = useState<TemplateLayout>(() => parseLayout(tpl));
  const [name, setName] = useState(tpl.name);
  const [past, setPast] = useState<TemplateLayout[]>([]);
  const [future, setFuture] = useState<TemplateLayout[]>([]);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [zoom, setZoom] = useState(1.1);
  const [pageView, setPageView] = useState<'first' | 'next'>('first');
  const [bg, setBg] = useState<{ first?: string; next?: string }>({});
  const [docKind, setDocKind] = useState<'devis' | 'facture'>('devis');
  const [preview, setPreview] = useState<number | null>(null);
  const [leftTab, setLeftTab] = useState<'ajouter' | 'calques'>('ajouter');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useLeaveGuard(dirty);

  const sample = useMemo(() => sampleSnapshot(settings, docKind, 4), [settings, docKind]);
  const values = useMemo(() => buildFieldValues(sample, { 'pagination.page': pageView === 'first' ? '1' : '2', 'pagination.total': '2' }), [sample, pageView]);

  // Historique (annuler / rétablir)
  const setLayout = useCallback((next: TemplateLayout | ((l: TemplateLayout) => TemplateLayout), record = true) => {
    setLayoutRaw((cur) => {
      const n = typeof next === 'function' ? (next as any)(cur) : next;
      if (record) {
        setPast((p) => [...p.slice(-80), cur]);
        setFuture([]);
      }
      return n;
    });
    setDirty(true);
  }, []);
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [layout, ...f]);
    setLayoutRaw(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setDirty(true);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, layout]);
    setLayoutRaw(future[0]);
    setFuture((f) => f.slice(1));
    setDirty(true);
  };

  // Fond (PDF rendu en image, ou image)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tpl.background_path || layout.background.type === 'none') return setBg({});
      try {
        const bytes = await ctx.files.read(tpl.background_path);
        if (layout.background.type === 'pdf') {
          const first = await renderPdfPageToDataUrl(bytes, layout.background.firstPage ?? 0, layout.page.width);
          const next = await renderPdfPageToDataUrl(bytes, layout.background.otherPages ?? layout.background.firstPage ?? 0, layout.page.width);
          if (!cancelled) setBg({ first: first.url, next: next.url });
        } else {
          const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
          if (!cancelled) setBg({ first: url, next: url });
        }
      } catch (e: any) {
        toast(`Fond illisible : ${e.message}`, 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl.background_path, layout.background.type, layout.background.firstPage, layout.background.otherPages]);

  useEffect(() => {
    const p = settings.company.logo_path;
    if (!p) return;
    ctx.files.read(p).then((b) => setLogoUrl(URL.createObjectURL(new Blob([b as BlobPart])))).catch(() => undefined);
  }, [settings.company.logo_path, ctx.files]);

  const selected = sel?.kind === 'el' ? layout.elements.find((e) => e.id === sel.id) ?? null : null;
  const updateEl = (elId: string, patch: Partial<LayoutElement>, record = true) =>
    setLayout((l) => ({ ...l, elements: l.elements.map((e) => (e.id === elId ? { ...e, ...patch } : e)) }), record);
  const removeEl = (elId: string) => {
    setLayout((l) => ({ ...l, elements: l.elements.filter((e) => e.id !== elId) }));
    setSel(null);
  };
  const addEl = (e: Omit<LayoutElement, 'id'>) => {
    const el = { ...e, id: newId(e.type) } as LayoutElement;
    setLayout((l) => ({ ...l, elements: [...l.elements, el] }));
    setSel({ kind: 'el', id: el.id });
  };

  // Clavier : suppression, flèches, annuler/rétablir
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
      if (!selected) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeEl(selected.id); return; }
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d && selected.anchor === 'fixed') { e.preventDefault(); updateEl(selected.id, { x: selected.x + d[0], y: selected.y + d[1] }); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // Glisser / redimensionner
  const drag = useRef<{ mode: 'move' | 'se' | 'e' | 's'; target: Sel; startX: number; startY: number; orig: any; recorded: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent, target: Sel, mode: 'move' | 'se' | 'e' | 's') => {
    e.stopPropagation();
    e.preventDefault();
    setSel(target);
    const orig = target?.kind === 'el' ? { ...layout.elements.find((x) => x.id === target.id)! } : { ...layout.table };
    drag.current = { mode, target, startX: e.clientX, startY: e.clientY, orig, recorded: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    if (!d.recorded && Math.abs(dx) + Math.abs(dy) < 1) return;
    const record = !d.recorded;
    d.recorded = true;
    const r = (n: number) => Math.round(n);
    if (d.target?.kind === 'el') {
      const o = d.orig as LayoutElement;
      if (d.mode === 'move') updateEl(o.id, o.anchor === 'flow' ? { x: r(o.x + dx) } : { x: r(o.x + dx), y: r(o.y + dy) }, record);
      else updateEl(o.id, { w: Math.max(8, r(o.w + (d.mode !== 's' ? dx : 0))), h: Math.max(o.type === 'line' ? 0 : 6, r(o.h + (d.mode !== 'e' ? dy : 0))) }, record);
    } else if (d.target?.kind === 'table') {
      const o = d.orig as TemplateLayout['table'];
      if (d.mode === 'move') setLayout((l) => ({ ...l, table: { ...l.table, x: r(o.x + dx), y: r(o.y + dy), bottom: r(o.bottom + dy) } }), record);
      else setLayout((l) => ({ ...l, table: { ...l.table, w: d.mode !== 's' ? Math.max(120, r(o.w + dx)) : l.table.w, bottom: d.mode !== 'e' ? Math.max(l.table.y + 60, r(o.bottom + dy)) : l.table.bottom } }), record);
    } else if (d.target?.kind === 'cont') {
      const o = d.orig as TemplateLayout['table'];
      if (d.mode === 'move') setLayout((l) => ({ ...l, table: { ...l.table, x: r(o.x + dx), continuationTop: r(o.continuationTop + dy), continuationBottom: r(o.continuationBottom + dy) } }), record);
      else setLayout((l) => ({ ...l, table: { ...l.table, w: d.mode !== 's' ? Math.max(120, r(o.w + dx)) : l.table.w, continuationBottom: d.mode !== 'e' ? Math.max(l.table.continuationTop + 100, r(o.continuationBottom + dy)) : l.table.continuationBottom } }), record);
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const save = async () => {
    try {
      validateLayout(layout);
    } catch (e: any) {
      toast(e.message, 'error');
      return;
    }
    const ok = await run(async () => {
      await saveLayout(ctx.db, tpl.id, layout, name);
      return true;
    }, 'Modèle enregistré');
    if (ok) setDirty(false);
  };

  const changeBackground = async () => {
    const f = await platform.pickFile({ title: 'Fond du modèle', extensions: ['pdf', 'png', 'jpg', 'jpeg'], label: 'PDF ou image' });
    if (!f) return;
    if (dirty) await saveLayout(ctx.db, tpl.id, layout, name).catch(() => undefined);
    await run(() => replaceBackground(ctx, tpl.id, f.name, f.bytes), 'Fond remplacé');
    setDirty(false);
  };

  const pageW = layout.page.width;
  const pageH = layout.page.height;
  const onPage = (e: LayoutElement) => e.anchor === 'fixed' && (e.pages === 'all' || (pageView === 'first' ? e.pages === 'first' || e.pages === 'last' : e.pages === 'not_first' || e.pages === 'last'));
  const flowEls = layout.elements.filter((e) => e.anchor === 'flow');
  const visibleForDoc = (e: LayoutElement) => !e.docTypes?.length || e.docTypes.includes(docKind);

  // Aperçu approximatif des blocs en flux sous le tableau (1re page)
  const flowPreview = (() => {
    let y = layout.table.y + layout.table.header.height + 4 * 28;
    return flowEls.filter(visibleForDoc).map((e) => {
      y += layout.flowGap;
      const h = e.type === 'totals' ? totalsRows(sample).length * (e.style?.size ?? 9) * 1.9 + (e.box?.padding ?? 0) * 2 : e.type === 'signature' ? Math.max(e.h, 60) : Math.max(18, (fillText(e.text ?? '', values).text.split('\n').length) * (e.style?.size ?? 9) * (e.style?.lineHeight ?? 1.3) + (e.box?.padding ?? 0) * 2);
      const out = { e, y, h };
      y += h;
      return out;
    });
  })();

  return (
    <div style={{ margin: '-22px -26px -40px' }}>
      <div className="row" style={{ padding: '10px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
        <Link to="/modeles" className="btn ghost sm">← Modèles</Link>
        <input className="input sm" style={{ width: 240, fontWeight: 600 }} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} aria-label="Nom du modèle" />
        <Button size="sm" icon={Undo2} onClick={undo} disabled={!past.length} title="Annuler (Ctrl+Z)" aria-label="Annuler" />
        <Button size="sm" icon={Redo2} onClick={redo} disabled={!future.length} title="Rétablir (Ctrl+Y)" aria-label="Rétablir" />
        <div className="btn-group">
          <button className={`btn sm ${pageView === 'first' ? 'on' : ''}`} onClick={() => setPageView('first')}>1re page</button>
          <button className={`btn sm ${pageView === 'next' ? 'on' : ''}`} onClick={() => setPageView('next')}>Pages suivantes</button>
        </div>
        <div className="btn-group">
          <button className={`btn sm ${docKind === 'devis' ? 'on' : ''}`} onClick={() => setDocKind('devis')}>Devis</button>
          <button className={`btn sm ${docKind === 'facture' ? 'on' : ''}`} onClick={() => setDocKind('facture')}>Facture</button>
        </div>
        <Button size="sm" icon={ZoomOut} onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))} aria-label="Zoom arrière" />
        <span className="small muted" style={{ width: 40, textAlign: 'center' }}>{Math.round(zoom * 100)} %</span>
        <Button size="sm" icon={ZoomIn} onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))} aria-label="Zoom avant" />
        <div className="grow" />
        <Button size="sm" icon={Upload} onClick={changeBackground}>Changer le fond</Button>
        <Button size="sm" icon={Eye} onClick={() => setPreview(4)}>Aperçu</Button>
        <Button size="sm" icon={Eye} onClick={() => setPreview(60)}>Aperçu long</Button>
        <Button size="sm" variant="primary" icon={Save} onClick={save} disabled={!dirty}>Enregistrer</Button>
      </div>
      <div className="designer">
        {/* Panneau gauche */}
        <div className="panel">
          <Tabs value={leftTab} onChange={setLeftTab} tabs={[{ key: 'ajouter', label: 'Ajouter' }, { key: 'calques', label: 'Éléments' }]} />
          {leftTab === 'ajouter' ? (
            <>
              <div className="col" style={{ gap: 6 }}>
                <Button size="sm" icon={Type} onClick={() => addEl({ type: 'text', name: 'Texte', x: 60, y: 60, w: 200, h: 30, pages: pageView === 'first' ? 'first' : 'all', anchor: 'fixed', text: 'Votre texte', style: { size: 10, color: '#1e293b' } })}>Zone de texte</Button>
                <Button size="sm" icon={ImageIcon} onClick={() => addEl({ type: 'image', name: 'Logo', src: 'logo', x: 40, y: 30, w: 140, h: 56, pages: 'first', anchor: 'fixed', fit: 'contain' })}>Logo (paramètres)</Button>
                <Button size="sm" icon={ImageIcon} onClick={async () => {
                  const f = await platform.pickFile({ title: 'Image', extensions: ['png', 'jpg', 'jpeg'], label: 'Image' });
                  if (!f) return;
                  const rel = `templates/${tpl.id}/img-${Date.now()}.${f.name.toLowerCase().endsWith('.png') ? 'png' : 'jpg'}`;
                  await ctx.files.write(rel, f.bytes);
                  addEl({ type: 'image', name: f.name, src: rel, x: 60, y: 60, w: 120, h: 80, pages: 'first', anchor: 'fixed', fit: 'contain' });
                }}>Image importée</Button>
                <Button size="sm" icon={Square} onClick={() => addEl({ type: 'rect', name: 'Rectangle', x: 60, y: 60, w: 160, h: 60, pages: 'first', anchor: 'fixed', box: { background: '#f1f5f9', radius: 4 } })}>Rectangle / fond</Button>
                <Button size="sm" icon={Minus} onClick={() => addEl({ type: 'line', name: 'Ligne', x: 40, y: 100, w: 515, h: 0, pages: 'first', anchor: 'fixed', box: { borderColor: '#cbd5e1', borderWidth: 1 } })}>Ligne</Button>
                <Button size="sm" icon={Sigma} onClick={() => addEl({ type: 'totals', name: 'Totaux', x: 315, y: 0, w: 240, h: 0, pages: 'last', anchor: 'flow', style: { size: 9, color: '#1e293b' }, box: { background: '#f1f5f9', radius: 4, padding: 10 } })}>Bloc des totaux</Button>
                <Button size="sm" icon={PenLine} onClick={() => addEl({ type: 'signature', name: 'Signature', x: 315, y: 0, w: 240, h: 96, pages: 'last', anchor: 'flow', docTypes: ['devis'], text: 'Bon pour accord — date et signature', style: { size: 8, color: '#64748b' }, box: { borderColor: '#cbd5e1', borderWidth: 0.8, radius: 4, padding: 8 } })}>Zone de signature</Button>
                <Button size="sm" icon={Table2} onClick={() => setSel({ kind: pageView === 'first' ? 'table' : 'cont' })}>Zone du tableau</Button>
              </div>
              <div>
                <div className="label" style={{ margin: '8px 0 4px' }}><Braces size={13} /> Champs dynamiques</div>
                <p className="tiny muted" style={{ marginBottom: 6 }}>{selected?.type === 'text' ? 'Cliquez pour insérer dans le texte sélectionné.' : 'Cliquez pour créer une zone contenant ce champ.'}</p>
                {[...new Set(FIELD_LIBRARY.map((f) => f.group))].map((g) => (
                  <div key={g} style={{ marginBottom: 6 }}>
                    <div className="tiny muted strong">{g}</div>
                    {FIELD_LIBRARY.filter((f) => f.group === g).map((f) => (
                      <span key={f.key} className="field-chip" title={`{{${f.key}}}`} onClick={() => {
                        if (selected?.type === 'text') updateEl(selected.id, { text: `${selected.text ?? ''}${selected.text ? ' ' : ''}{{${f.key}}}` });
                        else addEl({ type: 'text', name: f.label, x: 60, y: 60, w: 220, h: 18, pages: pageView === 'first' ? 'first' : 'all', anchor: 'fixed', text: `{{${f.key}}}`, style: { size: 10, color: '#1e293b' }, hideIfEmpty: true });
                      }}>{f.label}</span>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="col" style={{ gap: 2 }}>
              <div className="tiny muted strong">Éléments positionnés</div>
              {layout.elements.filter((e) => e.anchor === 'fixed').map((e) => (
                <div key={e.id} className={`layer ${sel?.kind === 'el' && sel.id === e.id ? 'sel' : ''}`} onClick={() => setSel({ kind: 'el', id: e.id })}>
                  <span className="grow">{e.name || e.type}</span>
                  <span className="tiny muted">{({ all: 'toutes', first: '1re', last: 'dern.', not_first: 'suiv.' } as Record<PageRule, string>)[e.pages]}</span>
                </div>
              ))}
              <div className="tiny muted strong" style={{ marginTop: 10 }}>Blocs après le tableau (ordre)</div>
              {flowEls.map((e, i) => (
                <div key={e.id} className={`layer ${sel?.kind === 'el' && sel.id === e.id ? 'sel' : ''}`} onClick={() => setSel({ kind: 'el', id: e.id })}>
                  <span className="grow">{e.name || e.type}</span>
                  <button className="btn ghost sm icon" aria-label="Monter" disabled={i === 0} onClick={(ev) => { ev.stopPropagation(); setLayout((l) => { const fl = l.elements.filter((x) => x.anchor === 'flow'); const fixed = l.elements.filter((x) => x.anchor !== 'flow'); [fl[i - 1], fl[i]] = [fl[i], fl[i - 1]]; return { ...l, elements: [...fixed, ...fl] }; }); }}><ArrowUp size={12} /></button>
                  <button className="btn ghost sm icon" aria-label="Descendre" disabled={i === flowEls.length - 1} onClick={(ev) => { ev.stopPropagation(); setLayout((l) => { const fl = l.elements.filter((x) => x.anchor === 'flow'); const fixed = l.elements.filter((x) => x.anchor !== 'flow'); [fl[i + 1], fl[i]] = [fl[i], fl[i + 1]]; return { ...l, elements: [...fixed, ...fl] }; }); }}><ArrowDown size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Page */}
        <div className="stage" onPointerDown={() => setSel(null)}>
          <div style={{ width: pageW * zoom, height: pageH * zoom, flexShrink: 0 }}>
            <div className="page-canvas" style={{ width: pageW, height: pageH, transform: `scale(${zoom})` }} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
              {(pageView === 'first' ? bg.first : bg.next) && <img className="bg" src={pageView === 'first' ? bg.first : bg.next} alt="" draggable={false} />}
              {layout.elements.filter(onPage).filter(visibleForDoc).filter((e) => (e.showIf === 'no_logo' ? !logoUrl : e.showIf === 'has_logo' ? !!logoUrl : true)).map((e) => (
                <ElementView key={e.id} e={e} values={values} logoUrl={logoUrl} selected={sel?.kind === 'el' && sel.id === e.id} onPointerDown={onPointerDown} ctx={ctx} sample={sample} />
              ))}
              {pageView === 'first' ? (
                <>
                  <div className="d-zone" style={{ left: layout.table.x, top: layout.table.y, width: layout.table.w, height: layout.table.bottom - layout.table.y, outline: sel?.kind === 'table' ? '2px solid #0d9488' : undefined }} onPointerDown={(ev) => onPointerDown(ev, { kind: 'table' }, 'move')}>
                    <span className="lbl">Tableau des lignes — 1re page</span>
                    <TableHeaderPreview layout={layout} />
                    <div className="handle" style={{ position: 'absolute', right: -5, bottom: -5, width: 10, height: 10, background: '#fff', border: '2px solid #0d9488', cursor: 'nwse-resize' }} onPointerDown={(ev) => onPointerDown(ev, { kind: 'table' }, 'se')} />
                  </div>
                  {flowPreview.map(({ e, y, h }) => (
                    <div key={e.id} className={`d-el ${sel?.kind === 'el' && sel.id === e.id ? 'sel' : ''}`} style={{ left: e.x, top: y, width: e.w, height: h, outline: '1px dashed #94a3b8', background: 'rgba(148,163,184,0.06)' }} onPointerDown={(ev) => onPointerDown(ev, { kind: 'el', id: e.id }, 'move')}>
                      <FlowPreview e={e} values={values} sample={sample} />
                      <div className="handle e" onPointerDown={(ev) => onPointerDown(ev, { kind: 'el', id: e.id }, 'e')} />
                    </div>
                  ))}
                </>
              ) : (
                <div className="d-zone cont" style={{ left: layout.table.x, top: layout.table.continuationTop, width: layout.table.w, height: layout.table.continuationBottom - layout.table.continuationTop, outline: sel?.kind === 'cont' ? '2px solid #7c3aed' : undefined }} onPointerDown={(ev) => onPointerDown(ev, { kind: 'cont' }, 'move')}>
                  <span className="lbl">Tableau — pages suivantes{layout.table.repeatHeader ? ' (en-tête répété)' : ''}</span>
                  {layout.table.repeatHeader && <TableHeaderPreview layout={layout} />}
                  <div style={{ position: 'absolute', right: -5, bottom: -5, width: 10, height: 10, background: '#fff', border: '2px solid #7c3aed', cursor: 'nwse-resize' }} onPointerDown={(ev) => onPointerDown(ev, { kind: 'cont' }, 'se')} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Propriétés */}
        <div className="panel right">
          {selected ? (
            <ElementProps e={selected} update={(p, rec) => updateEl(selected.id, p, rec)} remove={() => removeEl(selected.id)} duplicate={() => addEl({ ...selected, name: `${selected.name ?? ''} (copie)`, x: selected.x + 10, y: selected.y + 10 })} />
          ) : sel?.kind === 'table' || sel?.kind === 'cont' ? (
            <TableProps layout={layout} setLayout={setLayout} />
          ) : (
            <PageProps layout={layout} setLayout={setLayout} tpl={tpl} />
          )}
        </div>
      </div>
      {preview != null && (
        <PdfPreviewModal
          title="Aperçu du modèle"
          fileName={`Aperçu ${name}.pdf`}
          generate={async () => {
            await saveLayout(ctx.db, tpl.id, layout, name).then(() => setDirty(false));
            const fresh = await getTemplate(ctx.db, tpl.id);
            return renderWithTemplate(ctx, sampleSnapshot(settings, docKind, preview), fresh!, { watermark: 'EXEMPLE' });
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function cssFont(w?: FontWeight) {
  return { fontWeight: w === 'bold' ? 700 : w === 'semibold' ? 600 : 400, fontStyle: w === 'italic' ? 'italic' : 'normal' } as const;
}

function ElementView({ e, values, logoUrl, selected, onPointerDown, ctx, sample }: { e: LayoutElement; values: Record<string, string>; logoUrl: string | null; selected: boolean; onPointerDown: (ev: React.PointerEvent, s: Sel, m: 'move' | 'se' | 'e' | 's') => void; ctx: any; sample: any }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  useEffect(() => {
    if (e.type === 'image' && e.src && e.src !== 'logo') {
      ctx.files.read(e.src).then((b: Uint8Array) => setImgUrl(URL.createObjectURL(new Blob([b as BlobPart])))).catch(() => setImgUrl(null));
    }
  }, [e.type, e.src, ctx.files]);
  const st = { size: 9, weight: 'regular' as FontWeight, color: '#1e293b', align: 'left' as Align, lineHeight: 1.3, ...(e.style ?? {}) };
  const box = e.box ?? {};
  const style: React.CSSProperties = {
    left: e.x, top: e.y, width: e.w, height: e.type === 'line' ? Math.max(2, e.h) : e.h,
    background: e.type === 'rect' || e.type === 'text' ? box.background ?? undefined : undefined,
    border: box.borderColor && e.type !== 'line' ? `${box.borderWidth ?? 0.8}px solid ${box.borderColor}` : undefined,
    borderRadius: box.radius, padding: box.padding,
  };
  let content: React.ReactNode = null;
  if (e.type === 'text') {
    const filled = fillText(e.text ?? '', values).text;
    const [first, ...rest] = filled.split('\n');
    content = (
      <div style={{ fontSize: st.size, color: st.color, textAlign: st.align, lineHeight: st.lineHeight, whiteSpace: 'pre-wrap', fontFamily: 'Arial, Liberation Sans, sans-serif', ...cssFont(st.weight) }}>
        {st.firstLine ? <><div style={{ fontSize: st.firstLine.size ?? st.size, color: st.firstLine.color ?? st.color, ...cssFont(st.firstLine.weight ?? st.weight) }}>{first}</div>{rest.join('\n')}</> : filled}
      </div>
    );
  } else if (e.type === 'image') {
    const src = e.src === 'logo' ? logoUrl : imgUrl;
    content = src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: e.fit === 'stretch' ? 'fill' : e.fit ?? 'contain', objectPosition: 'left top' }} draggable={false} /> : <div style={{ border: '1px dashed #94a3b8', height: '100%', opacity: 0.6, fontSize: 7, color: '#94a3b8', padding: 2 }} title={e.src === 'logo' ? 'Emplacement du logo (à importer dans Paramètres → Entreprise)' : 'Image'}>{e.src === 'logo' ? 'logo' : 'image'}</div>;
  } else if (e.type === 'line') {
    content = <div style={{ borderTop: `${box.borderWidth ?? 1}px solid ${box.borderColor ?? '#94a3b8'}`, marginTop: 0 }} />;
  } else if (e.type === 'signature') {
    content = <div style={{ fontSize: st.size, color: st.color, fontWeight: 600 }}>{e.text}</div>;
  } else if (e.type === 'totals') {
    content = <FlowPreview e={e} values={values} sample={sample} />;
  }
  return (
    <div className={`d-el ${selected ? 'sel' : ''}`} style={style} onPointerDown={(ev) => onPointerDown(ev, { kind: 'el', id: e.id }, 'move')}>
      {content}
      {selected && (
        <>
          <div className="handle se" onPointerDown={(ev) => onPointerDown(ev, { kind: 'el', id: e.id }, 'se')} />
          <div className="handle e" onPointerDown={(ev) => onPointerDown(ev, { kind: 'el', id: e.id }, 'e')} />
          {e.type !== 'line' && <div className="handle s" onPointerDown={(ev) => onPointerDown(ev, { kind: 'el', id: e.id }, 's')} />}
        </>
      )}
    </div>
  );
}

function FlowPreview({ e, values, sample }: { e: LayoutElement; values: Record<string, string>; sample: any }) {
  const st = { size: 9, color: '#1e293b', lineHeight: 1.3, ...(e.style ?? {}) };
  const box = e.box ?? {};
  const wrap: React.CSSProperties = { background: box.background ?? undefined, border: box.borderColor ? `${box.borderWidth ?? 0.8}px solid ${box.borderColor}` : undefined, borderRadius: box.radius, padding: box.padding, height: '100%', fontFamily: 'Arial, Liberation Sans, sans-serif' };
  if (e.type === 'totals') {
    return (
      <div style={wrap}>
        {totalsRows(sample).map((r) => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: r.strong ? st.size + 1.5 : st.size, lineHeight: 1.9, fontWeight: r.strong ? 700 : 400, color: r.muted ? '#64748b' : r.strong ? '#0f1b3d' : st.color }}>
            <span>{r.label}</span><span>{r.value}</span>
          </div>
        ))}
      </div>
    );
  }
  if (e.type === 'signature') return <div style={{ ...wrap, fontSize: st.size, color: st.color, fontWeight: 600 }}>{e.text}</div>;
  return <div style={{ ...wrap, fontSize: st.size, color: st.color, lineHeight: st.lineHeight, whiteSpace: 'pre-wrap', textAlign: (e.style?.align as any) ?? 'left' }}>{fillText(e.text ?? '', values).text || <span style={{ color: '#94a3b8' }}>{e.name} (vide sur l'exemple)</span>}</div>;
}

function TableHeaderPreview({ layout }: { layout: TemplateLayout }) {
  const t = layout.table;
  const total = t.columns.reduce((a, c) => a + c.width, 0) || 1;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: t.header.height, background: t.header.background, color: t.header.color, display: 'flex', fontSize: t.header.size, fontWeight: 700, fontFamily: 'Arial, sans-serif', alignItems: 'center', borderBottom: t.header.background === '#ffffff' ? `1.2px solid ${layout.colors.primary}` : undefined }}>
      {t.columns.map((c) => <div key={c.key} style={{ width: `${(c.width / total) * 100}%`, padding: '0 6px', textAlign: c.align }}>{c.label}</div>)}
    </div>
  );
}

function Num({ label, value, onChange, step = 0.5 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <Field label={label}>
      <input className="input sm num" type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

function ElementProps({ e, update, remove, duplicate }: { e: LayoutElement; update: (p: Partial<LayoutElement>, record?: boolean) => void; remove: () => void; duplicate: () => void }) {
  const st = { size: 9, weight: 'regular', color: '#1e293b', align: 'left', lineHeight: 1.3, ...(e.style ?? {}) } as any;
  const box = e.box ?? {};
  const setStyle = (p: any) => update({ style: { ...(e.style ?? {}), ...p } });
  const setBox = (p: any) => update({ box: { ...box, ...p } });
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row between"><h3>{({ text: 'Texte', image: 'Image', rect: 'Rectangle', line: 'Ligne', totals: 'Bloc des totaux', signature: 'Zone de signature' } as any)[e.type]}</h3>
        <div className="row" style={{ gap: 4 }}><Button size="sm" icon={Copy} onClick={duplicate} aria-label="Dupliquer" /><Button size="sm" variant="danger" icon={Trash2} onClick={remove} aria-label="Supprimer" /></div>
      </div>
      <Field label="Nom"><input className="input sm" value={e.name ?? ''} onChange={(ev) => update({ name: ev.target.value })} /></Field>
      {(e.type === 'text' || e.type === 'signature') && (
        <Field label={e.type === 'text' ? 'Contenu (champs {{...}} autorisés)' : 'Libellé'}>
          <textarea className="input" rows={e.type === 'text' ? 6 : 2} value={e.text ?? ''} onChange={(ev) => update({ text: ev.target.value })} />
        </Field>
      )}
      <Field label="Placement">
        <select className="input sm" value={e.anchor} onChange={(ev) => update({ anchor: ev.target.value as any, y: ev.target.value === 'fixed' ? 600 : 0 })}>
          <option value="fixed">Position fixe sur la page</option>
          <option value="flow">Après le tableau (sans chevauchement)</option>
        </select>
      </Field>
      <div className="grid-2" style={{ gap: 8 }}>
        <Num label="X (mm)" value={toMm(e.x)} onChange={(v) => update({ x: toPt(v) })} />
        {e.anchor === 'fixed' && <Num label="Y (mm)" value={toMm(e.y)} onChange={(v) => update({ y: toPt(v) })} />}
        <Num label="Largeur (mm)" value={toMm(e.w)} onChange={(v) => update({ w: toPt(v) })} />
        {(e.anchor === 'fixed' || e.type === 'signature') && <Num label="Hauteur (mm)" value={toMm(e.h)} onChange={(v) => update({ h: toPt(v) })} />}
      </div>
      {e.anchor === 'fixed' && (
        <Field label="Pages">
          <select className="input sm" value={e.pages} onChange={(ev) => update({ pages: ev.target.value as PageRule })}>
            <option value="all">Toutes les pages</option>
            <option value="first">Première page</option>
            <option value="not_first">Pages suivantes</option>
            <option value="last">Dernière page</option>
          </select>
        </Field>
      )}
      {(e.type === 'text' || e.type === 'totals' || e.type === 'signature') && (
        <>
          <div className="form-section">Texte</div>
          <div className="grid-2" style={{ gap: 8 }}>
            <Num label="Taille (pt)" value={st.size} onChange={(v) => setStyle({ size: v })} />
            <Field label="Couleur"><input type="color" className="input sm" value={st.color} onChange={(ev) => setStyle({ color: ev.target.value })} /></Field>
            <Field label="Graisse"><select className="input sm" value={st.weight} onChange={(ev) => setStyle({ weight: ev.target.value })}><option value="regular">Normal</option><option value="semibold">Demi-gras</option><option value="bold">Gras</option><option value="italic">Italique</option></select></Field>
            <Field label="Alignement"><select className="input sm" value={st.align} onChange={(ev) => setStyle({ align: ev.target.value })}><option value="left">Gauche</option><option value="center">Centré</option><option value="right">Droite</option></select></Field>
            <Num label="Interligne" value={st.lineHeight} step={0.05} onChange={(v) => setStyle({ lineHeight: v })} />
          </div>
          {e.type === 'text' && <label className="check small"><input type="checkbox" checked={!!st.firstLine} onChange={(ev) => setStyle({ firstLine: ev.target.checked ? { weight: 'bold', size: st.size + 1.5 } : null })} /> Première ligne en gras (titre)</label>}
        </>
      )}
      {e.type !== 'image' && (
        <>
          <div className="form-section">Cadre</div>
          <div className="grid-2" style={{ gap: 8 }}>
            {e.type !== 'line' && <Field label="Fond"><div className="row" style={{ gap: 4 }}><input type="checkbox" checked={!!box.background} onChange={(ev) => setBox({ background: ev.target.checked ? '#f1f5f9' : null })} />{box.background && <input type="color" className="input sm" value={box.background} onChange={(ev) => setBox({ background: ev.target.value })} />}</div></Field>}
            <Field label={e.type === 'line' ? 'Couleur' : 'Bordure'}><div className="row" style={{ gap: 4 }}>{e.type !== 'line' && <input type="checkbox" checked={!!box.borderColor} onChange={(ev) => setBox({ borderColor: ev.target.checked ? '#cbd5e1' : null })} />}{(box.borderColor || e.type === 'line') && <input type="color" className="input sm" value={box.borderColor ?? '#94a3b8'} onChange={(ev) => setBox({ borderColor: ev.target.value })} />}</div></Field>
            <Num label="Épaisseur" value={box.borderWidth ?? 0.8} step={0.1} onChange={(v) => setBox({ borderWidth: v })} />
            {e.type !== 'line' && <Num label="Arrondi" value={box.radius ?? 0} onChange={(v) => setBox({ radius: v })} />}
            {e.type !== 'line' && e.type !== 'rect' && <Num label="Marge interne" value={box.padding ?? 0} onChange={(v) => setBox({ padding: v })} />}
          </div>
        </>
      )}
      {e.type === 'image' && (
        <Field label="Ajustement"><select className="input sm" value={e.fit ?? 'contain'} onChange={(ev) => update({ fit: ev.target.value as any })}><option value="contain">Contenir (proportions)</option><option value="cover">Couvrir</option><option value="stretch">Étirer</option></select></Field>
      )}
      <div className="form-section">Affichage</div>
      {e.type === 'text' && <label className="check small"><input type="checkbox" checked={!!e.hideIfEmpty} onChange={(ev) => update({ hideIfEmpty: ev.target.checked })} /> Masquer si les champs sont vides</label>}
      <Field label="Logo">
        <select className="input sm" value={e.showIf ?? ''} onChange={(ev) => update({ showIf: (ev.target.value || undefined) as any })}>
          <option value="">Toujours afficher</option><option value="has_logo">Seulement si un logo est défini</option><option value="no_logo">Seulement s'il n'y a pas de logo</option>
        </select>
      </Field>
      <div className="label">Types de documents</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {(['devis', 'facture', 'acompte', 'solde', 'avoir'] as const).map((k) => {
          const all = !e.docTypes || e.docTypes.length === 0;
          const on = all || e.docTypes!.includes(k);
          return <button key={k} className={`chip ${on ? 'on' : ''}`} onClick={() => {
            const cur = all ? ['devis', 'facture', 'acompte', 'solde', 'avoir'] : [...e.docTypes!];
            const next = on ? cur.filter((x) => x !== k) : [...cur, k];
            update({ docTypes: next.length === 5 ? undefined : (next as any) });
          }}>{k}</button>;
        })}
      </div>
    </div>
  );
}

function TableProps({ layout, setLayout }: { layout: TemplateLayout; setLayout: (fn: (l: TemplateLayout) => TemplateLayout) => void }) {
  const t = layout.table;
  const set = (p: Partial<TemplateLayout['table']>) => setLayout((l) => ({ ...l, table: { ...l.table, ...p } }));
  const allKeys = Object.keys(COLUMN_LABELS) as ColumnKey[];
  return (
    <div className="col" style={{ gap: 10 }}>
      <h3>Tableau des lignes</h3>
      <p className="tiny muted">Le tableau se répète sur autant de pages que nécessaire. Une ligne n'est jamais coupée entre deux pages. Les blocs après le tableau (totaux, mentions, signature) sont placés à la suite, sur une nouvelle page si besoin.</p>
      <div className="form-section">1re page</div>
      <div className="grid-2" style={{ gap: 8 }}>
        <Num label="X (mm)" value={toMm(t.x)} onChange={(v) => set({ x: toPt(v) })} />
        <Num label="Largeur (mm)" value={toMm(t.w)} onChange={(v) => set({ w: toPt(v) })} />
        <Num label="Haut (mm)" value={toMm(t.y)} onChange={(v) => set({ y: toPt(v) })} />
        <Num label="Limite basse (mm)" value={toMm(t.bottom)} onChange={(v) => set({ bottom: toPt(v) })} />
      </div>
      <div className="form-section">Pages suivantes</div>
      <div className="grid-2" style={{ gap: 8 }}>
        <Num label="Haut (mm)" value={toMm(t.continuationTop)} onChange={(v) => set({ continuationTop: toPt(v) })} />
        <Num label="Limite basse (mm)" value={toMm(t.continuationBottom)} onChange={(v) => set({ continuationBottom: toPt(v) })} />
      </div>
      <label className="check small"><input type="checkbox" checked={t.repeatHeader} onChange={(e) => set({ repeatHeader: e.target.checked })} /> Répéter l'en-tête du tableau</label>
      <label className="check small"><input type="checkbox" checked={t.showDescriptions} onChange={(e) => set({ showDescriptions: e.target.checked })} /> Afficher les descriptions détaillées</label>
      <div className="form-section">Colonnes</div>
      {t.columns.map((c, i) => (
        <div key={c.key} className="row" style={{ gap: 4 }}>
          <input className="input sm" style={{ flex: 2 }} value={c.label} onChange={(e) => set({ columns: t.columns.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} aria-label="Libellé" />
          <input className="input sm num" style={{ width: 52 }} type="number" min={2} value={c.width} onChange={(e) => set({ columns: t.columns.map((x, k) => (k === i ? { ...x, width: Number(e.target.value) } : x)) })} aria-label="Largeur relative" title="Largeur relative" />
          <button className="btn ghost sm icon" disabled={i === 0} onClick={() => { const n = [...t.columns]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set({ columns: n }); }} aria-label="Monter"><ArrowUp size={12} /></button>
          <button className="btn ghost sm icon" disabled={c.key === 'designation'} onClick={() => set({ columns: t.columns.filter((_, k) => k !== i) })} aria-label="Retirer"><Trash2 size={12} /></button>
        </div>
      ))}
      <select className="input sm" value="" onChange={(e) => { const k = e.target.value as ColumnKey; if (k) set({ columns: [...t.columns, { key: k, label: COLUMN_LABELS[k], width: 12, align: 'right' }] }); }}>
        <option value="">+ Ajouter une colonne…</option>
        {allKeys.filter((k) => !t.columns.some((c) => c.key === k)).map((k) => <option key={k} value={k}>{COLUMN_LABELS[k]}</option>)}
      </select>
      <div className="form-section">Style</div>
      <div className="grid-2" style={{ gap: 8 }}>
        <Field label="Fond en-tête"><input type="color" className="input sm" value={t.header.background} onChange={(e) => set({ header: { ...t.header, background: e.target.value } })} /></Field>
        <Field label="Texte en-tête"><input type="color" className="input sm" value={t.header.color} onChange={(e) => set({ header: { ...t.header, color: e.target.value } })} /></Field>
        <Num label="Taille en-tête" value={t.header.size} onChange={(v) => set({ header: { ...t.header, size: v } })} />
        <Num label="Taille lignes" value={t.row.size} onChange={(v) => set({ row: { ...t.row, size: v } })} />
        <Field label="Lignes alternées"><div className="row" style={{ gap: 4 }}><input type="checkbox" checked={!!t.row.zebra} onChange={(e) => set({ row: { ...t.row, zebra: e.target.checked ? '#f8fafc' : null } })} />{t.row.zebra && <input type="color" className="input sm" value={t.row.zebra} onChange={(e) => set({ row: { ...t.row, zebra: e.target.value } })} />}</div></Field>
        <Field label="Séparateurs"><div className="row" style={{ gap: 4 }}><input type="checkbox" checked={!!t.row.borderColor} onChange={(e) => set({ row: { ...t.row, borderColor: e.target.checked ? '#e2e8f0' : null } })} />{t.row.borderColor && <input type="color" className="input sm" value={t.row.borderColor} onChange={(e) => set({ row: { ...t.row, borderColor: e.target.value } })} />}</div></Field>
      </div>
    </div>
  );
}

function PageProps({ layout, setLayout, tpl }: { layout: TemplateLayout; setLayout: (fn: (l: TemplateLayout) => TemplateLayout) => void; tpl: DocTemplate }) {
  const { ctx, run } = useApp();
  const c = layout.colors;
  const setColors = (p: Partial<TemplateLayout['colors']>) => setLayout((l) => ({ ...l, colors: { ...l.colors, ...p } }));
  return (
    <div className="col" style={{ gap: 10 }}>
      <h3>Page et modèle</h3>
      <p className="tiny muted">Sélectionnez un élément sur la page pour le modifier. Flèches : déplacer (Maj = ×10) · Suppr : supprimer · Ctrl+Z / Ctrl+Y : annuler / rétablir · Ctrl+S : enregistrer.</p>
      <Field label="Utilisation">
        <select className="input sm" value={tpl.doc_type} onChange={(e) => run(() => renameTemplate(ctx.db, tpl.id, tpl.name, e.target.value as any))}>
          <option value="tous">Devis et factures</option><option value="devis">Devis uniquement</option><option value="facture">Factures uniquement</option>
        </select>
      </Field>
      <div className="small">Format : {toMm(layout.page.width)} × {toMm(layout.page.height)} mm</div>
      {layout.background.type !== 'none' && (
        <>
          <div className="form-section">Fond importé</div>
          {layout.background.type === 'pdf' && (
            <div className="grid-2" style={{ gap: 8 }}>
              <Field label="Page du fond (1re page)"><input className="input sm num" type="number" min={1} max={tpl.background_pages} value={(layout.background.firstPage ?? 0) + 1} onChange={(e) => setLayout((l) => ({ ...l, background: { ...l.background, firstPage: Math.max(0, Number(e.target.value) - 1) } }))} /></Field>
              <Field label="Page du fond (suivantes)"><input className="input sm num" type="number" min={1} max={tpl.background_pages} value={(layout.background.otherPages ?? 0) + 1} onChange={(e) => setLayout((l) => ({ ...l, background: { ...l.background, otherPages: Math.max(0, Number(e.target.value) - 1) } }))} /></Field>
            </div>
          )}
          <Button size="sm" variant="danger" onClick={() => run(() => replaceBackground(ctx, tpl.id, '', null), 'Fond retiré')}>Retirer le fond</Button>
        </>
      )}
      <div className="form-section">Couleurs</div>
      <div className="grid-2" style={{ gap: 8 }}>
        {([['primary', 'Principale'], ['accent', 'Accent'], ['text', 'Texte'], ['muted', 'Secondaire'], ['light', 'Fonds clairs']] as const).map(([k, l]) => (
          <Field key={k} label={l}><input type="color" className="input sm" value={c[k]} onChange={(e) => setColors({ [k]: e.target.value })} /></Field>
        ))}
      </div>
      <Num label="Espace entre les blocs après le tableau (pt)" value={layout.flowGap} onChange={(v) => setLayout((l) => ({ ...l, flowGap: v }))} />
    </div>
  );
}
