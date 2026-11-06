import { SELECTION_LIMITS, availabilityOf, checkSelection, isSelectionRow, packKeysOf, selectionMaxOf, visibleToCustomer, type CatalogRow, type SelectionRow } from './catalogo';

const row = (o: Partial<CatalogRow>): CatalogRow => ({
  slug: 's', internalKey: 'FRAME:news', autoType: 'FRAME', frameId: 'news', pack: false, tier: 'EDIT', credits: 1, status: 'LIVE', exampleKey: 'k', ...o,
});

describe('catálogo de templates (templates-creditos-v1 §3)', () => {
  it('disponibilidade: edição e STATIC sim; IA coming_soon; aposentados retired; sem preço disabled; chat só com a flag', () => {
    expect(availabilityOf(row({}))).toEqual({ available: true, reason: null });
    expect(availabilityOf(row({ autoType: 'STATIC', tier: 'STATIC', credits: 2 })).available).toBe(true);
    expect(availabilityOf(row({ autoType: 'AVATAR_FACE', tier: 'AI', credits: 8 }))).toEqual({ available: false, reason: 'coming_soon' });
    // A6 (01/11): COLD_OPEN e ENDCARD voltam (só no lote de template); HOOK_TEXT/STORY/SPLIT_LP seguem aposentados
    expect(availabilityOf(row({ autoType: 'COLD_OPEN' }))).toEqual({ available: true, reason: null });
    expect(availabilityOf(row({ autoType: 'ENDCARD' }))).toEqual({ available: true, reason: null });
    expect(availabilityOf(row({ autoType: 'HOOK_TEXT' }))).toEqual({ available: false, reason: 'retired' });
    expect(availabilityOf(row({ autoType: 'REMIX_KLING', tier: 'AI', credits: null }))).toEqual({ available: false, reason: 'disabled' });
    expect(availabilityOf(row({ autoType: 'CHAT_DM' }), { ITERATE_TEMPLATES: 'off' }).available).toBe(false);
    expect(availabilityOf(row({ autoType: 'CHAT_DM' }), { ITERATE_TEMPLATES: 'on' }).available).toBe(true);
    expect(availabilityOf(row({ pack: true, autoType: null, credits: 10 })).available).toBe(true);
  });

  it('cliente só vê LIVE com vídeo e disponível', () => {
    expect(visibleToCustomer(row({}))).toBe(true);
    expect(visibleToCustomer(row({ exampleKey: null }))).toBe(true); // 02/11: exemplo opcional
    expect(visibleToCustomer(row({ status: 'HIDDEN' }))).toBe(false);
    expect(visibleToCustomer(row({ status: 'DRAFT' }))).toBe(false);
  });

  it('pack: só Edição LIVE disponível (sem STATIC, IA, pack, DRAFT), com ou sem vídeo', () => {
    const keys = packKeysOf([
      row({ internalKey: 'FRAME:news' }), row({ internalKey: 'HEADLINE', autoType: 'HEADLINE', exampleKey: null }),
      row({ internalKey: 'STATIC', autoType: 'STATIC', tier: 'STATIC', credits: 2 }), row({ internalKey: 'AVATAR_FACE', autoType: 'AVATAR_FACE', tier: 'AI', credits: 8 }),
      row({ internalKey: 'COLD_OPEN', autoType: 'COLD_OPEN', status: 'DRAFT' }), row({ internalKey: 'PACK', pack: true, autoType: null, credits: 10 }),
    ], { ITERATE_TEMPLATES: 'off' });
    expect(keys).toEqual(['FRAME:news', 'HEADLINE']);
  });

  // ───────── templates-multi-v1 (04/11) ─────────
  describe('seleção de vários templates', () => {
    const env = { ITERATE_TEMPLATES: 'off' };
    const sel = (o: Partial<SelectionRow>): SelectionRow => ({ ...row({}), outputs: 1, ...o });
    const rows: SelectionRow[] = [
      sel({ slug: 'news', internalKey: 'FRAME:news' }), sel({ slug: 'meme', internalKey: 'FRAME:meme', frameId: 'meme' }),
      sel({ slug: 'headline', internalKey: 'HEADLINE', autoType: 'HEADLINE', frameId: null, outputs: 3 }),
      sel({ slug: 'cuts', internalKey: 'CUT', autoType: 'CUT', frameId: null, outputs: 2 }),
      sel({ slug: 'static', internalKey: 'STATIC', autoType: 'STATIC', frameId: null, tier: 'STATIC', credits: 2 }),
      sel({ slug: 'pack', internalKey: 'PACK', autoType: null, frameId: null, pack: true, credits: 10, outputs: 12 }),
      sel({ slug: 'face', internalKey: 'AVATAR_FACE', autoType: 'AVATAR_FACE', frameId: null, tier: 'AI', credits: 8, outputs: 3, status: 'DRAFT' }),
      sel({ slug: 'chat', internalKey: 'CHAT_DM', autoType: 'CHAT_DM', frameId: null }),
      sel({ slug: 'selection', internalKey: 'SELECTION', autoType: null, frameId: null, credits: null, outputs: 0, status: 'HIDDEN' }),
      sel({ slug: 'draft', internalKey: 'FRAME:live', frameId: 'live', status: 'DRAFT' }),
      ...Array.from({ length: 10 }, (_, k) => sel({ slug: `f${k}`, internalKey: `FRAME:f${k}`, frameId: `f${k}` })),
    ];

    it('linha de sistema: reconhecida, nunca visível, fora do pack', () => {
      const s = rows.find((r) => r.slug === 'selection')!;
      expect(isSelectionRow(s)).toBe(true);
      expect(isSelectionRow(rows[0])).toBe(false);
      expect(visibleToCustomer(s, env)).toBe(false);
      expect(packKeysOf(rows, env)).not.toContain('SELECTION');
      expect(SELECTION_LIMITS).toEqual({ minTemplates: 2, maxTemplates: 12, maxVideos: 12, maxFrames: 8 });
    });

    it('ok: devolve os marcados na ordem do pedido', () => {
      const r = checkSelection(rows, ['static', 'news', 'headline'], false, env);
      expect(r.ok && r.picked.map((t) => t.slug)).toEqual(['static', 'news', 'headline']);
    });

    it('checagens na ordem do contrato: not_found (todos) → pack → ai_tier → indisponível (o 1º) → too_many_videos', () => {
      // `selection` e o DRAFT contam como inexistentes pro cliente; a equipe vê o DRAFT mas nunca a linha de sistema
      expect(checkSelection(rows, ['news', 'selection', 'draft', 'nope', 'pack'], false, env)).toEqual({ ok: false, code: 'TEMPLATE_SELECTION_INVALID', details: { reason: 'not_found', slugs: ['selection', 'draft', 'nope'] } });
      expect(checkSelection(rows, ['news', 'selection'], true, env)).toMatchObject({ details: { reason: 'not_found', slugs: ['selection'] } });
      expect(checkSelection(rows, ['news', 'pack', 'face'], true, env)).toMatchObject({ details: { reason: 'pack', slugs: ['pack'] } });
      expect(checkSelection(rows, ['news', 'face'], true, env)).toMatchObject({ details: { reason: 'ai_tier', slugs: ['face'] } });
      // CHAT_DM com a flag desligada: o cliente nem vê (not_found); a equipe vê e recebe TEMPLATE_UNAVAILABLE com o slug
      expect(checkSelection(rows, ['news', 'chat'], false, env)).toMatchObject({ details: { reason: 'not_found', slugs: ['chat'] } });
      expect(checkSelection(rows, ['news', 'chat'], true, env)).toEqual({ ok: false, code: 'TEMPLATE_UNAVAILABLE', details: { reason: 'disabled', slug: 'chat' } });
      // Headline 3 + Cortes 2 + 7 molduras = 12 passa; + 1 moldura = 13 não
      const seven = Array.from({ length: 7 }, (_, k) => `f${k}`);
      expect(checkSelection(rows, ['headline', 'cuts', ...seven], false, env).ok).toBe(true);
      expect(checkSelection(rows, ['headline', 'cuts', ...seven, 'f7'], false, env)).toEqual({ ok: false, code: 'TEMPLATE_SELECTION_INVALID', details: { reason: 'too_many_videos', slugs: [], videos: 13, maxVideos: 12 } });
    });

    it('04/11: ≤ 8 molduras (FRAME ≤ 8 do plano); a 9ª = too_many_frames com as molduras marcadas', () => {
      const eight = Array.from({ length: 8 }, (_, k) => `f${k}`);
      expect(checkSelection(rows, eight, false, env).ok).toBe(true);
      expect(checkSelection(rows, [...eight, 'headline'], false, env)).toEqual({ ok: true, picked: expect.any(Array) });
      expect(checkSelection(rows, [...eight, 'news'], false, env)).toEqual({
        ok: false, code: 'TEMPLATE_SELECTION_INVALID', details: { reason: 'too_many_frames', slugs: [...eight, 'news'], frames: 9, max: 8 },
      });
    });

    it('max por tipo: Σ outputs por autoType, FRAME fora', () => {
      expect(selectionMaxOf(rows.filter((r) => ['news', 'meme', 'headline', 'cuts', 'static'].includes(r.slug)))).toEqual({ HEADLINE: 3, CUT: 2, STATIC: 1 });
    });
  });
});
