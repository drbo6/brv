import { useEffect, useMemo, useState } from 'react';
import { AVATAR_COLORS, glyphChoices, NAME_RULES, nameAvailable, nameProblem, saveProfile, useProfiles } from '../lib/profiles.js';
import { useSession } from '../lib/session.jsx';
import { useDebounced } from '../lib/hooks.js';
import { attempt, Avatar, Icon, Modal } from './ui.jsx';

const HTTPS = /^https:\/\/\S+$/i;

/**
 * Choose a username and avatar. New users see this right after their first sign-in and can't
 * skip it (only sign out); everyone can open it again from the Account page.
 */
export default function ProfileDialog() {
  const { user, needsProfile, closeProfile, signOut } = useSession();
  const [name, setName] = useState(user.displayName || '');
  // Emoji that other people already use are left out of the choices.
  const profiles = useProfiles();
  const used = useMemo(() => new Set([...profiles].filter(([uid, p]) => uid !== user.uid && p.avatar?.glyph).map(([, p]) => p.avatar.glyph)), [profiles, user.uid]);
  const [choices, setChoices] = useState(() => glyphChoices(used, user.avatar?.glyph));
  const [avatar, setAvatar] = useState(() => user.avatar || { glyph: choices[0], color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] });
  // The emoji choice is kept while trying out pictures, so switching back restores it.
  const [lastGlyph, setLastGlyph] = useState(() => (avatar.glyph ? avatar : { glyph: choices[0], color: AVATAR_COLORS[0] }));
  const [mode, setMode] = useState(() => (!user.avatar?.photo ? 'emoji' : user.avatar.photo === user.googlePhoto ? 'google' : 'url'));
  const [url, setUrl] = useState(() => (mode === 'url' ? user.avatar.photo : ''));
  const [urlBroken, setUrlBroken] = useState(false);
  const urlValid = HTTPS.test(url.trim());
  const reshuffle = () => setChoices(glyphChoices(used, avatar.glyph));
  // Profiles load live: if one of the offered emoji turns out to be taken, draw again.
  useEffect(() => {
    setChoices((list) => (list.some((g) => used.has(g) && g !== lastGlyph.glyph) ? glyphChoices(used, lastGlyph.glyph) : list));
  }, [used]); // eslint-disable-line react-hooks/exhaustive-deps
  const setGlyph = (a) => {
    setAvatar(a);
    setLastGlyph(a);
  };
  const pickMode = (m) => {
    setMode(m);
    if (m === 'emoji') setAvatar(lastGlyph);
    else if (m === 'google') setAvatar({ photo: user.googlePhoto });
    else setAvatar({ photo: urlValid ? url.trim() : '' });
  };
  const [taken, setTaken] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = nameProblem(name);
  const checkName = useDebounced(name.trim(), 300);

  useEffect(() => {
    if (nameProblem(checkName)) return undefined;
    let live = true;
    setChecking(true);
    nameAvailable(checkName, user.uid)
      .then((free) => live && setTaken(!free))
      .catch(() => live && setTaken(false))
      .finally(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [checkName, user.uid]);

  const stale = checkName !== name.trim();
  const avatarOk = mode !== 'url' || (urlValid && !urlBroken);
  const canSave = !problem && !taken && !checking && !stale && !busy && avatarOk;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    // Check again right before saving: someone may have taken the name meanwhile.
    if (!(await nameAvailable(name, user.uid))) {
      setTaken(true);
      return setBusy(false);
    }
    const ok = await attempt(() => saveProfile(user.uid, { name, avatar }, user.displayName), needsProfile ? `Welcome, ${name.trim()}!` : 'Profile saved');
    setBusy(false);
    if (ok) closeProfile();
  };

  const isPhoto = Boolean(avatar.photo);
  return (
    <Modal title={needsProfile ? 'Welcome! Set up your profile' : 'Your profile'} onClose={needsProfile ? undefined : closeProfile} className="profile-dialog">
      <form className="form" onSubmit={submit}>
        {needsProfile && (
          <p className="muted">
            Choose the name and picture others see when you comment, react or suggest changes. Your email address and Google name stay private: they are never shown to anyone.
          </p>
        )}
        <div className="profile-preview">
          <Avatar name={name} avatar={avatar.photo === '' ? null : avatar} size={64} />
          <div>
            <b>{name.trim() || 'Your username'}</b>
            <p className="small muted">This is how others see you.</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="pf-name">Username</label>
          <input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_RULES.max} autoComplete="nickname" aria-invalid={Boolean(name && (problem || taken))} autoFocus />
          <p className={`hint ${name && (problem || taken) ? 'error' : ''}`}>
            {!name
              ? `${NAME_RULES.min}–${NAME_RULES.max} characters. Must be unique.`
              : problem || (taken ? 'Someone already uses this name.' : checking || stale ? 'Checking…' : 'Available.')}
          </p>
        </div>

        <fieldset className="field avatar-picker">
          <legend>Avatar</legend>
          <div className="seg avatar-modes">
            <button type="button" className={mode === 'emoji' ? 'on' : ''} onClick={() => pickMode('emoji')}>
              Emoji
            </button>
            <button type="button" className={mode === 'url' ? 'on' : ''} onClick={() => pickMode('url')} title="Use a picture hosted on another site">
              Image from the web
            </button>
            {user.googlePhoto && (
              <button type="button" className={mode === 'google' ? 'on' : ''} onClick={() => pickMode('google')} title="Others will see your Google profile picture">
                Google picture
              </button>
            )}
          </div>

          {mode === 'emoji' && (
            <>
              <div className="glyph-grid" role="radiogroup" aria-label="Emoji">
                {choices.map((g) => (
                  <button
                    key={g}
                    type="button"
                    role="radio"
                    aria-checked={avatar.glyph === g}
                    className={`glyph ${avatar.glyph === g ? 'on' : ''}`}
                    onClick={() => setGlyph({ glyph: g, color: avatar.color || AVATAR_COLORS[0] })}
                    title={used.has(g) ? 'Someone else uses this one too' : undefined}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <div className="row gap wrap avatar-row">
                <button type="button" className="small" onClick={reshuffle} title="Show a different random selection (emoji nobody else uses)">
                  <Icon name="flip" />
                  Other emoji
                </button>
                <div className="color-grid" role="radiogroup" aria-label="Background color">
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={avatar.color === c}
                      aria-label={`Color ${c}`}
                      title="Background color"
                      className={`swatch ${avatar.color === c ? 'on' : ''}`}
                      style={{ background: c }}
                      onClick={() => setGlyph({ glyph: avatar.glyph, color: c })}
                    />
                  ))}
                </div>
              </div>
              <p className="hint">Only emoji nobody else has picked are offered, so your avatar stays recognizable.</p>
            </>
          )}

          {mode === 'url' && (
            <div className="field">
              <label htmlFor="pf-url">Image address</label>
              <input
                id="pf-url"
                value={url}
                placeholder="https://…/my-picture.png"
                aria-invalid={Boolean(url && (!urlValid || urlBroken))}
                onChange={(e) => {
                  const v = e.target.value;
                  setUrl(v);
                  setUrlBroken(false);
                  setAvatar({ photo: HTTPS.test(v.trim()) ? v.trim() : '' });
                }}
              />
              {urlValid && <img className="avatar-probe" src={url.trim()} alt="" referrerPolicy="no-referrer" onError={() => setUrlBroken(true)} onLoad={() => setUrlBroken(false)} />}
              <p className={`hint ${url && (!urlValid || urlBroken) ? 'error' : ''}`}>
                {!url
                  ? 'A square picture works best. It stays on its own site; use an https address.'
                  : !urlValid
                    ? 'Use an address starting with https://'
                    : urlBroken
                      ? 'That image could not be loaded.'
                      : 'Looks good.'}
              </p>
            </div>
          )}

          {mode === 'google' && <p className="hint">Others will see the picture from your Google account. Your email address and Google name stay private.</p>}
        </fieldset>

        <div className="modal-actions">
          {needsProfile ? (
            <button type="button" onClick={signOut} title="Leave without creating a profile">
              Sign out
            </button>
          ) : (
            <button type="button" onClick={closeProfile}>
              Cancel
            </button>
          )}
          <button type="submit" className="primary" disabled={!canSave}>
            {needsProfile ? 'Save and continue' : 'Save profile'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
