// Template `person-motion` (iterate-v2 F1.1/F1.4), promovido do protótipo aprovado de 28/10
// (src/prototipos/formatos/GreenScreenPrint.tsx, "pessoa + motion"). Em cima, um palco de motion graphics em código
// (texto cinético, errado → certo, esquema com setas, lista com ícones, selo, CTA) no tempo da fala; no meio, a legenda
// palavra a palavra; embaixo, numa caixa redonda, o ROSTO E A VOZ DO PRÓPRIO CAMPEÃO em 2-6 trechos dele (é edição, não
// geração). Cena final: só os números do Brain › proof e o CTA. Nenhum print, nenhuma imagem gerada, nada pago.
import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { LegendaAuto } from '../componentes/LegendaAuto';
import { resolverSrc } from '../componentes/midia';
import { trechosEmFrames } from '../lib/autoEdit';
import type { CaixaLegenda } from '../lib/legendaAuto';
import type { FittedText } from '../lib/molduras';
import {
  PERSON_GEO, PROOF_ROW, TEMPLATE_SAFE, TEMPLATE_W, personLayout, type PersonBeatProps, type PersonMotionProps, type TemplateProps,
} from '../lib/templatesFormato';
import { BotaoCTA, clamp, Contador, coresDaMarca, entrada, FPS, FundoMarca, Icone, iconeDaProva, Linhas, Seta, Sfx, surge, VERDE, VERMELHO, type Cores } from './comum';

const W = TEMPLATE_W;
type Fits = Map<string, FittedText>;
type Comum = Pick<TemplateProps, 'brand' | 'language' | 'sfx'>;

const Card: React.FC<{ cor: string; children: React.ReactNode; estilo?: React.CSSProperties }> = ({ cor, children, estilo }) => (
  <div style={{ background: 'rgba(20,18,28,0.92)', border: `3px solid ${cor}`, borderRadius: 32, padding: '26px 40px', boxShadow: `0 16px 50px rgba(0,0,0,0.55), 0 0 40px ${cor}33`, ...estilo }}>{children}</div>
);

