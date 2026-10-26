/**
 * Démarrage : plateforme, base de données (migrations + données initiales),
 * verrouillage éventuel, routes et tâches de fond locales.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { initPlatform, type Platform } from '@/platform';
import { initDatabase } from '@/domain/seed';
import { getAllSettings, patchSetting, type AllSettings } from '@/domain/settings';
import { expireQuotes } from '@/domain/quotes';
import { dueReminders, markReminded } from '@/domain/activities';
import { runRecurring } from '@/domain/contracts';
import { unlock } from '@/domain/security';
import { logEvent } from '@/domain/audit';
import { AppProvider, useApp } from './core/app';
import { Layout } from './Layout';
import { Dashboard } from './pages/Dashboard';
import { CompaniesPage } from './pages/Companies';
import { CompanyDetail } from './pages/CompanyDetail';
import { PipelinePage } from './pages/Pipeline';
import { ActivitiesPage } from './pages/Activities';
import { QuotesPage, QuoteNew, QuoteDetail } from './pages/Quotes';
import { InvoicesPage, InvoiceNew, InvoiceDetail } from './pages/Invoices';
import { PaymentsPage } from './pages/Payments';
import { CatalogPage } from './pages/Catalog';
import { ProjectsPage, ProjectDetail } from './pages/Projects';
import { ContractsPage } from './pages/Contracts';
import { DocumentsPage } from './pages/Documents';
import { TemplatesPage } from './pages/Templates';
import { TemplateDesigner } from './pages/TemplateDesigner';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { SignatureScreen } from './pages/SignatureScreen';
import logoUrl from '../../assets/logo.svg';

function applyTheme(theme: AllSettings['appearance']['theme']) {
  const dark = theme === 'sombre' || (theme === 'systeme' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function Root() {
  const [state, setState] = useState<{ platform: Platform; settings: AllSettings } | { error: string } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const platform = await initPlatform();
        await initDatabase(platform.ctx.db);
        const settings = await getAllSettings(platform.ctx.db);
        applyTheme(settings.appearance.theme);
        setState({ platform, settings });
      } catch (e: any) {
        console.error(e);
        setState({ error: e?.message ?? String(e) });
      }
    })();
  }, []);
  if (!state) {
    return (
      <div className="loading-screen">
        <div className="col" style={{ alignItems: 'center', gap: 14 }}>
          <img src={logoUrl} width={56} height={56} alt="" />
          <div>Ouverture de Signal Desk…</div>
        </div>
      </div>
    );
  }
  if ('error' in state) {
    return (
      <div className="loading-screen">
        <div className="lock-card" style={{ width: 520, textAlign: 'left' }}>
          <h2>Signal Desk n'a pas pu démarrer</h2>
          <div className="alert danger">{state.error}</div>
          <p className="muted small">Vos données ne sont pas modifiées. Fermez puis relancez l'application. Si le problème persiste, restaurez une sauvegarde depuis le dossier de données.</p>
        </div>
      </div>
    );
  }
  return (
    <AppProvider platform={state.platform} initialSettings={state.settings}>
      <Shell />
    </AppProvider>
  );
}

const isSignatureWindow = () => location.hash.startsWith('#/signature/');
/** Fenêtre ouverte pour une signature : figé au démarrage, elle ne donne accès qu'à l'écran de signature. */
const SIGNATURE_ONLY = typeof location !== 'undefined' && isSignatureWindow() && '__TAURI_INTERNALS__' in window;

