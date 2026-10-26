/**
 * Apposition d'une signature sur le PDF original et ajout d'un certificat de
 * preuve. Le PDF original n'est jamais modifié : un NOUVEAU fichier est produit.
 */
import { PDFDocument, PDFName, PDFString, type PDFPage } from 'pdf-lib';
import { drawAligned, embedFonts, hexColor, layoutText, SIGNATURE_ZONE_KEY, type SignatureZone } from './render';

export interface SignatureEvidence {
  documentLabel: string; // ex. « Devis D-2026-0004 — version 2 »
  documentUuid: string;
  sellerName: string;
  clientName: string;
  totalTtc: string;
  signerName: string;
  signerRole?: string | null;
  signerEmail?: string | null;
  signedAtIso: string;
  mention: string;
  consentText: string;
  originalSha256: string;
  snapshotSha256: string;
  signatureImageSha256: string;
  signatureUuid: string;
  method: string;
  events: { at: string; label: string }[];
}

export function readSignatureZone(doc: PDFDocument): SignatureZone | null {
  try {
    const v = (doc as any).getInfoDict().lookup(PDFName.of(SIGNATURE_ZONE_KEY));
    if (!v) return null;
    const text = v instanceof PDFString ? v.decodeText() : v.decodeText?.() ?? String(v);
    const z = JSON.parse(text);
    if (typeof z.page === 'number' && typeof z.x === 'number') return z;
  } catch {
    /* zone absente ou illisible */
  }
  return null;
}

function frDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

export async function stampSignedPdf(original: Uint8Array, signaturePng: Uint8Array, ev: SignatureEvidence): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original);
  const fonts = await embedFonts(doc);
  const img = await doc.embedPng(signaturePng);
  const zone = readSignatureZone(doc);
  const muted = hexColor('#64748b');

  // 1. Signature dans la zone prévue par le modèle
  if (zone && zone.page < doc.getPageCount()) {
    const page = doc.getPage(zone.page);
    const H = page.getHeight();
    const pad = 8;
    const infoLines = [
      `${ev.mention} — ${ev.signerName}${ev.signerRole ? ', ' + ev.signerRole : ''}`,
      `Signé électroniquement le ${frDateTime(ev.signedAtIso)} — voir certificat en dernière page`,
    ];
    const infoH = infoLines.length * 8;
    const availH = Math.max(10, zone.h - pad * 2 - 14 - infoH);
    const scale = Math.min((zone.w - pad * 2) / img.width, availH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: zone.x + pad, y: H - (zone.y + pad + 14 + h), width: w, height: h });
    infoLines.forEach((l, i) => drawAligned(page, l, fonts.regular, 6.2, muted, zone.x + pad, zone.w - pad * 2, H - (zone.y + zone.h - pad - infoH + 6.2 + i * 8), 'left'));
  }

  // 2. Certificat de preuve
  const first = doc.getPage(0);
  const W = first.getWidth();
  const H = first.getHeight();
  let page: PDFPage = doc.addPage([W, H]);
  let y = 50;
  const x = 50;
  const width = W - 100;
  const ensure = (h: number) => {
    if (y + h > H - 50) {
      page = doc.addPage([W, H]);
      y = 50;
    }
  };
  const write = (text: string, size = 9, weight: 'regular' | 'bold' | 'italic' = 'regular', color = '#1e293b') => {
    const laid = layoutText(text, { size, weight, color, align: 'left', lineHeight: 1.35 }, fonts, width);
    ensure(laid.height);
    for (const l of laid.lines) {
      drawAligned(page, l.text, l.font, l.size, hexColor(l.color), x, width, H - (y + l.size), 'left');
      y += l.height;
    }
  };
  const field = (label: string, value: string) => {
    const laid = layoutText(value || '—', { size: 8.5, weight: 'regular', color: '#1e293b', align: 'left', lineHeight: 1.35 }, fonts, width - 150);
    ensure(laid.height + 2);
    drawAligned(page, label, fonts.bold, 8.5, muted, x, 145, H - (y + 8.5), 'left');
    let yy = y;
    for (const l of laid.lines) {
      drawAligned(page, l.text, l.font, l.size, hexColor(l.color), x + 150, width - 150, H - (yy + l.size), 'left');
      yy += l.height;
    }
    y = yy + 3;
  };

  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: hexColor('#14b8a6') });
  write('CERTIFICAT DE SIGNATURE ÉLECTRONIQUE', 15, 'bold', '#0f1b3d');
  write('Preuve d\'accord générée par Signal Desk', 9, 'regular', '#64748b');
  y += 10;
  field('Document', ev.documentLabel);
  field('Identifiant du document', ev.documentUuid);
  field('Émetteur', ev.sellerName);
  field('Client', ev.clientName);
  field('Montant TTC', ev.totalTtc);
  y += 6;
  field('Signataire', ev.signerName + (ev.signerRole ? ` — ${ev.signerRole}` : ''));
  if (ev.signerEmail) field('Email déclaré', ev.signerEmail);
  field('Date et heure', `${frDateTime(ev.signedAtIso)} (heure locale du poste) — ${ev.signedAtIso} (UTC)`);
  field('Mention d\'acceptation', ev.mention);
  field('Consentement', ev.consentText);
  field('Méthode', ev.method);
  y += 6;
  field('Empreinte SHA-256 du PDF original', ev.originalSha256);
  field('Empreinte SHA-256 du contenu', ev.snapshotSha256);
  field('Empreinte SHA-256 de la signature', ev.signatureImageSha256);
  field('Identifiant de signature', ev.signatureUuid);
  y += 6;
  ensure(90);
  drawAligned(page, 'Signature apposée', fonts.bold, 8.5, muted, x, 145, H - (y + 8.5), 'left');
  const s = Math.min(220 / img.width, 70 / img.height);
  page.drawRectangle({ x: x + 150, y: H - (y + 76), width: 230, height: 76, borderColor: hexColor('#cbd5e1'), borderWidth: 0.6 });
  page.drawImage(img, { x: x + 155, y: H - (y + 73), width: img.width * s, height: img.height * s });
  y += 86;
  write('Journal des événements', 10, 'bold', '#0f1b3d');
  for (const e of ev.events) write(`${frDateTime(e.at)} — ${e.label}`, 8, 'regular');
  y += 10;
  write(
    'Portée de ce certificat : la signature a été tracée par le signataire sur l\'écran de signature de Signal Desk, sur le poste de l\'émetteur. ' +
      'Le document signé est lié de façon vérifiable au PDF original par son empreinte SHA-256 ; toute modification ultérieure du PDF original est détectable. ' +
      'Ce procédé constitue une signature électronique dite « simple ». Il ne constitue pas, à lui seul, une signature électronique avancée ou qualifiée au sens du ' +
      'règlement (UE) n° 910/2014 (eIDAS) : l\'identité du signataire n\'est pas vérifiée par un prestataire de confiance et aucun certificat qualifié n\'est utilisé. ' +
      'En cas de litige, sa valeur probante est appréciée par le juge au regard de l\'ensemble des éléments (articles 1366 et 1367 du Code civil).',
    7.5, 'italic', '#64748b',
  );

  doc.setSubject(`${ev.documentLabel} — signé par ${ev.signerName}`);
  doc.setKeywords(['signé', ev.signatureUuid, `sha256-original:${ev.originalSha256}`]);
  doc.setModificationDate(new Date(ev.signedAtIso));
  return doc.save({ useObjectStreams: false });
}
