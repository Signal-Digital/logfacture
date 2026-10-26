/** Recherche globale (entreprises, contacts, devis, factures, projets, documents, prestations). */
import type { Db } from '@/lib/db';

export interface SearchHit {
  type: 'entreprise' | 'contact' | 'devis' | 'facture' | 'projet' | 'document' | 'prestation' | 'opportunite';
  id: number;
  title: string;
  subtitle: string;
  route: string;
}

export async function globalSearch(db: Db, query: string, limit = 8): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const hits: SearchHit[] = [];
  const companies = await db.all<any>(
    `SELECT id, name, kind, city, email FROM companies WHERE merged_into_id IS NULL AND (lower(name) LIKE ? OR lower(COALESCE(email,'')) LIKE ? OR COALESCE(phone,'') LIKE ? OR lower(COALESCE(city,'')) LIKE ? OR COALESCE(siret,'') LIKE ?)
     ORDER BY archived_at IS NOT NULL, name LIMIT ?`,
    [like, like, `%${query.trim()}%`, like, `%${query.trim()}%`, limit],
  );
  for (const c of companies) {
    hits.push({ type: 'entreprise', id: c.id, title: c.name, subtitle: [c.kind === 'client' ? 'Client' : c.kind === 'prospect' ? 'Prospect' : c.kind === 'ancien_client' ? 'Ancien client' : 'Partenaire', c.city, c.email].filter(Boolean).join(' · '), route: `/entreprises/${c.id}` });
  }
  const contacts = await db.all<any>(
    `SELECT k.id, k.first_name, k.last_name, k.email, k.company_id, c.name AS company FROM contacts k LEFT JOIN companies c ON c.id = k.company_id
     WHERE k.archived_at IS NULL AND lower(COALESCE(k.first_name,'') || ' ' || k.last_name || ' ' || COALESCE(k.email,'')) LIKE ? LIMIT ?`,
    [like, limit],
  );
  for (const k of contacts) {
    hits.push({ type: 'contact', id: k.id, title: [k.first_name, k.last_name].filter(Boolean).join(' '), subtitle: [k.company, k.email].filter(Boolean).join(' · '), route: k.company_id ? `/entreprises/${k.company_id}` : '/contacts' });
  }
  const quotes = await db.all<any>(
    `SELECT q.id, q.number, q.title, c.name AS company FROM quotes q JOIN companies c ON c.id = q.company_id WHERE lower(q.number) LIKE ? OR lower(q.title) LIKE ? ORDER BY q.id DESC LIMIT ?`,
    [like, like, limit],
  );
  for (const x of quotes) hits.push({ type: 'devis', id: x.id, title: `Devis ${x.number}`, subtitle: [x.company, x.title].filter(Boolean).join(' · '), route: `/devis/${x.id}` });
  const invoices = await db.all<any>(
    `SELECT i.id, i.number, i.kind, i.title, c.name AS company FROM invoices i JOIN companies c ON c.id = i.company_id WHERE lower(COALESCE(i.number,'')) LIKE ? OR lower(i.title) LIKE ? ORDER BY i.id DESC LIMIT ?`,
    [like, like, limit],
  );
  for (const x of invoices) hits.push({ type: 'facture', id: x.id, title: `${x.kind === 'avoir' ? 'Avoir' : 'Facture'} ${x.number ?? '(brouillon)'}`, subtitle: [x.company, x.title].filter(Boolean).join(' · '), route: `/factures/${x.id}` });
  const projects = await db.all<any>(
    `SELECT p.id, p.name, c.name AS company FROM projects p JOIN companies c ON c.id = p.company_id WHERE lower(p.name) LIKE ? LIMIT ?`,
    [like, limit],
  );
  for (const x of projects) hits.push({ type: 'projet', id: x.id, title: x.name, subtitle: x.company, route: `/projets/${x.id}` });
  const opps = await db.all<any>(
    `SELECT o.id, o.title, c.name AS company FROM opportunities o JOIN companies c ON c.id = o.company_id WHERE o.archived_at IS NULL AND lower(o.title) LIKE ? LIMIT ?`,
    [like, limit],
  );
  for (const x of opps) hits.push({ type: 'opportunite', id: x.id, title: x.title, subtitle: `Opportunité · ${x.company}`, route: `/pipeline?opportunite=${x.id}` });
  const docs = await db.all<any>(`SELECT id, title, file_name FROM documents WHERE archived_at IS NULL AND (lower(title) LIKE ? OR lower(file_name) LIKE ?) LIMIT ?`, [like, like, limit]);
  for (const x of docs) hits.push({ type: 'document', id: x.id, title: x.title, subtitle: x.file_name, route: `/documents?document=${x.id}` });
  const services = await db.all<any>(`SELECT id, name, category FROM services WHERE archived_at IS NULL AND lower(name) LIKE ? LIMIT ?`, [like, limit]);
  for (const x of services) hits.push({ type: 'prestation', id: x.id, title: x.name, subtitle: x.category ?? 'Prestation', route: `/catalogue?prestation=${x.id}` });
  return hits;
}
