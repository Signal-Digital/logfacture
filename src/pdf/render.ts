/**
 * Moteur de rendu PDF (pdf-lib).
 *
 * 1. Mise en page : le tableau des lignes est paginé (en-tête répété, aucune
 *    ligne coupée entre deux pages sauf si elle dépasse à elle seule une page),
 *    puis les blocs « flux » (totaux, conditions, mentions, signature) sont
 *    placés à la suite, sur une nouvelle page si la place manque.
 * 2. Dessin : fond (PDF/image importé), éléments fixes (en-têtes, pieds de
 *    page, numéros de page), puis tableau et blocs.
 */
import { PDFDocument, PDFName, PDFString, degrees, rgb, type PDFFont, type PDFPage, type PDFImage, type PDFEmbeddedPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { builtinFont } from './fonts';
import { buildFieldValues, docTypeKey, fillText, formatLines, totalsRows, type DocSnapshot, type FormattedLine } from './fields';
import type { Align, FontWeight, LayoutElement, TableColumn, TemplateLayout, TextStyle } from './types';

export interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

export interface SignatureStamp {
  imagePng: Uint8Array;
  signerName: string;
  signerRole?: string | null;
  signedAt: string; // ISO
  mention: string;
}

export interface RenderInput {
  snapshot: DocSnapshot;
  layout: TemplateLayout;
  background?: { bytes: Uint8Array; kind: 'pdf' | 'png' | 'jpg' } | null;
  logo?: { bytes: Uint8Array; kind: 'png' | 'jpg' } | null;
  images?: Record<string, { bytes: Uint8Array; kind: 'png' | 'jpg' }>;
  watermark?: string | null;
  signature?: SignatureStamp | null;
  extraFields?: Record<string, string>;
}

export interface SignatureZone {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  pageHeight: number;
}

export interface RenderResult {
  bytes: Uint8Array;
  pageCount: number;
  signatureZone: SignatureZone | null;
  /** Diagnostic de pagination (tests) */
  rowsPerPage: number[];
}

export const SIGNATURE_ZONE_KEY = 'SignalDeskSignatureZone';

// ---------- Utilitaires ----------

export function hexColor(hex: string | null | undefined) {
  const h = (hex ?? '#000000').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(v.slice(0, 6), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Supprime les caractères non imprimables (tabulations → espaces). */
export function sanitize(text: string): string {
  return text.replace(/\t/g, '    ').replace(/[\u0000-\u0008\u000b-\u001f\u007f​﻿]/g, '').replace(/ /g, ' ');
}

/** Découpe un texte en lignes tenant dans `maxWidth` (mots trop longs coupés). */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  const width = (s: string) => font.widthOfTextAtSize(s, size);
  const space = width(' ');
  for (const paragraph of sanitize(text).split(/\r?\n/)) {
    if (paragraph.trim() === '') {
      out.push('');
      continue;
    }
    let line = '';
    let lineW = 0;
    for (let word of paragraph.split(/ +/)) {
      let w = width(word);
      if (line && lineW + space + w <= maxWidth) {
        line += ' ' + word;
        lineW += space + w;
        continue;
      }
      if (!line && w <= maxWidth) {
        line = word;
        lineW = w;
        continue;
      }
      if (line) out.push(line);
      line = '';
      lineW = 0;
      while (w > maxWidth && word.length > 1) {
        let cut = Math.max(1, Math.floor((word.length * maxWidth) / w));
        while (cut > 1 && width(word.slice(0, cut)) > maxWidth) cut--;
        while (cut < word.length - 1 && width(word.slice(0, cut + 1)) <= maxWidth) cut++;
        out.push(word.slice(0, cut));
        word = word.slice(cut);
        w = width(word);
      }
      line = word;
      lineW = w;
    }
    out.push(line);
  }
  return out;
}

export interface TextLine {
  text: string;
  font: PDFFont;
  size: number;
  color: string;
  height: number;
}

/** Met en forme un texte (premier paragraphe éventuellement stylé différemment). */
export function layoutText(text: string, st: TextStyle, fonts: Fonts, width: number): { lines: TextLine[]; height: number } {
  const lines: TextLine[] = [];
  const paragraphs = text.split('\n');
  paragraphs.forEach((p, i) => {
    const first = i === 0 && st.firstLine ? st.firstLine : null;
    const size = first?.size ?? st.size;
    const font = fontFor(fonts, first?.weight ?? st.weight);
    const color = first?.color ?? st.color;
    for (const l of wrapText(p, font, size, width)) lines.push({ text: l, font, size, color, height: size * st.lineHeight });
  });
  return { lines, height: lines.reduce((a, l) => a + l.height, 0) };
}

function drawLines(page: PDFPage, lines: TextLine[], x: number, top: number, width: number, align: Align, pageH: number) {
  let y = top;
  for (const l of lines) {
    drawAligned(page, l.text, l.font, l.size, hexColor(l.color), x, width, pageH - (y + l.size), align);
    y += l.height;
  }
}

function roundedRectPath(w: number, h: number, r: number): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r === 0) return `M0,0 H${w} V${h} H0 Z`;
  return `M${r},0 H${w - r} Q${w},0 ${w},${r} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} V${r} Q0,0 ${r},0 Z`;
}

