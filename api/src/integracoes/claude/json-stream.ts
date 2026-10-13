// Lê JSON que chega aos pedaços (streaming da saída estruturada) e devolve, conforme chega, o texto de cada
// valor string com o caminho dele (ex.: ['blocks', 2, 'speech']). Não valida nada: a validação é do JSON
// final, inteiro. Serve só pra empurrar `script.delta` pro web enquanto o Claude escreve.

export type JsonPath = (string | number)[];

type Frame = { kind: 'obj'; key: string | null; expectKey: boolean } | { kind: 'arr'; index: number };

export class JsonStringStream {
  private stack: Frame[] = [];
  private inString = false;
  private isKey = false;
  private escape = false;
  private unicode: string | null = null;
  private keyBuf = '';
  private pending = '';
  private pendingPath: JsonPath | null = null;

  constructor(private readonly onString: (path: JsonPath, chunk: string) => void) {}

  /** Recomeça do zero (o fallback do Claude reescreve a resposta inteira). */
  reset() {
    this.stack = [];
    this.inString = this.isKey = this.escape = false;
    this.unicode = null;
    this.keyBuf = this.pending = '';
    this.pendingPath = null;
  }

  push(text: string) {
    for (const ch of text) this.step(ch);
    this.flush();
  }

  private path(): JsonPath {
    return this.stack.map((f) => (f.kind === 'obj' ? (f.key ?? '') : f.index));
  }

  private emit(ch: string) {
    if (this.isKey) this.keyBuf += ch;
    else this.pending += ch;
  }

  private flush() {
    if (this.pending && this.pendingPath) this.onString(this.pendingPath, this.pending);
    this.pending = '';
  }

  private step(ch: string) {
    const top = this.stack[this.stack.length - 1];
    if (this.inString) {
      if (this.unicode !== null) {
        this.unicode += ch;
        if (this.unicode.length === 4) {
          this.emit(String.fromCharCode(parseInt(this.unicode, 16)));
          this.unicode = null;
        }
        return;
      }
      if (this.escape) {
        this.escape = false;
        if (ch === 'u') this.unicode = '';
        else this.emit(({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[ch] ?? ch);
        return;
      }
      if (ch === '\\') {
        this.escape = true;
        return;
      }
      if (ch === '"') {
        this.inString = false;
        if (this.isKey && top?.kind === 'obj') top.key = this.keyBuf;
        else this.flush();
        this.pendingPath = null;
        return;
      }
      this.emit(ch);
      return;
    }
    switch (ch) {
      case '{':
        this.stack.push({ kind: 'obj', key: null, expectKey: true });
        break;
      case '[':
        this.stack.push({ kind: 'arr', index: 0 });
        break;
      case '}':
      case ']':
        this.stack.pop();
        break;
      case ':':
        if (top?.kind === 'obj') top.expectKey = false;
        break;
      case ',':
        if (top?.kind === 'obj') {
          top.expectKey = true;
          top.key = null;
        } else if (top?.kind === 'arr') top.index++;
        break;
      case '"':
        this.inString = true;
        this.isKey = top?.kind === 'obj' && top.expectKey;
        this.keyBuf = '';
        if (!this.isKey) this.pendingPath = this.path();
        break;
      default:
        break; // número, literal, espaço
    }
  }
}
