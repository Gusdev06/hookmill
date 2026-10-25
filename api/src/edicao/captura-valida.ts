// Captura da página quebrada NUNCA vira referência (bug 25/10: "Application error" desenhado no celular do STATIC).
// Defesa na hora do USO (capturas já salvas antes da correção do medicao/captura-pagina.ts): baixa e olha a imagem.
// Usado pelo STATIC (D4, referência da tela e paleta) e pelo SPLIT-LP; as molduras B2 (`page_capture`) seguem a mesma regra.
import { Logger } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StorageService } from '../arquivos/storage.service';
import { diagnosticarImagem } from '../medicao/pagina-quebrada';

const log = new Logger('CapturaDaPagina');

/** true = a captura serve. Falha ao baixar = não serve (nunca arrisca a peça). */
export async function capturaValida(storage: Pick<StorageService, 'downloadTo'>, file: { id?: string; storageKey: string }, onde: string): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'maquina-cap-'));
  try {
    const path = join(dir, 'pagina.img');
    await storage.downloadTo(file, path);
    const d = await diagnosticarImagem(path);
    if (!d.ok) log.warn(`${onde}: captura ${file.id ?? file.storageKey} descartada (${d.motivo}: ${d.detalhe})`);
    return d.ok;
  } catch (e) {
    log.warn(`${onde}: captura ${file.id ?? file.storageKey} não baixou (${(e as Error).message}); descartada`);
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
