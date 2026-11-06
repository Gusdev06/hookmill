// Editor universal v1 (docs/contratos/editor-universal-v1.md), funções puras do @maquina/video/lib usadas pelo web
// (Player, alças, pílulas) e pela API (GET/PUT/export). F-U1: molduras (18) + HEADLINE.
export * from './tipos';
export { CODIGO_DO_FORMATO, FORMATO_DO_CODIGO, FORMAT_CODES, docV3De, docV3Vazio, numerosDoTexto, numerosNaoConfirmados, validarEstruturaAuto } from './comum';
export { CAMPOS_MOLDURA, manifestoMoldura, resolverPropsMoldura, textosDaMoldura, validarDocMoldura } from './moldura';
export { HEADLINE_CAPTION_LAYER_ID, HEADLINE_TEXT_LAYER_ID, ID_EDITOR_DA_CAMADA_REMIX, formatoDoQuadro, manifestoHeadline, resolverPropsHeadline, tamanhoQueCabeHeadline, validarDocHeadline } from './headline';
export { checarEdicao, exportLiberado, razaoDeContraste } from './checagens';
export { manifestoDe, normalizarDocV3, templateKeyEditavel, type OpcoesManifesto } from './manifesto';
export { comVideoEditado, limitesDoVideo } from './video';
