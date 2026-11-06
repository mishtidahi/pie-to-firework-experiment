import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { CaptchaApp } from './sequences/captcha/CaptchaApp';
import './styles.css';

/** ?scene=captcha → the "Select Joy" CAPTCHA sequence; anything else → the spinner (default). */
const SCENE = new URLSearchParams(window.location.search).get('scene');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {SCENE === 'captcha' ? <CaptchaApp /> : <App />}
  </StrictMode>,
);
