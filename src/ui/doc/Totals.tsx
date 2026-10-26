import { computeTotals, depositAmount, type DiscountType } from '@/lib/money';
import { formatEuro, formatRate } from '@/lib/format';
import type { DocLine } from '@/domain/docCommon';
import { useApp } from '../core/app';

export function TotalsBox({ lines, discount, deposit, credit }: { lines: DocLine[]; discount: { type: DiscountType; value: number }; deposit?: { type: DiscountType; value: number }; credit?: boolean }) {
  const { settings } = useApp();
  let t;
  let error: string | null = null;
  try {
    t = computeTotals(lines, discount);
  } catch (e: any) {
    error = e.message;
  }
  if (!t) return <div className="alert danger">{error}</div>;
  let dep = 0;
  try {
    dep = deposit ? depositAmount(t.total_ttc_cents, deposit.type, deposit.value) : 0;
  } catch {
    dep = 0;
  }
  const franchise = settings.vat.regime === 'franchise';
  return (
    <div className="totals-box card card-pad">
      {t.global_discount_cents > 0 && (
        <>
          <div className="r"><span className="muted">Sous-total HT</span><span className="num">{formatEuro(t.subtotal_ht_cents)}</span></div>
          <div className="r"><span className="muted">Remise globale</span><span className="num">-{formatEuro(t.global_discount_cents)}</span></div>
        </>
      )}
      <div className="r"><span>Total HT</span><span className="num strong">{formatEuro(t.total_ht_cents)}</span></div>
      {franchise ? (
        <div className="r muted small"><span>TVA non applicable (art. 293 B du CGI)</span><span>—</span></div>
      ) : (
        t.vat.map((v) => (
          <div className="r muted small" key={v.rate_bp}><span>TVA {formatRate(v.rate_bp)} sur {formatEuro(v.base_cents)}</span><span className="num">{formatEuro(v.vat_cents)}</span></div>
        ))
      )}
      <div className="r big"><span>{credit ? "Total de l'avoir" : franchise ? 'Net à payer' : 'Total TTC'}</span><span className="num">{formatEuro(t.total_ttc_cents)}</span></div>
      {dep > 0 && <div className="r small"><span className="muted">Acompte demandé</span><span className="num strong">{formatEuro(dep)}</span></div>}
    </div>
  );
}
