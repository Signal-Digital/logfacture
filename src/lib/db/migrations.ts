/**
 * Migrations du schéma SQLite.
 *
 * Règles :
 *  - une migration publiée n'est JAMAIS modifiée : on en ajoute une nouvelle ;
 *  - chaque migration s'exécute dans une transaction ;
 *  - montants en centimes (INTEGER), taux en points de base (2000 = 20 %),
 *    quantités en millièmes (1500 = 1,5).
 */
import type { Db } from './index';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const LOCK = (_table: string, msg: string) => `SELECT RAISE(ABORT, '${msg}')`;

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'schéma initial',
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Entreprises : prospects ET clients (une seule fiche, jamais dupliquée).
CREATE TABLE companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind TEXT NOT NULL DEFAULT 'prospect' CHECK (kind IN ('prospect','client','ancien_client','partenaire')),
  is_individual INTEGER NOT NULL DEFAULT 0,
  legal_form TEXT, siren TEXT, siret TEXT, vat_number TEXT,
  sector TEXT,
  address_line1 TEXT, address_line2 TEXT, postal_code TEXT, city TEXT, country TEXT DEFAULT 'France',
  phone TEXT, email TEXT, website TEXT, gbp_url TEXT,
  source TEXT,
  commercial_status TEXT NOT NULL DEFAULT 'nouveau',
  potential_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  next_action TEXT, next_action_date TEXT,
  became_client_at TEXT,
  merged_into_id INTEGER REFERENCES companies(id),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_companies_kind ON companies(kind, archived_at);
CREATE INDEX idx_companies_name ON companies(name COLLATE NOCASE);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE RESTRICT,
  first_name TEXT, last_name TEXT NOT NULL DEFAULT '',
  job_title TEXT, email TEXT, phone TEXT, mobile TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_contacts_company ON contacts(company_id);

CREATE TABLE pipeline_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'open' CHECK (kind IN ('open','won','lost')),
  default_probability INTEGER NOT NULL DEFAULT 10 CHECK (default_probability BETWEEN 0 AND 100),
  color TEXT NOT NULL DEFAULT '#64748b',
  archived_at TEXT
);

CREATE TABLE opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  contact_id INTEGER REFERENCES contacts(id),
  title TEXT NOT NULL,
  stage_id INTEGER NOT NULL REFERENCES pipeline_stages(id),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  probability INTEGER NOT NULL DEFAULT 10 CHECK (probability BETWEEN 0 AND 100),
  expected_close_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  lost_reason TEXT,
  notes TEXT,
  position REAL NOT NULL DEFAULT 0,
  closed_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_opp_stage ON opportunities(stage_id, position);
CREATE INDEX idx_opp_company ON opportunities(company_id);

CREATE TABLE services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'forfait',
  vat_rate_bp INTEGER NOT NULL DEFAULT 2000 CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  duration_label TEXT,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE project_statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#64748b'
);