/** Uma cena do palco, centrada na área do palco, entre fromSec e toSec. */
const Cena: React.FC<{ b: PersonBeatProps; i: number; t: number; fits: Fits; cores: Cores }> = ({ b, i, t, fits, cores }) => {
  const f = (k: string) => fits.get(`beats.${i}.${k}`)!;
  const de = b.fromSec, ate = b.toSec;
  const dur = Math.max(0.6, ate - de);
  const passo = (n: number) => Math.min(0.55, (dur * 0.7) / Math.max(1, n));
  let corpo: React.ReactNode = null;
  switch (b.kind) {
    case 'kinetic':
      corpo = b.words.map((_, k) => (
        <div key={k} style={surge(t, de + k * passo(b.words.length), ate, 60)}>
          <Linhas fit={f(`words.${k}`)} font="montserrat-900" cor={k === b.words.length - 1 && b.words.length > 1 ? cores.acento : '#fff'} />
        </div>
      ));
      break;
    case 'wrong_right': {
      const seta = de + Math.min(0.6, dur * 0.25);
      corpo = (
        <>
          <Card cor={VERMELHO} estilo={{ ...surge(t, de, ate), display: 'flex', alignItems: 'center', gap: 22 }}>
            <Icone nome="x" tam={60} cor={VERMELHO} largura={12} p={interpolate(t, [de, de + 0.3], [0, 1], clamp)} />
            <Linhas fit={f('wrong')} font="inter-800" cor={VERMELHO} align="left" riscado />
          </Card>
          <div style={{ ...surge(t, seta, ate, 20), height: 130, display: 'flex', alignItems: 'center' }}>
            <Seta p={interpolate(t, [seta, seta + 0.5], [0, 1], clamp)} comp={140} ang={90} cor={cores.acento} />
          </div>
          <Card cor={VERDE} estilo={{ ...surge(t, seta + 0.2, ate), display: 'flex', flexDirection: 'column', gap: 40, padding: '34px 44px' }}>
            {b.right.map((_, k) => {
              const em = seta + 0.2 + k * passo(b.right.length + 1);
              return (
                <div key={k} style={{ ...surge(t, em, ate), display: 'flex', alignItems: 'center', gap: 22 }}>
                  <Icone nome="check" tam={62} cor={VERDE} p={interpolate(t, [em, em + 0.35], [0, 1], clamp)} largura={12} />
                  <Linhas fit={f(`right.${k}`)} font="inter-800" cor={VERDE} align="left" />
                </div>
              );
            })}
          </Card>
        </>
      );
      break;
    }
    case 'steps':
      corpo = b.steps.map((_, k) => {
        const em = de + k * passo(b.steps.length);
        return (
          <React.Fragment key={k}>
            {k > 0 ? <div style={{ ...surge(t, em - 0.1, ate, 10), height: 70, display: 'flex', alignItems: 'center' }}><Seta p={interpolate(t, [em - 0.1, em + 0.25], [0, 1], clamp)} comp={70} ang={90} cor={cores.acento} espessura={8} /></div> : null}
            <div style={{ ...surge(t, em, ate), background: 'rgba(255,255,255,0.07)', border: `2px solid ${k === b.steps.length - 1 ? cores.acento : 'rgba(255,255,255,0.18)'}`, borderRadius: 22, padding: '22px 34px' }}>
              <Linhas fit={f(`steps.${k}`)} font="inter-800" cor="#fff" />
            </div>
          </React.Fragment>
        );
      });
      break;
    case 'icon_list':
      corpo = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26, width: W - 140 }}>
          {b.items.map((it, k) => {
            const em = de + k * passo(b.items.length);
            return (
              <div key={k} style={{ ...surge(t, em, ate, 50), display: 'flex', alignItems: 'center', gap: 34, minHeight: 110 }}>
                <Icone nome={it.icon} tam={110} cor={cores.acento} p={interpolate(t, [em, em + 0.5], [0, 1], clamp)} />
                <Linhas fit={f(`items.${k}`)} font="inter-800" cor="#fff" align="left" />
              </div>
            );
          })}
        </div>
      );
      break;
    case 'badge':
      corpo = (
        <div style={{ ...surge(t, de, ate, 0), scale: String(interpolate(entrada(t, de, 260), [0, 1], [1.8, 1])), rotate: '-3deg', border: `6px solid ${cores.acento}`, borderRadius: 18, padding: '18px 36px' }}>
          <Linhas fit={f('text')} font="montserrat-900" cor={cores.acento} />
        </div>
      );
      break;
    case 'cta':
      corpo = (
        <>
          <BotaoCTA t={t} emSec={de} fit={f('cta.button')} cores={cores} />
          {b.note ? <div style={{ ...surge(t, de + 0.25, ate), marginTop: 40 }}><Linhas fit={f('cta.note')} font="inter-600" cor="#CFCBDA" /></div> : null}
        </>
      );
      break;
  }
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: PERSON_GEO.stage.h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: b.kind === 'kinetic' ? 24 : 0 }}>
      {corpo}
    </div>
  );
};

/** O campeão dentro da caixa redonda: por trecho, a janela do rosto escalada pra caixa. Áudio = o do campeão. */
const Rosto: React.FC<{ p: PersonMotionProps; t: number; fimFala: number; cores: Cores }> = ({ p, t, fimFala, cores }) => {
  const { fps } = useVideoConfig();
  const trechos = trechosEmFrames(p.timeline, fps);
  const src = resolverSrc(p.source.videoUrl);
  const rampa = (p.joinFadeMs / 1000) * fps;
  const box = p.faceBox.box;
  const e = entrada(t, 0, 140);
  const sai = interpolate(t, [fimFala, fimFala + 0.35], [1, 0], { ...clamp, easing: Easing.in(Easing.quad) });
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: '50%', overflow: 'hidden', border: `8px solid ${cores.acento}`, boxShadow: '0 12px 50px rgba(0,0,0,0.7)', background: '#000', scale: String(e * sai), opacity: sai, boxSizing: 'border-box' }}>
      {trechos.map((tr, i) => {
        const j = p.faceBox.windows[i] ?? p.faceBox.windows[0];
        const s = (box.w - 16) / j.w;
        return (
          <Sequence key={i} name={`Trecho ${i + 1}`} from={tr.at} durationInFrames={tr.frames} layout="none">
            <OffthreadVideo
              src={src}
              trimBefore={tr.from || undefined}
              volume={rampa > 0 ? (f) => Math.min(interpolate(f, [0, rampa], [0, 1], clamp), interpolate(f, [tr.frames - 1 - rampa, tr.frames - 1], [1, 0], clamp)) : undefined}
              style={{ position: 'absolute', left: -j.x * s, top: -j.y * s, width: p.source.width * s, height: p.source.height * s, objectFit: 'fill', maxWidth: 'none' }}
            />
          </Sequence>
        );
      })}
    </div>
  );
};

