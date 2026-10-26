/**
 * Polices embarquées dans les PDF : Liberation Sans (métriques identiques à
 * Arial, licence SIL OFL 1.1 — voir fonts/LICENSE-LiberationSans.txt).
 * Choisie car son sous-ensemble (« subset ») est correctement généré par
 * pdf-lib, ce qui garde des PDF légers (~30 à 80 Ko). Inter, testée, perdait
 * des glyphes lors du sous-ensemble.
 */

const URLS = {
  regular: new URL('./fonts/LiberationSans-Regular.ttf', import.meta.url),
  bold: new URL('./fonts/LiberationSans-Bold.ttf', import.meta.url),
  italic: new URL('./fonts/LiberationSans-Italic.ttf', import.meta.url),
};

export type FontKey = keyof typeof URLS;

const cache = new Map<FontKey, Promise<Uint8Array>>();

async function load(url: URL): Promise<Uint8Array> {
  if (url.protocol === 'file:') {
    // Tests et scripts Node
    const fs = (globalThis as any).process.getBuiltinModule('node:fs');
    return new Uint8Array(fs.readFileSync(url));
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Police introuvable : ${url.pathname}`);
  return new Uint8Array(await r.arrayBuffer());
}

export function builtinFont(key: FontKey): Promise<Uint8Array> {
  let p = cache.get(key);
  if (!p) {
    p = load(URLS[key]);
    cache.set(key, p);
  }
  return p;
}
