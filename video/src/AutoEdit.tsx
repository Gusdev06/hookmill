import React, { useEffect, useMemo, useState } from 'react';
import {
  AbsoluteFill, Easing, Freeze, Img, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, spring, useCurrentFrame, useVideoConfig,
} from 'remotion';
import { resolverSrc } from './componentes/midia';
import { Seta } from './componentes/Seta';
import { carregarFontes, carregarFontesCJK, INTER, MONTSERRAT } from './fontes';
import { LegendaAuto } from './componentes/LegendaAuto';
import { caixaLegendaAutoEdit } from './lib/legendaAuto';
import { ajustarTexto } from './RemixKeep';
import { endCardFrames, janelaCover, trechosEmFrames, type AutoEditProps, type AutoReframe } from './lib/autoEdit';
import { corDeDestaque, corClara, contraste } from './lib/cores';
import type { RemixTextStyle } from './lib/remix';

// Template auto-edit (variacao-auto-v1 §7.2). Base = o campeão recortado pelo `timeline` e reenquadrado; por cima, a ÚNICA
// coisa que o tipo muda. Sem legenda nova, sem música, sem efeito extra. Áudio = o do campeão (o do vídeo da frente).

type Box = { x: number; y: number; w: number; h: number };
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const saida = Easing.bezier(0.16, 1, 0.3, 1);

/** Segura o frame até as fontes do template estarem prontas (o texto é medido com elas). */
const useFontes = (language: string, texto: string) => {
  const [pronto, setPronto] = useState(false);
  const [handle] = useState(() => delayRender('fontes auto-edit'));
  useEffect(() => {
    // CJK (headline-e-legenda-v1 §2.2): os pedaços da Noto que a legenda/os textos usam vêm antes do 1º frame
    carregarFontes().then(() => carregarFontesCJK(language, texto)).then(() => { setPronto(true); continueRender(handle); }).catch((e) => { console.error(e); continueRender(handle); });
  }, [handle, language, texto]);
  return pronto;
};

/** O campeão dentro de `box`: cover = janela centrada no foco, escala exata; contain_blur = inteiro, com o próprio vídeo
 *  desfocado atrás. `startFrom` = 1º frame do campeão (grade da saída). Só o vídeo da frente tem som. */
const Quadro: React.FC<{ src: string; source: AutoEditProps['source']; reframe: AutoReframe; box: Box; startFrom: number; mudo: boolean; volume?: (f: number) => number }> = ({
  src, source, reframe, box, startFrom, mudo, volume,
}) => {
  const comSom = !mudo && source.hasAudio;
  const video = (r: { left: number; top: number; w: number; h: number }, muted: boolean, extra?: React.CSSProperties) => (
    <OffthreadVideo
      src={src}
      muted={muted}
      volume={muted ? undefined : volume}
      trimBefore={startFrom || undefined}
      style={{ position: 'absolute', left: r.left, top: r.top, width: r.w, height: r.h, objectFit: 'fill', display: 'block', ...extra }}
    />
  );
  const coverEm = (b: { w: number; h: number }, foco: { x: number; y: number }) => {
    const j = janelaCover(source, b.w / b.h, foco);
    const s = b.w / j.w;
    return { left: -j.x * s, top: -j.y * s, w: source.width * s, h: source.height * s };
  };
  const cover = (foco: { x: number; y: number }) => coverEm(box, foco);
  if (reframe.mode === 'cover') {
    return <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden' }}>{video(cover(reframe.focus), !comSom)}</div>;
  }
  const s = Math.min(box.w / source.width, box.h / source.height);
  const w = source.width * s, h = source.height * s;
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden', backgroundColor: '#000' }}>
      {/* desfoque barato: pinta o fundo a 1/8 do tamanho com blur de 5 px e amplia 8x (= blur de 40 px no tamanho cheio) */}
      <div style={{ position: 'absolute', left: -box.w * 0.06, top: -box.h * 0.06, width: box.w / 8, height: box.h / 8, scale: String(8 * 1.12), transformOrigin: '0 0', filter: 'blur(5px) brightness(0.7)', overflow: 'hidden' }}>
        {video(coverEm({ w: box.w / 8, h: box.h / 8 }, { x: 0.5, y: 0.5 }), true)}
      </div>
      {video({ left: (box.w - w) / 2, top: (box.h - h) / 2, w, h }, !comSom)}
    </div>
  );
};

