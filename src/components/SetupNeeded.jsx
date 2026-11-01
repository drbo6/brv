export default function SetupNeeded() {
  return (
    <main className="setup-needed">
      <h1>Almost there</h1>
      <p>This site needs a Firebase project to store rules, rulesets and discussions.</p>
      <ol>
        <li>Create a Firebase project, enable Google sign-in and Cloud Firestore.</li>
        <li>
          Paste the web app config into <code>src/firebase-config.js</code>, or set the <code>VITE_FIREBASE_*</code> repository variables.
        </li>
        <li>
          Deploy <code>firestore.rules</code>.
        </li>
      </ol>
      <p>
        The README has step-by-step instructions. To try the site without Firebase, run <code>npm run demo</code>.
      </p>
    </main>
  );
}
