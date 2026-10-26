/**
 * Signature électronique locale des devis.
 *
 * Déroulé :
 *  1. une demande de signature est créée pour la version figée du devis
 *     (jeton aléatoire, statut « ouverte ») ;
 *  2. l'écran de signature (fenêtre séparée, sans accès au reste du CRM)
 *     n'affiche que ce document ;
 *  3. à la validation : contrôle de l'empreinte du PDF original, enregistrement
 *     de l'image de signature, génération d'un NOUVEAU PDF signé avec certificat
 *     de preuve, journal des événements, acceptation du devis.
 *
 * Signature à distance : non activée. La table `signature_requests` (champ
 * `channel = 'distance'`) prépare cette évolution ; voir docs/SIGNATURES.md.
 */
import type { Ctx } from './context';
import type { Db } from '@/lib/db';
import { BusinessError, assert } from './context';
import { randomToken, sha256Hex, uuid } from '@/lib/crypto';
import { formatEuro } from '@/lib/format';
import { logEvent } from './audit';
import { acceptQuote, getQuote, type QuoteSnapshot, type QuoteVersion } from './quotes';
import { storeQuoteVersionPdf } from './docgen';
import { storeDocument } from './documents';
import { getSetting } from './settings';
import { stampSignedPdf } from '@/pdf/sign';

export interface SignatureRequest {
  id: number;
  token: string;
  quote_id: number;
  quote_version_id: number;
  channel: 'local' | 'distance';
  status: 'ouverte' | 'signee' | 'expiree' | 'annulee';
  expires_at: string | null;
  created_at: string;
}

export interface SignatureRow {
  id: number;
  uuid: string;
  quote_id: number;
  quote_version_id: number;
  request_id: number | null;
  signer_name: string;
  signer_role: string | null;
  signer_email: string | null;
  consent_text: string;
  acceptance_mention: string;
  signed_at: string;
  method: string;
  signature_image_path: string;
  signature_image_sha256: string;
  original_pdf_path: string;
  original_sha256: string;
  signed_pdf_path: string | null;
  signed_sha256: string | null;
  user_agent: string | null;
  created_at: string;
}

export const SIGNATURE_METHOD = 'Signature manuscrite tracée à l\'écran (souris, stylet ou doigt), apposée localement dans Signal Desk';

async function event(db: Db, quoteId: number, ev: string, details?: string, ids: { requestId?: number; signatureId?: number } = {}) {
  await db.run('INSERT INTO signature_events (request_id, signature_id, quote_id, event, details) VALUES (?, ?, ?, ?, ?)', [
    ids.requestId ?? null, ids.signatureId ?? null, quoteId, ev, details ?? null,
  ]);
}

/** Crée (ou réutilise) une demande de signature locale pour la version en cours. */
export async function createSignatureRequest(ctx: Ctx, quoteId: number): Promise<SignatureRequest> {
  const q = await getQuote(ctx.db, quoteId);
  assert(q, 'Devis introuvable.');
  if (!['envoye', 'attente_signature'].includes(q.status)) {
    throw new BusinessError(q.status === 'brouillon' ? 'Finalisez le devis avant de le faire signer.' : 'Ce devis ne peut plus être signé dans son statut actuel.');
  }
  const v = await ctx.db.get<QuoteVersion>('SELECT * FROM quote_versions WHERE quote_id = ? AND version = ?', [quoteId, q.version]);
  assert(v, 'Version figée introuvable.');
  if (!v.pdf_path) await storeQuoteVersionPdf(ctx, v.id);
  const existing = await ctx.db.get<SignatureRequest>("SELECT * FROM signature_requests WHERE quote_version_id = ? AND status = 'ouverte' AND channel = 'local'", [v.id]);
  if (existing) return existing;
  const token = randomToken(24);
  const r = await ctx.db.run("INSERT INTO signature_requests (token, quote_id, quote_version_id, channel, expires_at) VALUES (?, ?, ?, 'local', ?)", [
    token, quoteId, v.id, q.validity_date ? `${q.validity_date}T23:59:59` : null,
  ]);
  await ctx.db.run("UPDATE quotes SET status = 'attente_signature', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'envoye'", [quoteId]);
  await event(ctx.db, quoteId, 'demande_creee', `Demande de signature locale pour la version ${v.version}`, { requestId: r.lastInsertId });
  await logEvent(ctx.db, { entity: 'signature', id: r.lastInsertId, action: 'demande', summary: `Demande de signature créée pour le devis ${q.number} v${v.version}`, companyId: q.company_id });
  return (await ctx.db.get<SignatureRequest>('SELECT * FROM signature_requests WHERE id = ?', [r.lastInsertId]))!;
}

