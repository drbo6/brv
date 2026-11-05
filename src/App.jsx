import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { configured, isDemo } from './lib/firebase.js';
import { useLocalStorage } from './lib/hooks.js';
import { href, useRoute } from './lib/router.js';
import { ROLES, SessionProvider, useSession } from './lib/session.jsx';
import { noteStylesOf } from './lib/rules.js';
import { brandCss, fontUrls } from './lib/brand.js';
import { useHistory, useUndoKeys } from './lib/history.js';
import { Avatar, Disclaimer, Icon, redoWithToast, Spinner, toast, undoWithToast } from './components/ui.jsx';
import WelcomeModal from './components/WelcomeModal.jsx';
import { ActiveRulesetProvider, RulesetBar } from './components/ActiveRuleset.jsx';
import { DialogHost } from './components/dialogs.jsx';
import ProfileDialog from './components/ProfileDialog.jsx';
import Tooltips from './components/Tooltips.jsx';
import { useTheme } from './lib/theme.js';
import { useLive } from './lib/hooks.js';
import { unreadQuery } from './lib/inbox.js';
import SetupNeeded from './components/SetupNeeded.jsx';
import RulesPage from './pages/RulesPage.jsx';

// Heavier, less-visited pages load on demand.
const ComponentsPage = lazy(() => import('./pages/ComponentsPage.jsx'));
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const HelpPage = lazy(() => import('./pages/HelpPage.jsx'));
const InboxPage = lazy(() => import('./pages/InboxPage.jsx'));

