export interface BrowserInfo {
  name: string;
  version: string;
  platform: string;
  userAgent: string;
}

interface UAData {
  brands?: { brand: string; version: string }[];
  platform?: string;
}

/** Pure UA parser (testable). Edge and Opera must be checked before Chrome. */
export function parseUserAgent(ua: string): { name: string; version: string } {
  const rules: [string, RegExp][] = [
    ['Edge', /\bEdg(?:e|A|iOS)?\/([\d.]+)/],
    ['Opera', /\bOPR\/([\d.]+)/],
    ['Firefox', /\b(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /\b(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /\bVersion\/([\d.]+).*Safari\//],
  ];
  for (const [name, re] of rules) {
    const m = re.exec(ua);
    if (m?.[1]) return { name, version: m[1] };
  }
  return { name: 'Unknown', version: '' };
}

export function detectBrowser(nav: Navigator = navigator): BrowserInfo {
  const ua = nav.userAgent;
  const uaData = (nav as Navigator & { userAgentData?: UAData }).userAgentData;
  const parsed = parseUserAgent(ua);
  // Prefer client-hint brands: they distinguish Edge/Chrome reliably.
  const brand = uaData?.brands?.find((b) => /Edge|Chrome|Chromium|Opera|Firefox/.test(b.brand) && !/Not.?A.?Brand/i.test(b.brand));
  const preferred = uaData?.brands?.find((b) => /Microsoft Edge/.test(b.brand)) ?? brand;
  return {
    name: preferred ? preferred.brand.replace('Microsoft ', '').replace('Google ', '') : parsed.name,
    version: preferred?.version ? `${preferred.version} (UA: ${parsed.version || 'n/a'})` : parsed.version,
    platform: uaData?.platform ?? nav.platform ?? '',
    userAgent: ua,
  };
}
