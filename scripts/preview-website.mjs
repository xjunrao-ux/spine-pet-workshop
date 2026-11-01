import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { siteDirectory } from './build-website.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    // Serve under the same subpath as GitHub project Pages to catch broken asset paths.
    const prefix = '/spine-pet-workshop/';
    if (pathname === '/') { response.writeHead(302, { Location: prefix }); response.end(); return; }
    if (!pathname.startsWith(prefix)) { response.writeHead(404); response.end('Not found'); return; }
    const requested = pathname.slice(prefix.length) || 'index.html';
    const file = path.resolve(siteDirectory, requested);
    const relative = path.relative(siteDirectory, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403); response.end('Forbidden'); return; }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
});
server.listen(4178, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4178/spine-pet-workshop/'));