/** O timeline emendado em corte seco, dentro de `box`. Rampa de volume de joinFadeMs em cada borda (sem clique). */
const Fonte: React.FC<{ p: AutoEditProps; box: Box; reframe?: AutoReframe }> = ({ p, box, reframe }) => {
  const { fps } = useVideoConfig();
  const trechos = trechosEmFrames(p.timeline, fps);
  const src = resolverSrc(p.source.videoUrl);
  const rampa = (p.joinFadeMs / 1000) * fps;
  return (
    <>
      {trechos.map((t, i) => (
        <Sequence key={i} name={`Trecho ${i + 1} (${(t.from / fps).toFixed(2)} s)`} from={t.at} durationInFrames={t.frames} layout="none">
          <Quadro
            src={src} source={p.source} reframe={reframe ?? p.reframe} box={box} startFrom={t.from} mudo={false}
            volume={rampa > 0 ? (f) => Math.min(interpolate(f, [0, rampa], [0, 1], clamp), interpolate(f, [t.frames - 1 - rampa, t.frames - 1], [1, 0], clamp)) : undefined}
          />
        </Sequence>
      ))}
    </>
  );
};

const estiloBase: RemixTextStyle = {
  fontId: 'montserrat-900', uppercase: false, fontSizePx: 84, lineHeight: 1.08, color: '#ffffff', highlightColor: null,
  strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center',
};

/** Texto que cabe na caixa (quebra + reduz a fonte, como o remix-keep). */
const TextoNaCaixa: React.FC<{ texto: string; box: { w: number; h: number }; estilo?: Partial<RemixTextStyle>; css?: React.CSSProperties; familia?: string }> = ({ texto, box, estilo, css, familia }) => {
  const st = { ...estiloBase, ...estilo };
  const aj = useMemo(() => ajustarTexto(texto.split(/\s+/).filter(Boolean), st, box), [texto, box.w, box.h, JSON.stringify(st)]);
  const justify = st.align === 'left' ? 'flex-start' : st.align === 'right' ? 'flex-end' : 'center';
  return (
    <div style={{ width: box.w, height: box.h, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: justify }}>
      {aj.linhas.map((l, i) => (
        <div key={i} style={{ fontFamily: familia ?? MONTSERRAT, fontWeight: 900, fontSize: aj.fontSize, lineHeight: st.lineHeight, color: st.color, whiteSpace: 'nowrap', textTransform: st.uppercase ? 'uppercase' : 'none', ...css }}>
          {l.join(' ')}
        </div>
      ))}
    </div>
  );
};

// ───────────────────────── HOOK-TEXT ─────────────────────────
const GanchoEscrito: React.FC<{ p: AutoEditProps & { params: { type: 'HOOK_TEXT' } } }> = ({ p }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { box, cover, text } = p.params;
  const entra = spring({ frame, fps, config: { damping: 14, stiffness: 180, mass: 0.6 } });
  const pad = Math.round(box.h * 0.12);
  const fundo = cover ? cover.color : '#ffffff';
  return (
    <>
      {cover ? <div style={{ position: 'absolute', left: cover.box.x, top: cover.box.y, width: cover.box.w, height: cover.box.h, backgroundColor: cover.color }} /> : null}
      <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, display: 'flex', alignItems: 'center', justifyContent: 'center', scale: String(interpolate(entra, [0, 1], [0.86, 1])), opacity: interpolate(frame, [0, 4], [0, 1], clamp) }}>
        <div style={{ backgroundColor: cover ? 'transparent' : fundo, borderRadius: cover ? 0 : 28, padding: pad }}>
          <TextoNaCaixa texto={text} box={{ w: box.w - pad * 2, h: box.h - pad * 2 }} estilo={{ color: contraste(fundo) }} />
        </div>
      </div>
    </>
  );
};

