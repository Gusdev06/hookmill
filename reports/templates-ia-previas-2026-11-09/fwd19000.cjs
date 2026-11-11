// Dentro do container: localhost:19000 → localhost:9000 (storage do worktree). Assim os links assinados pela
// API T1 (STORAGE_ENDPOINT=http://localhost:19000) abrem igual dentro do container e no Mac (ponte na 19000).
require('node:net').createServer((c) => {
  const s = require('node:net').connect(9000, '127.0.0.1');
  c.pipe(s); s.pipe(c);
  c.on('error', () => s.destroy()); s.on('error', () => c.destroy());
}).listen(19000, '127.0.0.1', () => console.log('19000 → 9000'));
