/**
 * Paramètres de l'application (table `settings`, valeurs JSON).
 *
 * Les informations fournies (nom commercial, statut, dirigeant, SIRET, email)
 * sont préremplies. Les autres (adresse, régime de TVA, IBAN…) restent vides :
 * elles ne sont jamais supposées, et leur absence bloque l'émission des
 * documents qui les exigent.
 */
import type { Db } from '@/lib/db';

export interface CompanySettings {
  trade_name: string;
  legal_name: string;
  legal_status: string;
  manager: string;
  ei_mention: boolean;
  siret: string;
  siren: string;
  ape_code: string;
  rcs_rm: string;
  vat_number: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  website: string;
  logo_path: string;
}

export type VatRegime = '' | 'franchise' | 'reel_simplifie' | 'reel_normal' | 'mini_reel';

export interface VatSettings {
  regime: VatRegime;
  rates_bp: number[];
  default_rate_bp: number;
  franchise_mention: string;
  vat_on_debits: boolean;
}

export interface PaymentSettings {
  iban: string;
  bic: string;
  bank_name: string;
  account_holder: string;
  default_terms_days: number;
  payment_terms_text: string;
  late_penalty_text: string;
  recovery_fee_text: string;
  early_payment_text: string;
  methods: { key: string; label: string; enabled: boolean }[];
}

export interface NumberingSettings {
  invoice_format: string;
  credit_format: string;
  quote_format: string;
  min_digits: number;
}

export interface QuoteSettings {
  validity_days: number;
  default_conditions: string;
  acceptance_mention: string;
  consent_text: string;
}

export interface LegalSettings {
  invoice_extra_mentions: string;
  quote_extra_mentions: string;
  b2c_mention: string;
}

export interface BackupSettings {
  directory: string;
  auto_enabled: boolean;
  frequency_hours: number;
  encrypt: boolean;
  last_auto_at: string;
  keep_last: number;
}

export interface SecuritySettings {
  password: null | { algo: 'PBKDF2-SHA256'; iterations: number; salt: string; hash: string };
  auto_lock_minutes: number;
}

export interface AppearanceSettings {
  theme: 'clair' | 'sombre' | 'systeme';
  sidebar_collapsed: boolean;
}

export interface EmailSettings {
  smtp_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_from: string;
  smtp_security: 'starttls' | 'tls';
  signature: string;
}

export interface AutomationSettings {
  recurring_auto_issue: boolean;
  payment_reminders_auto: boolean;
  local_notifications: boolean;
}

export interface AllSettings {
  company: CompanySettings;
  vat: VatSettings;
  payment: PaymentSettings;
  numbering: NumberingSettings;
  quotes: QuoteSettings;
  legal: LegalSettings;
  backup: BackupSettings;
  security: SecuritySettings;
  appearance: AppearanceSettings;
  email: EmailSettings;
  automation: AutomationSettings;
}

export const DEFAULT_SETTINGS: AllSettings = {
  company: {
    trade_name: 'Signal Digital',
    legal_name: 'Giovani Zunino',
    legal_status: 'Micro-entreprise (entrepreneur individuel)',
    manager: 'Giovani Zunino',
    ei_mention: true,
    siret: '94478489100011',
    siren: '944784891',
    ape_code: '',
    rcs_rm: '',
    vat_number: '',
    address_line1: '',
    address_line2: '',
    postal_code: '',
    city: '',
    country: 'France',
    email: 'contact@qarvo-digital.fr',
    phone: '',
    website: '',
    logo_path: '',
  },
  vat: {
    regime: '',
    rates_bp: [2000, 1000, 550, 210, 0],
    default_rate_bp: 2000,
    franchise_mention: 'TVA non applicable, art. 293 B du CGI',
    vat_on_debits: false,
  },
  payment: {
    iban: '',
    bic: '',
    bank_name: '',
    account_holder: '',
    default_terms_days: 30,
    payment_terms_text: 'Paiement à 30 jours à compter de la date d\'émission de la facture.',
    late_penalty_text:
      "En cas de retard de paiement, des pénalités de retard sont exigibles au taux de trois fois le taux d'intérêt légal en vigueur.",
    recovery_fee_text:
      "Pour les clients professionnels : indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce).",
    early_payment_text: 'Aucun escompte consenti pour paiement anticipé.',
    methods: [
      { key: 'virement', label: 'Virement bancaire', enabled: true },
      { key: 'carte', label: 'Carte bancaire', enabled: true },
      { key: 'cheque', label: 'Chèque', enabled: true },
      { key: 'especes', label: 'Espèces (dans les limites légales)', enabled: true },
      { key: 'prelevement', label: 'Prélèvement', enabled: false },
      { key: 'autre', label: 'Autre', enabled: true },
    ],
  },
  numbering: {
    invoice_format: 'F-{AAAA}-{N}',
    credit_format: 'AV-{AAAA}-{N}',
    quote_format: 'D-{AAAA}-{N}',
    min_digits: 4,
  },
  quotes: {
    validity_days: 30,
    default_conditions: '',
    acceptance_mention: 'Bon pour accord',
    consent_text:
      "Je reconnais avoir pris connaissance de l'intégralité du devis ci-dessus, et je l'accepte sans réserve. Je consens à le signer électroniquement et reconnais que cette signature manifeste mon accord.",
  },
  legal: {
    invoice_extra_mentions: '',
    quote_extra_mentions: '',
    b2c_mention: '',
  },
  backup: {
    directory: '',
    auto_enabled: false,
    frequency_hours: 24,
    encrypt: false,
    last_auto_at: '',
    keep_last: 30,
  },
  security: { password: null, auto_lock_minutes: 0 },
  appearance: { theme: 'systeme', sidebar_collapsed: false },
  email: {
    smtp_enabled: false,
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_from: '',
    smtp_security: 'starttls',
    signature: 'Giovani Zunino\nSignal Digital',
  },
  automation: { recurring_auto_issue: false, payment_reminders_auto: false, local_notifications: true },
};