export interface SigningSession {
  request: SignatureRequest;
  version: QuoteVersion;
  snapshot: QuoteSnapshot;
  pdfPath: string;
  consentText: string;
  acceptanceMention: string;
}

/** Données strictement nécessaires à l'écran de signature (aucune autre donnée du CRM). */
export async function openSigningSession(ctx: Ctx, token: string, opts: { log?: boolean } = {}): Promise<SigningSession> {
  if (!/^[0-9a-f]{48}$/.test(token)) throw new BusinessError('Lien de signature invalide.');
  const req = await ctx.db.get<SignatureRequest>('SELECT * FROM signature_requests WHERE token = ?', [token]);
  if (!req) throw new BusinessError('Demande de signature introuvable.');
  if (req.status !== 'ouverte') throw new BusinessError(req.status === 'signee' ? 'Ce document a déjà été signé.' : 'Cette demande de signature n\'est plus valide.');
  if (req.expires_at && new Date(req.expires_at) < new Date()) throw new BusinessError('La date de validité de ce devis est dépassée.');
  const v = await ctx.db.get<QuoteVersion>('SELECT * FROM quote_versions WHERE id = ?', [req.quote_version_id]);
  assert(v && v.pdf_path, 'Document introuvable.');
  const q = await ctx.db.get<any>('SELECT version, status FROM quotes WHERE id = ?', [req.quote_id]);
  if (!q || q.version !== v.version || !['envoye', 'attente_signature'].includes(q.status)) {
    throw new BusinessError('Ce devis a été modifié ou n\'est plus en attente de signature : cette demande n\'est plus valide.');
  }
  const settings = await getSetting(ctx.db, 'quotes');
  if (opts.log !== false) await event(ctx.db, req.quote_id, 'consultation', 'Ouverture de l\'écran de signature', { requestId: req.id });
  return { request: req, version: v, snapshot: JSON.parse(v.snapshot), pdfPath: v.pdf_path, consentText: settings.consent_text, acceptanceMention: settings.acceptance_mention };
}

export interface SignInput {
  signerName: string;
  signerRole?: string | null;
  signerEmail?: string | null;
  consent: boolean;
  mention: string;
  signaturePng: Uint8Array;
  userAgent?: string | null;
}

/** Vérifie qu'une image PNG de signature n'est pas vide (en-tête PNG et taille minimale). */
export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 100 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

