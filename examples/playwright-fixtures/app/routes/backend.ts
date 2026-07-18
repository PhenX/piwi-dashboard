import { defineEventHandler, setResponseHeader } from 'h3';
import { page, HTML_CONTENT_TYPE } from '../utils/page-template';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return page(
    'Backend logs demo',
    `<h1>Backend logs demo</h1>
     <p>Each button calls an API endpoint whose server-side logs ride back on the <code>X-Piwi-Logs</code> response header.</p>
     <button data-testid="load-report">Load report</button>
     <button data-testid="trigger-failure">Trigger backend failure</button>
     <p id="backend-result"></p>
     <script>
       const result = document.getElementById('backend-result');
       document.querySelector('[data-testid="load-report"]').addEventListener('click', async () => {
         const res = await fetch('/api/report');
         result.textContent = res.ok ? 'report loaded' : 'report failed';
       });
       document.querySelector('[data-testid="trigger-failure"]').addEventListener('click', async () => {
         const res = await fetch('/api/failing');
         result.textContent = res.ok ? 'unexpectedly ok' : 'backend failed as expected (' + res.status + ')';
       });
     </script>`,
  );
});