// ───────────────────────── ENDCARD ─────────────────────────
const CartaoFinal: React.FC<{ p: AutoEditProps & { params: { type: 'ENDCARD' } } }> = ({ p }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const ultimo = trechosEmFrames(p.timeline, fps).at(-1)!;
  const { headline, subline, ctaText, background } = p.params;
  const destaque = corDeDestaque(p.palette, background);
  const texto = contraste(background);
  const areaH = height - p.safeArea.top - p.safeArea.bottom;
  const tam = Math.min(width, areaH) / 1080;
  const sobe = (d: number) => ({ opacity: interpolate(frame, [d, d + 8], [0, 1], { ...clamp, easing: saida }), translate: `0 ${interpolate(frame, [d, d + 10], [36, 0], { ...clamp, easing: saida })}px` });
  return (
    <AbsoluteFill style={{ backgroundColor: background, overflow: 'hidden' }}>
      {/* último quadro congelado, desfocado a 1/8 do tamanho e ampliado (barato no Chrome) */}
      <div style={{ position: 'absolute', left: -width * 0.1, top: -height * 0.1, width: width / 8, height: height / 8, scale: String(8 * 1.2), transformOrigin: '0 0', filter: 'blur(5.5px)', opacity: 0.55, overflow: 'hidden' }}>
        <Freeze frame={0}>
          <Quadro src={resolverSrc(p.source.videoUrl)} source={p.source} reframe={p.reframe.mode === 'cover' ? p.reframe : { mode: 'cover', focus: { x: 0.5, y: 0.5 } }} box={{ x: 0, y: 0, w: width / 8, h: height / 8 }} startFrom={ultimo.from + ultimo.frames - 1} mudo />
        </Freeze>
      </div>
      <AbsoluteFill style={{ backgroundColor: background, opacity: interpolate(frame, [0, 8], [0.35, 0.8], clamp) }} />
      <div style={{ position: 'absolute', left: width * 0.08, width: width * 0.84, top: p.safeArea.top, height: areaH, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 36 * tam }}>
        <div style={sobe(2)}><TextoNaCaixa texto={headline} box={{ w: width * 0.84, h: 330 * tam }} estilo={{ fontSizePx: 104 * tam, color: texto }} css={{ letterSpacing: '-0.02em' }} /></div>
        {subline ? <div style={sobe(6)}><TextoNaCaixa texto={subline} box={{ w: width * 0.8, h: 150 * tam }} estilo={{ fontSizePx: 50 * tam, color: texto, lineHeight: 1.2 }} familia={INTER} css={{ fontWeight: 600, opacity: 0.9 }} /></div> : null}
        <div style={{ ...sobe(10), display: 'flex', alignItems: 'center', gap: 18 * tam, backgroundColor: destaque, color: contraste(destaque), borderRadius: 999, padding: `${30 * tam}px ${56 * tam}px`, fontFamily: INTER, fontWeight: 800, fontSize: 52 * tam, scale: String(interpolate(spring({ frame: frame - 10, fps, config: { damping: 12 } }), [0, 1], [0.8, 1])) }}>
          {ctaText}
          <span style={{ translate: `${Math.sin((frame / fps) * Math.PI * 2) * 6}px 0`, display: 'flex' }}><Seta cor={contraste(destaque)} tamanho={Math.round(50 * tam)} /></span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────── SPLIT-LP ─────────────────────────
const SplitPagina: React.FC<{ p: AutoEditProps & { params: { type: 'SPLIT_LP' } } }> = ({ p }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const topoH = Math.round(height * p.params.ratio);
  const { imageUrl, kind, scroll } = p.params.top;
  const desce = scroll ? interpolate(frame, [15, Math.max(16, durationInFrames - 15)], [0, 100], { ...clamp, easing: Easing.inOut(Easing.quad) }) : 0;
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, width, height: topoH, overflow: 'hidden', backgroundColor: kind === 'page' ? '#ffffff' : corClara(p.palette) }}>
        <Img src={resolverSrc(imageUrl)} style={{ width: '100%', height: '100%', objectFit: kind === 'page' ? 'cover' : 'contain', objectPosition: `50% ${desce}%`, display: 'block' }} />
      </div>
      <Fonte p={p} box={{ x: 0, y: topoH, w: width, h: height - topoH }} />
      <div style={{ position: 'absolute', left: 0, top: topoH - 3, width, height: 6, backgroundColor: '#ffffff', boxShadow: '0 0 18px rgba(0,0,0,0.35)' }} />
    </>
  );
};

