import { useState } from 'react';
import { COLLECTIONS, downloadJson, exportDatabase, importDatabase, inspectBackup, SENSITIVE } from '../../lib/backup.js';
import { useSession } from '../../lib/session.jsx';
import { attempt, Icon } from '../ui.jsx';
import { confirmDialog, promptDialog } from '../dialogs.jsx';

/** The owner's backup: download any set of collections as one JSON file, and load one back. */
export default function DataAdmin() {
  const { user } = useSession();
  const [names, setNames] = useState(() => COLLECTIONS.map((c) => c.id));
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null); // { name, data, counts }
  const [importNames, setImportNames] = useState([]);
  const [mode, setMode] = useState('merge');
  const [error, setError] = useState('');
  const toggle = (set, id) => set((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const download = async () => {
    setBusy(true);
    const data = await attempt(() => exportDatabase(names));
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

  // Replacing can also empty collections the file doesn't have (a clean start), so it lists them all.
  const listed = file ? COLLECTIONS.filter((c) => mode === 'replace' || file.counts[c.id] != null) : [];
  const setModeAndPick = (m) => {
    setMode(m);
    // Replacing ticks all content, so content the file lacks (comments, rulesets…) is cleared too.
    if (m === 'replace') setImportNames(COLLECTIONS.filter((c) => !SENSITIVE.has(c.id)).map((c) => c.id));
    else setImportNames(Object.keys(file.counts).filter((n) => file.counts[n] > 0 && !SENSITIVE.has(n)));
  };

  const doImport = async () => {
    const total = importNames.reduce((n, c) => n + (file.counts[c] || 0), 0);
    const emptied = importNames.filter((c) => !file.counts[c]);
    if (mode === 'replace') {
      const ok = await confirmDialog({
        title: 'Replace data',
        message: `Make ${importNames.length} collection${importNames.length === 1 ? '' : 's'} match the file (${total} documents)? Everything else in them is deleted${
          emptied.length ? `; ${emptied.length} the file doesn't have ${emptied.length === 1 ? 'is' : 'are'} emptied` : ''
        }. Your own owner, admin, role and profile entries are kept. Download a backup first: you can undo this in this tab only.`,
        confirmLabel: 'Continue',
        danger: true,
      });
      if (!ok) return;
      const typed = await promptDialog({ title: 'Replace data', message: 'Type REPLACE to confirm.', label: 'Confirmation', confirmLabel: 'Replace data', danger: true });
      if (typed?.trim() !== 'REPLACE') return;
    } else if (
      !(await confirmDialog({
        title: 'Import data',
        message: `Write ${total} documents from the file? Existing documents with the same ids are overwritten; nothing else changes. You can undo this afterwards.`,
        confirmLabel: 'Import',
      }))
    )
      return;
    setBusy(true);
    const protect = ['admins', 'roles', 'users'].map((c) => `${c}/${user.uid}`);
    const r = await attempt(() => importDatabase(file.data, { names: importNames, mode, protect }), `Imported ${file.name}`);
    setBusy(false);
    if (r) setFile(null);
  };

  return (
    <div className="admin-grid">
      <section className="panel">
        <h2>Backup</h2>
        <p className="small muted">
          Downloads the chosen collections as one JSON file (only the owner can do this). Keep regular backups somewhere safe: they contain everything people wrote,
          including usernames and private homebrew.
        </p>
        <div className="check-list">
          {COLLECTIONS.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={names.includes(c.id)} onChange={() => toggle(setNames, c.id)} />
              {c.label}
            </label>
          ))}
        </div>
        <button className="primary" onClick={download} disabled={busy || !names.length}>
          <Icon name="download" />
          {busy ? 'Preparing…' : 'Download backup'}
        </button>
      </section>

      <section className="panel">
        <h2>Import</h2>
        <p className="small muted">
          Owner only. Restore a backup, or load prepared content such as <code>blood-rage-valhalla.json</code> from your <code>imports/</code> folder. <b>Replace</b> can also clear
          collections for a clean start, keeping people and your own entries.
        </p>
        <label className="file-drop">
          <Icon name="upload" size={22} />
          <span>{file ? <b>{file.name}</b> : 'Choose a .json backup file'}</span>
          <input type="file" accept=".json,application/json" onChange={pick} />
        </label>
        {error && <p className="error">{error}</p>}
        {file && (
          <>
            <div className="field">
              <label>Mode</label>
              <div className="seg">
                <button type="button" className={mode === 'merge' ? 'on' : ''} onClick={() => setModeAndPick('merge')}>
                  Merge
                </button>
                <button type="button" className={mode === 'replace' ? 'on' : ''} onClick={() => setModeAndPick('replace')}>
                  Replace
                </button>
              </div>
              <p className="hint">
                {mode === 'merge'
                  ? 'Adds the documents in the file and overwrites ones with the same id. Nothing else changes.'
                  : 'Makes each ticked collection match the file exactly: documents not in the file are deleted, and a ticked collection the file doesn’t have is emptied.'}
              </p>
            </div>
            <div className="check-list">
              {listed.map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={importNames.includes(c.id)} onChange={() => toggle(setImportNames, c.id)} />
                  {c.label}{' '}
                  <span className="muted">({file.counts[c.id] != null ? file.counts[c.id] : mode === 'replace' ? 'empties it' : 0})</span>
                </label>
              ))}
            </div>
            <div className="row gap">
              <button onClick={() => setFile(null)} disabled={busy}>
                Cancel
              </button>
              <button className={mode === 'replace' ? 'danger' : 'primary'} onClick={doImport} disabled={busy || !importNames.length}>
                <Icon name="upload" />
                {busy ? 'Importing…' : mode === 'replace' ? 'Replace' : 'Import'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
