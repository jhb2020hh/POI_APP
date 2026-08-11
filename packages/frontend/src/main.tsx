import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initAuth } from './api/client'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service Worker Registrierung fehlgeschlagen:', err)
    })
  })
}

// Die gespeicherte Sitzung wird eingelesen, bevor die App zum ersten Mal
// rendert. Sonst waere beim Neuladen kurz kein Token vorhanden und die App
// wuerde faelschlich den Anmeldebildschirm zeigen.
//
// Bewusst als .then() und nicht als top-level await: mit einem await auf
// oberster Ebene wird das Einstiegsmodul zu einem asynchronen Modul, und der
// Build hat dabei den kompletten Anwendungscode aus dem Bundle verloren.
initAuth().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
