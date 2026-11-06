import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const demo = (file) => fileURLToPath(new URL(`./src/demo/${file}`, import.meta.url));

// `vite --mode demo` swaps the Firebase SDK for an in-browser fake (src/demo),
// so the site can be previewed and tested without a Firebase project.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  resolve: {
    alias:
      mode === 'demo'
        ? [
            { find: /^firebase\/app$/, replacement: demo('app.js') },
            { find: /^firebase\/auth$/, replacement: demo('auth.js') },
            { find: /^firebase\/firestore$/, replacement: demo('firestore.js') },
            { find: /^firebase\/app-check$/, replacement: demo('app-check.js') },
          ]
        : [],
  },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    chunkSizeWarningLimit: 2000,
  },
}));
