import { EventosService, formatSse, RENDER_MIN_INTERVAL_MS, SseMessage } from './eventos.service';

describe('EventosService (barramento do SSE)', () => {
  afterEach(() => jest.useRealTimers());

  it('entrega só pra quem ouve o mesmo criativo e limpa o canal ao desinscrever', () => {
    const ev = new EventosService();
    const a: SseMessage[] = [];
    const b: SseMessage[] = [];
    const sa = ev.stream('c1').subscribe((m) => a.push(m));
    const sb = ev.stream('c2').subscribe((m) => b.push(m));
    ev.publish('c1', 'creative.updated', { state: 'SCRIPTS_READY' });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
    sa.unsubscribe();
    sb.unsubscribe();
    expect(ev.listenerCount('c1')).toBe(0);
    ev.publish('c1', 'cost.updated', { costUsd: 1 }); // sem ouvinte: descartado, sem erro
  });

  it('render.updated: no máximo 1 a cada 500 ms, e o último sempre chega', () => {
    jest.useFakeTimers();
    const ev = new EventosService();
    const got: SseMessage[] = [];
    ev.stream('c1').subscribe((m) => got.push(m));
    for (let i = 1; i <= 10; i++) ev.publish('c1', 'render.updated', { progress: i * 10 });
    expect(got.map((m) => (m.data as any).progress)).toEqual([10]);
    jest.advanceTimersByTime(RENDER_MIN_INTERVAL_MS);
    expect(got.map((m) => (m.data as any).progress)).toEqual([10, 100]);
  });

  it('formato SSE', () => {
    expect(formatSse({ event: 'job.updated', data: { a: 1 } })).toBe('event: job.updated\ndata: {"a":1}\n\n');
  });
});
