// 04/11: proxy https local → API (dev com Meta live). A Meta só aceita redirect https; `https://localhost:3443/api/v1/meta/callback`
// está cadastrado no app. Uso: `node scripts/https-proxy.mjs` (com a API na 3001). Certificado autoassinado em scripts/.certs/
// (o Chrome avisa na 1ª vez: "Avançado → Continuar para localhost").
import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('./.certs/', import.meta.url));
const PORT = Number(process.env.HTTPS_PROXY_PORT || 3443), TARGET = Number(process.env.API_PORT || 3001);
https.createServer({ key: readFileSync(dir + 'localhost.key'), cert: readFileSync(dir + 'localhost.crt') }, (req, res) => {
  const up = http.request({ host: '127.0.0.1', port: TARGET, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-proto': 'https' } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end(`API offline na ${TARGET}: ${e.message}`); });
  req.pipe(up);
}).listen(PORT, () => console.log(`https://localhost:${PORT} → http://localhost:${TARGET}`));
