// Servidor local de desenvolvimento, com os mesmos cabeçalhos de segurança da publicação.
// Uso: npm run serve [-- porta]. Só entrega comprimir/.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'comprimir');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/') {
    res.writeHead(302, { Location: '/comprimir/' }).end();
    return;
  }
  if (!pathname.startsWith('/comprimir/')) {
    res.writeHead(404).end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const full = join(TOOL, normalize(pathname.slice('/comprimir/'.length)));
  let stat;
  try {
    if (!full.startsWith(TOOL + sep)) throw new Error('fora da pasta');
    stat = statSync(full);
    if (!stat.isFile()) throw new Error('não é arquivo');
  } catch {
    res.writeHead(404).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(full).pipe(res);
});

server.listen(Number(process.argv[2] ?? 8080), '127.0.0.1', () => {
  console.log(`Servindo em http://127.0.0.1:${server.address().port}/comprimir/`);
});
