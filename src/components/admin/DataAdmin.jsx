import { useState } from 'react';
import { COLLECTIONS, downloadJson, exportDatabase } from '../../lib/backup.js';
import { attempt, Icon } from '../ui.jsx';

/** The owner's backup: download any set of collections as one JSON file. */
export default function DataAdmin() {
  const [names, setNames] = useState(() => COLLECTIONS.map((c) => c.id));
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setNames((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const download = async () => {
    setBusy(true);
    const data = await attempt(() => exportDatabase(names));
    setBusy(false);
    if (data) downloadJson(data, `brv-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  return (
    <section className="panel">
      <h2>Backup</h2>
      <p className="small muted">
        Downloads the chosen collections as one JSON file (only the owner can do this). Keep regular backups somewhere safe: they contain everything people wrote, including
        usernames.
      </p>
      <div className="check-list">
        {COLLECTIONS.map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={names.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.label}
          </label>
        ))}
      </div>
      <button className="primary" onClick={download} disabled={busy || !names.length}>
        <Icon name="download" />
        {busy ? 'Preparing…' : 'Download backup'}
      </button>
    </section>
  );
}
