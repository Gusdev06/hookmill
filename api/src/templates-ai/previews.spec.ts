// templates-ia-previas-v1 §3/§5.6: máquina de estados, fase pública e vista das prévias (puro, sem banco).
import type { SemanticVariationV2 } from '@maquina/contratos';
import { aiPreviewsOf, aiSettings, aiSettingsKey, aiPreviewsOn, producibleVariationsV2 } from './contract';
import { BATCH_TRANSITIONS, PREVIEW_TRANSITIONS, aiPhaseOf, batchFailureCode, previewFailureCode, durationOf, planningOutcome, previewCode, previewView, sameApproval, type PreviewRow } from './previews';

const v = (o: Partial<SemanticVariationV2> = {}): SemanticVariationV2 => ({
  id: 'V1', formatId: 'F09', faithful: false, title: 'Angle one', angle: 'A fresh angle', summary: 'Two sentences. Here.', audience: 'People', hypothesis: 'h',
  changes: [{ axis: 'angle', before: 'old', after: 'new' }], preserved: ['offer'], factRefs: ['offer.what'], requirements: [],
  beats: [
    { role: 'hook', speaker: 'presenter', text: 'Have you ever wondered about this simple thing?', visual: '', factRefs: [] },
    { role: 'mechanism', speaker: 'presenter', text: 'It organizes your week in a few clicks.', visual: '', factRefs: ['offer.what'] },
    { role: 'cta', speaker: 'presenter', text: 'Visit the website and see the demonstration.', visual: '', factRefs: ['offer.what'] },
  ],
  cast: [{ speaker: 'presenter', name: 'Maya', gender: 'female', description: 'A woman' }],
  status: 'hypothesis', reviewRequired: true, audienceFit: 'not_assessed', testInterpretation: 'concept_exploration_not_causal',
  ...o,
} as SemanticVariationV2);

describe('prévias IA: settings e flag', () => {
  it('lote de prévias mora em settings.aiPreviews; o de 04/11 em aiGeneration', () => {
    const p = { aiPreviews: { requestId: 'r', format: 'F10', fingerprint: 'x' } };
    expect(aiPreviewsOf(p)).toMatchObject({ format: 'F10', previews: true });
    expect(aiSettings({ aiGeneration: { requestId: 'r', format: 'F04', fingerprint: 'x', expectedCredits: 5 } })).toMatchObject({ format: 'F04' });
    expect(aiPreviewsOf({ aiGeneration: { requestId: 'r', format: 'F04', fingerprint: 'x' } })).toBeNull();
    expect(aiSettings({ aiPreviews: { requestId: 'r', format: 'F99', fingerprint: 'x' } })).toBeNull();
    expect(aiSettingsKey({ previews: true })).toBe('aiPreviews');
    expect(aiSettingsKey({})).toBe('aiGeneration');
    expect(aiPreviewsOn({ AI_PREVIEWS: 'on' })).toBe(true);
    expect(aiPreviewsOn({ AI_PREVIEWS: 'off' })).toBe(false);
    expect(aiPreviewsOn({})).toBe(false);
  });
});

