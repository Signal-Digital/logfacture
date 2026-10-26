/** Libellés et tonalités d'affichage. */
import { QUOTE_STATUSES } from '@/domain/quotes';
import { INVOICE_KINDS, INVOICE_STATUSES } from '@/domain/invoices';
import { CONTRACT_STATUSES, PERIODICITIES } from '@/domain/contracts';
import { ACTIVITY_TYPES, PRIORITIES, ACTIVITY_STATUSES } from '@/domain/activities';
import { COMMERCIAL_STATUSES } from '@/domain/companies';

export const KIND_LABEL: Record<string, string> = { prospect: 'Prospect', client: 'Client', ancien_client: 'Ancien client', partenaire: 'Partenaire' };
export const KIND_TONE: Record<string, string> = { prospect: 'info', client: 'success', ancien_client: 'muted', partenaire: 'accent' };

export const quoteStatus = (k: string) => QUOTE_STATUSES.find((s) => s.key === k) ?? { label: k, tone: 'neutral' };
export const invoiceStatus = (k: string) => INVOICE_STATUSES.find((s) => s.key === k) ?? { label: k, tone: 'neutral' };
export const invoiceKind = (k: string) => INVOICE_KINDS.find((s) => s.key === k)?.label ?? k;
export const contractStatus = (k: string) => CONTRACT_STATUSES.find((s) => s.key === k) ?? { label: k, tone: 'neutral' };
export const periodicity = (k: string) => PERIODICITIES.find((s) => s.key === k)?.label ?? k;
export const activityType = (k: string) => ACTIVITY_TYPES.find((s) => s.key === k)?.label ?? k;
export const priority = (k: string) => PRIORITIES.find((s) => s.key === k)?.label ?? k;
export const activityStatus = (k: string) => ACTIVITY_STATUSES.find((s) => s.key === k)?.label ?? k;
export const commercialStatus = (k: string) => COMMERCIAL_STATUSES.find((s) => s.key === k)?.label ?? k;
export const PRIORITY_TONE: Record<string, string> = { basse: 'muted', normale: 'neutral', haute: 'warning', urgente: 'danger' };
export const PAYMENT_LABEL: Record<string, string> = { virement: 'Virement', carte: 'Carte bancaire', cheque: 'Chèque', especes: 'Espèces', prelevement: 'Prélèvement', autre: 'Autre' };
