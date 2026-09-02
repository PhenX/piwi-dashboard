/**
 * Self-contained fake "app-under-test" pages used to record demo evidence.
 *
 * Both `record-demo-media.mjs` (traces + videos) and `take-demo-screenshots.mjs`
 * (PNGs) serve these pages from a throwaway local HTTP server and drive a real
 * headless browser against them — never a real application, since traces embed
 * full page snapshots. Each page mirrors one of the failure stories in
 * `shared/demo/failure-stories.mjs` closely enough (headings, field labels,
 * button names) that the captured evidence reads as "the same app" as the
 * error text and locator-healing snapshots the seed generator produces for
 * that story, without needing to literally run the seeded test suite.
 *
 * Every page is a small standalone HTML document — no external fonts/scripts,
 * inline CSS only — so recordings stay tiny and reproducible offline.
 */

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; background: #f4f4f5; color: #18181b; }
  .card { max-width: 420px; margin: 32px auto; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  h1 { font-size: 18px; margin: 0 0 16px; }
  label { display: block; font-size: 13px; color: #52525b; margin: 12px 0 4px; }
  input, select { width: 100%; padding: 8px 10px; border: 1px solid #d4d4d8; border-radius: 6px; font-size: 14px; }
  button { border: 0; border-radius: 6px; padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
  button.primary { background: #18181b; color: #fff; }
  button.primary:disabled { background: #a1a1aa; cursor: default; }
  .hint { font-size: 12px; color: #71717a; margin-top: 8px; }
  .success { padding: 12px; border-radius: 8px; background: #f0fdf4; color: #15803d; font-size: 14px; font-weight: 600; }
`;

const page = (title, bodyCss, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${BASE_CSS}${bodyCss}</style>
</head>
<body>
${body}
</body>
</html>`;

// ── Checkout (project 1, story C1 "checkout-pay-timeout" / C2 "checkout-email-renamed") ──

/**
 * The interactive checkout form. `pending` wires the Pay button to a
 * `/api/quote` fetch that the recording server holds open forever, so the
 * button never becomes enabled — a real, reproducible `locator.click` timeout.
 * `contactRestructured` swaps the labeled email field for the combobox +
 * aria-labeled input shape from the "renamed label" story.
 */
export function checkoutFormPage({ pending = false, contactRestructured = false, confirmed = false } = {}) {
  if (confirmed) {
    return page(
      'Acme Shop — Checkout',
      '',
      `<div class="card">
        <h1>Checkout</h1>
        <div class="success">Order confirmed</div>
        <p class="hint">Confirmation sent to buyer@example.com</p>
      </div>`,
    );
  }

  const emailField = contactRestructured
    ? `<label for="contact-method">Contact method</label>
       <select id="contact-method"><option>Email</option><option>Text message</option></select>
       <label for="email" aria-hidden="true" style="visibility:hidden">Email address</label>
       <input id="email" type="email" aria-label="Contact email" value="buyer@example.com">`
    : `<label for="email">Email address</label>
       <input id="email" type="email" value="buyer@example.com">`;

  const script = pending
    ? `<script>
        const pay = document.getElementById('pay');
        fetch('/api/quote').then(() => { pay.disabled = false; pay.textContent = 'Pay'; });
      </script>`
    : '';

  return page(
    'Acme Shop — Checkout',
    '',
    `<div class="card">
      <h1>Checkout</h1>
      <div class="hint">Total: <strong>$42.00</strong></div>
      ${emailField}
      <label for="card">Card number</label>
      <input id="card" value="4242 4242 4242 4242">
      <label for="expiry">Expiry date</label>
      <input id="expiry" value="12/30">
      <label for="cvv">CVV</label>
      <input id="cvv" value="123">
      <button class="primary" id="pay" ${pending ? 'disabled' : ''} style="margin-top:18px;width:100%">${pending ? 'Confirming total…' : 'Pay'}</button>
      ${pending ? '<p class="hint">Calculating your order total…</p>' : ''}
    </div>
    ${script}`,
  );
}

export function cartSummaryPage() {
  return page(
    'Acme Shop — Cart',
    '',
    `<div class="card">
      <h1>Your cart</h1>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f4f4f5">
        <span>Wireless mouse × 1</span><span>$24.00</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f4f4f5">
        <span>USB-C cable × 2</span><span>$18.00</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding-top:12px;font-weight:600">
        <span>Total</span><span>$42.00</span>
      </div>
    </div>`,
  );
}

// ── UI components gallery (project 3, story C6 "button-strict-mode") ──────

export function buttonGalleryPage() {
  return page(
    'Design System — Button',
    `.gallery { max-width: 480px; margin: 32px auto; display: flex; gap: 12px; padding: 24px; }
     .btn { border: 0; border-radius: 6px; padding: 10px 20px; font-size: 14px; font-weight: 600; }
     .btn-primary { background: #18181b; color: #fff; }
     .btn-secondary { background: #e4e4e7; color: #52525b; }`,
    `<h1 style="text-align:center">Components / Button</h1>
     <div class="gallery">
       <button class="btn btn-primary">Primary</button>
       <button class="btn btn-secondary" disabled>Disabled</button>
       <button class="btn btn-secondary" aria-busy="true">Loading…</button>
     </div>`,
  );
}

// ── Modal (project 3, story C5 "modal-never-opens") ────────────────────────

export function modalPage() {
  return page(
    'Design System — Modal',
    `.stage { max-width: 480px; margin: 60px auto; text-align: center; }`,
    `<div class="stage">
      <h1>Components / Modal</h1>
      <button class="primary" id="open" style="padding:10px 20px">Open modal</button>
    </div>
    <script>
      // Mirrors the real regression: the focus trap is created lazily and the
      // teleport target isn't mounted yet, so open() throws before the modal
      // class is added — nothing visibly happens.
      document.getElementById('open').addEventListener('click', () => {
        try { undefined.activate(); } catch (e) { console.error(e); }
      });
    </script>`,
  );
}

// ── Mobile landing + forms (project 4, stories C7/C8) ──────────────────────

export function mobileNavPage({ heroImage = false } = {}) {
  // `heroImage` embeds a real <img> request (mirrors the seeded "unoptimized
  // hero-4k.png" regression) so the recording server can hold that request
  // open and produce a genuine page.goto("load") timeout. Screenshot capture
  // (no `heroImage`) uses a CSS placeholder instead — no network dependency.
  const hero = heroImage ? `<img src="/hero-4k.png" alt="Hero" class="hero">` : `<div class="hero">Loading…</div>`;
  return page(
    'Acme Shop — Mobile',
    `.hero { width: 100%; height: 220px; background: linear-gradient(135deg,#e4e4e7,#d4d4d8); display:flex; align-items:center; justify-content:center; color:#71717a; font-size:13px; object-fit: cover; }
     nav { display: flex; justify-content: space-around; padding: 14px 0; border-bottom: 1px solid #f4f4f5; font-size: 13px; color: #71717a; }
     nav .active { color: #18181b; font-weight: 600; }`,
    `<nav><span class="active">Home</span><span>Browse</span><span>Cart</span><span>Account</span></nav>
     ${hero}
     <div style="padding:16px"><div class="hint">Fetching featured products…</div></div>`,
  );
}

export function mobileFormsPage() {
  return page(
    'Acme Shop — Delivery details',
    `.keyboard { position: fixed; left: 0; right: 0; bottom: 0; height: 180px; background: #e4e4e7; border-top: 1px solid #d4d4d8; }`,
    `<div class="card" style="margin:20px auto">
      <h1>Delivery details</h1>
      <label for="notes">Delivery notes</label>
      <input id="notes" value="Leave at the door">
    </div>
    <div class="keyboard"></div>`,
  );
}

// ── Admin dashboard (project 5, stories C9/C10) ─────────────────────────────

export function adminReportsPage({ dark = false } = {}) {
  const theme = dark
    ? `body { background:#18181b; color:#e4e4e7; } .card { background:#27272a; box-shadow:none; }
       .export-btn { visibility: hidden; }`
    : `.export-btn { visibility: visible; }`;
  return page(
    'Admin — Monthly report',
    `.bars { display:flex; align-items:flex-end; gap:8px; height:120px; margin:16px 0; }
     .bars div { flex:1; background:#3b82f6; border-radius:3px 3px 0 0; }
     .export-btn { background:#e4e4e7; color:#18181b; }
     ${theme}`,
    `<div class="card">
      <h1>Monthly report</h1>
      <div class="bars" role="img" aria-label="Revenue chart">
        <div style="height:40%"></div><div style="height:65%"></div><div style="height:50%"></div>
        <div style="height:80%"></div><div style="height:70%"></div><div style="height:90%"></div>
      </div>
      <button class="export-btn" style="padding:8px 16px">Export CSV</button>
    </div>`,
  );
}

export function adminUsersPage({ rowCount = 26 } = {}) {
  const names = ['Ada Lovelace', 'Grace Hopper', 'Katherine Johnson', 'Margaret Hamilton', 'Radia Perlman'];
  const rows = Array.from({ length: rowCount - 1 }, (_, i) => {
    const name = names[i % names.length];
    return `<tr><td>${name}</td><td>${name.toLowerCase().replace(' ', '.')}@example.com</td><td>${i % 5 === 0 ? 'admin' : 'member'}</td></tr>`;
  }).join('');
  return page(
    'Admin — Users',
    `table { width: 100%; border-collapse: collapse; font-size: 13px; }
     th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #f4f4f5; }
     .wrap { max-width: 640px; margin: 24px auto; max-height: 520px; overflow: auto; }`,
    `<div class="wrap">
      <h1>Users</h1>
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`,
  );
}

export function loginPage() {
  return page(
    'Admin — Sign in',
    '',
    `<div class="card" style="text-align:center">
      <h1>Sign in</h1>
      <div class="success">Signed in — redirecting to dashboard…</div>
    </div>`,
  );
}
