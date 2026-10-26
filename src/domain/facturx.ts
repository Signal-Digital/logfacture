/**
 * Préparation à la facturation électronique (Factur-X / norme EN 16931).
 *
 * Génère le fichier XML « Cross Industry Invoice » (CII) correspondant à une
 * facture émise, au profil EN 16931. Il s'agit d'une PRÉPARATION :
 *  - le XML n'est pas encore validé par un outil officiel (schematron FNFE-MPE) ;
 *  - un PDF Factur-X conforme exige en plus un PDF/A-3 avec ce XML embarqué ;
 *  - l'émission via une plateforme agréée (PA) sera obligatoire selon le
 *    calendrier de la réforme. Voir docs/REGLEMENTAIRE.md.
 */
import type { InvoiceSnapshot } from './invoices';
import { computeLine } from '@/lib/money';

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const amount = (cents: number) => (cents / 100).toFixed(2);
const qty = (milli: number) => (milli / 1000).toFixed(4);
const rate = (bp: number) => (bp / 100).toFixed(2);
const date102 = (iso: string) => iso.replace(/-/g, '').slice(0, 8);

/** Catégorie de TVA (UNTDID 5305) : S (standard), Z (taux zéro), E (exonéré, ex. franchise). */
function vatCategory(s: InvoiceSnapshot, rateBp: number): { code: string; reason?: string } {
  if (s.seller.vat_regime === 'franchise') return { code: 'E', reason: s.seller.franchise_mention || 'TVA non applicable, art. 293 B du CGI' };
  return rateBp === 0 ? { code: 'Z' } : { code: 'S' };
}

export function invoiceToCii(s: InvoiceSnapshot): string {
  const typeCode = s.kind === 'avoir' ? '381' : s.kind === 'acompte' ? '386' : '380';
  const items = s.lines.filter((l) => l.kind === 'item');
  const lines = items
    .map((l, i) => {
      const r = computeLine(l);
      const cat = vatCategory(s, l.vat_rate_bp);
      const netUnit = l.quantity_milli !== 0 ? r.ht_cents / (l.quantity_milli / 1000) : 0;
      return `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(l.designation)}</ram:Name>${l.description ? `<ram:Description>${esc(l.description)}</ram:Description>` : ''}</ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${(netUnit / 100).toFixed(4)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${qty(l.quantity_milli)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat.code}</ram:CategoryCode>${cat.code === 'E' ? '' : `<ram:RateApplicablePercent>${rate(l.vat_rate_bp)}</ram:RateApplicablePercent>`}</ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(r.ht_cents)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
    })
    .join('');
  const taxes = s.totals.vat
    .map((v) => {
      const cat = vatCategory(s, v.rate_bp);
      return `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${amount(v.vat_cents)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${cat.reason ? `<ram:ExemptionReason>${esc(cat.reason)}</ram:ExemptionReason>` : ''}
        <ram:BasisAmount>${amount(v.base_cents)}</ram:BasisAmount><ram:CategoryCode>${cat.code}</ram:CategoryCode>${cat.code === 'E' ? '<ram:ExemptionReasonCode>VATEX-FR-FRANCHISE</ram:ExemptionReasonCode>' : `<ram:RateApplicablePercent>${rate(v.rate_bp)}</ram:RateApplicablePercent>`}
      </ram:ApplicableTradeTax>`;
    })
    .join('');
  const seller = s.seller;
  const client = s.client;
  const notes = s.legal_mentions.map((m) => `<ram:IncludedNote><ram:Content>${esc(m)}</ram:Content></ram:IncludedNote>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(s.number)}</ram:ID>
    <ram:TypeCode>${typeCode}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${date102(s.issue_date)}</udt:DateTimeString></ram:IssueDateTime>${notes}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${esc(seller.display_name)}</ram:Name>
        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${esc(seller.siren || seller.siret.slice(0, 9))}</ram:ID>${seller.trade_name ? `<ram:TradingBusinessName>${esc(seller.trade_name)}</ram:TradingBusinessName>` : ''}</ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress><ram:PostcodeCode>${esc(seller.postal_code)}</ram:PostcodeCode><ram:LineOne>${esc(seller.address_line1)}</ram:LineOne>${seller.address_line2 ? `<ram:LineTwo>${esc(seller.address_line2)}</ram:LineTwo>` : ''}<ram:CityName>${esc(seller.city)}</ram:CityName><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>
        ${seller.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(seller.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${seller.vat_number ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(seller.vat_number)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${esc(client.name)}</ram:Name>
        ${client.siren ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${esc(client.siren)}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
        <ram:PostalTradeAddress><ram:PostcodeCode>${esc(client.postal_code)}</ram:PostcodeCode><ram:LineOne>${esc(client.address_line1)}</ram:LineOne><ram:CityName>${esc(client.city)}</ram:CityName><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>
        ${client.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(client.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${client.vat_number ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(client.vat_number)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>${s.service_date ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${date102(s.service_date)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>` : ''}</ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      ${seller.iban ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(seller.iban.replace(/\s/g, ''))}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>` : ''}${taxes}
      ${s.due_date ? `<ram:SpecifiedTradePaymentTerms>${s.payment_terms ? `<ram:Description>${esc(s.payment_terms)}</ram:Description>` : ''}<ram:DueDateDateTime><udt:DateTimeString format="102">${date102(s.due_date)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>` : ''}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amount(s.totals.subtotal_ht_cents)}</ram:LineTotalAmount>
        ${s.totals.global_discount_cents ? `<ram:AllowanceTotalAmount>${amount(s.totals.global_discount_cents)}</ram:AllowanceTotalAmount>` : ''}
        <ram:TaxBasisTotalAmount>${amount(s.totals.total_ht_cents)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${amount(s.totals.total_vat_cents)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amount(s.totals.total_ttc_cents)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${amount(s.totals.total_ttc_cents)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
      ${s.credited_invoice_number ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${esc(s.credited_invoice_number)}</ram:IssuerAssignedID></ram:InvoiceReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}
