/**
 * Modèles Word (DOCX).
 *
 * Le document Word importé est conservé tel quel ; seuls les champs
 * {{...}} sont remplacés (docxtemplater), ce qui préserve sa structure
 * (styles, en-têtes, pieds de page, tableaux, images).
 *
 * Boucles disponibles :
 *   {{#lignes}} … {{designation}} {{quantite}} {{prix_unitaire}} {{total_ht}} … {{/lignes}}
 *     (placées dans une ligne de tableau, elles répètent la ligne)
 *   {{#tva}} {{taux}} {{base}} {{montant}} {{/tva}}
 *   {{#mentions}} {{texte}} {{/mentions}}
 *
 * La conversion en PDF nécessite LibreOffice ou Microsoft Word (voir
 * src-tauri/src/convert.rs) : la pagination est alors celle de Word/LibreOffice.
 */
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { buildFieldValues, formatLines, totalsRows, type DocSnapshot } from './fields';
import { formatEuro, formatRate } from '@/lib/format';

export const DOCX_LOOP_FIELDS = [
  { key: 'designation', label: 'Désignation' },
  { key: 'description', label: 'Description' },
  { key: 'quantite', label: 'Quantité' },
  { key: 'unite', label: 'Unité' },
  { key: 'prix_unitaire', label: 'Prix unitaire HT' },
  { key: 'remise', label: 'Remise' },
  { key: 'tva', label: 'Taux de TVA' },
  { key: 'total_ht', label: 'Total HT' },
  { key: 'total_ttc', label: 'Total TTC' },
];

export function docxData(s: DocSnapshot): Record<string, unknown> {
  const values = buildFieldValues(s);
  const lines = formatLines(s.lines).map((l) => ({
    designation: l.designation,
    description: l.description,
    quantite: l.quantity,
    unite: l.unit,
    prix_unitaire: l.unit_price,
    remise: l.discount,
    tva: l.vat_rate,
    total_ht: l.total_ht,
    total_ttc: l.total_ttc,
    est_section: l.kind === 'section',
    est_texte: l.kind === 'text',
  }));
  return {
    ...values,
    lignes: lines,
    tva: s.totals.vat.map((v) => ({ taux: formatRate(v.rate_bp), base: formatEuro(v.base_cents), montant: formatEuro(v.vat_cents) })),
    mentions: s.legal_mentions.map((t) => ({ texte: t })),
    totaux_lignes: totalsRows(s).map((r) => ({ libelle: r.label, valeur: r.value })),
  };
}

/** Résolution des clés pointées ({{client.nom}}) : clé plate d'abord, puis chemin. */
function parser(tag: string) {
  const key = tag.trim();
  return {
    get(scope: any) {
      if (key === '.') return scope;
      if (scope == null) return undefined;
      if (Object.prototype.hasOwnProperty.call(scope, key)) return scope[key];
      return key.split('.').reduce((acc: any, k) => (acc == null ? undefined : acc[k]), scope);
    },
  };
}

export interface DocxFillResult {
  bytes: Uint8Array;
}

export function fillDocx(template: Uint8Array, s: DocSnapshot): DocxFillResult {
  const zip = new PizZip(template);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    parser,
    nullGetter: () => '',
  });
  try {
    doc.render(docxData(s));
  } catch (e: any) {
    const details = e?.properties?.errors?.map((x: any) => x.properties?.explanation).filter(Boolean) ?? [];
    throw new Error(`Modèle Word invalide : ${details.join(' ; ') || e.message}`);
  }
  const out = doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' }) as Uint8Array;
  return { bytes: out };
}

const XML_PARTS = /^word\/(document|header\d*|footer\d*)\.xml$/;

/** Liste les champs {{...}} présents dans un DOCX (y compris en-têtes et pieds de page). */
export function inspectDocx(bytes: Uint8Array): { fields: string[]; loops: string[]; valid: boolean; error?: string } {
  try {
    const zip = new PizZip(bytes);
    if (!zip.file('word/document.xml')) return { fields: [], loops: [], valid: false, error: "Ce fichier n'est pas un document Word (.docx) valide." };
    let text = '';
    for (const name of Object.keys(zip.files)) {
      if (!XML_PARTS.test(name)) continue;
      const xml = zip.file(name)!.asText();
      // Texte brut par paragraphe (les champs peuvent être découpés en plusieurs « runs »)
      text += xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '') + '\n';
    }
    const tags = [...text.matchAll(/\{\{\s*([#/^]?)\s*([a-z_.]+)\s*\}\}/gi)];
    const fields = [...new Set(tags.filter((t) => !t[1]).map((t) => t[2]))];
    const loops = [...new Set(tags.filter((t) => t[1] === '#').map((t) => t[2]))];
    return { fields, loops, valid: true };
  } catch (e: any) {
    return { fields: [], loops: [], valid: false, error: `Fichier illisible : ${e.message}` };
  }
}
