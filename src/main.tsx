import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import AppThemeProvider from './components/AppThemeProvider.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <App />
    </AppThemeProvider>
  </StrictMode>,
);
