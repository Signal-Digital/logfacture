/** Composants d'interface de base. */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react';

type BtnVariant = 'default' | 'primary' | 'accent' | 'danger' | 'ghost';

export function Button({
  variant = 'default',
  size,
  icon: Icon,
  children,
  className = '',
  busy,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm'; icon?: LucideIcon; busy?: boolean }) {
  const [running, setRunning] = useState(false);
  const onClick = rest.onClick;
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy || running}
      className={`btn ${variant !== 'default' ? variant : ''} ${size ?? ''} ${!children && Icon ? 'icon' : ''} ${className}`}
      onClick={
        onClick
          ? async (e) => {
              const r = onClick(e) as unknown;
              if (r && typeof (r as Promise<unknown>).then === 'function') {
                setRunning(true);
                try {
                  await r;
                } finally {
                  setRunning(false);
                }
              }
            }
          : undefined
      }
    >
      {busy || running ? <span className="spinner" style={{ width: 14, height: 14 }} /> : Icon ? <Icon /> : null}
      {children}
    </button>
  );
}

export function Field({ label, required, help, error, children, className = '' }: { label?: ReactNode; required?: boolean; help?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      {label && <label className={required ? 'req' : ''}>{label}</label>}
      {children}
      {error ? <span className="error">{error}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}

export function Card({ title, actions, children, className = '', pad = true, foot }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; foot?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {typeof title === 'string' ? <h3>{title}</h3> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
      {foot && <div className="card-foot">{foot}</div>}
    </section>
  );
}

export function Badge({ tone = 'neutral', children, plain }: { tone?: string; children: ReactNode; plain?: boolean }) {
  return <span className={`badge ${tone} ${plain ? 'plain' : ''}`}>{children}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
  subtitle,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'lg' | 'xl' | 'full';
  subtitle?: ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="col" style={{ gap: 2 }}>
            <h2>{title}</h2>
            {subtitle && <span className="muted small">{subtitle}</span>}
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico">
        <Icon />
      </div>
      <h3>{title}</h3>
      {text && <p style={{ maxWidth: 420 }}>{text}</p>}
      {action}
    </div>
  );
}

export function Alert({ tone = 'info', children, title }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode; title?: ReactNode }) {
  const Icon = tone === 'danger' ? XCircle : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div className={`alert ${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon />
      <div className="grow">
        {title && <div className="strong">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Kpi({ label, value, hint, icon: Icon, tone, onClick, hero }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: 'danger' | 'warning' | 'info' | 'success'; onClick?: () => void; hero?: boolean }) {
  return (
    <div className={`kpi ${tone ? 'tone-' + tone : ''} ${onClick ? 'clickable' : ''} ${hero ? 'hero' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      {Icon && (
        <div className="icon">
          <Icon />
        </div>
      )}
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" aria-label="Chargement" />;
}

export function Loading() {
  return (
    <div className="empty">
      <Spinner />
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <span className="switch">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
      {label}
    </label>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Menu déroulant attaché à un bouton. */
export function Dropdown({ trigger, children, align = 'left', width }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className="menu" style={{ top: '100%', marginTop: 6, [align]: 0, minWidth: width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function initials(name: string): string {
  return name
    .split(/[\s\-']+/)
    .filter((w) => w && !/^(sarl|sas|sasu|eurl|sa|ei|la|le|les|de|du|des|et)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';
}

export function Avatar({ name, size }: { name: string; size?: 'lg' }) {
  return <div className={`avatar ${size ?? ''}`}>{initials(name)}</div>;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function PageHead({ title, subtitle, actions, breadcrumb }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="title">
        {breadcrumb && <div className="breadcrumb">{breadcrumb}</div>}
        <h1>{title}</h1>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

/** Tri de tableau. */
export function useSort<T>(rows: T[] | undefined, initial: { key: keyof T | string; dir: 'asc' | 'desc' }) {
  const [sort, setSort] = useState(initial);
  const sorted = [...(rows ?? [])].sort((a: any, b: any) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const r = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'fr', { sensitivity: 'base', numeric: true });
    return sort.dir === 'asc' ? r : -r;
  });
  const header = (key: string, label: ReactNode, className = '') => (
    <th className={`sortable ${className}`} onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}>
      {label} {sort.key === key ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );
  return { sorted, header };
}