const Fim: React.FC<{ p: NonNullable<PersonMotionProps['endCard']>; t: number; fits: Fits; cores: Cores }> = ({ p, t, fits, cores }) => {
  const de = p.fromSec + 0.05;
  const topo = TEMPLATE_SAFE.top + 150;
  const topoCta = topo + p.proof.length * (PROOF_ROW.h + 22) + 60;
  return (
    <>
      <div style={{ position: 'absolute', top: topo, left: (W - PROOF_ROW.w) / 2, width: PROOF_ROW.w, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {p.proof.map((pp, i) => {
          const em = de + i * 0.18;
          return (
            <div key={i} style={{ ...surge(t, em, 999, 60), height: PROOF_ROW.h, borderRadius: 36, background: 'rgba(20,18,28,0.92)', border: `3px solid ${i === 0 ? cores.acento : 'rgba(255,255,255,0.22)'}`, display: 'flex', alignItems: 'center', padding: '0 36px', gap: 26, boxSizing: 'border-box' }}>
              <Icone nome={iconeDaProva(i)} tam={78} cor={cores.acento} p={interpolate(t, [em, em + 0.6], [0, 1], clamp)} />
              <div style={{ width: PROOF_ROW.numW, flexShrink: 0 }}><Contador t={t} emSec={em} p={pp} fit={fits.get(`endCard.proof.${i}.value`)!} cor="#fff" dur={1.2} /></div>
              <Linhas fit={fits.get(`endCard.proof.${i}.label`)!} font="inter-800" cor="#CFCBDA" align="left" />
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', top: topoCta, width: W, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 36 }}>
        <BotaoCTA t={t} emSec={de + p.proof.length * 0.18 + 0.2} fit={fits.get('endCard.cta.button')!} cores={cores} />
        {p.cta.note ? <div style={surge(t, de + p.proof.length * 0.18 + 0.45)}><Linhas fit={fits.get('endCard.cta.note')!} font="inter-600" cor="#CFCBDA" /></div> : null}
      </div>
    </>
  );
};

export const PersonMotion: React.FC<{ p: PersonMotionProps; c: Comum }> = ({ p, c }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const cores = useMemo(() => coresDaMarca(c.brand.color), [c.brand.color]);
  const fits = useMemo(() => new Map(personLayout(p, c.language).map((x) => [x.slot, x.fit])), [p, c.language]);
  const fimFala = p.timeline.reduce((s, x) => s + (x.endSec - x.startSec), 0);
  const atual = p.beats.findIndex((b) => t >= b.fromSec - 0.02 && t < b.toSec);
  const caixa: CaixaLegenda = useMemo(() => ({ box: { ...PERSON_GEO.caption }, maxLinhas: 2, tamanho: 64, maxPalavras: 4 }), []);
  const naFala = !p.endCard || t < p.endCard.fromSec;
  return (
    <AbsoluteFill>
      <FundoMarca t={t} cores={cores} />
      <div style={{ position: 'absolute', left: 0, top: PERSON_GEO.stage.y, width: W, height: PERSON_GEO.stage.h, overflow: 'hidden' }}>
        {atual >= 0 && naFala ? <Cena b={p.beats[atual]} i={atual} t={t} fits={fits} cores={cores} /> : null}
      </div>
      {p.endCard && t >= p.endCard.fromSec - 0.05 ? <Fim p={p.endCard} t={t} fits={fits} cores={cores} /> : null}
      {naFala ? <LegendaAuto captions={{ ...p.captions, highlightColor: cores.acento }} timeline={p.timeline} caixa={caixa} ateSec={fimFala} /> : null}
      <Rosto p={p} t={t} fimFala={fimFala} cores={cores} />
      {p.beats.slice(1).map((b, i) => <Sfx key={`b${i}`} sfx={c.sfx} arquivo="send" emSec={Math.max(0, b.fromSec - 0.05)} volume={0.35} />)}
      {p.beats.filter((b) => b.kind === 'cta').map((b, i) => <Sfx key={`c${i}`} sfx={c.sfx} arquivo="ding" emSec={b.fromSec} volume={0.6} />)}
      {p.endCard ? p.endCard.proof.map((_, i) => <Sfx key={`p${i}`} sfx={c.sfx} arquivo="pop" emSec={p.endCard!.fromSec + 0.05 + i * 0.18} volume={0.5} />) : null}
    </AbsoluteFill>
  );
};
