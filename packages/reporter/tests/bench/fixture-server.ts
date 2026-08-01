import * as http from 'node:http';

/**
 * The page the benchmark workload drives. `rows` scales the DOM: the element
 * probe runs several document-wide `querySelectorAll` scans (uniqueness counts,
 * the role-source scan, the ancestor walk), so capture cost is a function of
 * page size, not just action count. Driving the same workload at two sizes is
 * what separates the fixed per-action overhead from the part that grows with
 * the page.
 *
 * The markup is deliberately ordinary — labeled form fields, a toolbar, and a
 * table of repeated rows with buttons and links — so the probe hits the same
 * shapes it hits in a real suite: ambiguous class names, unique test ids, an
 * anchor-worthy ancestor chain, and many same-role siblings.
 */
export function benchPageHtml(rows: number): string {
  const row = (i: number) => `
    <tr class="row" data-row="${i}">
      <td class="cell cell-name"><span class="name">Order ${i}</span></td>
      <td class="cell cell-status"><span class="badge badge-open">open</span></td>
      <td class="cell cell-actions">
        <button class="btn btn-primary" data-testid="open-${i}" name="open-${i}">Open order ${i}</button>
        <a class="link" href="#order-${i}" title="Details ${i}">Details ${i}</a>
      </td>
    </tr>`;

  return `<!doctype html>
<html lang="en">
  <head><title>Piwi capture benchmark</title></head>
  <body>
    <header class="site-header">
      <nav aria-label="Main">
        <a class="link nav-link" href="#home">Home</a>
        <a class="link nav-link" href="#orders">Orders</a>
        <a class="link nav-link" href="#settings">Settings</a>
      </nav>
    </header>
    <main>
      <section aria-label="Filters" class="panel">
        <label for="email">Email</label>
        <input class="field" id="email" name="email" type="email" placeholder="you@example.com" />
        <label for="search">Search</label>
        <input class="field" id="search" name="search" type="search" placeholder="Search orders" />
        <button class="btn btn-secondary" data-testid="apply-filters" name="apply">Apply filters</button>
      </section>
      <section aria-label="Orders" class="panel">
        <h2>Orders</h2>
        <table>
          <tbody id="rows">${Array.from({ length: rows }, (_, i) => row(i)).join('')}</tbody>
        </table>
      </section>
      <div id="status" role="status">idle</div>
    </main>
    <script>
      // Delegated from the row so the button and the row's plain <span> behave
      // identically — the benchmark drives both, and the two must differ only
      // in what the capture probe sees, never in what the page does.
      document.addEventListener('click', async (event) => {
        const row = event.target.closest('tr[data-row]');
        if (!row) return;
        const res = await fetch('/api/order/' + row.dataset.row);
        await res.json();
        document.getElementById('status').textContent = 'opened ' + row.dataset.row;
      });
    </script>
  </body>
</html>`;
}

export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

/**
 * Serve the benchmark page from localhost. Everything the workload touches is
 * local and in-memory so the measured deltas are capture overhead rather than
 * network variance.
 */
export function startFixtureServer(rows: number): Promise<FixtureServer> {
  const html = benchPageHtml(rows);
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/')) {
      const body = JSON.stringify({ ok: true });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('fixture server did not bind a port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
