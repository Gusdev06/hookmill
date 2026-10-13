// Fábrica de dados direto no banco de teste: põe um criativo em QUALQUER estado da máquina, com os pré-requisitos
// coerentes (roteiros, rostos, cenas, renders, arquivos). Serve pros testes de transição e de isolamento.
// Só setup de teste: a API de verdade só muda estado pelo CreativeStateMachine. Dono: maquina-qa.
import { randomUUID } from 'node:crypto';
import { PERSONAS, WS, q } from './db.ts';

export const STATES = [
  'SCRIPTS_WRITING', 'SCRIPTS_READY', 'SCRIPTS_FAILED',
  'AVATAR_PENDING', 'FACES_GENERATING', 'FACES_READY', 'FACES_FAILED',
  'ENGINE_PENDING', 'SCENES_GENERATING', 'SCENES_FAILED',
  'EDIT_PENDING', 'RENDERING', 'RENDER_FAILED', 'RENDER_READY', 'APPROVED',
] as const;
export type CreativeState = (typeof STATES)[number];
type WsKey = keyof typeof WS;

const id = (p: string) => `qa_${p}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const ownerOf = (ws: WsKey) => (ws === 'A' ? PERSONAS.donoA.id : PERSONAS.donoB.id);
const rank = (s: CreativeState) => STATES.indexOf(s);
const atLeast = (s: CreativeState, min: CreativeState) => rank(s) >= rank(min);

export const BLOCKS = [
  { label: 'hook', startSec: 0, endSec: 3, speech: 'QA hook line.', visualPrompt: 'SOLO SHOT, person looks at camera' },
  { label: 'problem', startSec: 3, endSec: 10, speech: 'QA problem line.', visualPrompt: 'SOLO SHOT, person in kitchen' },
  { label: 'product', startSec: 10, endSec: 20, speech: 'QA product line.', visualPrompt: 'SOLO SHOT, person holds phone at chest height' },
  { label: 'cta', startSec: 20, endSec: 26, speech: 'QA call to action.', visualPrompt: 'SOLO SHOT, person smiles' },
];
export const EDIT_DEFAULTS = { templateId: 'clean', captionStyle: 'word', captionPosition: 'bottom', headline: null, ctaText: 'Start now', endCard: true };

export interface OfferRow { id: string; workspaceId: string; name: string }
export async function criarOferta(ws: WsKey, over: Record<string, unknown> = {}): Promise<OfferRow> {
  const o = {
    id: id('offer'),
    name: `QA Offer ${ws}`,
    language: 'en',
    kind: 'Subscription app',
    what: 'A budgeting app that finds forgotten subscriptions.',
    audience: 'Adults who lose track of money',
    promise: 'Find money you forgot you were spending.',
    cta: 'Start your free trial',
    ...over,
  } as Record<string, any>;
  await q(
    `insert into offers (id, workspace_id, name, language, kind, what, audience, promise, cta, field_sources, created_by_id, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb,$10,now())`,
    [o.id, WS[ws], o.name, o.language, o.kind, o.what, o.audience, o.promise, o.cta, ownerOf(ws)],
  );
  return { id: o.id, workspaceId: WS[ws], name: o.name };
}

async function criarArquivo(ws: WsKey, kind: string, mime: string, ext: string): Promise<string> {
  const fid = id('file');
  await q(
    `insert into files (id, workspace_id, kind, storage_key, mime_type, size_bytes) values ($1,$2,$3,$4,$5,$6)`,
    [fid, WS[ws], kind, `ws/${WS[ws]}/${kind}/${fid}.${ext}`, mime, 1024],
  );
  return fid;
}

export interface CriativoFabricado {
  id: string; workspaceId: string; state: CreativeState; offer: OfferRow;
  scriptIds: string[]; selectedScriptId: string | null;
  faceIds: string[]; selectedFaceId: string | null;
  sceneIds: string[]; renderIds: string[];
}

/** Cria um criativo já no `state` pedido, com tudo que esse estado pressupõe. */
export async function criarCriativoNoEstado(ws: WsKey, state: CreativeState, opts: { offer?: OfferRow; editDirty?: boolean } = {}): Promise<CriativoFabricado> {
  const offer = opts.offer ?? (await criarOferta(ws));
  const cid = id('creative');
  const W = WS[ws];
  const owner = ownerOf(ws);
  const engineSet = atLeast(state, 'SCENES_GENERATING');
  const editSet = atLeast(state, 'EDIT_PENDING');
  await q(
    `insert into creatives (id, workspace_id, offer_id, name, language, state, engine, engine_model, format, estimated_cost_usd,
                            generated_at, edit_settings, edit_dirty, created_by_id, updated_at)
     values ($1,$2,$3,$4,'en',$5,$6,$7,'VERTICAL_9_16',$8,$9,$10::jsonb,$11,$12,now())`,
    [
      cid, W, offer.id, `${offer.name} · QA ${state}`, state,
      engineSet ? 'SCENES' : null, engineSet ? 'kling-3.0' : null, engineSet ? 1.5 : null, engineSet ? new Date().toISOString() : null,
      JSON.stringify(editSet ? EDIT_DEFAULTS : {}), opts.editDirty ?? state === 'EDIT_PENDING', owner,
    ],
  );

  // roteiros A-D
  const scriptStatus = state === 'SCRIPTS_WRITING' ? 'WRITING' : state === 'SCRIPTS_FAILED' ? 'FAILED' : 'READY';
  const scriptIds: string[] = [];
  for (const letter of ['A', 'B', 'C', 'D']) {
    const sid = id('script');
    scriptIds.push(sid);
    await q(
      `insert into scripts (id, workspace_id, creative_id, letter, status, angle, rationale, duration_sec, blocks, fail_reason, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now())`,
      [
        sid, W, cid, letter, scriptStatus,
        scriptStatus === 'READY' ? `Angle ${letter}` : null, scriptStatus === 'READY' ? 'QA rationale' : null,
        scriptStatus === 'READY' ? 26 : null, JSON.stringify(scriptStatus === 'READY' ? BLOCKS : []),
        scriptStatus === 'FAILED' ? 'QA: provider failed' : null,
      ],
    );
  }
  const selectedScriptId = atLeast(state, 'AVATAR_PENDING') ? scriptIds[0] : null;

  // rostos (lote 1)
  const faceIds: string[] = [];
  const faceStatus =
    state === 'FACES_GENERATING' ? 'GENERATING' : state === 'FACES_FAILED' ? 'FAILED' : atLeast(state, 'FACES_READY') ? 'READY' : null;
  if (faceStatus) {
    for (let pos = 0; pos < 4; pos++) {
      const fid = id('face');
      faceIds.push(fid);
      const fileId = faceStatus === 'READY' ? await criarArquivo(ws, 'FACE_IMAGE', 'image/png', 'png') : null;
      await q(
        `insert into faces (id, workspace_id, creative_id, batch, position, description, status, file_id, fail_reason, updated_at)
         values ($1,$2,$3,1,$4,'QA: woman in her 30s, kitchen, natural light',$5,$6,$7,now())`,
        [fid, W, cid, pos, faceStatus, fileId, faceStatus === 'FAILED' ? 'QA: safety block' : null],
      );
    }
  }
  const selectedFaceId = atLeast(state, 'ENGINE_PENDING') ? faceIds[0] : null;
  await q(`update creatives set selected_script_id = $2, selected_face_id = $3, face_description = $4 where id = $1`, [
    cid, selectedScriptId, selectedFaceId, selectedScriptId ? 'QA: woman in her 30s, kitchen, natural light' : null,
  ]);

  // cenas (geração 1, uma por bloco)
  const sceneIds: string[] = [];
  if (engineSet) {
    for (const [index, b] of BLOCKS.entries()) {
      let status = 'READY';
      if (state === 'SCENES_GENERATING') status = index < 2 ? 'READY' : 'GENERATING';
      if (state === 'SCENES_FAILED') status = index === 2 ? 'FAILED' : 'READY';
      const clip = status === 'READY' ? await criarArquivo(ws, 'SCENE_CLIP', 'video/mp4', 'mp4') : null;
      const sid = id('scene');
      sceneIds.push(sid);
      await q(
        `insert into scenes (id, workspace_id, creative_id, generation, index, label, start_sec, end_sec, speech, visual_prompt,
                             status, progress, fail_reason, clip_file_id, words, updated_at)
         values ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now())`,
        [
          sid, W, cid, index, b.label, b.startSec, b.endSec, b.speech, b.visualPrompt, status,
          status === 'READY' ? 100 : status === 'GENERATING' ? 40 : 0,
          status === 'FAILED' ? 'QA: provider timeout' : null, clip,
          status === 'READY' ? JSON.stringify([{ word: 'QA', startSec: 0, endSec: 0.4 }]) : null,
        ],
      );
    }
  }

  // renders
  const renderIds: string[] = [];
  const renderStatus =
    state === 'RENDERING' ? 'RENDERING'
    : state === 'RENDER_FAILED' ? 'FAILED'
    : ['EDIT_PENDING', 'RENDER_READY', 'APPROVED'].includes(state) ? 'READY'
    : null;
  if (renderStatus) {
    const rid = id('render');
    renderIds.push(rid);
    const fileId = renderStatus === 'READY' ? await criarArquivo(ws, 'RENDER_VIDEO', 'video/mp4', 'mp4') : null;
    await q(
      `insert into renders (id, workspace_id, creative_id, status, stage, progress, frame, total_frames, settings, input,
                            fail_reason, failed_frame, file_id, duration_sec)
       values ($1,$2,$3,$4,$5,$6,$7,780,$8::jsonb,'{}'::jsonb,$9,$10,$11,$12)`,
      [
        rid, W, cid, renderStatus, renderStatus === 'RENDERING' ? 'rendering' : null,
        renderStatus === 'READY' ? 100 : renderStatus === 'RENDERING' ? 50 : 30,
        renderStatus === 'RENDERING' ? 390 : null, JSON.stringify(EDIT_DEFAULTS),
        renderStatus === 'FAILED' ? 'QA: render crashed' : null, renderStatus === 'FAILED' ? 233 : null,
        fileId, renderStatus === 'READY' ? 26 : null,
      ],
    );
    if (state === 'APPROVED') {
      await q(`update creatives set final_render_id = $2, approved_at = now(), approved_by_id = $3 where id = $1`, [cid, rid, owner]);
    }
  }

  return { id: cid, workspaceId: W, state, offer, scriptIds, selectedScriptId, faceIds, selectedFaceId, sceneIds, renderIds };
}

export async function estadoNoBanco(creativeId: string): Promise<CreativeState> {
  const [r] = await q<{ state: CreativeState }>('select state from creatives where id = $1', [creativeId]);
  return r?.state;
}
