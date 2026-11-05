import { useEffect, useMemo, useState } from 'react';
import { doc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { setDoc } from '../../lib/store.js';
import { brandCss, brandOf, DEFAULT_BRAND, DEFAULT_COLORS, DEFAULT_FONTS, FONT_CHOICES, fontUrls } from '../../lib/brand.js';
import { useLive } from '../../lib/hooks.js';
import { TextWithPreview } from '../RuleDialogs.jsx';
import WelcomeModal from '../WelcomeModal.jsx';
import { confirmDialog } from '../dialogs.jsx';
import { attempt, Icon } from '../ui.jsx';

const FONT_ROLES = [
  { key: 'display', label: 'Headings', hint: 'The site name, page titles and section headings.' },
  { key: 'text', label: 'Rule text', hint: 'The rules and other long reading.' },
  { key: 'ui', label: 'Interface', hint: 'Buttons, menus, labels and everything else.' },
];
const COLOR_ROLES = [
  { key: 'primary', label: 'Main color', hint: 'Primary buttons, the header mark, active tabs and warnings of danger.' },
  { key: 'accent', label: 'Accent color', hint: 'Links, highlights, focus outlines and headings’ touches.' },
];

/**
 * The owner's site settings: the name and tagline in the header and browser tab, the welcome window
 * (also "About this site"), the disclaimer, and the site's colors and fonts. Colors and fonts
 * preview on the whole site while you edit; nothing changes for others until you save.
 */
export default function BrandAdmin() {
  const saved = useLive(() => doc(db, 'config', 'brand'), []);
  const savedKey = JSON.stringify(saved.data || null);
  const start = useMemo(() => brandOf(saved.data), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [b, setB] = useState(start);
  useEffect(() => setB(start), [start]);
  const [welcome, setWelcome] = useState(false);
  const dirty = JSON.stringify(b) !== JSON.stringify(start);
  const set = (patch) => setB((x) => ({ ...x, ...patch }));
  const setColor = (k, v) => setB((x) => ({ ...x, colors: { ...x.colors, [k]: v } }));
  const setFont = (k, v) => setB((x) => ({ ...x, fonts: { ...x.fonts, [k]: v } }));
  // What the site would look like: the draft over the saved settings.
  const draft = brandOf(b);

  const save = () =>
    attempt(
      () =>
        setDoc(doc(db, 'config', 'brand'), {
          name: b.name.trim(),
          tagline: b.tagline.trim(),
          mark: b.mark.trim(),
          welcomeKicker: b.welcomeKicker.trim(),
          welcomeText: b.welcomeText.trim(),
          welcomeButton: b.welcomeButton.trim(),
          disclaimer: b.disclaimer.trim(),
          colors: draft.colors,
          fonts: Object.fromEntries(Object.entries(b.fonts).map(([k, v]) => [k, v.trim()])),
        }),
      'Site settings saved',
    );
  const resetAll = async () =>
    (await confirmDialog({ title: 'Back to the defaults', message: 'Load the default values into every setting? You can then edit them; nothing is saved until you choose Save.', confirmLabel: 'Use the defaults' })) &&
    setB(brandOf(null));

  return (
    <div className="admin-grid brand-admin">
      {/* Live preview of colors and fonts while editing (this tab only). */}
      {dirty && (
        <>
          {fontUrls(draft.fonts).map((u) => (
            <link key={u} rel="stylesheet" href={u} />
          ))}
          {/* More specific than the saved settings' styles, so the draft wins while editing. */}
          <style>{brandCss(draft).replaceAll(':root', 'html:root')}</style>
        </>
      )}
      <section className="panel span-2">
        <div className="panel-head">
          <h2>Site</h2>
          <div className="row gap">
            <button className="small" onClick={resetAll} title="Load the default values into every setting, to edit or save">
              Defaults
            </button>
            <button className="small" disabled={!dirty} onClick={() => setB(start)}>
              Discard
            </button>
            <button className="small primary" disabled={!dirty} onClick={save}>
              <Icon name="save" />
              Save
            </button>
          </div>
        </div>
        <p className="small muted">
          Owner only. How the site presents itself: its name, the welcome window, the disclaimer, and its colors and fonts. Colors and fonts preview on this page as you
          change them; everyone else sees them once you save.
        </p>
        <div className="brand-preview" aria-label="Header preview">
          <span className="brand-mark" aria-hidden="true">
            {draft.mark}
          </span>
          <span className="brand-text">
            <span className="brand-title">{draft.name}</span>
            {draft.tagline && <span className="brand-sub">{draft.tagline}</span>}
          </span>
        </div>
      </section>

      <section className="panel">
        <h3>Name</h3>
        <div className="form">
          <div className="field">
            <label htmlFor="br-name">Site name</label>
            <input id="br-name" value={b.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} placeholder={DEFAULT_BRAND.name} />
            <p className="hint">In the header, the browser tab, the welcome window and PDF exports.</p>
          </div>
          <div className="field">
            <label htmlFor="br-tagline">Tagline</label>
            <input id="br-tagline" value={b.tagline} onChange={(e) => set({ tagline: e.target.value })} maxLength={80} placeholder="None" />
            <p className="hint">The small line under the name. Leave it empty for none.</p>
          </div>
          <div className="field">
            <label htmlFor="br-mark">Mark</label>
            <input id="br-mark" value={b.mark} onChange={(e) => set({ mark: e.target.value })} maxLength={3} placeholder={DEFAULT_BRAND.mark} className="brand-mark-input" />
            <p className="hint">One or two characters on the colored square in the header: a letter, rune or emoji.</p>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Colors</h3>
        <div className="form">
          {COLOR_ROLES.map((c) => (
            <div key={c.key} className="field">
              <label htmlFor={`br-c-${c.key}`}>
                {c.label}
                {b.colors[c.key] !== DEFAULT_COLORS[c.key] && (
                  <button type="button" className="link-btn small" onClick={() => setColor(c.key, DEFAULT_COLORS[c.key])}>
                    reset
                  </button>
                )}
              </label>
              <div className="row gap">
                <input id={`br-c-${c.key}`} type="color" value={b.colors[c.key]} onChange={(e) => setColor(c.key, e.target.value)} />
                <code>{b.colors[c.key]}</code>
              </div>
              <p className="hint">{c.hint} Lighter and darker shades, and the light theme's version, follow from it.</p>
            </div>
          ))}
        </div>
        <h3>Fonts</h3>
        <div className="form">
          {FONT_ROLES.map((f) => (
            <div key={f.key} className="field">
              <label htmlFor={`br-f-${f.key}`}>
                {f.label}
                {b.fonts[f.key] !== DEFAULT_FONTS[f.key] && (
                  <button type="button" className="link-btn small" onClick={() => setFont(f.key, DEFAULT_FONTS[f.key])}>
                    reset
                  </button>
                )}
              </label>
              <input id={`br-f-${f.key}`} list={`br-fl-${f.key}`} value={b.fonts[f.key]} onChange={(e) => setFont(f.key, e.target.value)} maxLength={40} />
              <datalist id={`br-fl-${f.key}`}>
                {[...new Set([DEFAULT_FONTS[f.key], ...FONT_CHOICES[f.key]])].map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <p className="hint">
                {f.hint} Pick one, or type the name of any{' '}
                <a href="https://fonts.google.com" target="_blank" rel="noreferrer">
                  Google font
                </a>
                . <span style={{ fontFamily: `'${draft.fonts[f.key]}'` }}>The quick brown fox jumps over the lazy dog.</span>
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel span-2">
        <div className="panel-head">
          <h3>Welcome window</h3>
          <button className="small" onClick={() => setWelcome(true)} title="See the welcome window with these settings">
            <Icon name="eye" />
            Preview
          </button>
        </div>
        <p className="small muted">New visitors see it once; everyone can open it again with <i>About this site</i> at the bottom of every page.</p>
        <div className="form">
          <div className="grid-2">
            <div className="field">
              <label htmlFor="br-kicker">Line above the name</label>
              <input id="br-kicker" value={b.welcomeKicker} onChange={(e) => set({ welcomeKicker: e.target.value })} maxLength={80} placeholder="None" />
            </div>
            <div className="field">
              <label htmlFor="br-button">Button</label>
              <input id="br-button" value={b.welcomeButton} onChange={(e) => set({ welcomeButton: e.target.value })} maxLength={40} placeholder={DEFAULT_BRAND.welcomeButton} />
            </div>
          </div>
          <TextWithPreview value={b.welcomeText} onChange={(v) => set({ welcomeText: v })} label="Text (empty: the default text)" rows={10} required={false} />
        </div>
      </section>

      <section className="panel span-2">
        <h3>Disclaimer</h3>
        <div className="form">
          <div className="field">
            <label htmlFor="br-disclaimer">Footer disclaimer</label>
            <textarea id="br-disclaimer" rows={2} value={b.disclaimer} onChange={(e) => set({ disclaimer: e.target.value })} maxLength={500} placeholder="Empty: the default disclaimer" />
            <p className="hint">Shown at the bottom of every page and beside the rules. Plain text; web addresses become links.</p>
          </div>
        </div>
      </section>

      {welcome && <WelcomeModal brand={draft} onClose={() => setWelcome(false)} />}
    </div>
  );
}
