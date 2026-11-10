import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './style.css';
import { browserLocale } from '../../utils/i18n';

document.documentElement.lang = browserLocale() === 'zh' ? 'zh-CN' : 'en';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
