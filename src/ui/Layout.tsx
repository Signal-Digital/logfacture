import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Bell, BarChart3, BookOpen, Briefcase, Building2, CalendarCheck, ChevronsLeft, CreditCard, FileSignature, FileText, FolderKanban,
  FolderOpen, KanbanSquare, LayoutDashboard, Lock, Moon, Package, Plus, Receipt, Repeat, Search, Settings, Sun, Target, UserPlus, Users,
} from 'lucide-react';
import { useApp, useData } from './core/app';
import { globalSearch, type SearchHit } from '@/domain/search';
import { computeNotices } from '@/domain/notifications';
import { activityCounts } from '@/domain/activities';
import { patchSetting } from '@/domain/settings';
import { CompanyFormModal } from './forms/CompanyForm';
import { ActivityFormModal, OpportunityFormModal } from './forms/smallForms';
import { Dropdown } from './components/ui';
import logoUrl from '../../assets/logo.svg';

const NAV: { section: string; items: { to: string; label: string; icon: any; countKey?: 'late' }[] }[] = [
  { section: '', items: [{ to: '/', label: 'Tableau de bord', icon: LayoutDashboard }] },
  {
    section: 'Commercial',
    items: [
      { to: '/prospects', label: 'Prospects', icon: Target },
      { to: '/entreprises', label: 'Entreprises et contacts', icon: Building2 },
      { to: '/pipeline', label: 'Pipeline commercial', icon: KanbanSquare },
      { to: '/activites', label: 'Activités et relances', icon: CalendarCheck, countKey: 'late' },
      { to: '/clients', label: 'Clients', icon: Users },
    ],
  },
  {
    section: 'Ventes',
    items: [
      { to: '/devis', label: 'Devis', icon: FileSignature },
      { to: '/factures', label: 'Factures et avoirs', icon: Receipt },
      { to: '/paiements', label: 'Paiements', icon: CreditCard },
      { to: '/catalogue', label: 'Catalogue de prestations', icon: Package },
    ],
  },
  {
    section: 'Production',
    items: [
      { to: '/projets', label: 'Projets et tâches', icon: FolderKanban },
      { to: '/contrats', label: 'Contrats récurrents', icon: Repeat },
      { to: '/documents', label: 'Documents', icon: FolderOpen },
      { to: '/modeles', label: 'Modèles de documents', icon: FileText },
    ],
  },
  {
    section: 'Pilotage',
    items: [
      { to: '/rapports', label: 'Rapports', icon: BarChart3 },
      { to: '/parametres', label: 'Paramètres', icon: Settings },
    ],
  },
];

