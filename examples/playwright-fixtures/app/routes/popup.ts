import { defineEventHandler, setResponseHeader } from 'h3';
import { page, HTML_CONTENT_TYPE } from '../utils/page-template';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return page(
    'Popup launcher',
    `<h1>Popup launcher</h1>
     <button data-testid="open-child">Open child window</button>
     <script>
       document.querySelector('[data-testid="open-child"]').addEventListener('click', () => {
         window.open('/child', '_blank');
       });
     </script>`,
  );
});