export async function signQuote(ctx: Ctx, token: string, input: SignInput): Promise<SignatureRow> {
  const session = await openSigningSession(ctx, token, { log: false });
  const { request, version, snapshot } = session;
  if (!input.signerName.trim() || input.signerName.trim().length < 3) throw new BusinessError('Indiquez le nom complet du signataire.');
  if (!input.consent) throw new BusinessError('Le consentement explicite est obligatoire pour signer.');
  if (input.mention.trim().toLowerCase() !== session.acceptanceMention.trim().toLowerCase()) {
    throw new BusinessError(`Recopiez exactement la mention « ${session.acceptanceMention} ».`);
  }
  if (!isPng(input.signaturePng)) throw new BusinessError('La signature est vide ou invalide.');

  // Intégrité du PDF original
  const original = await ctx.files.read(version.pdf_path!);
  const originalSha = await sha256Hex(original);
  if (originalSha !== version.pdf_sha256) {
    await event(ctx.db, request.quote_id, 'alerte_integrite', 'Empreinte du PDF original différente de l\'empreinte enregistrée', { requestId: request.id });
    throw new BusinessError('Le PDF du devis a été modifié depuis sa génération : signature impossible. Créez une nouvelle version du devis.');
  }
  const snapshotSha = await sha256Hex(version.snapshot);
  if (snapshotSha !== version.snapshot_sha256) throw new BusinessError('Le contenu figé du devis est incohérent : signature impossible.');

  const signedAt = new Date().toISOString();
  const sigUuid = uuid();
  const imgSha = await sha256Hex(input.signaturePng);
  const year = snapshot.issue_date.slice(0, 4);
  const base = `${snapshot.number}${snapshot.version > 1 ? '-v' + snapshot.version : ''}`;
  const imgPath = `signatures/${year}/${base}-${sigUuid}.png`;
  await ctx.files.write(imgPath, input.signaturePng);

  const events = await ctx.db.all<{ at: string; event: string; details: string | null }>('SELECT at, event, details FROM signature_events WHERE quote_id = ? AND (request_id = ? OR request_id IS NULL) ORDER BY at, id', [request.quote_id, request.id]);
  const labels: Record<string, string> = { demande_creee: 'Demande de signature créée', consultation: 'Document consulté sur l\'écran de signature' };
  const evidenceEvents = [
    ...events.map((e) => ({ at: e.at, label: labels[e.event] ?? e.details ?? e.event })),
    { at: signedAt, label: `Consentement exprimé et mention « ${input.mention.trim()} » saisie` },
    { at: signedAt, label: `Signature apposée par ${input.signerName.trim()}` },
  ];
  const signedPdf = await stampSignedPdf(original, input.signaturePng, {
    documentLabel: `Devis ${snapshot.number} — version ${snapshot.version}${snapshot.title ? ' — ' + snapshot.title : ''}`,
    documentUuid: snapshot.quote_uuid,
    sellerName: snapshot.seller.display_name,
    clientName: snapshot.client.name,
    totalTtc: formatEuro(snapshot.totals.total_ttc_cents),
    signerName: input.signerName.trim(),
    signerRole: input.signerRole?.trim() || null,
    signerEmail: input.signerEmail?.trim() || null,
    signedAtIso: signedAt,
    mention: input.mention.trim(),
    consentText: session.consentText,
    originalSha256: originalSha,
    snapshotSha256: snapshotSha,
    signatureImageSha256: imgSha,
    signatureUuid: sigUuid,
    method: SIGNATURE_METHOD,
    events: evidenceEvents,
  });
  const q = await getQuote(ctx.db, request.quote_id);
  const doc = await storeDocument(ctx, {
    title: `Devis ${base} signé`,
    docType: 'devis_signe',
    fileName: `Devis ${base} - signé.pdf`,
    folder: `documents/${year}/devis`,
    year: Number(year),
    bytes: signedPdf,
    companyId: q?.company_id,
    projectId: q?.project_id,
    quoteId: request.quote_id,
    locked: true,
  });

  const sigId = await ctx.db.tx(async (t) => {
    const fresh = await t.get<SignatureRequest>('SELECT * FROM signature_requests WHERE id = ?', [request.id]);
    if (fresh?.status !== 'ouverte') throw new BusinessError('Cette demande a déjà été traitée.');
    const r = await t.run(
      `INSERT INTO signatures (uuid, quote_id, quote_version_id, request_id, signer_name, signer_role, signer_email, consent_text, acceptance_mention,
         signed_at, method, signature_image_path, signature_image_sha256, original_pdf_path, original_sha256, signed_pdf_path, signed_sha256, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sigUuid, request.quote_id, version.id, request.id, input.signerName.trim(), input.signerRole?.trim() || null, input.signerEmail?.trim() || null,
        session.consentText, input.mention.trim(), signedAt, 'locale_manuscrite', imgPath, imgSha, version.pdf_path, originalSha, doc.file_path, doc.sha256,
        input.userAgent ?? null,
      ],
    );
    await t.run("UPDATE signature_requests SET status = 'signee' WHERE id = ?", [request.id]);
    await event(t, request.quote_id, 'consentement', session.consentText, { requestId: request.id, signatureId: r.lastInsertId });
    await event(t, request.quote_id, 'signature', `Signé par ${input.signerName.trim()} — empreinte originale ${originalSha}`, { requestId: request.id, signatureId: r.lastInsertId });
    await event(t, request.quote_id, 'pdf_signe', `PDF signé généré — empreinte ${doc.sha256}`, { requestId: request.id, signatureId: r.lastInsertId });
    await logEvent(t, { entity: 'signature', id: r.lastInsertId, action: 'signature', summary: `Devis ${snapshot.number} v${snapshot.version} signé par ${input.signerName.trim()}`, companyId: q?.company_id });
    return r.lastInsertId;
  });
  await acceptQuote(ctx.db, request.quote_id, { versionId: version.id, via: 'signature' });
  return (await ctx.db.get<SignatureRow>('SELECT * FROM signatures WHERE id = ?', [sigId]))!;
}

export async function cancelSignatureRequest(db: Db, requestId: number): Promise<void> {
  const r = await db.get<SignatureRequest>('SELECT * FROM signature_requests WHERE id = ?', [requestId]);
  assert(r, 'Demande introuvable.');
  if (r.status !== 'ouverte') return;
  await db.run("UPDATE signature_requests SET status = 'annulee' WHERE id = ?", [requestId]);
  await event(db, r.quote_id, 'demande_annulee', 'Demande de signature annulée', { requestId });
}

export async function listSignatures(db: Db, quoteId?: number): Promise<(SignatureRow & { quote_number: string; version: number })[]> {
  return db.all(
    `SELECT s.*, q.number AS quote_number, v.version FROM signatures s JOIN quotes q ON q.id = s.quote_id JOIN quote_versions v ON v.id = s.quote_version_id
     ${quoteId != null ? 'WHERE s.quote_id = ?' : ''} ORDER BY s.signed_at DESC`,
    quoteId != null ? [quoteId] : [],
  );
}

export async function signatureEvents(db: Db, quoteId: number) {
  return db.all<{ id: number; at: string; event: string; details: string | null }>('SELECT * FROM signature_events WHERE quote_id = ? ORDER BY at, id', [quoteId]);
}

export interface SignatureCheck {
  ok: boolean;
  checks: { label: string; ok: boolean }[];
}

/** Contrôle d'intégrité complet d'une signature (original, image, PDF signé). */
export async function verifySignature(ctx: Ctx, signatureId: number): Promise<SignatureCheck> {
  const s = await ctx.db.get<SignatureRow>('SELECT * FROM signatures WHERE id = ?', [signatureId]);
  assert(s, 'Signature introuvable.');
  const v = await ctx.db.get<QuoteVersion>('SELECT * FROM quote_versions WHERE id = ?', [s.quote_version_id]);
  const hashOf = async (p: string | null) => {
    if (!p) return null;
    try {
      return await sha256Hex(await ctx.files.read(p));
    } catch {
      return null;
    }
  };
  const checks = [
    { label: 'PDF original intact (empreinte identique à celle signée)', ok: (await hashOf(s.original_pdf_path)) === s.original_sha256 },
    { label: 'Empreinte de l\'original identique à celle de la version du devis', ok: v?.pdf_sha256 === s.original_sha256 },
    { label: 'Image de signature intacte', ok: (await hashOf(s.signature_image_path)) === s.signature_image_sha256 },
    { label: 'PDF signé intact', ok: !!s.signed_sha256 && (await hashOf(s.signed_pdf_path)) === s.signed_sha256 },
    { label: 'Contenu figé de la version cohérent', ok: !!v && (await sha256Hex(v.snapshot)) === v.snapshot_sha256 },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
