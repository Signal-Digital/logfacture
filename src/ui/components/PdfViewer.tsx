/** Aperçu PDF (pdf.js, rendu local dans la fenêtre). */
import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Spinner } from './ui';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };

export function PdfViewer({ bytes, maxPages = 50, initialScale = 1.15 }: { bytes: Uint8Array | null; maxPages?: number; initialScale?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(initialScale);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bytes || !ref.current) return;
    let cancelled = false;
    const container = ref.current;
    setBusy(true);
    setError(null);
    (async () => {
      try {
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        if (cancelled) return;
        setPages(doc.numPages);
        container.innerHTML = '';
        for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
          canvas.setAttribute('aria-label', `Page ${i}`);
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        }
      } catch (e: any) {
        if (!cancelled) setError(`Aperçu impossible : ${e.message}`);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes, scale, maxPages]);

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between">
        <span className="muted small">{pages ? `${pages} page${pages > 1 ? 's' : ''}` : ''}{pages > maxPages ? ` (aperçu des ${maxPages} premières)` : ''}</span>
        <div className="row" style={{ gap: 4 }}>
          {busy && <Spinner />}
          <button className="btn sm icon" onClick={() => setScale((s) => Math.max(0.5, s - 0.15))} aria-label="Zoom arrière"><ZoomOut /></button>
          <span className="small muted" style={{ width: 44, textAlign: 'center' }}>{Math.round(scale * 100)} %</span>
          <button className="btn sm icon" onClick={() => setScale((s) => Math.min(3, s + 0.15))} aria-label="Zoom avant"><ZoomIn /></button>
        </div>
      </div>
      {error && <div className="alert danger">{error}</div>}
      <div className="pdf-viewer" ref={ref} />
    </div>
  );
}

/** Rend une page de PDF dans un canvas (fond de l'éditeur de modèles). */
export async function renderPdfPageToDataUrl(bytes: Uint8Array, pageIndex: number, width: number): Promise<{ url: string; width: number; height: number }> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const page = await doc.getPage(Math.min(pageIndex + 1, doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (width / base.width) * 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  return { url: canvas.toDataURL('image/png'), width: base.width, height: base.height };
}
