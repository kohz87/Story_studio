// Development only; modules may also import the sibling vendored checker.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const base = resolve('.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
createServer(async (req, res) => {
    try {
        const path = resolve(base, `.${decodeURIComponent(req.url === '/' ? '/src/index.html' : req.url.split('?')[0])}`);
        if (!path.startsWith(`${base}/src/`) && !path.startsWith(`${base}/vendor/`)) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', types[extname(path)] || 'text/plain');
        res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
}).listen(8000, '127.0.0.1', () => console.log('Studio: http://127.0.0.1:8000'));
