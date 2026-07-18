import { defineEventHandler, setResponseHeader } from 'h3';
import { page, HTML_CONTENT_TYPE } from '../utils/page-template';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return page(
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
  );
});
