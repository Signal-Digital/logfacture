/** Champs de saisie spécialisés : montants, quantités, pourcentages, dates, sélecteurs. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { bpToInput, centsToInput, milliToInput, parseEuros, parsePercent, parseQuantity } from '@/lib/money';
import { useApp, useData } from '../core/app';
import { listCompanies, listContacts, contactFullName } from '@/domain/companies';
import { Search } from 'lucide-react';

/** Montant en euros (saisie libre « 1 234,56 », stockage en centimes). */
export function MoneyInput({ value, onChange, className = '', placeholder, allowNegative, autoFocus, ariaLabel }: { value: number | null; onChange: (cents: number) => void; className?: string; placeholder?: string; allowNegative?: boolean; autoFocus?: boolean; ariaLabel?: string }) {
  const [text, setText] = useState(value == null ? '' : centsToInput(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : centsToInput(value));
  }, [value]);
  return (
    <div className="input-group">
      <input
        className={`input num ${invalid ? 'invalid' : ''} ${className}`}
        value={text}
        placeholder={placeholder ?? '0,00'}
        inputMode="decimal"
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const c = parseEuros(e.target.value);
            if (!allowNegative && c < 0) throw new Error();
            setInvalid(false);
            onChange(c);
          } catch {
            setInvalid(true);
          }
        }}
        onBlur={() => {
          focused.current = false;
          if (!invalid) setText(value == null ? '' : centsToInput(value));
        }}
      />
      <span className="addon">€</span>
    </div>
  );
}

export function QuantityInput({ value, onChange, className = '', ariaLabel }: { value: number; onChange: (milli: number) => void; className?: string; ariaLabel?: string }) {
  const [text, setText] = useState(milliToInput(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(milliToInput(value));
  }, [value]);
  return (
    <input
      className={`input num ${invalid ? 'invalid' : ''} ${className}`}
      value={text}
      inputMode="decimal"
      aria-label={ariaLabel}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        try {
          onChange(parseQuantity(e.target.value));
          setInvalid(false);
        } catch {
          setInvalid(true);
        }
      }}
      onBlur={() => {
        focused.current = false;
        if (!invalid) setText(milliToInput(value));
      }}
    />
  );
}

export function PercentInput({ value, onChange, className = '', ariaLabel }: { value: number; onChange: (bp: number) => void; className?: string; ariaLabel?: string }) {
  const [text, setText] = useState(bpToInput(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(bpToInput(value));
  }, [value]);
  return (
    <div className="input-group">
      <input
        className={`input num ${invalid ? 'invalid' : ''} ${className}`}
        value={text}
        inputMode="decimal"
        aria-label={ariaLabel}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(parsePercent(e.target.value));
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
        onBlur={() => {
          focused.current = false;
          if (!invalid) setText(bpToInput(value));
        }}
      />
      <span className="addon">%</span>
    </div>
  );
}

/** Sélecteur de taux de TVA (taux configurés dans les paramètres). */
export function VatSelect({ value, onChange, className = '', ariaLabel }: { value: number; onChange: (bp: number) => void; className?: string; ariaLabel?: string }) {
  const { settings } = useApp();
  const rates = useMemo(() => {
    const r = new Set(settings.vat.rates_bp);
    r.add(value);
    return [...r].sort((a, b) => b - a);
  }, [settings.vat.rates_bp, value]);
  const franchise = settings.vat.regime === 'franchise';
  return (
    <select className={`input ${className}`} value={value} aria-label={ariaLabel} onChange={(e) => onChange(Number(e.target.value))} title={franchise ? 'Franchise en base : TVA à 0 %' : undefined}>
      {rates.map((r) => (
        <option key={r} value={r}>
          {bpToInput(r)} %
        </option>
      ))}
    </select>
  );
}

export function DateInput({ value, onChange, className = '', min, max, ariaLabel, required }: { value: string | null | undefined; onChange: (v: string | null) => void; className?: string; min?: string; max?: string; ariaLabel?: string; required?: boolean }) {
  return <input type="date" className={`input ${className}`} value={value ?? ''} min={min} max={max} aria-label={ariaLabel} required={required} onChange={(e) => onChange(e.target.value || null)} />;
}

export function DateTimeInput({ value, onChange, className = '' }: { value: string | null | undefined; onChange: (v: string | null) => void; className?: string }) {
  return <input type="datetime-local" className={`input ${className}`} value={value ? value.slice(0, 16) : ''} onChange={(e) => onChange(e.target.value ? `${e.target.value}:00` : null)} />;
}

/** Sélecteur d'entreprise avec recherche. */
export function CompanyPicker({ value, onChange, kinds, placeholder = 'Rechercher une entreprise…', autoFocus }: { value: number | null; onChange: (id: number | null, name?: string) => void; kinds?: ('prospect' | 'client' | 'ancien_client' | 'partenaire')[]; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data } = useData((ctx) => listCompanies(ctx.db, { kind: kinds, limit: 5000 }), [kinds?.join(',')]);
  const selected = data?.find((c) => c.id === value);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const results = (data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.city ?? '').toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <div className="dropdown" ref={ref} style={{ width: '100%' }}>
      <div className="search" style={{ width: '100%' }}>
        <Search />
        <input
          className="input"
          style={{ width: '100%' }}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={open ? q : selected?.name ?? ''}
          onFocus={() => {
            setOpen(true);
            setQ('');
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && (
        <div className="menu" style={{ top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 300, overflowY: 'auto' }}>
          {results.length === 0 && <div className="muted small" style={{ padding: 10 }}>Aucun résultat</div>}
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onChange(c.id, c.name);
                setOpen(false);
              }}
            >
              <span className="grow">
                <span className="strong">{c.name}</span>
                <span className="muted small"> · {c.kind === 'client' ? 'Client' : c.kind === 'prospect' ? 'Prospect' : c.kind === 'ancien_client' ? 'Ancien client' : 'Partenaire'}{c.city ? ' · ' + c.city : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ContactSelect({ companyId, value, onChange }: { companyId: number | null; value: number | null; onChange: (id: number | null) => void }) {
  const { data } = useData((ctx) => (companyId ? listContacts(ctx.db, { companyId }) : Promise.resolve([])), [companyId]);
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} disabled={!companyId}>
      <option value="">— Aucun contact —</option>
      {(data ?? []).map((k) => (
        <option key={k.id} value={k.id}>
          {contactFullName(k)}
          {k.job_title ? ` (${k.job_title})` : ''}
        </option>
      ))}
    </select>
  );
}
