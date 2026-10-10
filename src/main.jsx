import React from 'react'
import ReactDOM from 'react-dom/client'
import House from './House.jsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <House />
  </React.StrictMode>,
)
