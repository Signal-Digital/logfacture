/**
 * Modèle de mise en page des documents (devis, factures, avoirs).
 *
 * Unités : points PDF (1 pt = 1/72 pouce ; A4 = 595,28 × 841,89 pt),
 * origine en haut à gauche (convertie au rendu).
 */

export type PageRule = 'all' | 'first' | 'last' | 'not_first';
export type FontWeight = 'regular' | 'semibold' | 'bold' | 'italic';
export type Align = 'left' | 'center' | 'right';

export interface TextStyle {
  size: number;
  weight: FontWeight;
  color: string;
  align: Align;
  lineHeight: number; // multiplicateur
  /** Style particulier du premier paragraphe (ex. nom du client en gras, puis coordonnées) */
  firstLine?: { size?: number; weight?: FontWeight; color?: string } | null;
}

export interface BoxStyle {
  background?: string | null;
  borderColor?: string | null;
  borderWidth?: number;
  radius?: number;
  padding?: number;
}

export type ElementType = 'text' | 'image' | 'rect' | 'line' | 'totals' | 'signature' | 'payment_box';

export interface LayoutElement {
  id: string;
  type: ElementType;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pages: PageRule;
  /** 'fixed' : position absolue ; 'flow' : placé après le tableau (et les blocs précédents), sans chevauchement. */
  anchor: 'fixed' | 'flow';
  /** Texte avec champs dynamiques {{...}} */
  text?: string;
  style?: Partial<TextStyle>;
  box?: BoxStyle;
  /** image : 'logo' (logo des paramètres) ou chemin relatif d'un fichier importé */
  src?: string;
  fit?: 'contain' | 'cover' | 'stretch';
  /** Masquer l'élément si tous ses champs dynamiques sont vides */
  hideIfEmpty?: boolean;
  /** Affichage conditionnel selon la présence d'un logo dans les paramètres */
  showIf?: 'has_logo' | 'no_logo';
  /** Restreindre l'affichage à certains types de documents */
  docTypes?: ('devis' | 'facture' | 'acompte' | 'solde' | 'avoir')[];
  locked?: boolean;
}

export type ColumnKey = 'designation' | 'quantity' | 'unit' | 'unit_price' | 'discount' | 'vat_rate' | 'total_ht' | 'total_ttc';

export interface TableColumn {
  key: ColumnKey;
  label: string;
  width: number; // part relative
  align: Align;
}

export interface TableConfig {
  x: number;
  y: number; // haut du tableau, première page
  w: number;
  bottom: number; // limite basse, première page (le pied de page commence en dessous)
  continuationTop: number; // haut du tableau sur les pages suivantes
  continuationBottom: number;
  columns: TableColumn[];
  header: { background: string; color: string; size: number; height: number };
  row: { size: number; descriptionSize: number; color: string; mutedColor: string; paddingY: number; zebra: string | null; borderColor: string | null };
  showDescriptions: boolean;
  repeatHeader: boolean;
}

export interface Background {
  type: 'none' | 'pdf' | 'image';
  path?: string | null;
  /** Page du PDF de fond utilisée pour la 1re page / pour les pages suivantes (index 0) */
  firstPage?: number;
  otherPages?: number;
}

export interface TemplateLayout {
  version: 1;
  page: { width: number; height: number };
  colors: { primary: string; accent: string; text: string; muted: string; light: string };
  background: Background;
  table: TableConfig;
  elements: LayoutElement[];
  flowGap: number;
}

export const A4 = { width: 595.28, height: 841.89 };
