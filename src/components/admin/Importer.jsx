import { useMemo, useState } from 'react';
import { autoLayout, FIELD_KINDS, idField, importComponents, newField, saveType, slugKey } from '../../lib/components.js';
import { attempt, Icon, toast } from '../ui.jsx';

const SKIP = '__skip';
const NEW = '__new';

function guessKind(header, values) {
  const h = header.toLowerCase();
  if (h === 'id' || h.endsWith(' id')) return 'id';
  if (/(title|name)$/.test(h)) return 'title';
  if (/(image|illustration|art|picture|img|url)/.test(h)) return 'image';
  if (/(lore|flavou?r|quote)/.test(h)) return 'lore';
  const filled = values.filter((v) => v !== '' && v != null);
  if (filled.length && filled.every((v) => /^-?\d+(\.\d+)?$|^[xX*]$/.test(String(v).trim()) || /^n\/?a$/i.test(String(v).trim()))) return 'value';
  const distinct = new Set(filled.map(String));
  if (distinct.size <= Math.max(12, filled.length / 8) && filled.every((v) => String(v).length < 30)) return 'type';
  return 'ability';
}

/** Import rows from .xlsx/.xls/.csv into a component type, mapping columns to fields. */
export default function Importer({ type, comps, onDone }) {
  const [book, setBook] = useState(null); // { name, sheets: { [name]: rows[][] } }
  const [sheet, setSheet] = useState('');
  const [mapping, setMapping] = useState({}); // column index -> field key | NEW | SKIP
  const [newKinds, setNewKinds] = useState({}); // column index -> kind
  const [removeMissing, setRemoveMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = book?.sheets[sheet] || [];
  const headers = (rows[0] || []).map((h, i) => String(h || `Column ${i + 1}`).trim());
  const body = rows.slice(1).filter((r) => r.some((c) => c !== '' && c != null));

  const autoMap = (hdrs, data) => {
    const m = {};
    const k = {};
    hdrs.forEach((h, i) => {
      const match = type.fields.find((f) => f.key === slugKey(h) || f.label.toLowerCase() === h.toLowerCase());
      m[i] = match ? match.key : NEW;
      if (!match) k[i] = guessKind(h, data.map((r) => r[i]));
    });
    // Only one ID field allowed.
    if (idField(type)) Object.keys(k).forEach((i) => k[i] === 'id' && (k[i] = 'type'));
    else {
      let seen = false;
      Object.keys(k).forEach((i) => {
        if (k[i] === 'id') {
          if (seen) k[i] = 'type';
          seen = true;
        }
      });
    }
    setMapping(m);
    setNewKinds(k);
  };

  const readFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheets = {};
      for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });
      const first = wb.SheetNames[0];
      setBook({ name: file.name, sheets });
      setSheet(first);
      const r = sheets[first];
      autoMap((r[0] || []).map((h, i) => String(h || `Column ${i + 1}`).trim()), r.slice(1));
    } catch (e) {
      toast(`Could not read that file: ${e.message}`, 'error');
    }
    setBusy(false);
  };

  // Resolve the target field for each mapped column (existing or to-be-created).
  const plan = useMemo(() => {
    const keys = type.fields.map((f) => f.key);
    const created = [];
    const cols = headers.map((h, i) => {
      const target = mapping[i] ?? SKIP;
      if (target === SKIP) return null;
      if (target === NEW) {
        const f = newField(h, newKinds[i] || 'ability', [...keys, ...created.map((c) => c.key)]);
        f.filterable = f.kind === 'type';
        created.push(f);
        return { i, field: f };
      }
      return { i, field: type.fields.find((f) => f.key === target) };
    });
    const fields = [...type.fields, ...created];
    const idf = fields.find((f) => f.kind === 'id');
    const idCol = cols.find((c) => c && idf && c.field.key === idf.key);
    return { cols: cols.filter(Boolean), created, idf, idCol };
  }, [headers, mapping, newKinds, type.fields]);

  const records = useMemo(() => {
    return body
      .map((r) => {
        const data = {};
        for (const { i, field } of plan.cols) {
          let v = r[i] ?? '';
          if (typeof v === 'string') v = v.trim();
          if (field.kind === 'value' && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
          if (field.kind === 'state') v = v ? { of: String(v), name: field.label } : null;
          data[field.key] = v;
        }
        return data;
      })
      .filter((d) => plan.idf && d[plan.idf.key] !== '' && d[plan.idf.key] != null);
  }, [body, plan]);

  const dupes = useMemo(() => {
    if (!plan.idf) return [];
    const seen = new Set();
    const d = new Set();
    for (const r of records) {
      const k = String(r[plan.idf.key]);
      if (seen.has(k)) d.add(k);
      seen.add(k);
    }
    return [...d];
  }, [records, plan.idf]);

  const run = async () => {
    setBusy(true);
    const ok = await attempt(async () => {
      let target = type;
      if (plan.created.length) {
        const fields = [...type.fields, ...plan.created];
        // A brand-new type has nothing on its card yet: start from an automatic layout.
        target = { ...type, fields: type.fields.some((f) => f.layout?.show) ? fields : autoLayout(fields, type.cols, type.rows) };
        await saveType(target);
      }
      const r = await importComponents(target, records, { removeMissing, existing: comps });
      toast(`Imported ${r.written} components${r.removed ? `, removed ${r.removed}` : ''}`, 'ok');
    });
    setBusy(false);
    if (ok) {
      setBook(null);
      onDone();
    }
  };

  return (
    <section className="panel importer">
      <h2>Import a spreadsheet into “{type.name}”</h2>
      <p className="small muted">
        Upload an .xlsx, .xls or .csv file with one component per row and column headers in the first row. Rows are matched by their ID: existing components are updated, new ones are
        added.
      </p>
      <label className="file-drop">
        <Icon name="upload" size={22} />
        <span>{book ? book.name : 'Choose a file…'}</span>
        <input type="file" accept=".xlsx,.xls,.csv,.ods" onChange={(e) => readFile(e.target.files[0])} disabled={busy} />
      </label>

      {book && (
        <>
          {Object.keys(book.sheets).length > 1 && (
            <div className="field">
              <label htmlFor="imp-sheet">Sheet</label>
              <select
                id="imp-sheet"
                value={sheet}
                onChange={(e) => {
                  setSheet(e.target.value);
                  const r = book.sheets[e.target.value];
                  autoMap((r[0] || []).map((h, i) => String(h || `Column ${i + 1}`).trim()), r.slice(1));
                }}
              >
                {Object.keys(book.sheets).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
          )}

          <h3>Map columns to fields</h3>
          <table className="table mapping">
            <thead>
              <tr>
                <th>Column</th>
                <th>Example</th>
                <th>Field</th>
                <th>Kind (new fields)</th>
              </tr>
            </thead>
            <tbody>
              {headers.map((h, i) => (
                <tr key={i}>
                  <td>
                    <b>{h}</b>
                  </td>
                  <td className="muted small clamp">{String(body.find((r) => r[i] !== '')?.[i] ?? '').slice(0, 80)}</td>
                  <td>
                    <select value={mapping[i] ?? SKIP} onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })} aria-label={`Field for ${h}`}>
                      <option value={SKIP}>— skip —</option>
                      <option value={NEW}>+ New field “{h}”</option>
                      {type.fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label} ({FIELD_KINDS[f.kind]?.label})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {mapping[i] === NEW && (
                      <select value={newKinds[i] || 'ability'} onChange={(e) => setNewKinds({ ...newKinds, [i]: e.target.value })} aria-label={`Kind for ${h}`}>
                        {Object.entries(FIELD_KINDS).map(([k, v]) => (
                          <option key={k} value={k} disabled={k === 'id' && (idField(type) || Object.entries(newKinds).some(([j, kk]) => kk === 'id' && Number(j) !== i && mapping[j] === NEW))}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!plan.idCol ? (
            <p className="error">Map a column to the ID field (or create one with kind “ID”) — it is needed to match rows.</p>
          ) : (
            <p className="small">
              <b>{records.length}</b> rows ready{plan.created.length > 0 && `, ${plan.created.length} new field(s) will be added`}.
              {dupes.length > 0 && <span className="error"> Duplicate IDs (the last row wins): {dupes.slice(0, 8).join(', ')}{dupes.length > 8 ? '…' : ''}</span>}
            </p>
          )}
          <label className="check">
            <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} />
            Delete existing “{type.name}” components whose ID is not in this file
          </label>
          <div className="row gap">
            <button className="primary" onClick={run} disabled={busy || !plan.idCol || !records.length}>
              <Icon name="upload" />
              {busy ? 'Importing…' : `Import ${records.length} rows`}
            </button>
            <button onClick={() => setBook(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
