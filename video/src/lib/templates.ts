import type { TemplateId } from './schema';

export interface TemplateInfo {
  id: TemplateId | 'remix-keep';
  /** scratch = criativo do zero (escolha na Edição); remix = mantém a edição do campeão (não aparece na escolha). */
  kind: 'scratch' | 'remix';
  /** Chave de i18n do web (next-intl). */
  labelKey: string;
  /** Relativo à raiz do pacote @maquina/video. */
  thumbnailPath: string;
  supportsHeadline: boolean;
}

// Registro dos templates. Ordem = ordem na tela de Edição (Clean / Bold captions / Headline + captions).
export const TEMPLATES: readonly TemplateInfo[] = [
  { id: 'clean', kind: 'scratch', labelKey: 'edit.templates.clean', thumbnailPath: 'public/thumbnails/clean.png', supportsHeadline: false },
  { id: 'bold', kind: 'scratch', labelKey: 'edit.templates.bold', thumbnailPath: 'public/thumbnails/bold.png', supportsHeadline: false },
  { id: 'headline', kind: 'scratch', labelKey: 'edit.templates.headline', thumbnailPath: 'public/thumbnails/headline.png', supportsHeadline: true },
  // §13.6: sem miniatura própria (o card mostra o campeão); headline redesenhada vem nas camadas, não neste flag
  { id: 'remix-keep', kind: 'remix', labelKey: 'edit.templates.remixKeep', thumbnailPath: '', supportsHeadline: false },
];

export const templatePorId = (id: string): TemplateInfo | undefined => TEMPLATES.find((t) => t.id === id);