describe('máquina de estados (§3.1/§3.2)', () => {
  it('transições da prévia: APPROVED é final, não existe DISCARDED, retry só de FAILED', () => {
    expect(PREVIEW_TRANSITIONS.APPROVE).toEqual({ from: ['READY'], to: 'APPROVED' });
    expect(PREVIEW_TRANSITIONS.REGENERATE).toEqual({ from: ['READY'], to: 'PLANNED' });
    expect(PREVIEW_TRANSITIONS.RETRY_IMAGING.from).toEqual(['FAILED']);
    expect(Object.values(PREVIEW_TRANSITIONS).some((t) => t.from.includes('APPROVED'))).toBe(false);
    expect(BATCH_TRANSITIONS.FIRST_APPROVAL.from).toEqual(['PLANNING', 'PLAN_READY']);
    expect(BATCH_TRANSITIONS.PLAN_FAILED.from).toEqual(['PLANNING']);
  });

  it('fim do planning: só PLANNING, sem aprovação, nada gerando; ≥ 2 READY = PLAN_READY', () => {
    const b = { status: 'PLANNING', approvals: 0 };
    expect(planningOutcome(b, [])).toBeNull(); // planejador inicial ainda não respondeu
    expect(planningOutcome(b, ['READY', 'IMAGING', 'READY'])).toBeNull();
    expect(planningOutcome(b, ['READY', 'READY', 'FAILED', 'FAILED'])).toBe('PREVIEWS_READY');
    expect(planningOutcome(b, ['READY', 'FAILED', 'FAILED'])).toBe('PLAN_FAILED');
    expect(planningOutcome({ status: 'PLANNING', approvals: 1 }, ['APPROVED', 'FAILED'])).toBeNull();
    expect(planningOutcome({ status: 'PLAN_READY', approvals: 0 }, ['READY', 'FAILED'])).toBeNull();
  });

  it('fase pública na ordem do contrato', () => {
    expect(aiPhaseOf('PLANNING', [])).toBe('planning');
    expect(aiPhaseOf('PLAN_READY', [])).toBe('previews_ready');
    expect(aiPhaseOf('PLAN_FAILED', [])).toBe('failed');
    expect(aiPhaseOf('LAUNCHED', ['rendering', 'ready'])).toBe('producing');
    expect(aiPhaseOf('LAUNCHED', ['ready', 'failed'])).toBe('done');
    expect(aiPhaseOf('LAUNCHED', ['failed', 'failed'])).toBe('failed');
    expect(aiPhaseOf('LAUNCHED', ['queued'])).toBe('producing');
  });

  it('idempotência do approve: mesma chave = mesmo conjunto (qualquer ordem) e mesmo crédito', () => {
    expect(sameApproval({ previewIds: ['a', 'b'], credits: 0 }, { previewIds: ['b', 'a'], credits: 0 })).toBe(true);
    expect(sameApproval({ previewIds: ['a'], credits: 0 }, { previewIds: ['a', 'b'], credits: 0 })).toBe(false);
    expect(sameApproval({ previewIds: ['a'], credits: 5 }, { previewIds: ['a'], credits: 0 })).toBe(false);
  });
});

describe('producibleVariation v2 (§4.2)', () => {
  it('guarda as primeiras produzíveis, recusa a com requirements e título/ângulo repetido', () => {
    const plan = { variations: [
      // P2 (cast_repeat, I1 07/11): cada candidata com apresentador próprio
      v({ title: 'One', angle: 'First thesis', cast: [{ speaker: 'presenter', name: 'Maya', gender: 'female', description: 'A woman' }] }),
      v({ title: 'Two', angle: 'Second', requirements: [{ kind: 'proof', description: 'need proof' }], cast: [{ speaker: 'presenter', name: 'Ana', gender: 'female', description: 'A woman' }] }),
      v({ title: 'one!', angle: 'Other', cast: [{ speaker: 'presenter', name: 'Bia', gender: 'female', description: 'A woman' }] }), // título igual normalizado
      v({ title: 'Three', angle: 'Third thesis', cast: [{ speaker: 'presenter', name: 'Leo', gender: 'male', description: 'A man' }] }),
      v({ title: 'Four', angle: 'Fourth thesis', cast: [{ speaker: 'presenter', name: 'Rui', gender: 'male', description: 'A man' }] }),
      v({ title: 'Five', angle: 'Fifth thesis', cast: [{ speaker: 'presenter', name: 'maya', gender: 'female', description: 'A woman' }] }), // mesmo nome da One
    ] };
    const picked = producibleVariationsV2(plan, { format: 'F09', evidence: '', max: 4 });
    expect(picked.map((x) => x.title)).toEqual(['One', 'Three', 'Four']);
    expect(producibleVariationsV2(plan, { format: 'F09', evidence: '', max: 1, accepted: [{ title: 'One', angle: 'x' }] }).map((x) => x.title)).toEqual(['Three']);
    expect(producibleVariationsV2(plan, { format: 'F10', evidence: '', max: 4 })).toEqual([]); // formato errado
  });
});

