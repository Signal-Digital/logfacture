/** Graphiques SVG légers (sans dépendance). */
import { useState } from 'react';
import { formatEuro } from '@/lib/format';

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

function niceMax(v: number): number {
  // Montants en centimes : échelle minimale de 100 € pour un graphique vide.
  if (v < 10000) return 10000;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * exp;
}

function shortEuro(cents: number): string {
  const e = cents / 100;
  if (Math.abs(e) >= 1_000_000) return `${(e / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`;
  if (Math.abs(e) >= 1000) return `${(e / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(e)} €`;
}

/** Barres groupées (montants en centimes). */
export function BarChart({ labels, series, height = 240 }: { labels: string[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 760;
  const pad = { l: 56, r: 10, t: 12, b: 28 };
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const groupW = innerW / Math.max(1, labels.length);
  const barW = Math.min(22, (groupW * 0.72) / series.length);
  const y = (v: number) => pad.t + innerH - (Math.max(0, v) / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Graphique en barres">
        <g className="grid">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">{shortEuro(t)}</text>
            </g>
          ))}
        </g>
        {labels.map((l, i) => {
          const gx = pad.l + i * groupW + (groupW - barW * series.length) / 2;
          return (
            <g key={l + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * groupW} y={pad.t} width={groupW} height={innerH} fill={hover === i ? 'rgba(20,184,166,0.07)' : 'transparent'} />
              {series.map((s, k) => (
                <rect key={s.key} x={gx + k * barW} y={y(s.values[i])} width={barW - 3} height={Math.max(0, pad.t + innerH - y(s.values[i]))} rx={3} fill={s.color} />
              ))}
              <text x={pad.l + i * groupW + groupW / 2} y={height - 8} textAnchor="middle">{l}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="card" style={{ position: 'absolute', top: 6, right: 6, padding: '8px 12px', fontSize: 12.5, pointerEvents: 'none' }}>
          <div className="strong">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="row" style={{ gap: 6 }}>
              <i style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: 'inline-block' }} /> {s.label} : <span className="strong">{formatEuro(s.values[hover])}</span>
            </div>
          ))}
        </div>
      )}
      <div className="legend" style={{ marginTop: 6 }}>
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Barres horizontales (classement). */
export function HBars({ rows, format = formatEuro }: { rows: { label: string; value: number; sub?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r, i) => (
        <div className="bar-row" key={r.label + i}>
          <div className="nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.label}>
            {r.label}
            {r.sub && <div className="tiny muted">{r.sub}</div>}
          </div>
          <div className="bar">
            <div style={{ width: `${(Math.max(0, r.value) / max) * 100}%` }} />
          </div>
          <div className="num strong">{format(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

/** Anneau de répartition. */
export function Donut({ parts, size = 150, center }: { parts: { label: string; value: number; color: string }[]; size?: number; center?: string }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="row" style={{ gap: 18 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Répartition">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={16} />
        {parts.map((p) => {
          const len = (Math.max(0, p.value) / total) * c;
          const el = <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={16} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
          offset += len;
          return el;
        })}
        {center && (
          <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 15, fontWeight: 700, fill: 'var(--text)' }}>
            {center}
          </text>
        )}
      </svg>
      <div className="col" style={{ gap: 6 }}>
        {parts.map((p) => (
          <div key={p.label} className="row small" style={{ gap: 8 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: p.color, display: 'inline-block' }} />
            <span className="grow">{p.label}</span>
            <span className="strong">{p.value.toLocaleString('fr-FR')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
