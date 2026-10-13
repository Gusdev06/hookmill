// Build de produção: bundle do Remotion em dist/bundle (o RenderService usa via REMOTION_BUNDLE_DIR).
// A mídia de teste (public/fixtures/*.mp4) não vai pro bundle.
import { bundle } from '@remotion/bundler';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(raiz, 'dist', 'bundle');
rmSync(outDir, { recursive: true, force: true });
await bundle({
  entryPoint: path.join(raiz, 'src', 'index.ts'),
  outDir,
  publicDir: path.join(raiz, 'public'),
  onProgress: (p) => process.stdout.write(`\rbundle ${p}%`),
});
for (const f of ['cena-1.mp4', 'cena-2.mp4', 'cena-3.mp4', 'cena-4.mp4', 'cena-5.mp4']) rmSync(path.join(outDir, 'public', 'fixtures', f), { force: true });
rmSync(path.join(outDir, 'public', 'fixtures'), { recursive: true, force: true });
console.log(`\nbundle pronto em ${outDir}`);
