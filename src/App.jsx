import { Component, lazy, Suspense, useEffect, useState } from 'react';
import { configured, isDemo } from './lib/firebase.js';
import { useLocalStorage } from './lib/hooks.js';
import { href, useRoute } from './lib/router.js';
import { SessionProvider, useSession } from './lib/session.jsx';
import { Avatar, Icon, Spinner } from './components/ui.jsx';
import WelcomeModal from './components/WelcomeModal.jsx';
import SetupNeeded from './components/SetupNeeded.jsx';
import RulesPage from './pages/RulesPage.jsx';

// Heavier, less-visited pages load on demand.
const ComponentsPage = lazy(() => import('./pages/ComponentsPage.jsx'));
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));

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
  const { user, isAdmin } = useSession();
  const [welcomeSeen, setWelcomeSeen] = useLocalStorage('brv-welcome-seen', false);
  const [showWelcome, setShowWelcome] = useState(!welcomeSeen);

  useEffect(() => {
    const titles = { rules: 'Rules', components: 'Components', account: 'Account', admin: 'Admin' };
    document.title = `${titles[route.page] || 'Rules'} · Blood Rage Valhalla: Unofficial Living Rulebook`;
  }, [route.page]);

  const closeWelcome = () => {
    setWelcomeSeen(true);
    setShowWelcome(false);
  };

  const nav = [
    { page: 'rules', label: 'Rules', icon: 'book' },
    { page: 'components', label: 'Components', icon: 'grid' },
    isAdmin && { page: 'admin', label: 'Admin', icon: 'shield' },
  ].filter(Boolean);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href={href('rules')}>
          <span className="brand-mark" aria-hidden="true">
            ᚱ
          </span>
          <span className="brand-text">
            <span className="brand-title">Blood Rage Valhalla</span>
            <span className="brand-sub">Unofficial Living Rulebook</span>
          </span>
        </a>
        <nav className="main-nav" aria-label="Main">
          {nav.map((n) => (
            <a key={n.page} href={href(n.page)} className={route.page === n.page ? 'active' : ''} aria-current={route.page === n.page ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span className="nav-label">{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => setShowWelcome(true)} title="About this site" aria-label="About this site">
            <Icon name="info" size={18} />
          </button>
          <a className={`account-link ${route.page === 'account' ? 'active' : ''}`} href={href('account')}>
            {user ? <Avatar name={user.displayName} photo={user.photoURL} size={26} /> : <Icon name="user" />}
            <span className="nav-label">{user ? 'Account' : 'Log in'}</span>
          </a>
        </div>
      </header>
      {isDemo && (
        <div className="demo-banner">
          Demo mode — data is stored only in this browser. Sign in with the name “Admin” to try the admin tools.
        </div>
      )}
      <main id="main">
        <ErrorBoundary key={route.page}>
        <Suspense fallback={<Spinner />}>
          {route.page === 'components' ? (
            <ComponentsPage route={route} />
          ) : route.page === 'account' ? (
            <AccountPage />
          ) : route.page === 'admin' ? (
            <AdminPage route={route} />
          ) : (
            <RulesPage route={route} />
          )}
        </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="site-footer">
        <p>
          A fan-made, community-maintained resource. Not affiliated with or endorsed by the publishers of Blood Rage or Blood Rage: Valhalla. Rules text © its respective owners.
        </p>
        <button className="link-btn" onClick={() => setShowWelcome(true)}>
          About this site
        </button>
      </footer>
      {showWelcome && <WelcomeModal onClose={closeWelcome} />}
    </>
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
