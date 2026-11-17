import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Las dos familias de la marca (ver `mobile/lib/theme.ts`): Figtree para el
// texto, Baloo 2 para el nombre. Se sirven desde node_modules, no desde Google
// Fonts: el portal tiene que abrir en la tienda aunque la conexión esté mal.
import '@fontsource-variable/figtree'
import '@fontsource-variable/baloo-2'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
