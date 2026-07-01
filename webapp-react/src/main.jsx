import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/app.css';
import { tryEnterTelegramFullscreen } from './lib/telegram.js';

tryEnterTelegramFullscreen();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename="/webapp">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
