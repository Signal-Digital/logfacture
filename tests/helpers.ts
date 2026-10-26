import { createDb, type Db } from '@/lib/db';
import { nodeDriver } from '@/lib/db/nodeDriver';
import { MemoryFileStore } from '@/lib/files';
import { initDatabase } from '@/domain/seed';
import { patchSetting } from '@/domain/settings';
import type { Ctx } from '@/domain/context';

export async function newCtx(path = ':memory:'): Promise<Ctx & { close(): void }> {
  const driver = nodeDriver(path);
  const db = createDb(driver);
  await initDatabase(db);
  return { db, files: new MemoryFileStore(), close: () => driver.close() };
}

/** Complète les informations administratives obligatoires (adresse, régime de TVA). */
export async function completeSetup(db: Db, regime: 'franchise' | 'reel_simplifie' = 'reel_simplifie') {
  await patchSetting(db, 'company', { address_line1: '12 rue de la Paix', postal_code: '75002', city: 'Paris', vat_number: regime === 'franchise' ? '' : 'FR12944784891' });
  await patchSetting(db, 'vat', { regime });
  await patchSetting(db, 'payment', { iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'AGRIFRPP' });
}

export const clientInput = {
  name: 'Boulangerie Martin',
  kind: 'prospect' as const,
  address_line1: '3 place du Marché',
  postal_code: '69001',
  city: 'Lyon',
  email: 'contact@boulangerie-martin.fr',
  phone: '04 78 00 00 00',
  siren: '552100554',
};
