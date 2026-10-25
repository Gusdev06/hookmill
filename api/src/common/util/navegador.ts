// Onde está o Chromium headless de custo zero que a API já carrega pro Remotion (chrome-headless-shell).
// Usado pela medição (print da landing, `medicao/captura-pagina.ts`) e pelo briefing (render de página JS,
// `integracoes/claude/render-pagina.ts`). Env `REMOTION_BROWSER_EXECUTABLE`; vazio = o que o
// `npx remotion browser ensure` deixou em node_modules/.remotion.
import { existsSync } from 'node:fs';
import path from 'node:path';

export function acharNavegador(cfg: string | null | undefined): string | null {
  if (cfg && existsSync(cfg)) return cfg;
  const plat = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64') : process.platform === 'linux' ? (process.arch === 'arm64' ? 'linux-arm64' : 'linux64') : 'win64';
  const bin = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
  // src/common/util → raiz da api (em dist: dist/common/util → raiz da api também)
  const bases = [process.cwd(), path.resolve(__dirname, '..', '..', '..'), path.resolve(process.cwd(), 'api')];
  for (const b of bases) {
    const p = path.join(b, 'node_modules', '.remotion', 'chrome-headless-shell', plat, `chrome-headless-shell-${plat}`, bin);
    if (existsSync(p)) return p;
  }
  return null;
}
