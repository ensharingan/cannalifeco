export const CURRENCIES = [
  { code: "ZAR", symbol: "R", name: "South African Rand", country: "South Africa" },
  { code: "USD", symbol: "$", name: "US Dollar", country: "United States" },
  { code: "EUR", symbol: "€", name: "Euro", country: "Eurozone" },
  { code: "GBP", symbol: "£", name: "British Pound", country: "United Kingdom" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar", country: "Australia" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar", country: "Canada" },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar", country: "New Zealand" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc", country: "Switzerland" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen", country: "Japan" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan", country: "China" },
  { code: "INR", symbol: "₹", name: "Indian Rupee", country: "India" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real", country: "Brazil" },
  { code: "MXN", symbol: "MX$", name: "Mexican Peso", country: "Mexico" },
  { code: "AED", symbol: "AED", name: "UAE Dirham", country: "UAE" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar", country: "Singapore" },
  { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar", country: "Hong Kong" },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone", country: "Norway" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona", country: "Sweden" },
  { code: "DKK", symbol: "kr", name: "Danish Krone", country: "Denmark" },
  { code: "PLN", symbol: "zł", name: "Polish Zloty", country: "Poland" },
  { code: "CZK", symbol: "Kč", name: "Czech Koruna", country: "Czech Republic" },
  { code: "HUF", symbol: "Ft", name: "Hungarian Forint", country: "Hungary" },
  { code: "TRY", symbol: "₺", name: "Turkish Lira", country: "Turkey" },
  { code: "THB", symbol: "฿", name: "Thai Baht", country: "Thailand" },
  { code: "MYR", symbol: "RM", name: "Malaysian Ringgit", country: "Malaysia" },
  { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah", country: "Indonesia" },
  { code: "PHP", symbol: "₱", name: "Philippine Peso", country: "Philippines" },
  { code: "KES", symbol: "KSh", name: "Kenyan Shilling", country: "Kenya" },
  { code: "NGN", symbol: "₦", name: "Nigerian Naira", country: "Nigeria" },
  { code: "EGP", symbol: "E£", name: "Egyptian Pound", country: "Egypt" },
  { code: "MAD", symbol: "MAD", name: "Moroccan Dirham", country: "Morocco" },
  { code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi", country: "Ghana" },
  { code: "TZS", symbol: "TSh", name: "Tanzanian Shilling", country: "Tanzania" },
  { code: "UGX", symbol: "USh", name: "Ugandan Shilling", country: "Uganda" },
  { code: "ZMW", symbol: "ZK", name: "Zambian Kwacha", country: "Zambia" },
  { code: "BWP", symbol: "P", name: "Botswana Pula", country: "Botswana" },
  { code: "NAD", symbol: "N$", name: "Namibian Dollar", country: "Namibia" },
  { code: "MUR", symbol: "₨", name: "Mauritian Rupee", country: "Mauritius" },
];

export function getCurrencySymbol() {
  const code = localStorage.getItem("currency_code") || "ZAR";
  const currency = CURRENCIES.find(c => c.code === code);
  return currency ? currency.symbol : "R";
}

export function formatCurrency(amount) {
  const symbol = getCurrencySymbol();
  return `${symbol}${(amount || 0).toFixed(2)}`;
}

// Amount with no currency symbol — used on the printed till slip only.
export function formatAmount(amount) {
  return (amount || 0).toFixed(2);
}
