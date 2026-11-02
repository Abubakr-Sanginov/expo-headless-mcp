// Stand-in for "expo start": answers /status and prints a Bundled line periodically.
import http from 'node:http';
const port = Number(process.argv[2]);
http.createServer((req, res) => res.end('packager-status:running')).listen(port, '127.0.0.1');
setInterval(() => console.log('Android Bundled 120ms index.js (400 modules)'), 300);