// ───────────────────────── STORY ─────────────────────────
const Story: React.FC<{ p: AutoEditProps & { params: { type: 'STORY' } } }> = ({ p }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const { handle, timeAgo, replyLabel, bars } = p.params;
  const u = width / 1080;
  const topo = Math.max(28 * u, p.safeArea.top * 0.18);
  const avatarCor = corDeDestaque(p.palette, '#000000');
  const inicial = (p.brandName.trim()[0] ?? handle.replace(/^@/, '')[0] ?? '•').toUpperCase();
  const andamento = interpolate(frame, [0, durationInFrames - 1], [0, 1], clamp);
  const rodape = Math.max(36 * u, p.safeArea.bottom * 0.12);
  return (
    <>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 18%, rgba(0,0,0,0) 80%, rgba(0,0,0,0.4) 100%)' }} />
      <div style={{ position: 'absolute', left: 24 * u, right: 24 * u, top: topo, display: 'flex', gap: 8 * u }}>
        {Array.from({ length: bars }, (_, i) => (
          <div key={i} style={{ flex: 1, height: 6 * u, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.38)', overflow: 'hidden' }}>
            <div style={{ height: '100%', backgroundColor: '#fff', width: `${i < bars - 1 ? 100 : andamento * 100}%` }} />
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 30 * u, top: topo + 30 * u, display: 'flex', alignItems: 'center', gap: 20 * u, fontFamily: INTER, color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}>
        <div style={{ width: 84 * u, height: 84 * u, borderRadius: 999, padding: 5 * u, background: 'linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)' }}>
          <div style={{ width: '100%', height: '100%', borderRadius: 999, backgroundColor: avatarCor, border: `${4 * u}px solid #fff`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 38 * u, color: contraste(avatarCor), textShadow: 'none' }}>{inicial}</div>
        </div>
        <span style={{ fontWeight: 800, fontSize: 38 * u }}>{handle}</span>
        <span style={{ fontWeight: 600, fontSize: 34 * u, opacity: 0.75 }}>{timeAgo}</span>
      </div>
      <div style={{ position: 'absolute', left: 30 * u, right: 30 * u, top: height - rodape - 100 * u, height: 100 * u, display: 'flex', alignItems: 'center', gap: 26 * u }}>
        <div style={{ flex: 1, height: '100%', borderRadius: 999, border: `${3 * u}px solid rgba(255,255,255,0.85)`, display: 'flex', alignItems: 'center', paddingLeft: 40 * u, fontFamily: INTER, fontWeight: 600, fontSize: 36 * u, color: '#fff' }}>{replyLabel}</div>
        <svg width={64 * u} height={64 * u} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><path d="M12 21s-7.5-4.6-9.5-9.3C1.2 8.5 3.3 5 6.8 5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.5 0 5.6 3.5 4.3 6.7C19.5 16.4 12 21 12 21z" strokeLinejoin="round" /></svg>
        <svg width={64 * u} height={64 * u} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><path d="M22 3L10 14M22 3l-7 18-5-7-7-5 19-6z" strokeLinejoin="round" /></svg>
      </div>
    </>
  );
};

// ───────────────────────── REVIEW ─────────────────────────
const Estrela: React.FC<{ tam: number; cor: string }> = ({ tam, cor }) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" fill={cor} /></svg>
);
const Review: React.FC<{ p: AutoEditProps & { params: { type: 'REVIEW' } } }> = ({ p }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const topoH = Math.round(height * p.params.ratio);
  const { quote, author, stars } = p.params;
  const fundo = '#ffffff';
  const u = width / 1080;
  const entra = (d: number) => interpolate(spring({ frame: frame - d, fps, config: { damping: 16 } }), [0, 1], [0, 1]);
  const topoUtil = Math.max(p.safeArea.top * 0.6, 40 * u);
  const altTexto = topoH - topoUtil - (stars ? 110 : 30) * u - (author ? 90 : 20) * u - 40 * u;
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, width, height: topoH, backgroundColor: corClara(p.palette) }} />
      <div style={{ position: 'absolute', left: 48 * u, right: 48 * u, top: topoUtil, bottom: height - topoH + 36 * u, backgroundColor: fundo, borderRadius: 36 * u, boxShadow: '0 18px 50px rgba(0,0,0,0.18)', padding: `${34 * u}px ${44 * u}px`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 * u, opacity: entra(0), translate: `0 ${interpolate(entra(0), [0, 1], [40, 0])}px` }}>
        {stars ? (
          <div style={{ display: 'flex', gap: 8 * u }}>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} style={{ scale: String(entra(4 + i * 2)) }}><Estrela tam={64 * u} cor={i < stars ? '#F5B301' : '#D9D9D9'} /></div>
            ))}
          </div>
        ) : null}
        <TextoNaCaixa texto={`“${quote}”`} box={{ w: width - 2 * (48 + 44) * u, h: Math.max(80 * u, altTexto) }} estilo={{ fontSizePx: 64 * u, color: '#111111', align: 'left', lineHeight: 1.18 }} familia={INTER} css={{ fontWeight: 800, letterSpacing: '-0.01em' }} />
        {author ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 * u, fontFamily: INTER, fontWeight: 600, fontSize: 36 * u, color: '#555' }}>
            <span>— {author}</span>
            <svg width={38 * u} height={38 * u} viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#1D9BF0" /><path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" strokeWidth={2.4} fill="none" strokeLinecap="round" /></svg>
          </div>
        ) : null}
      </div>
      <Fonte p={p} box={{ x: 0, y: topoH, w: width, h: height - topoH }} />
    </>
  );
};