const DEFAULT_STYLE: TextStyle = { size: 9, weight: 'regular', color: '#1e293b', align: 'left', lineHeight: 1.3 };

function styleOf(e: LayoutElement): TextStyle {
  return { ...DEFAULT_STYLE, ...(e.style ?? {}) };
}

function fontFor(fonts: Fonts, w: FontWeight): PDFFont {
  return fonts[w] ?? fonts.regular;
}

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const [regular, bold, italic] = await Promise.all([builtinFont('regular'), builtinFont('bold'), builtinFont('italic')]);
  const boldFont = await doc.embedFont(bold, { subset: true });
  return {
    regular: await doc.embedFont(regular, { subset: true }),
    semibold: boldFont,
    bold: boldFont,
    italic: await doc.embedFont(italic, { subset: true }),
  };
}

// ---------- Mise en page du tableau ----------

interface CellText {
  text: string;
  font: PDFFont;
  size: number;
  color: string;
}

interface Row {
  kind: 'item' | 'section' | 'text';
  height: number;
  designationLines: CellText[];
  cells: Partial<Record<string, string>>;
  zebra: boolean;
  continued?: boolean;
}

function columnWidths(cols: TableColumn[], total: number): number[] {
  const sum = cols.reduce((a, c) => a + c.width, 0) || 1;
  return cols.map((c) => (c.width / sum) * total);
}

const CELL_PAD_X = 6;

function buildRows(lines: FormattedLine[], layout: TemplateLayout, fonts: Fonts): Row[] {
  const t = layout.table;
  const widths = columnWidths(t.columns, t.w);
  const desigIdx = Math.max(0, t.columns.findIndex((c) => c.key === 'designation'));
  const desigWidth = widths[desigIdx] - CELL_PAD_X * 2;
  const fullWidth = t.w - CELL_PAD_X * 2;
  const rows: Row[] = [];
  let itemIndex = 0;
  for (const l of lines) {
    const designationLines: CellText[] = [];
    if (l.kind === 'item') {
      for (const s of wrapText(l.designation, fonts.semibold, t.row.size, desigWidth)) designationLines.push({ text: s, font: fonts.semibold, size: t.row.size, color: t.row.color });
      if (t.showDescriptions && l.description.trim()) {
        for (const s of wrapText(l.description, fonts.regular, t.row.descriptionSize, desigWidth)) designationLines.push({ text: s, font: fonts.regular, size: t.row.descriptionSize, color: t.row.mutedColor });
      }
    } else if (l.kind === 'section') {
      for (const s of wrapText(l.designation, fonts.bold, t.row.size + 0.5, fullWidth)) designationLines.push({ text: s, font: fonts.bold, size: t.row.size + 0.5, color: layout.colors.primary });
    } else {
      for (const s of wrapText(l.designation, fonts.italic, t.row.descriptionSize + 0.5, fullWidth)) designationLines.push({ text: s, font: fonts.italic, size: t.row.descriptionSize + 0.5, color: t.row.mutedColor });
    }
    const textH = designationLines.reduce((a, c) => a + c.size * 1.28, 0);
    rows.push({
      kind: l.kind,
      height: textH + t.row.paddingY * 2,
      designationLines,
      cells: l.kind === 'item' ? { quantity: l.unit ? `${l.quantity} ${l.unit}` : l.quantity, unit: l.unit, unit_price: l.unit_price, discount: l.discount, vat_rate: l.vat_rate, total_ht: l.total_ht, total_ttc: l.total_ttc } : {},
      zebra: l.kind === 'item' ? itemIndex++ % 2 === 1 : false,
    });
  }
  // Une colonne « Unité » séparée : la quantité n'inclut pas l'unité.
  if (t.columns.some((c) => c.key === 'unit')) {
    rows.forEach((r, i) => { if (r.kind === 'item') r.cells.quantity = lines[i].quantity; });
  }
  return rows;
}

