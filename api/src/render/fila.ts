/** Fila FIFO com limite de concorrência (RENDER_CONCURRENCY). Sem dependência de Nest, testável. */
export class FilaLimitada {
  private ativos = 0;
  private readonly espera: (() => void)[] = [];

  constructor(private readonly limite: number) {
    if (!Number.isInteger(limite) || limite < 1) throw new Error(`concorrência inválida: ${limite}`);
  }

  get emAndamento() { return this.ativos; }
  get naFila() { return this.espera.length; }

  async executar<T>(tarefa: () => Promise<T>): Promise<T> {
    if (this.ativos >= this.limite) await new Promise<void>((ok) => this.espera.push(ok));
    this.ativos++;
    try {
      return await tarefa();
    } finally {
      this.ativos--;
      this.espera.shift()?.();
    }
  }
}
