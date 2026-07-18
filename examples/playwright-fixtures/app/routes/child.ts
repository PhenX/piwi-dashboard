import { defineEventHandler, setResponseHeader } from 'h3';
import { page, HTML_CONTENT_TYPE } from '../utils/page-template';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return page(
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
  );
});
