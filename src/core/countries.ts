// The fixed list of countries a founder can pick, and how a row's country cell is matched to one.

export const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia",
  "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium",
  "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
  "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Canada", "Cape Verde", "Central African Republic", "Chad",
  "Chile", "China", "Colombia", "Comoros", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic",
  "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt",
  "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France",
  "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau",
  "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland",
  "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo",
  "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania",
  "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania",
  "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique",
  "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria",
  "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama",
  "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Puerto Rico", "Qatar",
  "Republic of the Congo", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal",
  "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia",
  "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland",
  "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago",
  "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
  "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia",
  "Zimbabwe",
] as const;

export type Country = (typeof COUNTRIES)[number];

/** Other ways a row writes a country, by the normalised form of the country's name. */
const ALIASES: Record<string, string[]> = {
  "united states": ["us", "usa", "u s", "u s a", "united states of america", "america"],
  "united kingdom": ["uk", "u k", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
  "united arab emirates": ["uae", "u a e", "emirates", "dubai", "abu dhabi"],
  "czech republic": ["czechia"],
  "south korea": ["korea", "republic of korea"],
  "netherlands": ["the netherlands", "holland"],
  "turkey": ["turkiye"],
  "ivory coast": ["cote d ivoire"],
  "cape verde": ["cabo verde"],
  "eswatini": ["swaziland"],
  "myanmar": ["burma"],
  "timor leste": ["east timor"],
  "vietnam": ["viet nam"],
  "russia": ["russian federation"],
  "democratic republic of the congo": ["drc", "dr congo"],
  "palestine": ["palestinian territories"],
};

function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^the /, "");
}

const CANONICAL = new Map<string, string>();
for (const c of COUNTRIES) CANONICAL.set(norm(c), norm(c));
for (const [canon, names] of Object.entries(ALIASES)) for (const n of names) CANONICAL.set(norm(n), canon);

export function isCountry(value: unknown): value is Country {
  return typeof value === "string" && (COUNTRIES as readonly string[]).includes(value);
}

/** The countries a row's cell names: "Israel/US" names two, "London, United Kingdom" one. */
export function countriesIn(cell: unknown): string[] {
  if (typeof cell !== "string") return [];
  const found = new Set<string>();
  for (const part of cell.split(/[\/,;&|()]|\band\b/i)) {
    const c = CANONICAL.get(norm(part));
    if (c !== undefined) found.add(c);
  }
  const whole = CANONICAL.get(norm(cell));
  if (whole !== undefined) found.add(whole);
  return [...found];
}

/** True when the row's country cell names the founder's country. */
export function inCountry(cell: unknown, country: string): boolean {
  const want = CANONICAL.get(norm(country));
  return want !== undefined && countriesIn(cell).includes(want);
}
