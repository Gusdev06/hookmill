// Composição de produto `Template` (iterate-v2 F1.4): os templates grátis `chat-dm` e `person-motion`, com schema zod
// (templateSchema) como a `Moldura`. Fontes do bundle + os pedaços da Noto CJK que o texto usa antes do 1º frame
// (headline-e-legenda §2: zh/ja quebram por caractere, sem fonte de reserva).
import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, type CalculateMetadataFunction } from 'remotion';
import { carregarFontes, carregarFontesCJK } from '../fontes';
import { TEMPLATE_FPS, TEMPLATE_H, TEMPLATE_W, type TemplateProps } from '../lib/templatesFormato';
import { ChatDM } from './ChatDM';
import { PersonMotion } from './PersonMotion';

/** Todo texto que aparece (pra baixar os pedaços CJK certos). */
export const textoDoTemplate = (p: TemplateProps): string => {
  const base = [p.brand.name, p.brand.handle, p.brand.initials];
  if (p.templateId === 'chat-dm') {
    const c = p.props;
    return [...base, c.hook.text, c.chrome.typing, c.chrome.inputPlaceholder, c.chrome.profileStatus, ...c.messages.flatMap((m) => [m.text, ...m.wrong, ...m.right]),
      ...c.close.lines, c.cta.button, c.cta.note ?? '', ...c.proof.flatMap((x) => [x.label, x.prefix, x.suffix])].join('');
  }
  const m = p.props;
  const doBeat = (b: Record<string, unknown>): string[] => Object.values(b).flatMap((v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : String((x as { text?: string }).text ?? ''))) : []));
  return [...base, ...m.captions.words.map((w) => w.word), ...m.beats.flatMap((b) => doBeat(b as unknown as Record<string, unknown>)),
    ...(m.endCard ? [m.endCard.cta.button, m.endCard.cta.note ?? '', ...m.endCard.proof.flatMap((x) => [x.label, x.prefix, x.suffix])] : [])].join('');
};

const useFontes = (language: string, texto: string) => {
  const [pronto, setPronto] = useState(false);
  const [handle] = useState(() => delayRender('fontes template'));
  useEffect(() => {
    carregarFontes().then(() => carregarFontesCJK(language, texto)).then(() => { setPronto(true); continueRender(handle); })
      .catch((e) => { console.error(e); setPronto(true); continueRender(handle); });
  }, [handle, language, texto]);
  return pronto;
};

export const Template: React.FC<TemplateProps> = (p) => {
  const texto = useMemo(() => textoDoTemplate(p), [p]);
  const pronto = useFontes(p.language, texto);
  const c = { brand: p.brand, language: p.language, sfx: p.sfx };
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {pronto ? (p.templateId === 'chat-dm' ? <ChatDM p={p.props} c={c} /> : <PersonMotion p={p.props} c={c} />) : null}
    </AbsoluteFill>
  );
};

/** Duração calculada pelo builder (`durationInFrames`), 1080x1920, 30 fps (só 9:16 na v1). */
export const calcularTemplate: CalculateMetadataFunction<TemplateProps> = async ({ props }) => ({
  durationInFrames: props.durationInFrames, fps: TEMPLATE_FPS, width: TEMPLATE_W, height: TEMPLATE_H,
});
