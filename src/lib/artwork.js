// Both catalogues serve artwork at arbitrary sizes through the URL; ask for what is shown.
export function artworkAt(url, size) {
  if (!url) return '';
  if (/mzstatic\.com/.test(url)) return url.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
  if (/dzcdn\.net\/images\/cover\//.test(url)) {
    const side = Math.min(1000, size);
    return url.replace(/\/\d+x\d+-/, `/${side}x${side}-`);
  }
  return url;
}

export function artworkSrcSet(url) {
  if (!/mzstatic\.com|dzcdn\.net/.test(url || '')) return undefined;
  return [160, 320, 600, 1000].map(size => `${artworkAt(url, size)} ${size}w`).join(', ');
}
