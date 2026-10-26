/** Plateforme Windows (Tauri) : SQLite natif, fichiers locaux, boîtes de dialogue système. */
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { createDb } from '@/lib/db';
import { tauriDriver } from '@/lib/db/tauriDriver';
import { base64ToBytes, bytesToBase64 } from '@/lib/crypto';
import type { FileStore } from '@/lib/files';
import type { AppInfo, Platform } from './types';

const files: FileStore = {
  write: async (rel, data) => {
    await invoke('file_write', { rel, dataB64: bytesToBase64(data) });
  },
  read: async (rel) => base64ToBytes(await invoke<string>('file_read', { rel })),
  exists: (rel) => invoke<boolean>('file_exists', { rel }),
  remove: (rel) => invoke<void>('file_delete', { rel }),
};

export async function createTauriPlatform(): Promise<Platform> {
  const info = await invoke<AppInfo>('app_info');
  const db = createDb(tauriDriver);
  const converters = await invoke<{ libreoffice: string | null; word: boolean }>('converters_detect').catch(() => ({ libreoffice: null, word: false }));
  const ctx = {
    db,
    files,
    convertDocx: converters.libreoffice || converters.word ? async (docx: Uint8Array) => base64ToBytes(await invoke<string>('docx_to_pdf', { docxB64: bytesToBase64(docx) })) : undefined,
  };
  return {
    kind: 'tauri',
    ctx,
    info,
    async pickFile({ title, extensions, label }) {
      const path = await open({ title, multiple: false, directory: false, filters: [{ name: label, extensions }] });
      if (!path || Array.isArray(path)) return null;
      const bytes = base64ToBytes(await invoke<string>('external_read', { path }));
      return { name: path.split(/[\\/]/).pop() ?? 'fichier', path, bytes };
    },
    async saveFile(defaultName, bytes, filter) {
      const path = await save({ defaultPath: defaultName, filters: [{ name: filter.label, extensions: filter.extensions }] });
      if (!path) return null;
      await invoke('external_write', { path, dataB64: bytesToBase64(bytes) });
      return path;
    },
    async openManagedFile(rel) {
      await openPath(await invoke<string>('file_abs_path', { rel }));
    },
    async revealManagedFile(rel) {
      await revealItemInDir(await invoke<string>('file_abs_path', { rel }));
    },
    openFolder: (abs) => openPath(abs),
    openUrl: (url) => openUrl(url),
    async pickDirectory(title) {
      const p = await open({ title, directory: true, multiple: false });
      return typeof p === 'string' ? p : null;
    },
    backupCreate: (destDir, passphrase, label) => invoke('backup_create', { destDir, passphrase, label }),
    backupVerify: (path, passphrase) => invoke('backup_verify', { path, passphrase }),
    backupRestore: (path, passphrase) => invoke('backup_restore', { path, passphrase }),
    backupList: (dir) => invoke('backup_list', { dir }),
    async pickBackupFile() {
      const p = await open({ title: 'Choisir une sauvegarde', multiple: false, filters: [{ name: 'Sauvegarde Signal Desk', extensions: ['sdbak'] }] });
      return typeof p === 'string' ? p : null;
    },
    converters: async () => converters,
    async notify(title, body) {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === 'granted';
      if (ok) sendNotification({ title, body });
    },
    async openSignatureWindow(token) {
      const label = `signature-${token.slice(0, 12)}`;
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.setFocus();
        return;
      }
      new WebviewWindow(label, {
        url: `index.html#/signature/${token}`,
        title: 'Signature du devis — Signal Desk',
        width: 1100,
        height: 900,
        center: true,
        focus: true,
      });
    },
    copyText: (t) => navigator.clipboard.writeText(t),
  };
}