export default function App() {
  if (!configured) return <SetupNeeded />;
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  const route = useRoute();
  const { user, isEditor, realUser, realRole, role, previewing, setViewAs, profileOpen, brand } = useSession();
  const history = useHistory();
  const theme = useTheme();
  useUndoKeys(useCallback((kind, label) => toast(`${kind === 'undo' ? 'Undone' : 'Redone'}: ${label}`, 'ok'), []));
  const lowerRoles = Object.keys(ROLES).slice(Object.keys(ROLES).indexOf(realRole));
  const [welcomeSeen, setWelcomeSeen] = useLocalStorage('brv-welcome-seen', false);
  const [showWelcome, setShowWelcome] = useState(!welcomeSeen);

  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    const titles = { rules: 'Rules', components: 'Components', account: 'Account', admin: 'Admin', help: 'Help', inbox: 'Inbox' };
    // The unread count shows in the browser tab too.
    document.title = `${unreadCount ? `(${unreadCount}) ` : ''}${titles[route.page] || 'Rules'} · ${brand.name}${brand.tagline ? `: ${brand.tagline}` : ''}`;
  }, [route.page, unreadCount, brand.name, brand.tagline]);

  const closeWelcome = () => {
    setWelcomeSeen(true);
    setShowWelcome(false);
  };

  const nav = [
    { page: 'rules', label: 'Rules', icon: 'book', tip: 'The rules, with versions, discussion and rulesets' },
    { page: 'components', label: 'Components', icon: 'grid', tip: 'Browse the cards and other components' },
    isEditor && { page: 'admin', label: 'Admin', icon: 'shield', tip: 'Manage content, rulesets, people and backups' },
    { page: 'help', label: 'Help', icon: 'help', tip: 'How everything on this site works' },
  ].filter(Boolean);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href={href('rules')}>
          <span className="brand-mark" aria-hidden="true">
            {brand.mark}
          </span>
          <span className="brand-text">
            <span className="brand-title">{brand.name}</span>
            {brand.tagline && <span className="brand-sub">{brand.tagline}</span>}
          </span>
        </a>
        <nav className="main-nav" aria-label="Main">
          {nav.map((n) => (
            <a key={n.page} href={href(n.page)} className={route.page === n.page ? 'active' : ''} aria-current={route.page === n.page ? 'page' : undefined} title={n.tip}>
              <Icon name={n.icon} />
              <span className="nav-label">{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="header-actions">
          {realUser && (
            <div className="history-btns" role="group" aria-label="Undo history">
              <button
                className="icon-btn"
                onClick={() => undoWithToast()}
                disabled={!history.undo || history.busy}
                title={history.undo ? `Undo: ${history.undo.label} (Ctrl+Z)` : 'Nothing to undo'}
                aria-label={history.undo ? `Undo: ${history.undo.label}` : 'Nothing to undo'}
              >
                <Icon name="undo" size={18} />
              </button>
              {history.redo && (
                <button className="icon-btn" onClick={() => redoWithToast()} disabled={history.busy} title={`Redo: ${history.redo.label} (Ctrl+Shift+Z)`} aria-label={`Redo: ${history.redo.label}`}>
                  <Icon name="redo" size={18} />
                </button>
              )}
            </div>
          )}
          {user && <InboxLink uid={user.uid} active={route.page === 'inbox'} onCount={setUnreadCount} />}
          {lowerRoles.length > 1 && <ViewAsMenu roles={lowerRoles} role={role} realRole={realRole} previewing={previewing} setViewAs={setViewAs} />}
          <button
            className="icon-btn theme-btn"
            onClick={theme.toggle}
            title={`Switch to ${theme.theme === 'light' ? 'dark' : 'light'} mode${theme.following ? ' (now following your system setting)' : ''}`}
            aria-label={`Switch to ${theme.theme === 'light' ? 'dark' : 'light'} mode`}
          >
            <Icon name={theme.theme === 'light' ? 'moon' : 'sun'} size={18} />
          </button>
          <button className="icon-btn about-btn" onClick={() => setShowWelcome(true)} title="About this site" aria-label="About this site">
            <Icon name="info" size={18} />
          </button>
          <a className={`account-link ${route.page === 'account' ? 'active' : ''}`} href={href('account')}>
            {user ? <Avatar name={user.displayName} avatar={user.avatar} size={26} /> : <Icon name="user" />}
            <span className="nav-label">{user ? 'Account' : 'Log in'}</span>
          </a>
        </div>
      </header>
      {previewing && (
        <div className="preview-banner" role="status">
          <Icon name="eye" />
          <span>
            Previewing the site as {role === 'visitor' ? 'a visitor who is not signed in' : 'a signed-in user without admin rights'}.
          </span>
          <button className="small" onClick={() => setViewAs(null)}>
            Stop previewing
          </button>
        </div>
      )}
      {isDemo && (
        <div className="demo-banner">
          Demo mode — data is stored only in this browser. Sign in with the name “Admin” to try the admin tools.
        </div>
      )}
      <ActiveRulesetProvider route={route}>
      {(route.page === 'rules' || route.page === 'components') && <RulesetBar page={route.page} />}
      <main id="main">
        <ErrorBoundary key={route.page}>
        <Suspense fallback={<Spinner />}>
          {route.page === 'components' ? (
            <ComponentsPage route={route} />
          ) : route.page === 'account' ? (
            <AccountPage />
          ) : route.page === 'admin' ? (
            <AdminPage route={route} />
          ) : route.page === 'help' ? (
            <HelpPage route={route} />
          ) : route.page === 'inbox' ? (
            <InboxPage route={route} />
          ) : (
            <RulesPage route={route} />
          )}
        </Suspense>
        </ErrorBoundary>
      </main>
      </ActiveRulesetProvider>
      <footer className="site-footer">
        <p>
          <Disclaimer />
        </p>
        <button className="link-btn" onClick={() => setShowWelcome(true)}>
          About this site
        </button>
      </footer>
      {showWelcome && <WelcomeModal onClose={closeWelcome} />}
      {profileOpen && user && <ProfileDialog />}
      <DialogHost />
      <Tooltips />
      <BoxStyles />
      <BrandStyles />
    </>
  );
}

/** The owner's colors and fonts (Admin → Site), over the stylesheet's defaults. */
function BrandStyles() {
  const { brand } = useSession();
  const urls = fontUrls(brand.fonts);
  return (
    <>
      {urls.map((u) => (
        <link key={u} rel="stylesheet" href={u} />
      ))}
      <style>{brandCss(brand)}</style>
    </>
  );
}

const ROLE_HINTS = {
  owner: 'Everything; can’t be demoted',
  admin: 'Content and people management',
  editor: 'All content, no people management',
  user: 'Signed in, without admin rights: react, discuss, suggest',
  visitor: 'Not signed in: read only',
};

/** Pick a lower role to preview the site with. */
function ViewAsMenu({ roles, role, realRole, previewing, setViewAs }) {
  const ref = useRef(null);
  const close = () => ref.current?.removeAttribute('open');
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
  return (
    <details ref={ref} className={`menu view-as ${previewing ? 'on' : ''}`}>
      <summary className="view-as-btn" title="See the site as someone with less access" aria-label={`Viewing as ${ROLES[role]}. Change`}>
        <Icon name="eye" />
        <span className="view-as-label">{previewing ? `As ${ROLES[role].toLowerCase()}` : 'View as'}</span>
        <Icon name="chevronDown" size={14} />
      </summary>
      <div className="menu-pop view-as-pop" role="menu">
        <p className="menu-title">View the site as</p>
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            role="menuitemradio"
            aria-checked={r === role}
            className={`menu-item ${r === role ? 'on' : ''}`}
            onClick={() => {
              setViewAs(r === realRole ? null : r);
              close();
            }}
          >
            <Icon name={r === role ? 'check' : r === 'user' ? 'user' : r === 'visitor' ? 'eye' : r === 'editor' ? 'edit' : 'shield'} />
            <span>
              <b>
                {ROLES[r]}
                {r === realRole ? ' (you)' : ''}
              </b>
              <span className="small muted">{ROLE_HINTS[r]}</span>
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

// A CSS string literal: backslashes and quotes escaped, line breaks flattened.
const cssString = (s) => `"${String(s || '').replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')}"`;

/** The note box presets (Admin → Rules → Notes) as CSS: each box-n gets its colour and default heading. */
function BoxStyles() {
  const { site } = useSession();
  const css = noteStylesOf(site)
    .map((s, i) => {
      const color = /^#[0-9a-f]{3,8}$/i.test(s.color || '') ? s.color : '#9c9087';
      return `.box-${i + 1}{--box:${color};--box-label:${cssString(s.label)}}${s.label ? '' : `.box-${i + 1}::before{display:none}`}`;
    })
    .join('');
  return <style>{css}</style>;
}

/** Header bell with the number of unread notices. */
function InboxLink({ uid, active, onCount }) {
  const unread = useLive(() => unreadQuery(uid), [uid]);
  const n = unread.data?.length || 0;
  useEffect(() => {
    onCount(n);
    return () => onCount(0);
  }, [n, onCount]);
  return (
    <a className={`icon-btn inbox-link ${active ? 'active' : ''}`} href={href('inbox')} title={n ? `Inbox: ${n} unread notice${n === 1 ? '' : 's'}` : 'Inbox: nothing new'} aria-label={n ? `Inbox, ${n} unread` : 'Inbox'}>
      <Icon name={n ? 'bellRing' : 'bell'} size={18} />
      {n > 0 && <span className="badge">{n > 99 ? '99+' : n}</span>}
    </a>
  );
}

/** Keeps one broken page from blanking the whole site. */
class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page narrow">
        <div className="empty">
          <h3>Something went wrong on this page</h3>
          <p>{String(this.state.error.message || this.state.error)}</p>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </div>
    );
  }
}
