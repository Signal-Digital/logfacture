/**
 * Modèles de documents : modèles visuels (éditeur), fonds importés (PDF,
 * PNG, JPEG) et modèles Word (DOCX).
 */
import { PDFDocument } from 'pdf-lib';
import type { Ctx } from './context';
import type { Db } from '@/lib/db';
import { BusinessError, assert } from './context';
import { logEvent } from './audit';
import { classicLayout, overlayLayout } from '@/pdf/builtinTemplates';
import { inspectDocx } from '@/pdf/docx';
import type { TemplateLayout } from '@/pdf/types';
import { extensionOf } from '@/lib/files';

export interface DocTemplate {
  id: number;
  name: string;
  doc_type: 'devis' | 'facture' | 'tous';
  engine: 'visuel' | 'docx';
  background_type: 'none' | 'pdf' | 'image';
  background_path: string | null;
  background_pages: number;
  docx_path: string | null;
  layout_json: string;
  is_default_quote: number;
  is_default_invoice: number;
  is_builtin: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export function parseLayout(t: Pick<DocTemplate, 'layout_json'>): TemplateLayout {
  try {
    const l = JSON.parse(t.layout_json);
    if (l && l.version === 1 && l.table && Array.isArray(l.elements)) return l;
  } catch {
    /* modèle corrompu : on retombe sur le modèle classique */
  }
  return classicLayout();
}

export async function listTemplates(db: Db, includeArchived = false): Promise<DocTemplate[]> {
  return db.all<DocTemplate>(`SELECT * FROM doc_templates ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY is_builtin DESC, name COLLATE NOCASE`);
}

export async function getTemplate(db: Db, id: number): Promise<DocTemplate | undefined> {
  return db.get<DocTemplate>('SELECT * FROM doc_templates WHERE id = ?', [id]);
}

/** Modèle à utiliser : celui demandé, sinon le modèle par défaut du type, sinon le premier. */
export async function resolveTemplate(db: Db, templateId: number | null | undefined, kind: 'devis' | 'facture'): Promise<DocTemplate> {
  if (templateId) {
    const t = await getTemplate(db, templateId);
    if (t && !t.archived_at) return t;
  }
  const def = await db.get<DocTemplate>(
    `SELECT * FROM doc_templates WHERE archived_at IS NULL AND ${kind === 'devis' ? 'is_default_quote' : 'is_default_invoice'} = 1 LIMIT 1`,
  );
  if (def) return def;
  const any = await db.get<DocTemplate>("SELECT * FROM doc_templates WHERE archived_at IS NULL AND engine = 'visuel' ORDER BY id LIMIT 1");
  if (!any) throw new BusinessError('Aucun modèle de document disponible.');
  return any;
}

export async function saveLayout(db: Db, id: number, layout: TemplateLayout, name?: string): Promise<void> {
  const t = await getTemplate(db, id);
  assert(t, 'Modèle introuvable.');
  validateLayout(layout);
  await db.run(
    `UPDATE doc_templates SET layout_json = ?, name = COALESCE(?, name), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [JSON.stringify(layout), name?.trim() || null, id],
  );
}

export function validateLayout(l: TemplateLayout): void {
  const t = l.table;
  if (t.w <= 50) throw new BusinessError('Le tableau des lignes est trop étroit.');
  if (t.bottom - t.y < 80) throw new BusinessError('La zone du tableau en première page est trop petite (80 pt minimum).');
  if (t.continuationBottom - t.continuationTop < 120) throw new BusinessError('La zone du tableau des pages suivantes est trop petite.');
  if (t.x < 0 || t.x + t.w > l.page.width + 1 || t.bottom > l.page.height || t.continuationBottom > l.page.height) {
    throw new BusinessError('Le tableau dépasse de la page.');
  }
  if (!t.columns.some((c) => c.key === 'designation')) throw new BusinessError('Le tableau doit contenir la colonne « Désignation ».');
  if (!t.columns.some((c) => c.key === 'total_ht' || c.key === 'total_ttc')) throw new BusinessError('Le tableau doit contenir une colonne de total.');
}

export async function createVisualTemplate(db: Db, name: string, layout?: TemplateLayout): Promise<number> {
  assert(name.trim(), 'Le nom du modèle est obligatoire.');
  const r = await db.run("INSERT INTO doc_templates (name, engine, layout_json) VALUES (?, 'visuel', ?)", [name.trim(), JSON.stringify(layout ?? classicLayout())]);
  await logEvent(db, { entity: 'modele', id: r.lastInsertId, action: 'creation', summary: `Modèle créé : ${name.trim()}` });
  return r.lastInsertId;
}

export async function duplicateTemplate(ctx: Ctx, id: number): Promise<number> {
  const t = await getTemplate(ctx.db, id);
  assert(t, 'Modèle introuvable.');
  const r = await ctx.db.run(
    `INSERT INTO doc_templates (name, doc_type, engine, background_type, background_path, background_pages, docx_path, layout_json)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, ?)`,
    [`${t.name} (copie)`, t.doc_type, t.engine, t.background_type, t.background_pages, t.layout_json],
  );
  const newId = r.lastInsertId;
  // Copie physique des fichiers : chaque modèle est indépendant.
  if (t.background_path) {
    const ext = extensionOf(t.background_path);
    const path = `templates/${newId}/fond.${ext}`;
    await ctx.files.write(path, await ctx.files.read(t.background_path));
    await ctx.db.run('UPDATE doc_templates SET background_path = ? WHERE id = ?', [path, newId]);
  }
  if (t.docx_path) {
    const path = `templates/${newId}/modele.docx`;
    await ctx.files.write(path, await ctx.files.read(t.docx_path));
    await ctx.db.run('UPDATE doc_templates SET docx_path = ? WHERE id = ?', [path, newId]);
  }
  await logEvent(ctx.db, { entity: 'modele', id: newId, action: 'duplication', summary: `Modèle « ${t.name} » dupliqué` });
  return newId;
}

export async function setDefaultTemplate(db: Db, id: number, kind: 'devis' | 'facture'): Promise<void> {
  const col = kind === 'devis' ? 'is_default_quote' : 'is_default_invoice';
  await db.tx(async (t) => {
    const tpl = await getTemplate(t, id);
    assert(tpl && !tpl.archived_at, 'Modèle introuvable.');
    await t.run(`UPDATE doc_templates SET ${col} = 0`);
    await t.run(`UPDATE doc_templates SET ${col} = 1 WHERE id = ?`, [id]);
  });
}

export async function archiveTemplate(db: Db, id: number): Promise<void> {
  const t = await getTemplate(db, id);
  assert(t, 'Modèle introuvable.');
  if (t.is_default_quote || t.is_default_invoice) throw new BusinessError('Ce modèle est utilisé par défaut : choisissez un autre modèle par défaut avant de l\'archiver.');
  await db.run("UPDATE doc_templates SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [id]);
}

export async function renameTemplate(db: Db, id: number, name: string, docType?: DocTemplate['doc_type']): Promise<void> {
  assert(name.trim(), 'Le nom du modèle est obligatoire.');
  await db.run("UPDATE doc_templates SET name = ?, doc_type = COALESCE(?, doc_type), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [name.trim(), docType ?? null, id]);
}

export interface ImportResult {
  id: number;
  warnings: string[];
}

/**
 * Importe un modèle depuis un fichier : PDF ou image → fond graphique d'un
 * modèle visuel (zones à ajuster dans l'éditeur) ; DOCX → modèle Word.
 */
export async function importTemplate(ctx: Ctx, fileName: string, bytes: Uint8Array, name?: string): Promise<ImportResult> {
  const ext = extensionOf(fileName);
  const label = (name ?? fileName.replace(/\.[^.]+$/, '')).trim() || 'Modèle importé';
  const warnings: string[] = [];
  if (ext === 'pdf') {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (e: any) {
      throw new BusinessError(`PDF illisible : ${e.message}`);
    }
    if (doc.isEncrypted) warnings.push('Ce PDF est protégé : son rendu comme fond peut être incomplet. Utilisez de préférence une version non protégée.');
    const first = doc.getPage(0);
    const { width, height } = first.getSize();
    if (Math.abs(width - 595.28) > 2 || Math.abs(height - 841.89) > 2) warnings.push(`Format de page ${Math.round(width)} × ${Math.round(height)} pt (A4 = 595 × 842) : le document conservera ce format.`);
    const layout = overlayLayout({ width, height });
    layout.background = { type: 'pdf', firstPage: 0, otherPages: doc.getPageCount() > 1 ? 1 : 0 };
    warnings.push('Ajustez dans l\'éditeur la zone du tableau et la position des champs pour qu\'ils ne recouvrent pas le décor du modèle.');
    const r = await ctx.db.run("INSERT INTO doc_templates (name, engine, background_type, background_pages, layout_json) VALUES (?, 'visuel', 'pdf', ?, ?)", [label, doc.getPageCount(), JSON.stringify(layout)]);
    const path = `templates/${r.lastInsertId}/fond.pdf`;
    await ctx.files.write(path, bytes);
    await ctx.db.run('UPDATE doc_templates SET background_path = ? WHERE id = ?', [path, r.lastInsertId]);
    await logEvent(ctx.db, { entity: 'modele', id: r.lastInsertId, action: 'import', summary: `Modèle PDF importé : ${label} (${doc.getPageCount()} page(s))` });
    return { id: r.lastInsertId, warnings };
  }
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpg) throw new BusinessError('Image non reconnue (PNG ou JPEG attendu).');
    const layout = overlayLayout();
    layout.background = { type: 'image' };
    warnings.push("L'image est étirée au format A4 : utilisez une image au ratio A4 (par exemple 2480 × 3508 pixels à 300 dpi).");
    const r = await ctx.db.run("INSERT INTO doc_templates (name, engine, background_type, background_pages, layout_json) VALUES (?, 'visuel', 'image', 1, ?)", [label, JSON.stringify(layout)]);
    const path = `templates/${r.lastInsertId}/fond.${isPng ? 'png' : 'jpg'}`;
    await ctx.files.write(path, bytes);
    await ctx.db.run('UPDATE doc_templates SET background_path = ? WHERE id = ?', [path, r.lastInsertId]);
    await logEvent(ctx.db, { entity: 'modele', id: r.lastInsertId, action: 'import', summary: `Fond image importé : ${label}` });
    return { id: r.lastInsertId, warnings };
  }
  if (ext === 'docx') {
    const info = inspectDocx(bytes);
    if (!info.valid) throw new BusinessError(info.error ?? 'Document Word invalide.');
    if (info.fields.length === 0 && info.loops.length === 0) {
      warnings.push('Aucun champ {{...}} trouvé dans ce document : insérez des champs (ex. {{client.nom}}) dans Word pour qu\'ils soient remplis.');
    }
    if (!info.loops.includes('lignes')) {
      warnings.push('Aucune boucle {{#lignes}} … {{/lignes}} : les lignes de prestations ne seront pas listées.');
    }
    const r = await ctx.db.run("INSERT INTO doc_templates (name, engine, layout_json) VALUES (?, 'docx', ?)", [label, JSON.stringify(classicLayout())]);
    const path = `templates/${r.lastInsertId}/modele.docx`;
    await ctx.files.write(path, bytes);
    await ctx.db.run('UPDATE doc_templates SET docx_path = ? WHERE id = ?', [path, r.lastInsertId]);
    await logEvent(ctx.db, { entity: 'modele', id: r.lastInsertId, action: 'import', summary: `Modèle Word importé : ${label} (${info.fields.length} champ(s))` });
    return { id: r.lastInsertId, warnings };
  }
  throw new BusinessError('Format non pris en charge : PDF, DOCX, PNG ou JPEG uniquement.');
}

/** Remplace le fond d'un modèle visuel existant. */
export async function replaceBackground(ctx: Ctx, id: number, fileName: string, bytes: Uint8Array | null): Promise<void> {
  const t = await getTemplate(ctx.db, id);
  assert(t && t.engine === 'visuel', 'Modèle visuel introuvable.');
  const layout = parseLayout(t);
  if (!bytes) {
    layout.background = { type: 'none' };
    await ctx.db.run("UPDATE doc_templates SET background_type = 'none', background_path = NULL, background_pages = 0, layout_json = ? WHERE id = ?", [JSON.stringify(layout), id]);
    return;
  }
  const ext = extensionOf(fileName);
  let pages = 1;
  let type: 'pdf' | 'image' = 'image';
  if (ext === 'pdf') {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    pages = doc.getPageCount();
    type = 'pdf';
    const { width, height } = doc.getPage(0).getSize();
    layout.page = { width, height };
    layout.background = { type: 'pdf', firstPage: 0, otherPages: pages > 1 ? 1 : 0 };
  } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
    layout.background = { type: 'image' };
  } else {
    throw new BusinessError('Fond : PDF, PNG ou JPEG uniquement.');
  }
  const path = `templates/${id}/fond-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  await ctx.files.write(path, bytes);
  await ctx.db.run('UPDATE doc_templates SET background_type = ?, background_path = ?, background_pages = ?, layout_json = ? WHERE id = ?', [type, path, pages, JSON.stringify(layout), id]);
}
