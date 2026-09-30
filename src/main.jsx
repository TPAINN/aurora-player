import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './aurora-player.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Offline shell unavailable:', error.message))
  })
}

if (new URLSearchParams(window.location.search).has("audit")) {
  const script = document.createElement("script"); script.src = "/audit.js"; script.type = "module"; document.head.append(script);
}