/** Coupe une ligne plus haute qu'une page entière (cas extrême : description très longue). */
function splitRow(row: Row, maxHeight: number, paddingY: number): Row[] {
  const parts: Row[] = [];
  let current: CellText[] = [];
  let h = paddingY * 2;
  for (const line of row.designationLines) {
    const lh = line.size * 1.28;
    if (h + lh > maxHeight && current.length) {
      parts.push({ ...row, designationLines: current, height: h, cells: parts.length === 0 ? row.cells : {}, continued: parts.length > 0 });
      current = [];
      h = paddingY * 2;
    }
    current.push(line);
    h += lh;
  }
  parts.push({ ...row, designationLines: current, height: h, cells: parts.length === 0 ? row.cells : {}, continued: parts.length > 0 });
  return parts;
}

// ---------- Rendu principal ----------

type Op = (page: PDFPage, ctx: { pageIndex: number; pageCount: number }) => void;

export async function renderDocument(input: RenderInput): Promise<RenderResult> {
  const { snapshot, layout } = input;
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const values = buildFieldValues(snapshot, input.extraFields);
  const docType = docTypeKey(snapshot);
  const pageW = layout.page.width;
  const pageH = layout.page.height;
  const Y = (top: number) => pageH - top; // conversion haut-gauche → bas-gauche

  // Fond
  let bgPages: PDFEmbeddedPage[] = [];
  let bgImage: PDFImage | null = null;
  if (input.background && layout.background.type !== 'none') {
    if (input.background.kind === 'pdf') {
      const src = await PDFDocument.load(input.background.bytes, { ignoreEncryption: true });
      const count = src.getPageCount();
      const first = Math.min(layout.background.firstPage ?? 0, count - 1);
      const other = Math.min(layout.background.otherPages ?? first, count - 1);
      bgPages = await doc.embedPdf(src, [first, other]);
    } else {
      bgImage = input.background.kind === 'png' ? await doc.embedPng(input.background.bytes) : await doc.embedJpg(input.background.bytes);
    }
  }
  const logo = input.logo ? (input.logo.kind === 'png' ? await doc.embedPng(input.logo.bytes) : await doc.embedJpg(input.logo.bytes)) : null;
  const images: Record<string, PDFImage> = {};
  for (const [k, v] of Object.entries(input.images ?? {})) images[k] = v.kind === 'png' ? await doc.embedPng(v.bytes) : await doc.embedJpg(v.bytes);
  const sigImage = input.signature ? await doc.embedPng(input.signature.imagePng) : null;

  const visible = (e: LayoutElement) => {
    if (e.docTypes && e.docTypes.length && !e.docTypes.includes(docType)) return false;
    if (e.showIf === 'has_logo' && !logo) return false;
    if (e.showIf === 'no_logo' && logo) return false;
    if (e.type === 'image' && e.src === 'logo' && !logo) return false;
    if (e.type === 'image' && e.src && e.src !== 'logo' && !images[e.src]) return false;
    return true;
  };

  // ----- Pagination -----
  const pageOps: Op[][] = [[]];
  const t = layout.table;
  const widths = columnWidths(t.columns, t.w);
  const rowsPerPage: number[] = [0];
  let pageIndex = 0;
  let cursor = t.y;
  let bottom = t.bottom;

  const drawHeader = (pi: number, top: number) => {
    pageOps[pi].push((page) => {
      if (t.header.background && t.header.background !== '#ffffff') {
        page.drawRectangle({ x: t.x, y: Y(top + t.header.height), width: t.w, height: t.header.height, color: hexColor(t.header.background) });
      } else {
        page.drawLine({ start: { x: t.x, y: Y(top + t.header.height) }, end: { x: t.x + t.w, y: Y(top + t.header.height) }, thickness: 1.2, color: hexColor(layout.colors.primary) });
      }
      let x = t.x;
      t.columns.forEach((c, i) => {
        drawAligned(page, c.label, fonts.bold, t.header.size, hexColor(t.header.color), x + CELL_PAD_X, widths[i] - CELL_PAD_X * 2, Y(top + t.header.height / 2 + t.header.size * 0.35), c.align);
        x += widths[i];
      });
    });
  };

  const newPage = (withHeader: boolean) => {
    pageIndex++;
    pageOps.push([]);
    rowsPerPage.push(0);
    cursor = t.continuationTop;
    bottom = t.continuationBottom;
    if (withHeader && t.repeatHeader) {
      drawHeader(pageIndex, cursor);
      cursor += t.header.height;
    }
  };

  drawHeader(0, cursor);
  cursor += t.header.height;

  const rows = buildRows(formatLines(snapshot.lines), layout, fonts);
  const maxRowHeight = t.continuationBottom - t.continuationTop - t.header.height;
  for (const original of rows) {
    const parts = original.height > maxRowHeight ? splitRow(original, maxRowHeight, t.row.paddingY) : [original];
    for (const row of parts) {
      if (cursor + row.height > bottom) newPage(true);
      const top = cursor;
      const pi = pageIndex;
      rowsPerPage[pi]++;
      pageOps[pi].push((page) => drawRow(page, row, top));
      cursor += row.height;
    }
  }

  function drawRow(page: PDFPage, row: Row, top: number) {
    if (row.kind === 'section') {
      page.drawRectangle({ x: t.x, y: Y(top + row.height), width: t.w, height: row.height, color: hexColor(layout.colors.light) });
    } else if (row.zebra && t.row.zebra) {
      page.drawRectangle({ x: t.x, y: Y(top + row.height), width: t.w, height: row.height, color: hexColor(t.row.zebra) });
    }
    if (t.row.borderColor) {
      page.drawLine({ start: { x: t.x, y: Y(top + row.height) }, end: { x: t.x + t.w, y: Y(top + row.height) }, thickness: 0.5, color: hexColor(t.row.borderColor) });
    }
    let x = t.x;
    const desigIdx = t.columns.findIndex((c) => c.key === 'designation');
    t.columns.forEach((c, i) => {
      if (row.kind !== 'item') {
        if (i === 0) {
          let ly = top + t.row.paddingY;
          for (const l of row.designationLines) {
            ly += l.size;
            page.drawText(l.text, { x: t.x + CELL_PAD_X, y: Y(ly), size: l.size, font: l.font, color: hexColor(l.color) });
            ly += l.size * 0.28;
          }
        }
      } else if (i === desigIdx) {
        let ly = top + t.row.paddingY;
        for (const l of row.designationLines) {
          ly += l.size;
          drawAligned(page, l.text, l.font, l.size, hexColor(l.color), x + CELL_PAD_X, widths[i] - CELL_PAD_X * 2, Y(ly), c.align);
          ly += l.size * 0.28;
        }
      } else {
        const v = row.cells[c.key];
        if (v) drawAligned(page, v, fonts.regular, t.row.size, hexColor(t.row.color), x + CELL_PAD_X, widths[i] - CELL_PAD_X * 2, Y(top + t.row.paddingY + t.row.size), c.align);
      }
      x += widths[i];
    });
  }

  // ----- Blocs en flux -----
  let signatureZone: SignatureZone | null = null;
  const flow = layout.elements.filter((e) => e.anchor === 'flow' && visible(e));
  for (const e of flow) {
    const measured = measureFlow(e);
    if (!measured) continue;
    cursor += layout.flowGap;
    if (cursor + measured.height > bottom) {
      newPage(false);
    }
    const top = cursor;
    const pi = pageIndex;
    pageOps[pi].push((page) => measured.draw(page, top));
    if (e.type === 'signature') signatureZone = { page: pi, x: e.x, y: top, w: e.w, h: measured.height, pageHeight: pageH };
    cursor += measured.height;
  }

  function measureFlow(e: LayoutElement): { height: number; draw: (page: PDFPage, top: number) => void } | null {
    const st = styleOf(e);
    const pad = e.box?.padding ?? 0;
    if (e.type === 'totals') {
      const trs = totalsRows(snapshot);
      const lh = st.size * 1.9;
      const sep = 6; // espace avant la ligne de total principal
      const height = trs.length * lh + pad * 2 + trs.filter((r, i) => r.strong && i > 0).length * sep;
      return {
        height,
        draw: (page, top) => {
          drawBox(page, e.x, top, e.w, height, e.box);
          let y = top + pad;
          trs.forEach((r, i) => {
            const strong = !!r.strong;
            const font = strong ? fonts.bold : fonts.regular;
            const size = strong ? st.size + 1.5 : st.size;
            const color = hexColor(r.muted ? layout.colors.muted : strong ? layout.colors.primary : st.color);
            if (strong && i > 0) {
              y += sep;
              page.drawLine({ start: { x: e.x + pad, y: Y(y) }, end: { x: e.x + e.w - pad, y: Y(y) }, thickness: 0.8, color: hexColor(layout.colors.accent) });
            }
            drawAligned(page, r.label, font, size, color, e.x + pad, e.w * 0.62 - pad, Y(y + lh * 0.65), 'left');
            drawAligned(page, r.value, font, size, color, e.x + e.w * 0.62, e.w * 0.38 - pad, Y(y + lh * 0.65), 'right');
            y += lh;
          });
        },
      };
    }
    if (e.type === 'signature') {
      const height = Math.max(e.h, 60);
      return {
        height,
        draw: (page, top) => {
          drawBox(page, e.x, top, e.w, height, e.box);
          const label = fillText(e.text ?? '', values).text;
          drawAligned(page, sanitize(label), fonts.semibold, st.size, hexColor(st.color), e.x + pad, e.w - pad * 2, Y(top + pad + st.size), 'left');
          if (input.signature && sigImage) {
            const sig = input.signature;
            const d = new Date(sig.signedAt);
            const when = `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
            const info = `${sig.mention} — ${sig.signerName}${sig.signerRole ? ', ' + sig.signerRole : ''} — signé électroniquement le ${when}`;
            const infoLines = wrapText(info, fonts.regular, 6.5, e.w - pad * 2);
            const infoH = infoLines.length * 8;
            const availH = height - pad * 2 - st.size - 6 - infoH;
            const scale = Math.min((e.w - pad * 2) / sigImage.width, availH / sigImage.height);
            const w = sigImage.width * scale;
            const h = sigImage.height * scale;
            page.drawImage(sigImage, { x: e.x + pad, y: Y(top + pad + st.size + 4 + h), width: w, height: h });
            infoLines.forEach((l, i) => page.drawText(l, { x: e.x + pad, y: Y(top + height - pad - infoH + 6.5 + i * 8), size: 6.5, font: fonts.regular, color: hexColor(layout.colors.muted) }));
          }
        },
      };
    }
    if (e.type === 'text') {
      const filled = fillText(e.text ?? '', values);
      if (e.hideIfEmpty && filled.hadFields && !filled.anyValue) return null;
      if (!filled.text.trim()) return null;
      const laid = layoutText(filled.text, st, fonts, e.w - pad * 2);
      const height = laid.height + pad * 2;
      return {
        height,
        draw: (page, top) => {
          drawBox(page, e.x, top, e.w, height, e.box);
          drawLines(page, laid.lines, e.x + pad, top + pad, e.w - pad * 2, st.align, pageH);
        },
      };
    }
    if (e.type === 'rect' || e.type === 'line' || e.type === 'image') {
      return { height: e.h, draw: (page, top) => drawFixed(page, { ...e, y: top }, 0, 1) };
    }
    return null;
  }

  function drawBox(page: PDFPage, x: number, top: number, w: number, h: number, box?: LayoutElement['box']) {
    if (!box || (!box.background && !box.borderColor)) return;
    const path = roundedRectPath(w, h, box.radius ?? 0);
    page.drawSvgPath(path, {
      x,
      y: Y(top),
      color: box.background ? hexColor(box.background) : undefined,
      borderColor: box.borderColor ? hexColor(box.borderColor) : undefined,
      borderWidth: box.borderColor ? box.borderWidth ?? 0.8 : 0,
    });
  }

  function drawFixed(page: PDFPage, e: LayoutElement, pi: number, pageCount: number) {
    const st = styleOf(e);
    if (e.type === 'rect') {
      drawBox(page, e.x, e.y, e.w, e.h, e.box ?? { background: layout.colors.light });
      return;
    }
    if (e.type === 'line') {
      page.drawLine({ start: { x: e.x, y: Y(e.y) }, end: { x: e.x + e.w, y: Y(e.y + e.h) }, thickness: e.box?.borderWidth ?? 0.8, color: hexColor(e.box?.borderColor ?? layout.colors.muted) });
      return;
    }
    if (e.type === 'image') {
      const img = e.src === 'logo' ? logo : e.src ? images[e.src] : null;
      if (!img) return;
      let w = e.w;
      let h = e.h;
      if (e.fit !== 'stretch') {
        const scale = e.fit === 'cover' ? Math.max(e.w / img.width, e.h / img.height) : Math.min(e.w / img.width, e.h / img.height);
        w = img.width * scale;
        h = img.height * scale;
      }
      page.drawImage(img, { x: e.x, y: Y(e.y + h), width: w, height: h });
      return;
    }
    if (e.type === 'text') {
      const filled = fillText(e.text ?? '', { ...values, 'pagination.page': String(pi + 1), 'pagination.total': String(pageCount) });
      if (e.hideIfEmpty && filled.hadFields && !filled.anyValue) return;
      const pad = e.box?.padding ?? 0;
      drawBox(page, e.x, e.y, e.w, e.h, e.box);
      const laid = layoutText(filled.text, st, fonts, e.w - pad * 2);
      drawLines(page, laid.lines, e.x + pad, e.y + pad, e.w - pad * 2, st.align, pageH);
      return;
    }
    if (e.type === 'signature') {
      // Zone de signature fixe (modèles importés)
      const pad = e.box?.padding ?? 6;
      drawBox(page, e.x, e.y, e.w, e.h, e.box ?? { borderColor: '#cbd5e1', borderWidth: 0.8 });
      const label = fillText(e.text ?? '', values).text;
      if (label) drawAligned(page, sanitize(label), fonts.semibold, st.size, hexColor(st.color), e.x + pad, e.w - pad * 2, Y(e.y + pad + st.size), 'left');
      return;
    }
    if (e.type === 'totals') {
      const m = measureFlow({ ...e, anchor: 'flow' });
      m?.draw(page, e.y);
    }
  }

  // Zone de signature fixe (si pas de bloc en flux)
  if (!signatureZone) {
    const fixedSig = layout.elements.find((e) => e.type === 'signature' && e.anchor === 'fixed' && visible(e));
    if (fixedSig) {
      const pi = fixedSig.pages === 'first' ? 0 : pageOps.length - 1;
      signatureZone = { page: pi, x: fixedSig.x, y: fixedSig.y, w: fixedSig.w, h: fixedSig.h, pageHeight: pageH };
    }
  }

  // ----- Dessin -----
  const pageCount = pageOps.length;
  for (let pi = 0; pi < pageCount; pi++) {
    const page = doc.addPage([pageW, pageH]);
    const bg = bgPages.length ? (pi === 0 ? bgPages[0] : bgPages[1] ?? bgPages[0]) : null;
    if (bg) page.drawPage(bg, { x: 0, y: 0, width: pageW, height: pageH });
    if (bgImage) page.drawImage(bgImage, { x: 0, y: 0, width: pageW, height: pageH });
    for (const e of layout.elements) {
      if (e.anchor !== 'fixed' || !visible(e)) continue;
      const on =
        e.pages === 'all' || (e.pages === 'first' && pi === 0) || (e.pages === 'last' && pi === pageCount - 1) || (e.pages === 'not_first' && pi > 0);
      if (on) drawFixed(page, e, pi, pageCount);
    }
    for (const op of pageOps[pi]) op(page, { pageIndex: pi, pageCount });
    if (input.watermark) {
      const size = 72;
      const wm = sanitize(input.watermark);
      const w = fonts.bold.widthOfTextAtSize(wm, size);
      page.drawText(wm, {
        x: pageW / 2 - (w / 2) * Math.cos(Math.PI / 4) + (size / 2) * Math.sin(Math.PI / 4),
        y: pageH / 2 - (w / 2) * Math.sin(Math.PI / 4) - (size / 2) * Math.cos(Math.PI / 4),
        size, font: fonts.bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(45),
      });
    }
  }

  // Métadonnées
  const title = `${values['document.type']} ${snapshot.number}`.trim();
  doc.setTitle(title);
  doc.setAuthor(snapshot.seller.display_name);
  doc.setSubject(snapshot.title || title);
  doc.setCreator('Signal Desk');
  doc.setProducer('Signal Desk (pdf-lib)');
  doc.setLanguage('fr-FR');
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  // Position de la zone de signature, relue lors de l'apposition de la signature (dictionnaire Info du PDF).
  if (signatureZone) (doc as any).getInfoDict().set(PDFName.of(SIGNATURE_ZONE_KEY), PDFString.of(JSON.stringify(signatureZone)));

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, pageCount, signatureZone, rowsPerPage };
}

export function drawAligned(page: PDFPage, text: string, font: PDFFont, size: number, color: ReturnType<typeof rgb>, x: number, width: number, y: number, align: Align) {
  const s = sanitize(text);
  if (!s) return;
  const w = font.widthOfTextAtSize(s, size);
  const dx = align === 'right' ? width - w : align === 'center' ? (width - w) / 2 : 0;
  page.drawText(s, { x: x + dx, y, size, font, color });
}
