import { defineEventHandler, setResponseHeader } from 'h3';
import { page, HTML_CONTENT_TYPE } from '../utils/page-template';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return page(
    'Slow endpoint',
    `<h1>Slow endpoint</h1>
     <p id="status">loading…</p>
     <script>
       Promise.all([fetch('/api/slow'), fetch('/api/users/1'), fetch('/api/users/2')])
         .then(() => { document.getElementById('status').textContent = 'done'; });
     </script>`,
  );
});