// ───────────────────────── NATIVE-SEARCH ─────────────────────────
const Busca: React.FC<{ p: AutoEditProps & { params: { type: 'NATIVE_SEARCH' } } }> = ({ p }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { query, introSec, typingCps, placeholder } = p.params;
  const total = Math.round(introSec * fps);
  const comecaDigitar = Math.round(0.25 * fps);
  const sai = Math.round(0.3 * fps);
  // 14 car/s; se a busca não cabe na janela, acelera só o necessário pra terminar 0,35 s antes da saída
  const cps = Math.max(typingCps, query.length / Math.max(0.3, (total - sai - comecaDigitar) / fps - 0.35));
  const n = Math.min(query.length, Math.max(0, Math.floor(((frame - comecaDigitar) / fps) * cps)));
  const digitado = query.slice(0, n);
  const cursor = Math.floor(frame / (fps * 0.5)) % 2 === 0 || n < query.length;
  const u = width / 1080;
  const saindo = interpolate(frame, [total - sai, total], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const barraTop = Math.max(p.safeArea.top, 70 * u) + 30 * u;
  return (
    <AbsoluteFill style={{ backgroundColor: '#ffffff', translate: `0 ${-saindo * height}px`, opacity: 1 - saindo * 0.2 }}>
      <div style={{ position: 'absolute', left: 50 * u, right: 50 * u, top: barraTop, height: 130 * u, borderRadius: 999, backgroundColor: '#F1F3F4', display: 'flex', alignItems: 'center', gap: 26 * u, padding: `0 ${44 * u}px`, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
        <svg width={56 * u} height={56 * u} viewBox="0 0 24 24" fill="none" stroke="#5f6368" strokeWidth={2.4}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" strokeLinecap="round" /></svg>
        <div style={{ flex: 1, minWidth: 0, fontFamily: INTER, fontWeight: 600, fontSize: 48 * u, color: n ? '#202124' : '#80868b', whiteSpace: 'nowrap', overflow: 'hidden', display: 'flex', justifyContent: measureFits(n ? digitado : placeholder, 48 * u, width - 300 * u) ? 'flex-start' : 'flex-end' }}>
          <span>{n ? digitado : placeholder}</span>
          {cursor ? <span style={{ display: 'inline-block', width: 4 * u, height: 56 * u, backgroundColor: '#1a73e8', marginLeft: 4 * u, alignSelf: 'center' }} /> : null}
        </div>
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ position: 'absolute', left: 70 * u, top: barraTop + (210 + i * 120) * u, display: 'flex', alignItems: 'center', gap: 30 * u, opacity: n >= ((i + 1) * query.length) / 5 ? 1 : 0 }}>
          <svg width={44 * u} height={44 * u} viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth={2.4}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" strokeLinecap="round" /></svg>
          <div style={{ width: (520 - i * 90) * u, height: 30 * u, borderRadius: 15 * u, backgroundColor: '#E8EAED' }} />
        </div>
      ))}
    </AbsoluteFill>
  );
};
/** Estimativa barata (Inter 600 ≈ 0,55 em por caractere) só pra decidir se o texto rola pra esquerda. */
const measureFits = (t: string, size: number, w: number) => t.length * size * 0.55 < w;