export type SettingsKey = keyof AllSettings;

export async function getSetting<K extends SettingsKey>(db: Db, key: K): Promise<AllSettings[K]> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  const def = DEFAULT_SETTINGS[key];
  if (!row) return structuredClone(def);
  try {
    const parsed = JSON.parse(row.value);
    if (Array.isArray(def) || typeof def !== 'object' || def === null) return parsed;
    return { ...structuredClone(def), ...parsed };
  } catch {
    return structuredClone(def);
  }
}

export async function getAllSettings(db: Db): Promise<AllSettings> {
  const out: any = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingsKey[]) out[key] = await getSetting(db, key);
  return out;
}

export async function setSetting<K extends SettingsKey>(db: Db, key: K, value: AllSettings[K]): Promise<void> {
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value)],
  );
}

export async function patchSetting<K extends SettingsKey>(db: Db, key: K, patch: Partial<AllSettings[K]>): Promise<AllSettings[K]> {
  const current = await getSetting(db, key);
  const next = { ...current, ...patch } as AllSettings[K];
  await setSetting(db, key, next);
  return next;
}

// ---------- Contrôles administratifs ----------

/** Contrôle de la clé de Luhn (SIREN / SIRET). La Poste (SIREN 356000000) a une règle spéciale. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  if (digits.startsWith('356000000') && digits.length === 14) {
    return digits.split('').reduce((a, c) => a + Number(c), 0) % 5 === 0;
  }
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export function validateSiret(siret: string): string | null {
  const s = siret.replace(/\s/g, '');
  if (!/^\d{14}$/.test(s)) return 'Le SIRET doit comporter 14 chiffres.';
  if (!luhnValid(s)) return 'Le SIRET ne respecte pas la clé de contrôle (Luhn).';
  return null;
}

export function validateSiren(siren: string): string | null {
  const s = siren.replace(/\s/g, '');
  if (!/^\d{9}$/.test(s)) return 'Le SIREN doit comporter 9 chiffres.';
  if (!luhnValid(s)) return 'Le SIREN ne respecte pas la clé de contrôle (Luhn).';
  return null;
}

/** Validation IBAN (ISO 13616, modulo 97). */
export function validateIban(iban: string): string | null {
  const s = iban.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return 'Format d\'IBAN invalide.';
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1 ? null : 'IBAN invalide (clé de contrôle incorrecte).';
}

export interface ComplianceIssue {
  field: string;
  label: string;
  severity: 'bloquant' | 'avertissement';
  section: SettingsKey;
}

/** Liste des informations administratives manquantes ou douteuses. */
export function checkAdministrativeSetup(s: AllSettings): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const c = s.company;
  const req = (cond: boolean, field: string, label: string, section: SettingsKey = 'company', severity: ComplianceIssue['severity'] = 'bloquant') => {
    if (!cond) issues.push({ field, label, severity, section });
  };
  req(!!c.trade_name.trim() || !!c.legal_name.trim(), 'legal_name', 'Nom ou dénomination de l\'entreprise');
  req(!!c.legal_name.trim(), 'legal_name', 'Nom et prénom de l\'entrepreneur (dénomination légale)');
  req(!!c.address_line1.trim() && !!c.postal_code.trim() && !!c.city.trim(), 'address', 'Adresse professionnelle complète (adresse, code postal, ville)');
  if (!c.siret.trim()) req(false, 'siret', 'Numéro SIRET');
  else {
    const e = validateSiret(c.siret);
    if (e) issues.push({ field: 'siret', label: e, severity: 'bloquant', section: 'company' });
    else if (c.siren && c.siret.replace(/\s/g, '').slice(0, 9) !== c.siren.replace(/\s/g, '')) {
      issues.push({ field: 'siren', label: 'Le SIREN ne correspond pas aux 9 premiers chiffres du SIRET.', severity: 'bloquant', section: 'company' });
    }
  }
  req(!!s.vat.regime, 'regime', 'Régime de TVA (franchise en base ou assujetti) : à confirmer, il n\'est jamais supposé', 'vat');
  if (s.vat.regime && s.vat.regime !== 'franchise') {
    req(!!c.vat_number.trim(), 'vat_number', 'Numéro de TVA intracommunautaire (obligatoire si vous êtes assujetti)', 'company');
  }
  req(c.ei_mention, 'ei_mention', 'Mention « EI » ou « Entrepreneur individuel » (obligatoire pour un entrepreneur individuel)', 'company', 'avertissement');
  req(!!s.payment.late_penalty_text.trim(), 'late_penalty_text', 'Taux des pénalités de retard', 'payment');
  req(!!s.payment.recovery_fee_text.trim(), 'recovery_fee_text', 'Indemnité forfaitaire de recouvrement (clients professionnels)', 'payment', 'avertissement');
  if (s.payment.iban.trim()) {
    const e = validateIban(s.payment.iban);
    if (e) issues.push({ field: 'iban', label: e, severity: 'avertissement', section: 'payment' });
  } else {
    req(false, 'iban', 'IBAN (recommandé pour le paiement par virement)', 'payment', 'avertissement');
  }
  return issues;
}

/** Dénomination à afficher sur les documents (avec mention EI si activée). */
export function sellerDisplayName(c: CompanySettings): string {
  const base = c.legal_name.trim() || c.trade_name.trim();
  return c.ei_mention && !/\bEI\b|entrepreneur individuel/i.test(base) ? `${base} EI` : base;
}
