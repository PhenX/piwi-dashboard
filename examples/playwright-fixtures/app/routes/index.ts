import { defineEventHandler, setResponseHeader } from 'h3';
import { page, HTML_CONTENT_TYPE } from '../utils/page-template';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return page(
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
  );
});
