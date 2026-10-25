// Escolha do adaptador por env e por kind (render-lambda-v1 §6.1). O despachante pede `para(input)` no submit; o poller,
// o webhook e o finalize pedem `porImpl(render.impl)` (vale pra toda linha lambda mesmo depois do rollback, §2.7).
import { kindDe, type RenderImpl, type RenderInput, type RenderKind, type RenderPort } from './contrato';

export class RenderPorts {
  constructor(
    readonly impl: RenderImpl,
    readonly lambdaKinds: ReadonlySet<RenderKind>,
    private readonly portas: Partial<Record<RenderImpl, RenderPort>>,
  ) {
    if (!portas[impl]) throw new Error(`RENDER_IMPL=${impl} sem adaptador configurado`);
  }

  /** Adaptador pra um render NOVO: RENDER_IMPL=lambda manda pro lambda só os kind de RENDER_LAMBDA_KINDS; o resto vai pro local. */
  para(input: RenderInput | { kind?: string }): RenderPort {
    if (this.impl === 'lambda' && !this.lambdaKinds.has(kindDe(input))) return this.porImpl('local');
    return this.porImpl(this.impl);
  }

  /** Adaptador de uma linha que já existe (`renders.impl`; null = render antigo = local). */
  porImpl(impl: RenderImpl | string | null): RenderPort {
    const i = (impl ?? 'local') as RenderImpl;
    const p = this.portas[i];
    if (!p) throw new Error(`render impl ${i} sem adaptador (REMOTION_LAMBDA_FUNCTION/REMOTION_SERVE_URL vazios?)`);
    return p;
  }

  /** Os adaptadores configurados (o despachante assina onEvent de cada um). */
  todos(): RenderPort[] { return Object.values(this.portas).filter((p): p is RenderPort => !!p); }

  templates() { return this.porImpl(this.impl).templates(); }
}
