/** Zone de signature manuscrite (souris, stylet, doigt) — événements Pointer, lissage quadratique. */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface SignaturePadHandle {
  clear(): void;
  isEmpty(): boolean;
  /** PNG recadré sur le tracé, fond transparent. */
  toPng(): Promise<Uint8Array>;
}

export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (empty: boolean) => void }>(function SignaturePad({ onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<{ x: number; y: number; p: number }[][]>([]);
  const drawing = useRef(false);
  const [, force] = useState(0);

  const ratio = () => window.devicePixelRatio || 1;

  const redraw = () => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.scale(ratio(), ratio());
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b1530';
    for (const s of strokes.current) {
      if (s.length === 1) {
        ctx.beginPath();
        ctx.arc(s[0].x, s[0].y, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = '#0b1530';
        ctx.fill();
        continue;
      }
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1];
        const b = s[i];
        ctx.lineWidth = 1.4 + 1.8 * ((a.p + b.p) / 2);
        ctx.beginPath();
        const mid0 = i > 1 ? { x: (s[i - 2].x + a.x) / 2, y: (s[i - 2].y + a.y) / 2 } : a;
        const mid1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.moveTo(mid0.x, mid0.y);
        ctx.quadraticCurveTo(a.x, a.y, mid1.x, mid1.y);
        ctx.stroke();
      }
    }
  };

  useEffect(() => {
    const c = canvas.current!;
    const resize = () => {
      const r = c.getBoundingClientRect();
      c.width = r.width * ratio();
      c.height = r.height * ratio();
      redraw();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5 };
  };

  useImperativeHandle(ref, () => ({
    clear() {
      strokes.current = [];
      redraw();
      onChange?.(true);
      force((x) => x + 1);
    },
    isEmpty: () => strokes.current.reduce((a, s) => a + s.length, 0) < 8,
    async toPng() {
      const pts = strokes.current.flat();
      const minX = Math.max(0, Math.min(...pts.map((p) => p.x)) - 8);
      const minY = Math.max(0, Math.min(...pts.map((p) => p.y)) - 8);
      const maxX = Math.max(...pts.map((p) => p.x)) + 8;
      const maxY = Math.max(...pts.map((p) => p.y)) + 8;
      const scale = 2;
      const out = document.createElement('canvas');
      out.width = Math.ceil((maxX - minX) * scale);
      out.height = Math.ceil((maxY - minY) * scale);
      const ctx = out.getContext('2d')!;
      const src = canvas.current!;
      ctx.drawImage(src, minX * ratio(), minY * ratio(), (maxX - minX) * ratio(), (maxY - minY) * ratio(), 0, 0, out.width, out.height);
      const blob: Blob = await new Promise((res) => out.toBlob((b) => res(b!), 'image/png'));
      return new Uint8Array(await blob.arrayBuffer());
    },
  }));

  return (
    <canvas
      ref={canvas}
      className="sigpad"
      aria-label="Zone de signature : signez avec la souris, un stylet ou le doigt"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        drawing.current = true;
        strokes.current.push([point(e)]);
        redraw();
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
        const stroke = strokes.current[strokes.current.length - 1];
        for (const ev of events) {
          const r = canvas.current!.getBoundingClientRect();
          stroke.push({ x: ev.clientX - r.left, y: ev.clientY - r.top, p: ev.pressure && ev.pointerType === 'pen' ? ev.pressure : 0.5 });
        }
        redraw();
      }}
      onPointerUp={() => {
        drawing.current = false;
        onChange?.(strokes.current.reduce((a, s) => a + s.length, 0) < 8);
      }}
      onPointerLeave={() => {
        if (drawing.current) {
          drawing.current = false;
          onChange?.(strokes.current.reduce((a, s) => a + s.length, 0) < 8);
        }
      }}
    />
  );
});
