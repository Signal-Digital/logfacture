/** Données initiales (au premier lancement uniquement). */
import type { Db } from '@/lib/db';
import { migrate } from '@/lib/db/migrations';
import { DEFAULT_STAGES } from './pipeline';
import { DEFAULT_PROJECT_STATUSES, DEFAULT_PROJECT_TEMPLATES, saveProjectTemplate } from './projects';
import { DEFAULT_SERVICES, createService } from './catalog';
import { DEFAULT_EMAIL_TEMPLATES } from './emails';
import { DEFAULT_SETTINGS, setSetting, type SettingsKey } from './settings';
import { BUILTIN_TEMPLATES } from '@/pdf/builtinTemplates';

export async function initDatabase(db: Db): Promise<{ firstRun: boolean }> {
  await migrate(db);
  const seeded = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = '_seeded'");
  if (seeded) {
    await ensureEmailTemplates(db);
    return { firstRun: false };
  }
  await db.tx(async (t) => {
    for (const key of Object.keys(DEFAULT_SETTINGS) as SettingsKey[]) {
      const exists = await t.get('SELECT 1 FROM settings WHERE key = ?', [key]);
      if (!exists) await setSetting(t, key, DEFAULT_SETTINGS[key] as any);
    }
    if (!(await t.get('SELECT 1 FROM pipeline_stages'))) {
      for (const s of DEFAULT_STAGES) {
        await t.run('INSERT INTO pipeline_stages (name, position, kind, default_probability, color) VALUES (?, ?, ?, ?, ?)', [s.name, s.position, s.kind, s.default_probability, s.color]);
      }
    }
    if (!(await t.get('SELECT 1 FROM project_statuses'))) {
      let pos = 1;
      for (const s of DEFAULT_PROJECT_STATUSES) {
        await t.run('INSERT INTO project_statuses (name, position, is_closed, color) VALUES (?, ?, ?, ?)', [s.name, pos++, s.is_closed, s.color]);
      }
    }
    if (!(await t.get('SELECT 1 FROM project_templates'))) {
      for (const tpl of DEFAULT_PROJECT_TEMPLATES) {
        await saveProjectTemplate(t, { name: tpl.name, description: null, service_type: tpl.service_type, tasks: tpl.tasks.map((k, i) => ({ ...k, position: i + 1 })) });
      }
    }
    if (!(await t.get('SELECT 1 FROM services'))) {
      for (const s of DEFAULT_SERVICES) await createService(t, s);
    }
    if (!(await t.get('SELECT 1 FROM doc_templates'))) {
      for (const tpl of BUILTIN_TEMPLATES) {
        await t.run(
          'INSERT INTO doc_templates (name, doc_type, engine, layout_json, is_default_quote, is_default_invoice, is_builtin) VALUES (?, ?, ?, ?, ?, ?, 1)',
          [tpl.name, 'tous', 'visuel', JSON.stringify(tpl.layout), tpl.defaultQuote ? 1 : 0, tpl.defaultInvoice ? 1 : 0],
        );
      }
    }
    await t.run("INSERT INTO settings (key, value) VALUES ('_seeded', ?)", [JSON.stringify(new Date().toISOString())]);
  });
  await ensureEmailTemplates(db);
  return { firstRun: true };
}

/** Ajoute les modèles d'email fournis manquants (sans écraser les personnalisations). */
async function ensureEmailTemplates(db: Db) {
  for (const t of DEFAULT_EMAIL_TEMPLATES) {
    await db.run('INSERT INTO email_templates (key, name, category, subject, body) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING', [t.key, t.name, t.category, t.subject, t.body]);
  }
}
