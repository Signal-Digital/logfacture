import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, Copy, Package, Pencil, Plus, Search } from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHead, useSort } from '../components/ui';
import { MoneyInput, VatSelect } from '../components/inputs';
import { UNITS, archiveService, createService, duplicateService, listCategories, listServices, updateService, type Service, type ServiceInput } from '@/domain/catalog';
import { formatEuro, formatRate } from '@/lib/format';

export function CatalogPage() {
  const { ctx, run } = useApp();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<Service | 'new' | null>(params.get('nouveau') ? 'new' : null);
  const { data, loading } = useData((c) => listServices(c.db, { search, category: category || undefined, includeArchived: archived }), [search, category, archived]);
  const { data: categories } = useData((c) => listCategories(c.db));
  const { sorted, header } = useSort(data, { key: 'category', dir: 'asc' });
  useEffect(() => {
    const id = Number(params.get('prestation'));
    if (id && data) {
      const s = data.find((x) => x.id === id);
      if (s) setEdit(s);
    }
  }, [params, data]);
  return (
    <>
      <PageHead title="Catalogue de prestations" subtitle="Insérez une prestation dans un devis en un clic. Modifier un tarif ici ne modifie jamais les documents existants." actions={<Button variant="accent" icon={Plus} onClick={() => setEdit('new')}>Nouvelle prestation</Button>} />
      <div className="toolbar">
        <div className="search"><Search /><input className="input" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="input" style={{ width: 200 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie">
          <option value="">Toutes les catégories</option>
          {categories?.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="check small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Inclure les archivées</label>
      </div>
      <Card pad={false}>
        {loading && !data ? <Loading /> : !sorted.length ? <Empty icon={Package} title="Aucune prestation" action={<Button variant="primary" onClick={() => setEdit('new')}>Créer une prestation</Button>} /> : (
          <table className="table">
            <thead><tr>{header('name', 'Prestation')}{header('category', 'Catégorie')}{header('unit_price_cents', 'Prix HT', 'num')}<th>Unité</th><th className="num">TVA</th><th>Durée</th><th /></tr></thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id} style={{ opacity: s.archived_at ? 0.55 : 1 }}>
                  <td><div className="cell-title">{s.name} {s.is_recurring ? <Badge tone="accent" plain>Récurrente</Badge> : null} {s.archived_at && <Badge tone="muted" plain>Archivée</Badge>}</div><div className="cell-sub" style={{ maxWidth: 480 }}>{s.description}</div></td>
                  <td>{s.category}</td>
                  <td className="num strong">{formatEuro(s.unit_price_cents)}</td>
                  <td>{s.unit}</td>
                  <td className="num">{formatRate(s.vat_rate_bp)}</td>
                  <td className="muted">{s.duration_label}</td>
                  <td className="num nowrap">
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(s)} aria-label="Modifier" />
                    <Button size="sm" variant="ghost" icon={Copy} onClick={() => run(() => duplicateService(ctx.db, s.id), 'Prestation dupliquée')} aria-label="Dupliquer" />
                    <Button size="sm" variant="ghost" icon={s.archived_at ? ArchiveRestore : Archive} onClick={() => run(() => archiveService(ctx.db, s.id, !s.archived_at), s.archived_at ? 'Prestation réactivée' : 'Prestation archivée')} aria-label={s.archived_at ? 'Réactiver' : 'Archiver'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {edit && <ServiceModal service={edit === 'new' ? undefined : edit} categories={categories ?? []} onClose={() => { setEdit(null); if (params.get('nouveau') || params.get('prestation')) setParams({}); }} />}
    </>
  );
}

function ServiceModal({ service, categories, onClose }: { service?: Service; categories: string[]; onClose: () => void }) {
  const { ctx, run, settings } = useApp();
  const [f, setF] = useState<ServiceInput>(service ? { ...service } : { name: '', unit: 'forfait', unit_price_cents: 0, vat_rate_bp: settings.vat.regime === 'franchise' ? 0 : settings.vat.default_rate_bp, is_recurring: 0 });
  const set = (k: keyof ServiceInput, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const ok = await run(async () => {
      if (service) await updateService(ctx.db, service.id, f);
      else await createService(ctx.db, f);
      return true;
    }, 'Prestation enregistrée');
    if (ok) onClose();
  };
  return (
    <Modal title={service ? 'Modifier la prestation' : 'Nouvelle prestation'} onClose={onClose} size="lg" footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={save}>Enregistrer</Button></>}>
      <div className="form-grid">
        <Field label="Nom" required className="span-2"><input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Description" className="span-2"><textarea className="input" value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Catégorie"><input className="input" list="cats" value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Durée (facultatif)"><input className="input" value={f.duration_label ?? ''} onChange={(e) => set('duration_label', e.target.value)} placeholder="2 semaines" /></Field>
        <Field label="Prix unitaire HT" required><MoneyInput value={f.unit_price_cents ?? 0} onChange={(v) => set('unit_price_cents', v)} /></Field>
        <Field label="Unité"><input className="input" list="units2" value={f.unit ?? ''} onChange={(e) => set('unit', e.target.value)} /><datalist id="units2">{UNITS.map((u) => <option key={u} value={u} />)}</datalist></Field>
        <Field label="Taux de TVA" help={settings.vat.regime === 'franchise' ? 'Franchise en base : 0 % appliqué sur les documents' : undefined}><VatSelect value={f.vat_rate_bp ?? 0} onChange={(v) => set('vat_rate_bp', v)} /></Field>
        <Field label=" "><label className="check"><input type="checkbox" checked={!!f.is_recurring} onChange={(e) => set('is_recurring', e.target.checked ? 1 : 0)} /> Prestation récurrente (abonnement)</label></Field>
      </div>
    </Modal>
  );
}
