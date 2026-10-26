/**
 * Écran de signature autonome (fenêtre séparée) : n'affiche QUE le document à
 * signer, sans navigation ni accès aux autres données du CRM.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Eraser, PenLine, ShieldCheck } from 'lucide-react';
import { useApp, errorMessage } from '../core/app';
import { Alert, Button, Field, Loading } from '../components/ui';
import { PdfViewer } from '../components/PdfViewer';
import { SignaturePad, type SignaturePadHandle } from '../components/SignaturePad';
import { openSigningSession, signQuote, type SigningSession } from '@/domain/signatures';
import { formatEuro } from '@/lib/format';
import { isTauri } from '@/platform';
import logoUrl from '../../../assets/logo.svg';

export function SignatureScreen() {
  const token = useParams().token ?? '';
  const { ctx } = useApp();
  const [session, setSession] = useState<SigningSession | null>(null);
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; at: string } | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [mention, setMention] = useState('');
  const [consent, setConsent] = useState(false);
  const [empty, setEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    document.title = 'Signature du devis — Signal Desk';
    openSigningSession(ctx, token)
      .then(async (s) => {
        setSession(s);
        setName(s.snapshot.client.contact_name || '');
        setEmail(s.snapshot.client.email || '');
        setPdf(await ctx.files.read(s.pdfPath));
      })
      .catch((e) => setError(errorMessage(e).text));
  }, [ctx, token]);

  const submit = async () => {
    if (!session || !pad.current) return;
    setBusy(true);
    setError(null);
    try {
      const png = await pad.current.toPng();
      const sig = await signQuote(ctx, token, { signerName: name, signerRole: role, signerEmail: email, consent, mention, signaturePng: png, userAgent: navigator.userAgent });
      setDone({ name: sig.signer_name, at: sig.signed_at });
    } catch (e) {
      setError(errorMessage(e).text);
    } finally {
      setBusy(false);
    }
  };

  const canSign = !!session && name.trim().length >= 3 && consent && !empty && mention.trim().toLowerCase() === session.acceptanceMention.toLowerCase();

  return (
    <div className="sign-shell">
      <div className="sign-head">
        <img src={logoUrl} width={30} height={30} alt="" />
        <div className="grow">
          <div className="strong">{session ? session.snapshot.seller.trade_name || session.snapshot.seller.display_name : 'Signature électronique'}</div>
          <div className="small" style={{ color: '#a5b4d8' }}>{session ? `Devis ${session.snapshot.number}${session.snapshot.version > 1 ? ` (version ${session.snapshot.version})` : ''} — ${session.snapshot.client.name}` : ''}</div>
        </div>
        <ShieldCheck color="#5eead4" />
      </div>
      {!session && !error && <Loading />}
      {error && !session && <div style={{ padding: 30 }}><Alert tone="danger" title="Signature impossible">{error}</Alert></div>}
      {session && done && (
        <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}>
          <div className="card card-pad col" style={{ maxWidth: 520, textAlign: 'center', alignItems: 'center', gap: 12 }}>
            <CheckCircle2 size={48} color="var(--success)" />
            <h2>Merci, le devis est signé</h2>
            <p className="muted">Signé par {done.name} le {new Date(done.at).toLocaleString('fr-FR')}. Le document signé et son certificat ont été enregistrés.</p>
            <Button onClick={() => (isTauri() ? window.close() : history.back())}>Fermer cette fenêtre</Button>
          </div>
        </div>
      )}
      {session && !done && (
        <div className="sign-body">
          <div className="col">
            <div className="card card-pad row between">
              <div>
                <div className="strong">{session.snapshot.title || `Devis ${session.snapshot.number}`}</div>
                <div className="muted small">Montant total : {formatEuro(session.snapshot.totals.total_ttc_cents)} {session.snapshot.seller.vat_regime === 'franchise' ? '(TVA non applicable)' : 'TTC'}</div>
              </div>
              <div className="muted tiny mono" title="Empreinte SHA-256 du document">SHA-256 {session.version.pdf_sha256?.slice(0, 16)}…</div>
            </div>
            <PdfViewer bytes={pdf} initialScale={1.05} />
          </div>
          <div className="col">
            <div className="card card-pad col" style={{ gap: 12, position: 'sticky', top: 20 }}>
              <h2><PenLine size={18} /> Signer le devis</h2>
              <Field label="Nom et prénom du signataire" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
              <div className="grid-2">
                <Field label="Fonction / qualité"><input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Gérant(e)…" /></Field>
                <Field label="Email (facultatif)"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              </div>
              <Field label={`Recopiez la mention « ${session.acceptanceMention} »`} required>
                <input className="input" value={mention} onChange={(e) => setMention(e.target.value)} placeholder={session.acceptanceMention} />
              </Field>
              <div>
                <div className="row between" style={{ marginBottom: 6 }}>
                  <span className="label req">Signature</span>
                  <Button size="sm" variant="ghost" icon={Eraser} onClick={() => pad.current?.clear()}>Effacer</Button>
                </div>
                <SignaturePad ref={pad} onChange={setEmpty} />
                <div className="tiny muted" style={{ marginTop: 4 }}>Signez avec la souris, un stylet ou le doigt.</div>
              </div>
              <label className="check" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
                <span className="small">{session.consentText}</span>
              </label>
              {error && <Alert tone="danger">{error}</Alert>}
              <Button variant="accent" disabled={!canSign || busy} busy={busy} onClick={submit}>Signer le devis</Button>
              <p className="tiny muted">Signature électronique simple réalisée sur ce poste. Le document signé est lié au PDF original par son empreinte SHA-256 et un certificat de preuve y est ajouté. Elle ne constitue pas une signature avancée ou qualifiée au sens du règlement eIDAS.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
