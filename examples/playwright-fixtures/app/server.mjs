/**
 * Tiny dependency-free web app used as the system under test.
 *
 * Pages exercise every capture path of the Piwi Dashboard fixtures:
 * API calls (fetch + XHR), console output, a popup window, labeled form
 * fields, a slow endpoint, and parameterized routes.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 4173);

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 40rem; padding: 0 1rem; }
    nav a { margin-right: 1rem; }
    label { display: block; margin-top: 0.75rem; }
    input, textarea, select { display: block; margin-top: 0.25rem; width: 100%; max-width: 24rem; }
    button { margin-top: 1rem; }
  </style>
</head>
<body>
  <nav><a href="/">Home</a><a href="/form">Form</a><a href="/popup">Popup</a><a href="/slow">Slow</a></nav>
  ${body}
</body>
</html>`;

const PAGES = {
  '/': page(
    'Piwi fixtures demo',
    `<h1>Piwi fixtures demo</h1>
     <p>A small app exercised by the example Playwright suite.</p>
     <button data-testid="load-items">Load items</button>
     <ul id="items"></ul>
     <script>
       console.warn('demo: home page loaded');
       document.querySelector('[data-testid="load-items"]').addEventListener('click', async () => {
         const items = await (await fetch('/api/items')).json();
         document.getElementById('items').innerHTML = items.map((i) => '<li>' + i.name + '</li>').join('');
       });
     </script>`,
  ),

  '/form': page(
    'Contact form',
    `<h1>Contact form</h1>
     <form id="contact">
       <label for="email">Email</label>
       <input id="email" name="email" type="email">
       <label for="message">Message</label>
       <textarea id="message" name="message"></textarea>
       <label for="priority">Priority</label>
       <select id="priority" name="priority">
         <option value="low">Low</option>
         <option value="high">High</option>
       </select>
       <button type="submit">Send</button>
     </form>
     <p id="result"></p>
     <script>
       document.getElementById('contact').addEventListener('submit', (event) => {
         event.preventDefault();
         const email = document.getElementById('email').value;
         if (!email) {
           console.error('demo: email is required');
           return;
         }
         const xhr = new XMLHttpRequest();
         xhr.open('POST', '/api/submit');
         xhr.setRequestHeader('Content-Type', 'application/json');
         xhr.onload = () => { document.getElementById('result').textContent = 'Sent!'; };
         xhr.send(JSON.stringify({ email }));
       });
     </script>`,
  ),

  '/popup': page(
    'Popup launcher',
    `<h1>Popup launcher</h1>
     <button data-testid="open-child">Open child window</button>
     <script>
       document.querySelector('[data-testid="open-child"]').addEventListener('click', () => {
         window.open('/child', '_blank');
       });
     </script>`,
  ),

  '/child': page(
    'Child window',
    `<h1>Child window</h1>
     <button data-testid="child-action">Child action</button>
     <p id="child-result"></p>
     <script>
       console.warn('demo: child window opened');
       document.querySelector('[data-testid="child-action"]').addEventListener('click', async () => {
         await fetch('/api/child');
         document.getElementById('child-result').textContent = 'child done';
       });
     </script>`,
  ),

  '/slow': page(
    'Slow endpoint',
    `<h1>Slow endpoint</h1>
     <p id="status">loading…</p>
     <script>
       Promise.all([fetch('/api/slow'), fetch('/api/users/1'), fetch('/api/users/2')])
         .then(() => { document.getElementById('status').textContent = 'done'; });
     </script>`,
  ),
};

const json = (res, body, delayMs = 0) => {
  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }, delayMs);
};

createServer((req, res) => {
  const path = new URL(req.url, `http://localhost:${PORT}`).pathname;

  if (PAGES[path]) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(PAGES[path]);
  }
  if (path === '/api/items') return json(res, [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }]);
  if (path === '/api/submit' && req.method === 'POST') return json(res, { ok: true });
  if (path === '/api/slow') return json(res, { ok: true }, 800);
  if (path === '/api/child') return json(res, { ok: true });
  if (path === '/api/before-all-marker') return json(res, { ok: true });
  const userMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userMatch) return json(res, { id: Number(userMatch[1]), name: `User ${userMatch[1]}` });

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}).listen(PORT, () => {
  console.log(`Demo app listening on http://localhost:${PORT}`);
});
