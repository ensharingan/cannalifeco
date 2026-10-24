/**
 * brand.js — single source of truth for white-label identity.
 *
 * This build is the Canna Life Co white label of the Budify platform. Everything
 * customer-visible that carries a name, a colour or a logo reads from here, so
 * spinning up another licensee is a matter of editing this file and dropping a
 * new logo into src/, not grepping the codebase for "Budify".
 *
 * Anything that is NOT customer-visible (database column names, the
 * x-client-info header, localStorage keys) deliberately stays as-is — renaming
 * those breaks existing sessions and migrations for no visible gain.
 */

export const BRAND = {
  // Displayed wherever the product is named.
  name: 'Canna Life Co',
  productName: 'Canna Life Co POS',
  legalName: 'Canna Life Co',
  tagline: 'Point of Sale & Club Management',

  // Falls back to the wordmark below when logoSrc is null.
  logoSrc: null,

  // Support / contact surfaces. Update once the client's domain is confirmed.
  supportEmail: 'support@cannalife.co.za',
  website: 'https://cannalife.co.za',

  // Platform operator — shown in the "powered by" footnote and on PDFs.
  operator: 'TJ Spares (Pty) Ltd t/a Lereko Digital',
  poweredBy: 'Powered by Budify',

  // Primary accent, used for PDF headers and meta theme-colour. Keep in sync
  // with --primary in index.css if you change it.
  colors: {
    primaryHex: '#04643a',
    primaryRgb: [22, 163, 74],
    darkRgb: [20, 20, 20],
  },
};

export default BRAND;