describe('vista da prévia (§5.6)', () => {
  const row = (o: Partial<PreviewRow> = {}): PreviewRow => ({
    id: 'i1', index: 1, previewStatus: 'READY', previewRegens: 1, previewRetries: 0, approvedAt: null, errorCode: null, failReason: null,
    payload: { preview: { version: 'semantic-v2', variation: v(), summary: 'Two sentences. Here.', cast: [{ speaker: 'presenter', name: 'Maya', gender: 'female', description: 'A woman', voiceId: 'Calm_Woman', voiceName: 'Calm woman', castingId: 'c1', faceId: 'f1' }], failStage: null, history: [], regens: [], retries: [] } },
    ...o,
  });
  const faces = new Map([['f1', { status: 'READY' as const, image: { fileId: 'file1', url: 'http://x', width: 1152, height: 2048 } }]]);

  it('ready: conteúdo, elenco com imagem, letra, tetos e estimativa', () => {
    const p = previewView(row(), faces, null);
    expect(p).toMatchObject({ letter: 'B', status: 'ready', title: 'Angle one', hook: 'Have you ever wondered about this simple thing?', pieceId: null, action: null, failStage: null });
    expect(p.cast[0]).toMatchObject({ name: 'Maya', voiceId: 'Calm_Woman', status: 'ready', image: { fileId: 'file1' } });
    expect(p.regenerations).toEqual({ used: 1, max: 3 });
    expect(p.retries).toEqual({ used: 0, max: 2 });
    expect(p.estimate).toEqual({ durationSec: durationOf(v()), credits: null });
  });

  it('planned sem variação = textos null e elenco vazio; failed com retry sobrando = action retry', () => {
    const empty = { preview: { version: 'semantic-v2', variation: null, summary: null, cast: [], failStage: null, history: [], regens: [], retries: [] } };
    expect(previewView(row({ previewStatus: 'PLANNED', payload: empty }), faces, 5)).toMatchObject({ status: 'planned', title: null, summary: null, cast: [], beats: [] });
    const failed = { preview: { ...(row().payload as { preview: object }).preview, failStage: 'imaging' } };
    expect(previewView(row({ previewStatus: 'FAILED', payload: failed, errorCode: 'PROVIDER_ERROR', failReason: 'x' }), faces, 5)).toMatchObject({ status: 'failed', failStage: 'imaging', action: 'retry', errorCode: 'PROVIDER_ERROR' });
    expect(previewView(row({ previewStatus: 'FAILED', previewRetries: 2, payload: failed }), faces, 5).action).toBeNull();
  });

  it('approved = pieceId do item e approvedAt', () => {
    const at = new Date('2026-11-07T10:00:00Z');
    expect(previewView(row({ previewStatus: 'APPROVED', approvedAt: at }), faces, 0)).toMatchObject({ status: 'approved', pieceId: 'i1', approvedAt: at.toISOString() });
    expect(previewCode('F10', 3)).toBe('AI-F10-D');
  });
});

describe('failureCode estável (MÉDIO-1)', () => {
  it('prévia: estágio + errorCode; lote: interrompido, planejador falhou ou poucas prévias', () => {
    expect(previewFailureCode('imaging', 'SAFETY_BLOCK')).toBe('image_blocked');
    expect(previewFailureCode('imaging', 'PROVIDER_TIMEOUT')).toBe('image_timeout');
    expect(previewFailureCode('imaging', 'PROVIDER_ERROR')).toBe('image_failed');
    expect(previewFailureCode('planning', 'INTERRUPTED')).toBe('planning_interrupted');
    expect(previewFailureCode('planning', 'PROVIDER_ERROR')).toBe('planning_failed');
    expect(batchFailureCode('INTERRUPTED', false)).toBe('planning_interrupted');
    expect(batchFailureCode('PROVIDER_ERROR', true)).toBe('too_few_previews');
    expect(batchFailureCode('SAFETY_BLOCK', false)).toBe('planning_failed');
  });
});
