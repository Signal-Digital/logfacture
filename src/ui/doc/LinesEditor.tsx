import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, GripVertical, Heading, Package, Plus, Search, Trash2, Type } from 'lucide-react';
import { Button, Modal } from '../components/ui';
import { MoneyInput, PercentInput, QuantityInput, VatSelect } from '../components/inputs';
import { useApp, useData } from '../core/app';
import { listServices, UNITS } from '@/domain/catalog';
import { computeLine, type DiscountType } from '@/lib/money';
import { emptyLine, type DocLine } from '@/domain/docCommon';
import { formatEuro, formatRate } from '@/lib/format';

export function LinesEditor({ lines, onChange, readOnly, allowNegative }: { lines: DocLine[]; onChange: (l: DocLine[]) => void; readOnly?: boolean; allowNegative?: boolean }) {
  const { settings } = useApp();
  const [picker, setPicker] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const defaultVat = settings.vat.regime === 'franchise' ? 0 : settings.vat.default_rate_bp;
  const update = (i: number, patch: Partial<DocLine>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onChange(lines.filter((_, k) => k !== i));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= lines.length) return;
    const n = [...lines];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  const add = (l: DocLine) => onChange([...lines, l]);

  if (readOnly) {
    return (
      <div className="table-wrap">
        <table className="table lines-table">
          <thead><tr><th>Désignation</th><th className="num">Qté</th><th className="num">P.U. HT</th><th className="num">Remise</th><th className="num">TVA</th><th className="num">Total HT</th></tr></thead>
          <tbody>
            {lines.map((l, i) =>
              l.kind === 'item' ? (
                <tr key={i}>
                  <td><div className="strong">{l.designation}</div>{l.description && <div className="small muted pre">{l.description}</div>}</td>
                  <td className="num">{(l.quantity_milli / 1000).toLocaleString('fr-FR')} {l.unit}</td>
                  <td className="num">{formatEuro(l.unit_price_cents)}</td>
                  <td className="num">{l.discount_type === 'percent' ? `-${formatRate(l.discount_value)}` : l.discount_type === 'amount' ? `-${formatEuro(l.discount_value)}` : ''}</td>
                  <td className="num">{formatRate(l.vat_rate_bp)}</td>
                  <td className="num strong">{formatEuro(safeHt(l))}</td>
                </tr>
              ) : (
                <tr key={i} className="section"><td colSpan={6} className={l.kind === 'section' ? 'strong' : 'muted'} style={{ fontStyle: l.kind === 'text' ? 'italic' : undefined }}>{l.designation}</td></tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="table-wrap">
        <table className="table lines-table">
          <thead>
            <tr>
              <th style={{ width: 26 }} />
              <th style={{ minWidth: 260 }}>Désignation et description</th>
              <th style={{ width: 92 }} className="num">Quantité</th>
              <th style={{ width: 112 }}>Unité</th>
              <th style={{ width: 132 }} className="num">P.U. HT</th>
              <th style={{ width: 200 }}>Remise</th>
              <th style={{ width: 92 }}>TVA</th>
              <th style={{ width: 110 }} className="num">Total HT</th>
              <th style={{ width: 96 }} />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>Aucune ligne. Ajoutez une prestation du catalogue ou une ligne libre.</td></tr>
            )}
            {lines.map((l, i) => (
              <tr
                key={i}
                className={l.kind !== 'item' ? 'section' : ''}
                draggable={dragIdx === i}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIdx == null || dragIdx === i) return;
                  const n = [...lines];
                  const [m] = n.splice(dragIdx, 1);
                  n.splice(i, 0, m);
                  onChange(n);
                  setDragIdx(null);
                }}
              >
                <td className="handle" onMouseDown={() => setDragIdx(i)} onMouseUp={() => setDragIdx(null)} title="Glisser pour déplacer"><GripVertical size={15} /></td>
                {l.kind === 'item' ? (
                  <>
                    <td>
                      <input className="input" placeholder="Désignation" value={l.designation} onChange={(e) => update(i, { designation: e.target.value })} aria-label={`Désignation ligne ${i + 1}`} />
                      <textarea className="input" style={{ marginTop: 4, fontSize: 12.5 }} placeholder="Description détaillée (facultative)" value={l.description ?? ''} rows={1}
                        onChange={(e) => update(i, { description: e.target.value })}
                        onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${Math.min(200, t.scrollHeight)}px`; }} />
                    </td>
                    <td><QuantityInput value={l.quantity_milli} onChange={(v) => update(i, { quantity_milli: v })} ariaLabel="Quantité" /></td>
                    <td>
                      <input className="input" list="units" value={l.unit ?? ''} onChange={(e) => update(i, { unit: e.target.value })} aria-label="Unité" />
                    </td>
                    <td><MoneyInput value={l.unit_price_cents} onChange={(v) => update(i, { unit_price_cents: v })} allowNegative={allowNegative} ariaLabel="Prix unitaire HT" /></td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <select className="input" style={{ width: 66, padding: '0 4px' }} value={l.discount_type} onChange={(e) => update(i, { discount_type: e.target.value as DiscountType, discount_value: 0 })} aria-label="Type de remise">
                          <option value="none">—</option>
                          <option value="percent">%</option>
                          <option value="amount">€</option>
                        </select>
                        {l.discount_type === 'percent' && <PercentInput value={l.discount_value} onChange={(v) => update(i, { discount_value: v })} ariaLabel="Remise %" />}
                        {l.discount_type === 'amount' && <MoneyInput value={l.discount_value} onChange={(v) => update(i, { discount_value: v })} ariaLabel="Remise €" />}
                      </div>
                    </td>
                    <td><VatSelect value={l.vat_rate_bp} onChange={(v) => update(i, { vat_rate_bp: v })} ariaLabel="TVA" /></td>
                    <td className="num strong" style={{ paddingTop: 13 }}>{formatEuro(safeHt(l))}</td>
                  </>
                ) : (
                  <td colSpan={7}>
                    <input className="input" style={{ fontWeight: l.kind === 'section' ? 650 : 400, fontStyle: l.kind === 'text' ? 'italic' : undefined }} placeholder={l.kind === 'section' ? 'Titre de section' : 'Texte libre'} value={l.designation} onChange={(e) => update(i, { designation: e.target.value })} />
                  </td>
                )}
                <td className="nowrap" style={{ paddingTop: 9 }}>
                  <button className="btn ghost sm icon" onClick={() => move(i, -1)} aria-label="Monter" disabled={i === 0}><ArrowUp size={14} /></button>
                  <button className="btn ghost sm icon" onClick={() => move(i, 1)} aria-label="Descendre" disabled={i === lines.length - 1}><ArrowDown size={14} /></button>
                  <button className="btn ghost sm icon" onClick={() => onChange([...lines.slice(0, i + 1), { ...l, id: undefined }, ...lines.slice(i + 1)])} aria-label="Dupliquer"><Copy size={14} /></button>
                  <button className="btn ghost sm icon" onClick={() => remove(i)} aria-label="Supprimer"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
      </div>
      <div className="row wrap">
        <Button icon={Package} variant="primary" onClick={() => setPicker(true)}>Prestation du catalogue</Button>
        <Button icon={Plus} onClick={() => add(emptyLine(defaultVat))}>Ligne libre</Button>
        <Button icon={Heading} onClick={() => add({ ...emptyLine(0), kind: 'section', quantity_milli: 0, unit: null })}>Section</Button>
        <Button icon={Type} onClick={() => add({ ...emptyLine(0), kind: 'text', quantity_milli: 0, unit: null })}>Texte</Button>
        <span className="muted small">{lines.filter((l) => l.kind === 'item').length} ligne(s) — nombre illimité, pagination automatique dans le PDF</span>
      </div>
      {picker && (
        <CatalogPicker
          onClose={() => setPicker(false)}
          onPick={(s) =>
            add({
              kind: 'item', service_id: s.id, designation: s.name, description: s.description ?? '', quantity_milli: 1000, unit: s.unit,
              unit_price_cents: s.unit_price_cents, discount_type: 'none', discount_value: 0,
              vat_rate_bp: settings.vat.regime === 'franchise' ? 0 : s.vat_rate_bp, is_recurring: s.is_recurring,
            })
          }
        />
      )}
    </div>
  );
}

function safeHt(l: DocLine): number {
  try {
    return computeLine(l).ht_cents;
  } catch {
    return 0;
  }
}

export function CatalogPicker({ onPick, onClose }: { onPick: (s: any) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [added, setAdded] = useState<number[]>([]);
  const { data } = useData((c) => listServices(c.db, { search: q }), [q]);
  return (
    <Modal title="Insérer une prestation" subtitle="Cliquez pour ajouter (plusieurs possibles). Le prix copié pourra être modifié sans changer le catalogue." onClose={onClose} size="lg" footer={<Button variant="primary" onClick={onClose}>Terminé</Button>}>
      <div className="search" style={{ marginBottom: 10, width: '100%' }}>
        <Search />
        <input className="input" style={{ width: '100%' }} autoFocus placeholder="Rechercher une prestation…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="col" style={{ gap: 6 }}>
        {data?.map((s) => (
          <button
            key={s.id}
            className="card card-pad row"
            style={{ textAlign: 'left', cursor: 'pointer', padding: '10px 14px', borderColor: added.includes(s.id) ? 'var(--accent)' : undefined, font: 'inherit', color: 'inherit' }}
            onClick={() => { onPick(s); setAdded((a) => [...a, s.id]); }}
          >
            <div className="grow">
              <div className="strong">{s.name} {added.includes(s.id) && <span className="badge success plain">Ajoutée</span>}</div>
              <div className="muted small">{s.category}{s.description ? ' · ' + s.description.slice(0, 110) : ''}</div>
            </div>
            <div className="num">
              <div className="strong">{formatEuro(s.unit_price_cents)}</div>
              <div className="muted tiny">HT / {s.unit} · TVA {formatRate(s.vat_rate_bp)}</div>
            </div>
          </button>
        ))}
        {data?.length === 0 && <div className="muted small">Aucune prestation. Ajoutez-en dans le catalogue.</div>}
      </div>
    </Modal>
  );
}
