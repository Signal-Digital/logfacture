/**
 * État global de l'interface : plateforme, contexte métier, paramètres,
 * rafraîchissement des données, notifications (toasts), confirmations.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Platform } from '@/platform';
import type { Ctx } from '@/domain/context';
import { BusinessError } from '@/domain/context';
import { getAllSettings, type AllSettings } from '@/domain/settings';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
  details?: string[];
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Exige la saisie d'un texte (ex. motif) avant de confirmer */
  input?: { label: string; placeholder?: string; required?: boolean; initial?: string; multiline?: boolean };
}

interface AppState {
  platform: Platform;
  ctx: Ctx;
  settings: AllSettings;
  version: number;
  invalidate(): void;
  reloadSettings(): Promise<void>;
  toast(text: string, kind?: Toast['kind'], details?: string[]): void;
  /** Exécute une action, affiche les erreurs métier de façon lisible et rafraîchit les données. */
  run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined>;
  confirm(opts: ConfirmOptions): Promise<string | false>;
}

const Ctx_ = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx_);
  if (!v) throw new Error('AppProvider manquant');
  return v;
}

export function errorMessage(e: unknown): { text: string; details?: string[] } {
  if (e instanceof BusinessError) return { text: e.message, details: e.details };
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Erreur inattendue';
  // Messages SQLite des déclencheurs : on retire le préfixe technique.
  const clean = msg.replace(/^.*?(?:SqliteFailure|Error|error)[^:]*:\s*/i, '').replace(/^constraint failed:?\s*/i, '');
  if (/UNIQUE constraint failed/i.test(msg)) return { text: 'Cet élément existe déjà (doublon refusé).' };
  if (/FOREIGN KEY constraint failed/i.test(msg)) return { text: 'Opération impossible : cet élément est encore utilisé par d\'autres données.' };
  return { text: clean || 'Erreur inattendue' };
}

export function AppProvider({ platform, initialSettings, children }: { platform: Platform; initialSettings: AllSettings; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [settings, setSettings] = useState(initialSettings);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: string | false) => void }) | null>(null);
  const seq = useRef(0);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info', details?: string[]) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text, details }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4000);
  }, []);

  const invalidate = useCallback(() => setVersion((v) => v + 1), []);
  const reloadSettings = useCallback(async () => {
    setSettings(await getAllSettings(platform.ctx.db));
  }, [platform]);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string) => {
      try {
        const r = await fn();
        if (success) toast(success, 'success');
        return r;
      } catch (e) {
        const m = errorMessage(e);
        toast(m.text, 'error', m.details);
        console.error(e);
        return undefined;
      } finally {
        invalidate();
      }
    },
    [toast, invalidate],
  );

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<string | false>((resolve) => setDialog({ ...opts, resolve })), []);

  const value = useMemo<AppState>(
    () => ({ platform, ctx: platform.ctx, settings, version, invalidate, reloadSettings, toast, run, confirm }),
    [platform, settings, version, invalidate, reloadSettings, toast, run, confirm],
  );

  return (
    <Ctx_.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <div className="t-body">
              {t.text}
              {t.details && t.details.length > 0 && (
                <ul>
                  {t.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
            <button aria-label="Fermer" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>
      {dialog && <ConfirmDialog opts={dialog} onClose={(v) => { dialog.resolve(v); setDialog(null); }} />}
    </Ctx_.Provider>
  );
}

function ConfirmDialog({ opts, onClose }: { opts: ConfirmOptions; onClose: (v: string | false) => void }) {
  const [text, setText] = useState(opts.input?.initial ?? '');
  const valid = !opts.input?.required || text.trim().length > 0;
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(false);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-head">
          <h2 id="confirm-title">{opts.title}</h2>
        </div>
        <div className="modal-body col">
          <div>{opts.message}</div>
          {opts.input && (
            <div className="field">
              <label className={opts.input.required ? 'req' : ''}>{opts.input.label}</label>
              {opts.input.multiline ? (
                <textarea className="input" autoFocus value={text} placeholder={opts.input.placeholder} onChange={(e) => setText(e.target.value)} />
              ) : (
                <input className="input" autoFocus value={text} placeholder={opts.input.placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && valid && onClose(text)} />
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => onClose(false)}>Annuler</button>
          <button className={`btn ${opts.danger ? 'danger solid' : 'primary'}`} disabled={!valid} autoFocus={!opts.input} onClick={() => onClose(opts.input ? text : 'ok')}>
            {opts.confirmLabel ?? 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Charge des données ; se recharge quand les dépendances changent ou après toute action (invalidate). */
export function useData<T>(fn: (ctx: Ctx) => Promise<T>, deps: unknown[] = []): { data: T | undefined; loading: boolean; error: string | null; reload: () => void } {
  const { ctx, version } = useApp();
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn(ctx)
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e).text);
        console.error(e);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, version, local, ...deps]);
  return { data, loading, error, reload: () => setLocal((x) => x + 1) };
}

/** Avertit avant de quitter la page si des modifications ne sont pas enregistrées. */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
}
