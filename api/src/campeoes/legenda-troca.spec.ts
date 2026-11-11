// troca-texto-queimado-v1 §15.6.5 (F2): estado da troca de legenda em função pura de captionTrack + placa CAPTION.
import type { EditMap } from '@maquina/contratos';
import { trackFake } from '../medicao/troca';
import { captionBoxOf, captionSwapLigado, captionSwapOf, legendaMaxSecDoEnv, temCamadaLegenda, type EditMapLegenda } from './legenda-troca';

const style = { fontId: 'montserrat-800', uppercase: false, fontSizePx: 40, lineHeight: 1.15, color: '#fff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' };
const bg = { kind: 'none' as const, color: null, box: null };
const layer = (id: string, kind: 'caption' | 'headline', box: { x: number; y: number; w: number; h: number }) => ({ id, kind, startFrame: 0, endFrame: 90, box, background: bg, style, text: null, wordsPerPage: 3, source: 'vision' as const });
const mapa = (layers: unknown[], track?: EditMapLegenda['captionTrack']): EditMapLegenda => ({ version: 1, width: 720, height: 1280, fps: 30, frameCount: 90, cells: [], faceTrack: [], layers, overlaysOverFace: [], profile: null, keepEdit: {}, ...(track !== undefined && { captionTrack: track }) } as unknown as EditMapLegenda);
const track = (motivo: Parameters<typeof trackFake>[4] = null) => trackFake({ workspaceId: 'w', championId: 'c', videoUrl: 'u', editMap: mapa([]) as unknown as EditMap, words: [], durationSec: 30 }, 3, 'montserrat-800', { x: 0, y: 0, w: 1, h: 1 }, motivo);
const plate = (status: 'QUEUED' | 'RUNNING' | 'READY' | 'REJECTED' | 'FAILED', reason: string | null = null) => ({ status, reason, version: 1 });

describe('captionSwapOf', () => {
  it('sem leitura da legenda = unmeasured; null = sem legenda (none)', () => {
    expect(captionSwapOf(null, null).state).toBe('unmeasured');
    expect(captionSwapOf(mapa([]), null).state).toBe('unmeasured');
    expect(captionSwapOf(mapa([], null), null)).toEqual({ state: 'none', reason: null });
  });
  it('veredito do video reprovou = blocked com a razão, sem olhar a placa', () => {
    expect(captionSwapOf(mapa([], track('busy_background')), null)).toEqual({ state: 'blocked', reason: 'busy_background' });
    expect(captionSwapOf(mapa([], track('too_long')), plate('READY'))).toEqual({ state: 'blocked', reason: 'too_long' });
  });
  it('swap aprovado: sem placa, QUEUED e RUNNING = needs_plate; READY = ready; REJECTED/FAILED = blocked', () => {
    const m = mapa([], track());
    expect(captionSwapOf(m, null)).toEqual({ state: 'needs_plate', reason: null });
    expect(captionSwapOf(m, plate('QUEUED')).state).toBe('needs_plate');
    expect(captionSwapOf(m, plate('RUNNING')).state).toBe('needs_plate');
    expect(captionSwapOf(m, plate('READY'))).toEqual({ state: 'ready', reason: null });
    expect(captionSwapOf(m, plate('REJECTED', 'color_shift'))).toEqual({ state: 'blocked', reason: 'color_shift' });
    expect(captionSwapOf(m, plate('REJECTED', 'plate_rejected'))).toEqual({ state: 'blocked', reason: 'plate_rejected' });
    expect(captionSwapOf(m, plate('REJECTED', null))).toEqual({ state: 'blocked', reason: 'plate_rejected' });
    expect(captionSwapOf(m, plate('FAILED', 'plate_failed'))).toEqual({ state: 'blocked', reason: 'plate_failed' });
  });
});

describe('auxiliares', () => {
  it('captionBoxOf une só as camadas caption; sem camada = null', () => {
    const m = mapa([layer('a', 'caption', { x: 10, y: 100, w: 100, h: 50 }), layer('b', 'caption', { x: 50, y: 300, w: 200, h: 40 }), layer('h', 'headline', { x: 0, y: 0, w: 720, h: 80 })]);
    expect(captionBoxOf(m)).toEqual({ x: 10, y: 100, w: 240, h: 240 });
    expect(temCamadaLegenda(m)).toBe(true);
    expect(captionBoxOf(mapa([layer('h', 'headline', { x: 0, y: 0, w: 1, h: 1 })]))).toBeNull();
    expect(temCamadaLegenda(mapa([]))).toBe(false);
  });
  it('LEGENDA_MAX_SEC: inválido = 60', () => {
    expect(legendaMaxSecDoEnv(undefined)).toBe(60);
    expect(legendaMaxSecDoEnv('abc')).toBe(60);
    expect(legendaMaxSecDoEnv('-5')).toBe(60);
    expect(legendaMaxSecDoEnv('130')).toBe(130);
  });
});

describe('CAPTION_SWAP', () => {
  it('padrão off; só "on" liga', () => {
    const v = process.env.CAPTION_SWAP;
    try {
      delete process.env.CAPTION_SWAP; expect(captionSwapLigado()).toBe(false);
      process.env.CAPTION_SWAP = 'off'; expect(captionSwapLigado()).toBe(false);
      process.env.CAPTION_SWAP = 'ON'; expect(captionSwapLigado()).toBe(true);
    } finally { if (v === undefined) delete process.env.CAPTION_SWAP; else process.env.CAPTION_SWAP = v; }
  });
});
