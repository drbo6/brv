import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './theme-light.css';
import { applyTheme } from './lib/theme.js';

// Set the theme before the first paint, so there is no flash of the wrong colors.
applyTheme();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
