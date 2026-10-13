/**
 * Fila por chave (in-process). A API roda em UMA instância (eventos.md), então serializar por criativo aqui
 * basta pra que dois webhooks/cliques no mesmo criativo não leiam o estado um do outro pela metade.
 * O compare-and-set no banco continua sendo a garantia final; isto só evita a corrida "ler → decidir".
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => gate);
    this.tails.set(key, tail);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
