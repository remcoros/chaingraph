import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyAccentTheme, readAccentTheme } from './lib/accentTheme';
import './styles.css';

applyAccentTheme(readAccentTheme(), false);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
