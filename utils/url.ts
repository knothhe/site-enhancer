export interface UrlVariants {
  hostname: string;
  cleanUrl: string;
  bareUrl: string;
  removedCount: number;
}

const trackingParams = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid',
  'msclkid', 'twclid', 'ttclid', 'yclid', 'igshid',
  'mc_cid', 'mc_eid', '_ga', '_gl', '_hsenc', '_hsmi', 'hsctatracking',
  'vero_id', 'vero_conv',
]);

function isTrackingParam(name: string, hostname: string): boolean {
  const key = name.toLowerCase();
  if (key.startsWith('utm_') || trackingParams.has(key)) return true;

  // Short, generic names only have tracking meaning on these specific sites.
  if (['x.com', 'twitter.com'].some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) {
    return ['s', 't', 'ref_src', 'ref_url'].includes(key);
  }
  if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
    return key === 'si';
  }
  return false;
}

export function getUrlVariants(rawUrl: string | undefined): UrlVariants | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  // Keep the original encoding, order and duplicate values of retained parameters.
  // Re-serializing URLSearchParams can alter signatures, spaces and escape sequences.
  const source = url.href;
  const hashIndex = source.indexOf('#');
  const fragment = hashIndex < 0 ? '' : source.slice(hashIndex);
  const beforeHash = hashIndex < 0 ? source : source.slice(0, hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  const base = queryIndex < 0 ? beforeHash : beforeHash.slice(0, queryIndex);
  let removedCount = 0;
  const kept = queryIndex < 0 ? [] : beforeHash.slice(queryIndex + 1).split('&').filter(part => {
    const name = new URLSearchParams(part).keys().next().value;
    if (name !== undefined && isTrackingParam(name, url.hostname)) {
      removedCount += 1;
      return false;
    }
    return true;
  });

  return {
    hostname: url.host,
    cleanUrl: removedCount === 0 ? source : base + (kept.some(Boolean) ? `?${kept.join('&')}` : '') + fragment,
    bareUrl: base + fragment,
    removedCount,
  };
}
