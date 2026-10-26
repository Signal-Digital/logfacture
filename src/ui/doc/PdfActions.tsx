import { useEffect, useState } from 'react';
import { Download, FolderOpen, Printer } from 'lucide-react';
import { Button, Modal } from '../components/ui';
import { PdfViewer } from '../components/PdfViewer';
import { useApp, errorMessage } from '../core/app';
import type { GeneratedPdf } from '@/domain/docgen';

/** Aperçu d'un PDF généré à la volée (brouillon) avec enregistrement et impression. */
export function PdfPreviewModal({ title, fileName, generate, onClose }: { title: string; fileName: string; generate: () => Promise<GeneratedPdf>; onClose: () => void }) {
  const { platform, toast, run } = useApp();
  const [pdf, setPdf] = useState<GeneratedPdf | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    generate().then(setPdf).catch((e) => setError(errorMessage(e).text));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const print = () =>
    run(async () => {
      if (!pdf) return;
      const rel = `tmp/apercus/${Date.now()}-${fileName}`;
      await platform.ctx.files.write(rel, pdf.bytes);
      await platform.openManagedFile(rel);
      toast('Le PDF est ouvert dans votre visionneuse : utilisez Ctrl+P pour imprimer.');
    });
  return (
    <Modal
      title={title}
      subtitle={pdf ? `Modèle : ${pdf.template.name}${pdf.engine === 'docx' ? ' (Word, converti en PDF)' : ''}` : undefined}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Fermer</Button>
          <Button icon={Printer} disabled={!pdf} onClick={print}>Imprimer</Button>
          <Button variant="primary" icon={Download} disabled={!pdf} onClick={async () => { const p = await platform.saveFile(fileName, pdf!.bytes, { label: 'PDF', extensions: ['pdf'] }); if (p) toast(`PDF enregistré : ${p}`, 'success'); }}>Enregistrer sous…</Button>
        </>
      }
    >
      {error ? <div className="alert danger">{error}</div> : <PdfViewer bytes={pdf?.bytes ?? null} />}
    </Modal>
  );
}

/** Actions sur un PDF enregistré (document définitif). */
export function StoredPdfActions({ path, fileName }: { path: string; fileName: string }) {
  const { platform, toast, run } = useApp();
  return (
    <>
      <Button icon={Printer} onClick={() => run(async () => { await platform.openManagedFile(path); toast('PDF ouvert : utilisez Ctrl+P pour imprimer.'); })}>Ouvrir / imprimer</Button>
      <Button icon={Download} onClick={() => run(async () => { const p = await platform.saveFile(fileName, await platform.ctx.files.read(path), { label: 'PDF', extensions: ['pdf'] }); if (p) toast(`PDF exporté : ${p}`, 'success'); })}>Exporter</Button>
      {platform.kind === 'tauri' && <Button icon={FolderOpen} variant="ghost" onClick={() => run(() => platform.revealManagedFile(path))} aria-label="Ouvrir le dossier" title="Ouvrir le dossier dans Windows" />}
    </>
  );
}

export function StoredPdfView({ path }: { path: string }) {
  const { ctx } = useApp();
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ctx.files.read(path).then(setBytes).catch((e) => setError(errorMessage(e).text));
  }, [path, ctx.files]);
  if (error) return <div className="alert danger">{error}</div>;
  return <PdfViewer bytes={bytes} initialScale={1} />;
}