CREATE TABLE project_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  service_type TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE project_template_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  offset_days INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,
  number TEXT UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'brouillon'
    CHECK (status IN ('brouillon','envoye','attente_signature','accepte','refuse','expire','annule')),
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  contact_id INTEGER REFERENCES contacts(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  project_id INTEGER,
  title TEXT NOT NULL DEFAULT '',
  issue_date TEXT NOT NULL,
  validity_date TEXT,
  client_snapshot TEXT,
  seller_snapshot TEXT,
  global_discount_type TEXT NOT NULL DEFAULT 'none' CHECK (global_discount_type IN ('none','percent','amount')),
  global_discount_value INTEGER NOT NULL DEFAULT 0,
  deposit_type TEXT NOT NULL DEFAULT 'none' CHECK (deposit_type IN ('none','percent','amount')),
  deposit_value INTEGER NOT NULL DEFAULT 0,
  payment_terms TEXT,
  special_conditions TEXT,
  footer_notes TEXT,
  notes_internal TEXT,
  template_id INTEGER,
  total_ht_cents INTEGER NOT NULL DEFAULT 0,
  total_vat_cents INTEGER NOT NULL DEFAULT 0,
  total_ttc_cents INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT, accepted_at TEXT, refused_at TEXT, cancelled_at TEXT,
  accepted_version_id INTEGER,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_quotes_company ON quotes(company_id);

CREATE TABLE quote_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'item' CHECK (kind IN ('item','section','text')),
  service_id INTEGER REFERENCES services(id),
  designation TEXT NOT NULL DEFAULT '',
  description TEXT,
  quantity_milli INTEGER NOT NULL DEFAULT 1000,
  unit TEXT,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','percent','amount')),
  discount_value INTEGER NOT NULL DEFAULT 0,
  vat_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  is_recurring INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_quote_lines ON quote_lines(quote_id, position);

CREATE TABLE quote_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  pdf_path TEXT,
  pdf_sha256 TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (quote_id, version)
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  service_type TEXT,
  status_id INTEGER REFERENCES project_statuses(id),
  start_date TEXT, due_date TEXT,
  contract_amount_cents INTEGER NOT NULL DEFAULT 0,
  quote_id INTEGER REFERENCES quotes(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  notes TEXT,
  completed_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_projects_company ON projects(company_id);

CREATE TABLE contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  service_id INTEGER REFERENCES services(id),
  title TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  vat_rate_bp INTEGER NOT NULL DEFAULT 0,
  periodicity TEXT NOT NULL DEFAULT 'mensuel' CHECK (periodicity IN ('mensuel','trimestriel','semestriel','annuel')),
  start_date TEXT NOT NULL,
  next_invoice_date TEXT,
  renewal_date TEXT,
  end_date TEXT,
  termination_terms TEXT,
  status TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','suspendu','resilie','termine')),
  auto_issue INTEGER NOT NULL DEFAULT 0,
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  quote_id INTEGER REFERENCES quotes(id),
  project_id INTEGER REFERENCES projects(id),
  notes TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,
  number TEXT UNIQUE,
  kind TEXT NOT NULL DEFAULT 'facture' CHECK (kind IN ('facture','acompte','solde','avoir')),
  status TEXT NOT NULL DEFAULT 'brouillon'
    CHECK (status IN ('brouillon','emise','partiellement_payee','payee','annulee')),
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  contact_id INTEGER REFERENCES contacts(id),
  quote_id INTEGER REFERENCES quotes(id),
  project_id INTEGER REFERENCES projects(id),
  contract_id INTEGER REFERENCES contracts(id),
  credited_invoice_id INTEGER REFERENCES invoices(id),
  title TEXT NOT NULL DEFAULT '',
  issue_date TEXT,
  due_date TEXT,
  service_date TEXT,
  client_snapshot TEXT,
  seller_snapshot TEXT,
  global_discount_type TEXT NOT NULL DEFAULT 'none' CHECK (global_discount_type IN ('none','percent','amount')),
  global_discount_value INTEGER NOT NULL DEFAULT 0,
  payment_terms TEXT,
  legal_mentions TEXT,
  footer_notes TEXT,
  notes_internal TEXT,
  template_id INTEGER,
  total_ht_cents INTEGER NOT NULL DEFAULT 0,
  total_vat_cents INTEGER NOT NULL DEFAULT 0,
  total_ttc_cents INTEGER NOT NULL DEFAULT 0,
  totals_json TEXT,
  pdf_path TEXT,
  pdf_sha256 TEXT,
  issued_at TEXT,
  cancelled_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status = 'brouillon' OR (number IS NOT NULL AND issue_date IS NOT NULL))
);
CREATE INDEX idx_invoices_company ON invoices(company_id);
CREATE INDEX idx_invoices_status ON invoices(status, due_date);

CREATE TABLE invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'item' CHECK (kind IN ('item','section','text')),
  service_id INTEGER REFERENCES services(id),
  designation TEXT NOT NULL DEFAULT '',
  description TEXT,
  quantity_milli INTEGER NOT NULL DEFAULT 1000,
  unit TEXT,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','percent','amount')),
  discount_value INTEGER NOT NULL DEFAULT 0,
  vat_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  is_recurring INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_invoice_lines ON invoice_lines(invoice_id, position);

