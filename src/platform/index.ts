import type { Platform } from './types';

export type { Platform } from './types';

let current: Platform | null = null;

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function initPlatform(): Promise<Platform> {
  if (current) return current;
  if (isTauri()) {
    const { createTauriPlatform } = await import('./tauri');
    current = await createTauriPlatform();
  } else {
    const { createBrowserPlatform } = await import('./browser');
    current = await createBrowserPlatform();
  }
  return current;
}

export function platform(): Platform {
  if (!current) throw new Error('Plateforme non initialisée');
  return current;
}
