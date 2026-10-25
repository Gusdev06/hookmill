// Ponto de entrada do render pro backend: tipos do contrato, token e módulo.
export * from './contrato';
export { RenderModule, RENDER_SERVICE, RENDER_PORTS, criarRenderPorts } from './render.module';
export { RenderPorts } from './portas';
export { ServicoComoPorta } from './servico-como-porta';
export { LambdaRenderPort, decidirWebhook, prazoEstourado, lambdaConfig, type LambdaConfig, type LinhaDeRender } from './lambda';
export { mesclarPalavras, type AudioSplice, type PalavraFrame, type PalavraSeg } from './troca-motor';
