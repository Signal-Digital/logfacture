/** Fabrique un DOCX minimal (structure Word valide) pour les tests. */
import PizZip from 'pizzip';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function p(text: string, opts: { bold?: boolean; split?: boolean } = {}): string {
  const rPr = opts.bold ? '<w:rPr><w:b/></w:rPr>' : '';
  if (opts.split && text.length > 4) {
    // Simule Word qui découpe un champ en plusieurs « runs »
    const mid = Math.floor(text.length / 2);
    return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${text.slice(0, mid)}</w:t></w:r><w:r>${rPr}<w:t xml:space="preserve">${text.slice(mid)}</w:t></w:r></w:p>`;
  }
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function cell(text: string): string {
  return `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
}

export function buildDocx(opts: { withLoop?: boolean; extraParagraphs?: string[] } = {}): Uint8Array {
  const rows = opts.withLoop === false ? '' : `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>
<w:tr>${cell('Désignation')}${cell('Qté')}${cell('PU HT')}${cell('Total HT')}</w:tr>
<w:tr>${cell('{{#lignes}}{{designation}}')}${cell('{{quantite}}')}${cell('{{prix_unitaire}}')}${cell('{{total_ht}}{{/lignes}}')}</w:tr></w:tbl>`;
  const body = [
    p('{{document.type}} N° {{document.numero}}', { bold: true, split: true }),
    p('Émetteur : {{entreprise.denomination}} — SIRET {{entreprise.siret}}'),
    p('Client : {{client.nom}}', { split: true }),
    p('{{client.adresse}}'),
    p('Date : {{document.date}}'),
    ...(opts.extraParagraphs ?? []).map((t) => p(t)),
  ].join('');
  const after = [p('Total HT : {{totaux.total_ht}}'), p('TVA : {{totaux.total_tva}}'), p('Total TTC : {{totaux.total_ttc}}', { bold: true }), p('{{#mentions}}{{texte}}{{/mentions}}')].join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}${rows}${after}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const zip = new PizZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', document);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
  return zip.generate({ type: 'uint8array' }) as Uint8Array;
}

/** Conversion par LibreOffice (si présent) — même principe que la commande Rust. */
export function libreOfficeConverter(): ((docx: Uint8Array) => Promise<Uint8Array>) | undefined {
  const proc = (globalThis as any).process;
  const fs = proc.getBuiltinModule('node:fs');
  const cp = proc.getBuiltinModule('node:child_process');
  const os = proc.getBuiltinModule('node:os');
  const path = proc.getBuiltinModule('node:path');
  const soffice = ['/usr/bin/soffice', '/usr/bin/libreoffice'].find((p) => fs.existsSync(p));
  if (!soffice) return undefined;
  return async (docx) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-conv-'));
    const input = path.join(dir, 'document.docx');
    fs.writeFileSync(input, docx);
    cp.execFileSync(soffice, [`-env:UserInstallation=file://${dir}/profile`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, input], { stdio: 'ignore', timeout: 120000 });
    const out = fs.readFileSync(path.join(dir, 'document.pdf'));
    fs.rmSync(dir, { recursive: true, force: true });
    return new Uint8Array(out);
  };
}
