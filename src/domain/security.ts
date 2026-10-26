/**
 * Protection par mot de passe et verrouillage automatique.
 *
 * Le mot de passe n'est jamais stocké : seule une empreinte PBKDF2-SHA256
 * (310 000 itérations, sel aléatoire) est conservée.
 *
 * Limite : ce verrou protège l'accès à l'interface de Signal Desk. Il ne
 * chiffre pas la base SQLite sur le disque et ne protège pas contre une
 * personne disposant d'un accès administrateur au poste Windows. Pour
 * protéger les données au repos, activez BitLocker (voir docs/SECURITE.md).
 */
import type { Db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { BusinessError } from './context';
import { getSetting, patchSetting } from './settings';
import { logEvent } from './audit';

export function passwordStrength(pw: string): { ok: boolean; message: string } {
  if (pw.length < 10) return { ok: false, message: 'Au moins 10 caractères.' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(pw)).length;
  if (classes < 3) return { ok: false, message: 'Mélangez au moins 3 types de caractères (minuscules, majuscules, chiffres, symboles).' };
  return { ok: true, message: 'Mot de passe correct.' };
}

export async function isPasswordSet(db: Db): Promise<boolean> {
  return !!(await getSetting(db, 'security')).password;
}

export async function setPassword(db: Db, newPassword: string, currentPassword?: string): Promise<void> {
  const sec = await getSetting(db, 'security');
  if (sec.password) {
    if (!currentPassword || !(await verifyPassword(currentPassword, sec.password))) throw new BusinessError('Mot de passe actuel incorrect.');
  }
  const strength = passwordStrength(newPassword);
  if (!strength.ok) throw new BusinessError(strength.message);
  await patchSetting(db, 'security', { password: await hashPassword(newPassword) });
  await logEvent(db, { entity: 'securite', action: sec.password ? 'changement_mot_de_passe' : 'activation_mot_de_passe', summary: sec.password ? 'Mot de passe modifié' : 'Protection par mot de passe activée' });
}

export async function removePassword(db: Db, currentPassword: string): Promise<void> {
  const sec = await getSetting(db, 'security');
  if (!sec.password) return;
  if (!(await verifyPassword(currentPassword, sec.password))) throw new BusinessError('Mot de passe incorrect.');
  await patchSetting(db, 'security', { password: null, auto_lock_minutes: 0 });
  await logEvent(db, { entity: 'securite', action: 'desactivation_mot_de_passe', summary: 'Protection par mot de passe désactivée' });
}

/** Vérifie le mot de passe à l'ouverture / au déverrouillage. Délai croissant après des échecs. */
let failures = 0;
export async function unlock(db: Db, password: string): Promise<boolean> {
  const sec = await getSetting(db, 'security');
  if (!sec.password) return true;
  if (failures >= 3) await new Promise((r) => setTimeout(r, Math.min(30, 2 ** (failures - 2)) * 1000));
  const ok = await verifyPassword(password, sec.password);
  if (ok) {
    failures = 0;
  } else {
    failures++;
    await logEvent(db, { entity: 'securite', action: 'echec_deverrouillage', summary: 'Tentative de déverrouillage échouée' });
  }
  return ok;
}

export function resetUnlockFailures() {
  failures = 0;
}
