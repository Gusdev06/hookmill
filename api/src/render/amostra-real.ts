/**
 * Render real pelo RenderService, com a mídia de teste local (nada pago).
 * As cenas são servidas por HTTP local, como as URLs assinadas do storage em produção.
 * Uso (de api/): npx ts-node --transpile-only src/render/amostra-real.ts [templateId] [format]
 * Requer: npm run build -w video (dist/lib + dist/bundle) e video/public/fixtures (ver LEIAME.md).
 */
import { createReadStream, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { ScratchRenderInput as RenderInput } from './contrato';
import { RemotionRenderService } from './remotion-render.service';
import { renderConfig } from './render.module';

async function main() {
  const fixtures = path.join(path.dirname(require.resolve('@maquina/video/package.json')), 'public', 'fixtures');
  const servidor = http.createServer((req, res) => {
    const arquivo = path.join(fixtures, path.basename(decodeURIComponent(req.url ?? '')));
    try {
      const { size } = statSync(arquivo);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'Access-Control-Allow-Origin': '*' });
      createReadStream(arquivo).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  const amostra = JSON.parse(readFileSync(path.join(fixtures, 'amostra.json'), 'utf8')) as { scenes: RenderInput['scenes'] };
  const input: RenderInput = {
    renderId: `amostra-${Date.now()}`,
    templateId: process.argv[2] ?? 'headline',
    format: (process.argv[3] as RenderInput['format']) ?? 'VERTICAL_9_16',
    fps: 30,
    language: 'en',
    scenes: amostra.scenes.map((s) => ({ ...s, clipUrl: `${base}/${path.basename(s.clipUrl)}` })),
    captionStyle: 'word',
    captionPosition: 'bottom',
    headline: 'I found out without touching their phone',
    ctaText: 'Try it free today',
    endCard: true,
  };

  const svc = new RemotionRenderService(renderConfig((k) => process.env[k] ?? ({ REMOTION_BUNDLE_DIR: '../video/dist/bundle' } as Record<string, string>)[k]));
  const inicio = Date.now();
  let eventos = 0;
  const r = await svc.render(input, (p) => {
    eventos++;
    process.stdout.write(`\r${p.stage} ${p.progress}% frame ${p.frame}/${p.totalFrames}   `);
  });
  console.log(`\nok em ${((Date.now() - inicio) / 1000).toFixed(1)} s, ${eventos} avisos de progresso`);
  console.log(JSON.stringify({ ...r, sizeMB: +(r.sizeBytes / 1048576).toFixed(1) }));
  servidor.close();
}

main().catch((e) => {
  console.error('\nFALHOU', e);
  process.exit(1);
});
