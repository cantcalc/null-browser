import { app, session } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { DataManager } from '../electron/DataManager';
import { WorkspaceSessions } from '../electron/WorkspaceSessions';
import { INTERFACE_STYLE_IDS, normalizeTheme } from '../shared/appearance';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'null-workspace-migration-'));
app.setPath('userData', profile);
app.whenReady().then(() => {
  fs.writeFileSync(path.join(profile, 'browser_store.json'), JSON.stringify({
    workspaces: [{ id: 'existing-custom-id', name: 'My Work', color: '#10b981' }],
    settings: { interfaceStyle: 'invalid-import', theme: 'mist', accentColor: 'rose', newTabConfig: { showLogo: false } },
  }));
  const data = new DataManager();
  assert.equal(data.getLegacySessionWorkspaceId(), 'existing-custom-id');
  let setups = 0;
  const pool = new WorkspaceSessions(() => { setups++; }, data.getLegacySessionWorkspaceId());
  assert.equal(pool.get('existing-custom-id'), session.defaultSession);
  assert.equal(setups, 0, 'unused workspaces allocated sessions');
  const other = pool.get('other-workspace');
  assert.notEqual(other, session.defaultSession);
  assert.equal(pool.get('other-workspace'), other);
  assert.equal(setups, 1, 'session prepared repeatedly');
  assert.equal(data.getSettings().interfaceStyle, 'studio');
  assert.equal(data.getSettings().theme, 'paper');
  assert.equal('accentColor' in data.getSettings(), false, 'legacy accent preference retained');
  assert.equal('newTabConfig' in data.getSettings(), false, 'legacy start-screen preference retained');
  for (const legacyTheme of ['paper', 'light', 'mist', 'white']) assert.equal(normalizeTheme(legacyTheme), 'paper');
  for (const legacyTheme of ['noir', 'graphite', 'midnight', 'forest', 'aurora', 'sunset', 'oled', 'cobalt', 'clay', undefined]) assert.equal(normalizeTheme(legacyTheme), 'noir');
  for (const interfaceStyle of INTERFACE_STYLE_IDS) {
    data.updateSettings({ interfaceStyle });
    data.flushSync();
    assert.equal(new DataManager().getSettings().interfaceStyle, interfaceStyle, 'design did not survive reload');
  }
  data.updateSettings({ interfaceStyle: 'studio' });
  data.saveWorkspaces([{ id: 'other-workspace', name: 'Renamed', color: '#10b981' }], 'other-workspace');
  data.flushSync();
  const restarted = new DataManager();
  const restored = new WorkspaceSessions(() => {}, restarted.getLegacySessionWorkspaceId());
  assert.equal(restarted.getSettings().interfaceStyle, 'studio');
  assert.equal(restarted.getLegacySessionWorkspaceId(), 'existing-custom-id');
  assert.equal(restored.get('other-workspace'), other, 'rename changed storage partition');
  assert.notEqual(restored.get('other-workspace'), session.defaultSession, 'deleted owner cookie jar reassigned');
  console.log('NULL_WORKSPACE_MIGRATION_QA=' + JSON.stringify({ ok: true, lazySessionSetup: true, customLegacyOwner: true, deleteDoesNotReassignCookies: true, stableRename: true, invalidDesignImport: true, designPersistence: true, monochromeMigration: true, profile }));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