/** A Sequence zera o frame; a legenda conta o tempo da PEÇA. Repõe o deslocamento com uma Sequence negativa. */
const DeslocadaNoTempo: React.FC<{ de: number; children: React.ReactNode }> = ({ de, children }) => (
  <Sequence from={-de} layout="none">{children}</Sequence>
);

// ───────────────────────── composição ─────────────────────────
export const AutoEdit: React.FC<AutoEditProps> = (p) => {
  const prontas = useFontes(p.language, JSON.stringify(p.params) + (p.captions?.words.map((w) => w.word).join('') ?? ''));
  const { fps, width, height } = useVideoConfig();
  if (!prontas) return null;
  const tela = { x: 0, y: 0, w: width, h: height };
  const corpo = trechosEmFrames(p.timeline, fps).reduce((n, t) => n + t.frames, 0);
  const pr = p.params;
  // legenda automática (§2.2): terço de baixo da área do vídeo, acima da UI; some na busca de abertura e no end card
  const areaVideo = pr.type === 'REVIEW' ? { x: 0, y: Math.round(height * pr.ratio), w: width, h: height - Math.round(height * pr.ratio) }
    : pr.type === 'SPLIT_LP' ? { x: 0, y: Math.round(height * pr.ratio), w: width, h: height - Math.round(height * pr.ratio) } : tela;
  const caixaLeg = p.captions?.words.length ? caixaLegendaAutoEdit(p.format, p.safeArea, areaVideo) : null;
  const legendaDe = pr.type === 'NATIVE_SEARCH' ? Math.round(pr.introSec * fps) : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000', overflow: 'hidden' }}>
      {pr.type === 'SPLIT_LP' ? <SplitPagina p={p as never} />
        : pr.type === 'REVIEW' ? <Review p={p as never} />
        : <Fonte p={p} box={tela} />}
      {pr.type === 'HOOK_TEXT' ? (
        <Sequence name="Gancho escrito" from={0} durationInFrames={Math.max(1, Math.round(pr.endSec * fps))} layout="none"><GanchoEscrito p={p as never} /></Sequence>
      ) : null}
      {pr.type === 'STORY' ? <Story p={p as never} /> : null}
      {pr.type === 'NATIVE_SEARCH' ? (
        <Sequence name="Busca" from={0} durationInFrames={Math.round(pr.introSec * fps)} layout="none"><Busca p={p as never} /></Sequence>
      ) : null}
      {pr.type === 'ENDCARD' ? (
        <Sequence name="End card" from={corpo} durationInFrames={endCardFrames(p, fps)}><CartaoFinal p={p as never} /></Sequence>
      ) : null}
      {p.captions && caixaLeg && corpo > legendaDe ? (
        <Sequence name="Legenda automática" from={legendaDe} durationInFrames={corpo - legendaDe} layout="none">
          <AbsoluteFill style={{ translate: `0 0` }}>
            <DeslocadaNoTempo de={legendaDe}><LegendaAuto captions={p.captions} timeline={p.timeline} caixa={caixaLeg} ateSec={corpo / fps} /></DeslocadaNoTempo>
          </AbsoluteFill>
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
