import { useState } from 'react';
import { COLLECTIONS, downloadJson, exportDatabase, importDatabase, inspectBackup } from '../../lib/backup.js';
import { useSession } from '../../lib/session.jsx';
import { attempt, Icon } from '../ui.jsx';
import { confirmDialog } from '../dialogs.jsx';

// People data is opt-in on import: restoring it is rarely what you want.
const SENSITIVE = new Set(['admins', 'users', 'adminChat']);

export default function DataAdmin() {
  const { user } = useSession();
  const [exportNames, setExportNames] = useState(() => COLLECTIONS.map((c) => c.id));
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null); // { name, data, counts }
  const [importNames, setImportNames] = useState([]);
  const [mode, setMode] = useState('merge');
  const [error, setError] = useState('');

  const toggle = (list, set, id) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const doExport = async () => {
    setBusy(true);
    const data = await attempt(() => exportDatabase(exportNames));
    setBusy(false);
    if (data) downloadJson(data, `brv-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    try {
      const data = JSON.parse(await f.text());
      const counts = inspectBackup(data);
      setFile({ name: f.name, data, counts });
      setImportNames(Object.keys(counts).filter((n) => counts[n] > 0 && !SENSITIVE.has(n)));
    } catch (err) {
      setFile(null);
      setError(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
    }
  };

  const doImport = async () => {
    const total = importNames.reduce((n, c) => n + (file.counts[c] || 0), 0);
    const warning =
      mode === 'replace'
        ? `Replace ${importNames.length} collection(s) with the file's ${total} documents? Documents that are not in the file will be deleted.`
        : `Write ${total} documents from the file? Existing documents with the same IDs will be overwritten.`;
    if (!(await confirmDialog({ title: mode === 'replace' ? 'Replace data' : 'Import data', message: `${warning} You can undo this afterwards.`, confirmLabel: 'Import', danger: mode === 'replace' }))) return;
    setBusy(true);
    const r = await attempt(
      () => importDatabase(file.data, { names: importNames, mode, protect: [`admins/${user.uid}`] }),
      `Imported ${file.name}`,
    );
    setBusy(false);
    if (r) setFile(null);
  };

  return (
    <div className="admin-grid">
      <section className="panel">
        <h2>Export a backup</h2>
        <p className="small muted">Downloads the chosen collections as one JSON file. Keep regular backups: the file can be imported again here.</p>
        <div className="check-list">
          {COLLECTIONS.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={exportNames.includes(c.id)} onChange={() => toggle(exportNames, setExportNames, c.id)} />
              {c.label}
            </label>
          ))}
        </div>
        <button className="primary" onClick={doExport} disabled={busy || !exportNames.length}>
          <Icon name="download" />
          Download backup
        </button>
      </section>

      <section className="panel">
        <h2>Import</h2>
        <p className="small muted">
          Restore a backup, or load prepared content such as <code>imports/blood-rage-valhalla.json</code> from the repository. Imports can be undone.
        </p>
        <label className="file-drop">
          <Icon name="upload" size={22} />
          <span>{file ? <b>{file.name}</b> : 'Choose a .json backup file'}</span>
          <input type="file" accept=".json,application/json" onChange={pick} />
        </label>
        {error && <p className="error">{error}</p>}
        {file && (
          <>
            <div className="check-list">
              {COLLECTIONS.filter((c) => file.counts[c.id] != null).map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={importNames.includes(c.id)} onChange={() => toggle(importNames, setImportNames, c.id)} />
                  {c.label} <span className="muted">({file.counts[c.id]})</span>
                </label>
              ))}
            </div>
            <div className="field">
              <label>Mode</label>
              <div className="seg">
                <button type="button" className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')}>
                  Merge
                </button>
                <button type="button" className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>
                  Replace
                </button>
              </div>
              <p className="hint">
                {mode === 'merge'
                  ? 'Adds the documents in the file and overwrites ones with the same ID. Nothing else changes.'
                  : 'Makes each chosen collection match the file exactly: documents not in the file are deleted. Your own admin entry is always kept.'}
              </p>
            </div>
            <div className="row gap">
              <button onClick={() => setFile(null)} disabled={busy}>
                Cancel
              </button>
              <button className="primary" onClick={doImport} disabled={busy || !importNames.length}>
                <Icon name="upload" />
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