CREATE TABLE number_sequences (
  series TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (series, year)
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_at TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'virement' CHECK (method IN ('virement','carte','cheque','especes','prelevement','autre')),
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

CREATE TABLE payment_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  level TEXT NOT NULL CHECK (level IN ('avant_echeance','relance_1','relance_finale')),
  channel TEXT NOT NULL CHECK (channel IN ('copie','messagerie','smtp')),
  subject TEXT, body TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE contract_invoice_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  invoice_id INTEGER REFERENCES invoices(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (contract_id, period_start)
);

-- Activités : appels, emails, rendez-vous, relances, tâches (y compris de projet)…
CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('appel','email','rdv','relance','audit','tache','note','reunion')),
  title TEXT NOT NULL,
  notes TEXT,
  company_id INTEGER REFERENCES companies(id),
  contact_id INTEGER REFERENCES contacts(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  project_id INTEGER REFERENCES projects(id),
  quote_id INTEGER REFERENCES quotes(id),
  invoice_id INTEGER REFERENCES invoices(id),
  due_at TEXT,
  duration_min INTEGER,
  priority TEXT NOT NULL DEFAULT 'normale' CHECK (priority IN ('basse','normale','haute','urgente')),
  status TEXT NOT NULL DEFAULT 'a_faire' CHECK (status IN ('a_faire','en_cours','fait','annule')),
  done_at TEXT,
  remind_at TEXT,
  reminded_at TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_activities_due ON activities(status, due_at);
CREATE INDEX idx_activities_company ON activities(company_id);
CREATE INDEX idx_activities_project ON activities(project_id);

CREATE TABLE doc_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'tous' CHECK (doc_type IN ('devis','facture','tous')),
  engine TEXT NOT NULL DEFAULT 'visuel' CHECK (engine IN ('visuel','docx')),
  background_type TEXT NOT NULL DEFAULT 'none' CHECK (background_type IN ('none','pdf','image')),
  background_path TEXT,
  background_pages INTEGER NOT NULL DEFAULT 0,
  docx_path TEXT,
  layout_json TEXT NOT NULL DEFAULT '{}',
  is_default_quote INTEGER NOT NULL DEFAULT 0,
  is_default_invoice INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE signature_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  quote_id INTEGER NOT NULL REFERENCES quotes(id),
  quote_version_id INTEGER NOT NULL REFERENCES quote_versions(id),
  channel TEXT NOT NULL DEFAULT 'local' CHECK (channel IN ('local','distance')),
  status TEXT NOT NULL DEFAULT 'ouverte' CHECK (status IN ('ouverte','signee','expiree','annulee')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  quote_version_id INTEGER NOT NULL REFERENCES quote_versions(id) ON DELETE RESTRICT,
  request_id INTEGER REFERENCES signature_requests(id),
  signer_name TEXT NOT NULL,
  signer_role TEXT,
  signer_email TEXT,
  consent_text TEXT NOT NULL,
  acceptance_mention TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'locale_manuscrite',
  signature_image_path TEXT NOT NULL,
  signature_image_sha256 TEXT NOT NULL,
  original_pdf_path TEXT NOT NULL,
  original_sha256 TEXT NOT NULL,
  signed_pdf_path TEXT,
  signed_sha256 TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE signature_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER REFERENCES signature_requests(id),
  signature_id INTEGER REFERENCES signatures(id),
  quote_id INTEGER NOT NULL REFERENCES quotes(id),
  event TEXT NOT NULL,
  details TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Bibliothèque documentaire (PDF émis, pièces jointes, versions).
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'autre'
    CHECK (doc_type IN ('devis','devis_signe','facture','avoir','contrat','piece_jointe','modele','autre')),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  company_id INTEGER REFERENCES companies(id),
  project_id INTEGER REFERENCES projects(id),
  quote_id INTEGER REFERENCES quotes(id),
  invoice_id INTEGER REFERENCES invoices(id),
  contract_id INTEGER REFERENCES contracts(id),
  year INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  parent_document_id INTEGER REFERENCES documents(id),
  locked INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_documents_company ON documents(company_id);

-- Journal des événements (insertion seule).
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  company_id INTEGER
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_company ON audit_log(company_id);

-- ===== Protections contre les modifications silencieuses =====

CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
BEGIN ${LOCK('audit_log', "Le journal des événements ne peut pas être modifié")}; END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
BEGIN ${LOCK('audit_log', "Le journal des événements ne peut pas être supprimé")}; END;

CREATE TRIGGER invoice_issued_immutable BEFORE UPDATE ON invoices
WHEN OLD.status <> 'brouillon' AND (
  NEW.number IS NOT OLD.number OR NEW.kind IS NOT OLD.kind OR NEW.issue_date IS NOT OLD.issue_date
  OR NEW.due_date IS NOT OLD.due_date OR NEW.total_ht_cents IS NOT OLD.total_ht_cents
  OR NEW.total_vat_cents IS NOT OLD.total_vat_cents OR NEW.total_ttc_cents IS NOT OLD.total_ttc_cents
  OR NEW.client_snapshot IS NOT OLD.client_snapshot OR NEW.seller_snapshot IS NOT OLD.seller_snapshot
  OR NEW.totals_json IS NOT OLD.totals_json OR NEW.title IS NOT OLD.title
  OR NEW.credited_invoice_id IS NOT OLD.credited_invoice_id OR NEW.legal_mentions IS NOT OLD.legal_mentions
  OR NEW.payment_terms IS NOT OLD.payment_terms
  OR (OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS NOT OLD.pdf_sha256)
  OR NEW.status = 'brouillon'
)
BEGIN ${LOCK('invoices', 'Facture émise : modification interdite. Utilisez un avoir pour la rectifier.')}; END;

CREATE TRIGGER invoice_issued_no_delete BEFORE DELETE ON invoices
WHEN OLD.status <> 'brouillon'
BEGIN ${LOCK('invoices', 'Une facture émise ne peut pas être supprimée.')}; END;

CREATE TRIGGER invoice_lines_lock_ins BEFORE INSERT ON invoice_lines
WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'brouillon'
BEGIN ${LOCK('invoice_lines', 'Facture émise : lignes non modifiables.')}; END;
CREATE TRIGGER invoice_lines_lock_upd BEFORE UPDATE ON invoice_lines
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'brouillon'
BEGIN ${LOCK('invoice_lines', 'Facture émise : lignes non modifiables.')}; END;
CREATE TRIGGER invoice_lines_lock_del BEFORE DELETE ON invoice_lines
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'brouillon'
BEGIN ${LOCK('invoice_lines', 'Facture émise : lignes non modifiables.')}; END;

CREATE TRIGGER quote_lines_lock_ins BEFORE INSERT ON quote_lines
WHEN (SELECT status FROM quotes WHERE id = NEW.quote_id) <> 'brouillon'
BEGIN ${LOCK('quote_lines', 'Devis non modifiable dans ce statut : créez une nouvelle version.')}; END;
CREATE TRIGGER quote_lines_lock_upd BEFORE UPDATE ON quote_lines
WHEN (SELECT status FROM quotes WHERE id = OLD.quote_id) <> 'brouillon'
BEGIN ${LOCK('quote_lines', 'Devis non modifiable dans ce statut : créez une nouvelle version.')}; END;
CREATE TRIGGER quote_lines_lock_del BEFORE DELETE ON quote_lines
WHEN (SELECT status FROM quotes WHERE id = OLD.quote_id) <> 'brouillon'
BEGIN ${LOCK('quote_lines', 'Devis non modifiable dans ce statut : créez une nouvelle version.')}; END;

CREATE TRIGGER quote_locked_fields BEFORE UPDATE ON quotes
WHEN OLD.status NOT IN ('brouillon') AND NEW.status <> 'brouillon' AND (
  NEW.total_ttc_cents IS NOT OLD.total_ttc_cents OR NEW.total_ht_cents IS NOT OLD.total_ht_cents
  OR NEW.number IS NOT OLD.number OR NEW.version IS NOT OLD.version OR NEW.client_snapshot IS NOT OLD.client_snapshot
  OR NEW.title IS NOT OLD.title OR NEW.special_conditions IS NOT OLD.special_conditions
  OR NEW.payment_terms IS NOT OLD.payment_terms OR NEW.deposit_value IS NOT OLD.deposit_value
)
BEGIN ${LOCK('quotes', 'Devis verrouillé : créez une nouvelle version pour le modifier.')}; END;

CREATE TRIGGER quote_accepted_no_reopen BEFORE UPDATE ON quotes
WHEN OLD.status = 'accepte' AND NEW.status NOT IN ('accepte','brouillon','annule')
BEGIN ${LOCK('quotes', 'Un devis accepté ne peut pas changer de statut ainsi.')}; END;

CREATE TRIGGER quote_versions_immutable BEFORE UPDATE ON quote_versions
WHEN NEW.snapshot IS NOT OLD.snapshot OR NEW.snapshot_sha256 IS NOT OLD.snapshot_sha256
  OR (OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS NOT OLD.pdf_sha256)
BEGIN ${LOCK('quote_versions', 'Une version de devis enregistrée est immuable.')}; END;
CREATE TRIGGER quote_versions_no_delete BEFORE DELETE ON quote_versions
BEGIN ${LOCK('quote_versions', 'Une version de devis ne peut pas être supprimée.')}; END;

CREATE TRIGGER quote_sent_no_delete BEFORE DELETE ON quotes
WHEN OLD.status <> 'brouillon' OR EXISTS (SELECT 1 FROM quote_versions WHERE quote_id = OLD.id)
BEGIN ${LOCK('quotes', 'Un devis envoyé ne peut pas être supprimé : archivez-le ou annulez-le.')}; END;

CREATE TRIGGER signatures_immutable BEFORE UPDATE ON signatures
WHEN NEW.signed_at IS NOT OLD.signed_at OR NEW.original_sha256 IS NOT OLD.original_sha256
  OR NEW.signer_name IS NOT OLD.signer_name OR NEW.signature_image_sha256 IS NOT OLD.signature_image_sha256
  OR NEW.quote_version_id IS NOT OLD.quote_version_id
  OR (OLD.signed_sha256 IS NOT NULL AND NEW.signed_sha256 IS NOT OLD.signed_sha256)
BEGIN ${LOCK('signatures', 'Une signature enregistrée est immuable.')}; END;
CREATE TRIGGER signatures_no_delete BEFORE DELETE ON signatures
BEGIN ${LOCK('signatures', 'Une signature ne peut pas être supprimée.')}; END;
CREATE TRIGGER signature_events_no_update BEFORE UPDATE ON signature_events
BEGIN ${LOCK('signature_events', 'Journal de signature non modifiable.')}; END;
CREATE TRIGGER signature_events_no_delete BEFORE DELETE ON signature_events
BEGIN ${LOCK('signature_events', 'Journal de signature non modifiable.')}; END;

CREATE TRIGGER documents_locked_no_delete BEFORE DELETE ON documents
WHEN OLD.locked = 1
BEGIN ${LOCK('documents', 'Document verrouillé (émis ou signé) : suppression interdite.')}; END;
CREATE TRIGGER documents_locked_no_update BEFORE UPDATE ON documents
WHEN OLD.locked = 1 AND (NEW.file_path IS NOT OLD.file_path OR NEW.sha256 IS NOT OLD.sha256 OR NEW.locked <> 1)
BEGIN ${LOCK('documents', 'Document verrouillé (émis ou signé) : modification interdite.')}; END;
`,
  },
];

export async function migrate(db: Db): Promise<number> {
  await db.batch(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  const row = await db.get<{ v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations');
  const current = row?.v ?? 0;
  for (const m of migrations) {
    if (m.version <= current) continue;
    await db.tx(async (t) => {
      await t.batch(m.sql);
      await t.run('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name]);
    });
  }
  return migrations[migrations.length - 1].version;
}