function Shell() {
  const { settings, ctx, platform, invalidate } = useApp();
  const hasPassword = !!settings.security.password;
  const [locked, setLocked] = useState(hasPassword && !isSignatureWindow());
  const lastActivity = useRef(Date.now());

  useEffect(() => applyTheme(settings.appearance.theme), [settings.appearance.theme]);

  // Verrouillage automatique après inactivité
  useEffect(() => {
    const minutes = settings.security.auto_lock_minutes;
    if (!hasPassword || !minutes || isSignatureWindow()) return;
    const bump = () => (lastActivity.current = Date.now());
    const events = ['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - lastActivity.current > minutes * 60000) setLocked(true);
    }, 15000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [hasPassword, settings.security.auto_lock_minutes]);

  // Tâches de fond locales (aucun envoi externe)
  useEffect(() => {
    if (isSignatureWindow()) return;
    let stopped = false;
    const tick = async () => {
      try {
        const expired = await expireQuotes(ctx.db);
        const automation = (await getAllSettings(ctx.db)).automation;
        if (automation.local_notifications) {
          for (const a of await dueReminders(ctx.db)) {
            await platform.notify(`Rappel : ${a.title}`, a.company_name ? `${a.company_name}` : 'Activité Signal Desk');
            await markReminded(ctx.db, a.id);
          }
        }
        // Préparation des factures récurrentes (brouillons) ; émission seulement si activée.
        const rec = await runRecurring(ctx.db);
        if (rec.prepared && automation.local_notifications) await platform.notify('Factures récurrentes', `${rec.prepared} brouillon(s) préparé(s)${rec.issued ? `, ${rec.issued} émise(s)` : ''}.`);
        await autoBackup();
        if (expired || rec.prepared) invalidate();
      } catch (e) {
        console.error('Tâche de fond', e);
      }
    };
    const autoBackup = async () => {
      const s = await getAllSettings(ctx.db);
      const b = s.backup;
      if (!b.auto_enabled || platform.kind !== 'tauri') return;
      const last = b.last_auto_at ? new Date(b.last_auto_at).getTime() : 0;
      if (Date.now() - last < b.frequency_hours * 3600000) return;
      const dir = b.directory || platform.info.default_backup_dir;
      if (b.encrypt) return; // la phrase de passe n'est jamais stockée : sauvegarde chiffrée = manuelle
      try {
        const info = await platform.backupCreate(dir, null, 'auto');
        await patchSetting(ctx.db, 'backup', { last_auto_at: new Date().toISOString() });
        await logEvent(ctx.db, { entity: 'sauvegarde', action: 'creation', summary: `Sauvegarde automatique : ${info.path}` });
      } catch (e: any) {
        await platform.notify('Sauvegarde automatique impossible', e?.message ?? String(e));
      }
    };
    const first = setTimeout(tick, 4000);
    const interval = setInterval(() => !stopped && tick(), 60000);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [ctx.db, platform, invalidate]);

  const lock = useCallback(() => hasPassword && setLocked(true), [hasPassword]);

  if (SIGNATURE_ONLY) return <RouterProvider router={signatureRouter()} />;
  if (locked) return <LockScreen onUnlock={() => { lastActivity.current = Date.now(); setLocked(false); }} />;
  return <RouterProvider router={getRouter(lock, hasPassword)} />;
}

let router: ReturnType<typeof createHashRouter> | null = null;
let sigRouter: ReturnType<typeof createHashRouter> | null = null;

/** Routeur restreint de la fenêtre de signature : aucune autre page n'est accessible. */
function signatureRouter() {
  sigRouter ??= createHashRouter([
    { path: '/signature/:token', element: <SignatureScreen /> },
    { path: '*', element: <div className="loading-screen"><div>Cette fenêtre est réservée à la signature d'un document.</div></div> },
  ]);
  return sigRouter;
}
let routerLockRef: { lock: () => void; canLock: boolean } = { lock: () => undefined, canLock: false };

function LayoutWithLock() {
  return <Layout onLock={() => routerLockRef.lock()} canLock={routerLockRef.canLock} />;
}

function getRouter(lock: () => void, canLock: boolean) {
  routerLockRef = { lock, canLock };
  if (router) return router;
  router = createHashRouter([
    { path: '/signature/:token', element: <SignatureScreen /> },
    {
      path: '/',
      element: <LayoutWithLock />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: 'prospects', element: <CompaniesPage kind="prospect" /> },
        { path: 'entreprises', element: <CompaniesPage /> },
        { path: 'entreprises/:id', element: <CompanyDetail /> },
        { path: 'contacts', element: <Navigate to="/entreprises?onglet=contacts" replace /> },
        { path: 'clients', element: <CompaniesPage kind="client" /> },
        { path: 'pipeline', element: <PipelinePage /> },
        { path: 'activites', element: <ActivitiesPage /> },
        { path: 'devis', element: <QuotesPage /> },
        { path: 'devis/nouveau', element: <QuoteNew /> },
        { path: 'devis/:id', element: <QuoteDetail /> },
        { path: 'factures', element: <InvoicesPage /> },
        { path: 'factures/nouvelle', element: <InvoiceNew /> },
        { path: 'factures/:id', element: <InvoiceDetail /> },
        { path: 'paiements', element: <PaymentsPage /> },
        { path: 'catalogue', element: <CatalogPage /> },
        { path: 'projets', element: <ProjectsPage /> },
        { path: 'projets/:id', element: <ProjectDetail /> },
        { path: 'contrats', element: <ContractsPage /> },
        { path: 'documents', element: <DocumentsPage /> },
        { path: 'modeles', element: <TemplatesPage /> },
        { path: 'modeles/:id', element: <TemplateDesigner /> },
        { path: 'rapports', element: <ReportsPage /> },
        { path: 'parametres', element: <SettingsPage /> },
        { path: 'parametres/:section', element: <SettingsPage /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ]);
  return router;
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { ctx, settings } = useApp();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError('');
    const ok = await unlock(ctx.db, pw);
    setBusy(false);
    if (ok) onUnlock();
    else {
      setError('Mot de passe incorrect.');
      setPw('');
    }
  };
  return (
    <div className="lock-screen">
      <div className="lock-card">
        <img src={logoUrl} width={56} height={56} alt="" style={{ margin: '0 auto' }} />
        <div>
          <h2>Signal Desk est verrouillé</h2>
          <div className="muted small">{settings.company.trade_name}</div>
        </div>
        <input className="input" type="password" autoFocus placeholder="Mot de passe" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} aria-label="Mot de passe" />
        {error && <div className="alert danger">{error}</div>}
        <button className="btn primary" onClick={submit} disabled={busy || !pw}>{busy ? 'Vérification…' : 'Déverrouiller'}</button>
        <p className="tiny muted">Ce verrou protège l'accès à l'application. Il ne chiffre pas les fichiers sur le disque.</p>
      </div>
    </div>
  );
}
