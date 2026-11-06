import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from 'firebase/app-check';
import { firebaseConfig as fileConfig } from '../firebase-config.js';

const env = import.meta.env;

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || fileConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || fileConfig.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || fileConfig.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || fileConfig.storageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || fileConfig.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || fileConfig.appId,
};

export const isDemo = env.MODE === 'demo';
export const configured = isDemo || Boolean(config.apiKey && config.projectId);

let app = null;
let auth = null;
let db = null;
if (configured) {
  app = initializeApp(config);
  // App Check: with a reCAPTCHA site key, the database only answers this website (once App Check is
  // enforced in the Firebase console), not scripts that copied the project's settings.
  const siteKey = env.VITE_RECAPTCHA_SITE_KEY;
  if (siteKey && !isDemo) {
    // Local development: a debug token, registered in the Firebase console, stands in for reCAPTCHA.
    if (env.DEV) self.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN || true;
    const Provider = env.VITE_RECAPTCHA_ENTERPRISE === 'true' ? ReCaptchaEnterpriseProvider : ReCaptchaV3Provider;
    initializeAppCheck(app, { provider: new Provider(siteKey), isTokenAutoRefreshEnabled: true });
  }
  auth = getAuth(app);
  // A cache in the browser: coming back to the site (or reloading) within half an hour only reads
  // what changed, which keeps the free plan's daily reads for more visitors.
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    db = initializeFirestore(app, {});
  }
}

export { app, auth, db };
