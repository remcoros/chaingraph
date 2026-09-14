import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App/App';
import { applyAccentTheme, readAccentTheme } from './App/accentTheme';
import './App/styles.css';

applyAccentTheme(readAccentTheme(), false);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