export function Layout({ onLock, canLock }: { onLock: () => void; canLock: boolean }) {
  const { settings, ctx, run, reloadSettings, platform } = useApp();
  const [palette, setPalette] = useState(false);
  const [quick, setQuick] = useState<null | 'prospect' | 'client' | 'activite' | 'opportunite'>(null);
  const nav = useNavigate();
  const collapsed = settings.appearance.sidebar_collapsed;
  const { data: counts } = useData((c) => activityCounts(c.db));
  const { data: notices } = useData((c) => computeNotices(c.db));

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      } else if (mod && e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setQuick('prospect');
      } else if (mod && e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        nav('/devis/nouveau');
      } else if (mod && e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        nav('/factures/nouvelle');
      } else if (mod && e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setQuick('activite');
      } else if (mod && e.key.toLowerCase() === 'l' && canLock) {
        e.preventDefault();
        onLock();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [nav, onLock, canLock]);

  const toggleTheme = () =>
    run(async () => {
      const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      await patchSetting(ctx.db, 'appearance', { theme: current === 'dark' ? 'clair' : 'sombre' });
      await reloadSettings();
    });

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <img src={logoUrl} alt="" />
          <div className="txt">
            <div className="name">Signal Desk</div>
            <div className="tag">{settings.company.trade_name}</div>
          </div>
        </div>
        <nav className="nav" aria-label="Navigation principale">
          {NAV.map((g) => (
            <div key={g.section}>
              {g.section && <div className="nav-section">{g.section}</div>}
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.to === '/'} title={it.label}>
                  <it.icon />
                  <span>{it.label}</span>
                  {it.countKey === 'late' && counts && counts.late + counts.today > 0 && (
                    <span className={`count ${counts.late ? 'alert' : ''}`}>{counts.late + counts.today}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          {canLock && (
            <button onClick={onLock} title="Verrouiller (Ctrl+L)"><Lock /><span className="txt">Verrouiller</span></button>
          )}
          <button
            onClick={() => run(async () => { await patchSetting(ctx.db, 'appearance', { sidebar_collapsed: !collapsed }); await reloadSettings(); })}
            title="Réduire le menu"
          >
            <ChevronsLeft style={{ transform: collapsed ? 'rotate(180deg)' : undefined }} />
            <span className="txt">Réduire le menu</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="searchbox" onClick={() => setPalette(true)} role="button" tabIndex={0} aria-label="Recherche globale">
            <Search size={16} />
            <span className="grow">Rechercher un client, un devis, une facture…</span>
            <kbd>Ctrl</kbd><kbd>K</kbd>
          </div>
          <div className="grow" />
          {platform.kind === 'browser' && <span className="badge warning" title="Données en mémoire, non conservées">Mode démonstration navigateur</span>}
          <Dropdown
            align="right"
            width={230}
            trigger={(open) => <button className="btn accent" onClick={open}><Plus size={16} /> Créer</button>}
          >
            {(close) => (
              <>
                <div className="menu-title">Création rapide</div>
                <button onClick={() => { close(); setQuick('prospect'); }}><UserPlus /> Prospect <kbd style={{ marginLeft: 'auto' }}>Ctrl+Alt+P</kbd></button>
                <button onClick={() => { close(); setQuick('client'); }}><Users /> Client</button>
                <button onClick={() => { close(); setQuick('opportunite'); }}><Briefcase /> Opportunité</button>
                <button onClick={() => { close(); setQuick('activite'); }}><CalendarCheck /> Activité / relance <kbd style={{ marginLeft: 'auto' }}>Ctrl+Alt+A</kbd></button>
                <div className="sep" />
                <button onClick={() => { close(); nav('/devis/nouveau'); }}><FileSignature /> Devis <kbd style={{ marginLeft: 'auto' }}>Ctrl+Alt+D</kbd></button>
                <button onClick={() => { close(); nav('/factures/nouvelle'); }}><Receipt /> Facture <kbd style={{ marginLeft: 'auto' }}>Ctrl+Alt+F</kbd></button>
                <button onClick={() => { close(); nav('/catalogue?nouveau=1'); }}><Package /> Prestation</button>
                <button onClick={() => { close(); nav('/projets?nouveau=1'); }}><FolderKanban /> Projet</button>
              </>
            )}
          </Dropdown>
          <Dropdown
            align="right"
            width={360}
            trigger={(open) => (
              <button className="btn ghost icon" onClick={open} aria-label="Notifications" style={{ position: 'relative' }}>
                <Bell size={18} />
                {notices && notices.length > 0 && (
                  <span style={{ position: 'absolute', top: 3, right: 3, minWidth: 16, height: 16, borderRadius: 8, background: notices.some((n) => n.level === 'danger') ? 'var(--danger)' : 'var(--warning)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 4px' }}>
                    {notices.length}
                  </span>
                )}
              </button>
            )}
          >
            {(close) => (
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                <div className="menu-title">Notifications</div>
                {(!notices || notices.length === 0) && <div className="muted small" style={{ padding: 12 }}>Tout est à jour.</div>}
                {notices?.map((n) => (
                  <button key={n.key} onClick={() => { close(); nav(n.route); }} style={{ alignItems: 'flex-start' }}>
                    <span className="dot" style={{ marginTop: 6, background: n.level === 'danger' ? 'var(--danger)' : n.level === 'warning' ? 'var(--warning)' : 'var(--info)' }} />
                    <span className="grow">
                      <div className="strong">{n.title}</div>
                      <div className="muted small">{n.detail}</div>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Dropdown>
          <button className="btn ghost icon" onClick={toggleTheme} aria-label="Changer de thème" title="Mode clair / sombre">
            {document.documentElement.dataset.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="btn ghost icon" onClick={() => nav('/parametres/aide')} aria-label="Aide" title="Aide et raccourcis"><BookOpen size={18} /></button>
        </header>
        <main className="content" id="content">
          <Outlet />
        </main>
      </div>
      {palette && <SearchPalette onClose={() => setPalette(false)} />}
      {(quick === 'prospect' || quick === 'client') && <CompanyFormModal kind={quick} onClose={() => setQuick(null)} />}
      {quick === 'activite' && <ActivityFormModal onClose={() => setQuick(null)} />}
      {quick === 'opportunite' && <OpportunityFormModal onClose={() => setQuick(null)} />}
    </div>
  );
}

const TYPE_LABEL: Record<SearchHit['type'], string> = {
  entreprise: 'Entreprise', contact: 'Contact', devis: 'Devis', facture: 'Facture', projet: 'Projet', document: 'Document', prestation: 'Prestation', opportunite: 'Opportunité',
};

function SearchPalette({ onClose }: { onClose: () => void }) {
  const { ctx } = useApp();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const t = setTimeout(async () => {
      setHits(await globalSearch(ctx.db, q));
      setSel(0);
    }, 120);
    return () => clearTimeout(t);
  }, [q, ctx.db]);
  const go = (h: SearchHit) => {
    onClose();
    nav(h.route);
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Recherche globale">
        <input
          ref={input}
          value={q}
          placeholder="Rechercher partout (entreprises, contacts, devis, factures, projets, documents)…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter' && hits[sel]) go(hits[sel]);
          }}
        />
        <div className="results">
          {q.trim().length < 2 && <div className="muted small" style={{ padding: 12 }}>Tapez au moins 2 caractères. Raccourcis : Ctrl+Alt+P (prospect), Ctrl+Alt+D (devis), Ctrl+Alt+F (facture), Ctrl+Alt+A (activité).</div>}
          {q.trim().length >= 2 && hits.length === 0 && <div className="muted small" style={{ padding: 12 }}>Aucun résultat pour « {q} ».</div>}
          {hits.map((h, i) => (
            <div key={h.type + h.id} className={`hit ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(h)}>
              <span className="type">{TYPE_LABEL[h.type]}</span>
              <span className="grow">
                <div className="strong">{h.title}</div>
                {h.subtitle && <div className="muted small">{h.subtitle}</div>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
