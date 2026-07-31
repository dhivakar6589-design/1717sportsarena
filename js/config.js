// Central place to change the backend URL later (e.g. when you deploy it online)

// Resolution order:
// 1. If the page set window.__BACKEND_URL__ (inline script in index.html/host.html), use it.
//    This is needed when the frontend is hosted separately from the backend (e.g. Netlify).
// 2. On localhost, default to the local backend.
// 3. Otherwise assume the backend also serves the frontend (same origin — e.g. Render/Railway).
window.__BACKEND_URL__ = window.__BACKEND_URL__
  || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:'
    ? 'http://localhost:4000'
    : window.location.origin);

// Root URL of the backend API
const API_BASE = window.__BACKEND_URL__ + '/api';
// Root URL of the backend, used to build full links for uploaded images
const ASSET_BASE = window.__BACKEND_URL__;