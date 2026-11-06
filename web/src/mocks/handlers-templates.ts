/**
 * MSW handlers of the template gallery with credits (docs/contratos/templates-creditos-v1.md §7), on top of the Iterate mock:
 * a template = an Iterate batch (./iterate.ts) with the type locked, plus the run (lines, quote, reserve/charge/refund) here.
 *
 * Web-mock switches (in the page URL, kept in sessionStorage):
 *   ?mockaccess=paid|sample|internal (amostra.ts) · ?mockcredits=low (balance 0) · ?mockcredits=changed (next Generate = 409
 *   CREDITS_CHANGED, the quote goes up by 1) · ?mockcredits=reset (42 credits, 4 sample uses, empty history).
 * Fit by ad (deterministic by id): …0 ok · …1 burned captions · …2 no face · …3 never read (until a template uses it).
 * Uploads: file name with "mock-captions" / "mock-noface". Render failures: the Iterate triggers ([mock:render-fail:<TYPE>]).
 * templates-multi-v1: POST /ad-templates/use (2-12 slugs, the §3.1 checks in order), `fits` with `slugs` (+ `bySlug`), runs with
 * `selection`. A never-read ad (…3) lets a misfit through: it shows up in the plan as "left out" (`skipped`) and isn't charged.
 */
import { researchAdName } from "./research"
import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type {
  AdminTemplate, CreditEntryKind, CreditEntryView, CreditPool, CreditsSummary, EditableText, FrameTemplateId, IterateBatch,
  IterateTemplateRun, LibraryItem, RunLineView, StartIterateBody, TemplateCard, TemplateFit, TemplateFitsBody, TemplateRunRef, TemplateSelectionLimits,
  TemplateSourceRef, TemplateStatus, UpdateItemTextsBody, UpdateTemplateBody, UseTemplateBody, UseTemplatesBody, GrantCreditsBody,
} from "@/lib/api/types"
import { db, mockId, save as saveDb } from "./db"
import { mockAccess, markSampleUsed } from "./amostra"
import { mockWorkspaceOf } from "./auth"
import { adRows } from "./v2"
import { f2 } from "./variar"
import { advanceIter, it, iterView, launchIter, newIter, saveIter, type MIter, type MPiece } from "./iterate"
import { COPY_TEXTS, headlineBlockedReason, headlineCopied, headlineFitReady } from "./headline-f1b"

const u = (p: string) => API_URL + p
const ok = <D,>(data: D, status = 200) => HttpResponse.json({ success: true, data }, { status })
const fail = (code: string, statusCode: number, message: string, details?: unknown) =>
  HttpResponse.json({ success: false, error: { code, message, statusCode, ...(details ? { details } : {}) } }, { status: statusCode })
const body = async <T,>(r: Request) => ((await r.json().catch(() => ({}))) as T)
const pt = () => db.uiLocale === "PT_BR"
const L = (en: string, ptText: string) => (pt() ? ptText : en)

// ───────────── catalog ─────────────
type Spec = { type: string; frame?: FrameTemplateId; n?: number; variants?: string[] }
interface MTemplate {
  slug: string; key: string; tier: "EDIT" | "STATIC" | "AI"; category: TemplateCard["category"]; credits: number | null; outputs: number
  en: [string, string, string]; pt: [string, string, string]; needs: string[]; status: TemplateStatus; beta?: boolean; available: boolean
  example: boolean; uses: number; spec: Spec[]; pack?: boolean; order: number
}
const T = (
  slug: string, key: string, category: MTemplate["category"], en: [string, string, string], ptx: [string, string, string], spec: Spec[], extra: Partial<MTemplate> = {}
): MTemplate => ({ slug, key, tier: "EDIT", category, credits: 1, outputs: spec.reduce((a, s) => a + (s.n ?? 1), 0), en, pt: ptx, needs: [], status: "LIVE", available: true, example: true, uses: 10, spec, order: 0, ...extra })
const F = (id: FrameTemplateId): Spec[] => [{ type: "FRAME", frame: id }]

const SEED: MTemplate[] = [
  T("breaking-news", "FRAME:news", "frames", ["Breaking news", "Your ad plays inside a news broadcast. The headline is written from your promise and proof.", "1 video"], ["Notícia urgente", "Seu anúncio dentro de um telejornal. A manchete sai da sua promessa e da sua prova.", "1 vídeo"], F("news"), { uses: 34 }),
  T("meme-pov", "FRAME:meme", "frames", ["Meme POV", "\"POV:\" caption on top of your ad, written from the pain your buyer feels.", "1 video"], ["Meme POV", "Legenda \"POV:\" em cima do anúncio, escrita a partir da dor do seu comprador.", "1 vídeo"], F("meme"), { uses: 51 }),
  T("post-card", "FRAME:post_card", "frames", ["Post card", "Your hook as a social post, your ad below it. No verified badge, no made-up numbers.", "1 video"], ["Post", "Seu gancho como um post, o anúncio embaixo. Sem selo de verificado, sem número inventado.", "1 vídeo"], F("post_card"), { uses: 22 }),
  T("question-box", "FRAME:question_box", "frames", ["Question box", "A question sticker with the question your ad answers, your creator answering it.", "1 video"], ["Caixinha de pergunta", "Uma caixinha com a pergunta que seu anúncio responde, e sua criadora respondendo.", "1 vídeo"], F("question_box"), { uses: 18, needs: ["face", "clean_face"] }),
  T("top-5", "FRAME:ranking", "frames", ["Top 5", "A ranking built only from what your Brain says: pains, promise and proof.", "1 video"], ["Top 5", "Um ranking feito só com o que o Cérebro diz: dores, promessa e prova.", "1 vídeo"], F("ranking"), { uses: 12, needs: ["brain_points"] }),
  T("live", "FRAME:live", "frames", ["Live", "Your ad framed as a live broadcast, with your handle and limited comments.", "1 video"], ["Live", "Seu anúncio como uma live, com seu @ e poucos comentários.", "1 vídeo"], F("live"), { uses: 9, example: false }),
  T("split-screen", "FRAME:split_stack", "frames", ["Split screen", "Your creator on top. Below, stock footage that shows what she is saying.", "1 video"], ["Tela dividida", "Sua criadora em cima. Embaixo, imagens de banco que mostram o que ela fala.", "1 vídeo"], F("split_stack"), { uses: 27, needs: ["face"] }),
  T("gossip-page", "FRAME:gossip_page", "frames", ["Gossip page", "Your ad as a post from a gossip page, with a headline that teases the promise.", "1 video"], ["Página de fofoca", "Seu anúncio como post de página de fofoca, com uma manchete que provoca a promessa.", "1 vídeo"], F("gossip_page"), { uses: 15, needs: ["face"] }),
  T("new-headline", "HEADLINE", "headline", ["New headline", "Same video, three new written hooks over the first 3 seconds. Everything else stays.", "3 videos"], ["Headline nova", "Mesmo vídeo, três ganchos escritos novos nos 3 primeiros segundos. O resto fica igual.", "3 vídeos"], [{ type: "HEADLINE", n: 3 }], { uses: 63 }),
  T("native-search", "NATIVE_SEARCH", "headline", ["Native search", "Opens on a search bar typing the problem your hook names, then cuts to your ad.", "1 video"], ["Busca nativa", "Abre numa barra de busca digitando o problema do gancho, depois corta pro anúncio.", "1 vídeo"], [{ type: "NATIVE_SEARCH" }], { uses: 8 }),
  T("short-cuts", "CUT", "cuts", ["Short cuts", "15 s and 20 s versions that keep your hook, your proof and your call to action.", "2 videos"], ["Cortes curtos", "Versões de 15 s e 20 s que mantêm gancho, prova e chamada.", "2 vídeos"], [{ type: "CUT", variants: ["15", "20"] }], { uses: 30, needs: ["min_25s"] }),
  T("review", "REVIEW", "cuts", ["Review", "Your ad under a 5-star review written from your proof.", "1 video"], ["Avaliação", "Seu anúncio embaixo de uma avaliação 5 estrelas escrita a partir da sua prova.", "1 vídeo"], [{ type: "REVIEW" }], { uses: 6, needs: ["proof"] }),
  T("chat-dm", "CHAT_DM", "chat", ["Chat DM", "Your ad turned into a Direct conversation: a buyer asks, the brand answers. No person, no voice.", "1 video · 9:16"], ["Chat DM", "Seu anúncio vira uma conversa no Direct: o comprador pergunta, a marca responde.", "1 vídeo · 9:16"], [{ type: "CHAT_DM" }], { uses: 40, needs: ["speech"] }),
  T("person-motion", "PERSON_MOTION", "chat", ["Person + motion", "Your own creator in a box below, your promise animated above in sync with what she says.", "1 video · 9:16"], ["Pessoa + motion", "Sua criadora numa caixa embaixo, a promessa animada em cima no ritmo da fala.", "1 vídeo · 9:16"], [{ type: "PERSON_MOTION" }], { uses: 37, needs: ["face", "min_15s", "clean_face"] }),
  T("static-ad", "STATIC", "static", ["Static ad", "A new image ad made from your Brain, using your ad as reference. 9:16, 4:5 and 1:1.", "1 image"], ["Anúncio estático", "Uma imagem nova feita do seu Cérebro, com seu anúncio de referência. 9:16, 4:5 e 1:1.", "1 imagem"], [{ type: "STATIC" }], { tier: "STATIC", credits: 2, uses: 19 }),
  T("new-face", "AVATAR_FACE", "avatar", ["New face", "Same video, same voice, same edit. Only the face changes, three times.", "3 videos"], ["Rosto novo", "Mesmo vídeo, mesma voz, mesma edição. Só o rosto muda, três vezes.", "3 vídeos"], [], { tier: "AI", credits: 8, uses: 21, needs: ["face", "speech"], status: "DRAFT", available: false }),
  T("podcast-clip", "REMIX_PODCAST", "remix", ["Podcast clip", "A host asks, a guest answers. Opens after our quality test.", "1 video + 2 hooks"], ["Corte de podcast", "Um apresentador pergunta, um convidado responde. Abre depois do nosso teste de qualidade.", "1 vídeo + 2 ganchos"], [], { tier: "AI", credits: null, uses: 0, status: "HIDDEN", beta: true, available: false }),
  T("let-hookmill-pick", "PACK", "pack", ["Let HookMill pick", "We read your ad and pick the Edit templates that fit it best. You see the list and the total before anything runs.", "up to 12 videos"], ["Deixa o HookMill escolher", "A gente lê seu anúncio e escolhe os templates de Edição que mais encaixam. Você vê a lista e o total antes de rodar.", "até 12 vídeos"], [], { credits: 10, pack: true, uses: 44 }),
]
SEED.forEach((t, i) => (t.order = i))
/** the pack's lines, best fit first */
const PACK_SLUGS = ["new-headline", "chat-dm", "person-motion", "breaking-news", "meme-pov", "short-cuts", "post-card", "native-search"]

// ───────────── state ─────────────
interface MRun {
  runId: string; batchId: string; slug: string; pack: boolean; pool: CreditPool | null; status: "DRAFT" | "RESERVED" | "SETTLED"
  cap: number | null; excluded: string[]; texts: Record<string, EditableText[]>; held: number; charged: number; refunded: number; attempt: number
  bump: number; fit: TemplateFit; keyOf: Record<string, string>; createdAt: number; settledAt: number | null; championName: string; sourceKey: string
  /** templates-multi-v1: the checked slugs and the ones left out (slug "selection") */
  selection?: { slugs: string[]; skipped: { slug: string; reason: string }[] } | null
}
const LIMITS: TemplateSelectionLimits = { minTemplates: 2, maxTemplates: 12, maxVideos: 12, maxFrames: 8 }
/** the run's template name; a selection is the system row "Your selection" (not in the catalog) */
const runName = (r: MRun) => (r.selection ? L("Your selection", "Sua seleção") : nameOf(tplOf(r.slug)!))
interface MState { balance: number; sampleLeft: number; ledger: CreditEntryView[]; runs: MRun[]; catalog: MTemplate[]; read: string[] }
const KEY = "mock:templates:v1"
function load(): MState {
  if (typeof window !== "undefined") {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      try {
        return JSON.parse(raw) as MState
      } catch {}
    }
  }
  return fresh()
}
function fresh(): MState {
  const now = Date.now()
  return {
    balance: 42, sampleLeft: 4, runs: [], catalog: SEED.map((x) => ({ ...x })), read: [],
    ledger: [{ id: mockId("ce"), kind: "MANUAL", pool: "CREDITS", delta: 50, amount: 50, balanceAfter: 50, note: L("Paid by Pix", "Pago por Pix"), createdAt: new Date(now - 864e5).toISOString(), run: null, by: { id: "u_gusta", name: "Gusta" } },
      { id: mockId("ce"), kind: "RESERVE", pool: "CREDITS", delta: -8, amount: 8, balanceAfter: 42, note: null, createdAt: new Date(now - 36e5).toISOString(), run: { id: "tr_seed", batchId: "ib_seed", templateSlug: "new-face", templateName: "New face" }, by: null }],
  }
}
let S: MState = load()
function save() {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(S))
}
function captureFromUrl() {
  if (typeof window === "undefined") return
  const v = new URLSearchParams(window.location.search).get("mockcredits")
  if (!v || sessionStorage.getItem("mock:credits:seen") === `${v}${window.location.pathname}`) return
  sessionStorage.setItem("mock:credits:seen", `${v}${window.location.pathname}`)
  if (v === "reset") S = fresh()
  if (v === "low") S.balance = 0
  if (v === "changed") sessionStorage.setItem("mock:credits:changed", "1")
  save()
}

const access = () => mockAccess()
const poolNow = (): CreditPool | null => (access() === "INTERNAL" ? null : access() === "SAMPLE" ? "SAMPLE" : "CREDITS")
const balanceOf = (pool: CreditPool | null) => (pool === null ? null : pool === "SAMPLE" ? S.sampleLeft : S.balance)
function entry(kind: CreditEntryKind, pool: CreditPool, delta: number, amount: number, run: MRun | null, note: string | null = null) {
  if (pool === "SAMPLE") S.sampleLeft += delta
  else S.balance += delta
  const named = run && (run.selection || tplOf(run.slug))
  S.ledger.unshift({
    id: mockId("ce"), kind, pool, delta, amount, balanceAfter: pool === "SAMPLE" ? S.sampleLeft : S.balance, note, createdAt: new Date().toISOString(),
    run: run && named ? { id: run.runId, batchId: run.batchId, templateSlug: run.slug, templateName: runName(run) } : null, by: null,
  })
}
function summary(): CreditsSummary {
  captureFromUrl()
  const a = access()
  const pool = poolNow()
  return {
    unlimited: a === "INTERNAL", access: a, pool, balance: balanceOf(pool), credits: S.balance,
    sample: a === "SAMPLE" ? { left: S.sampleLeft, total: 4 } : null, held: S.runs.filter((r) => r.status === "RESERVED").reduce((x, r) => x + r.held, 0),
    checkoutUrl: null, contactEmail: "hello@hookmill.app",
  }
}

const tplOf = (slug: string) => S.catalog.find((t) => t.slug === slug) ?? null
const nameOf = (t: MTemplate) => (pt() ? t.pt[0] : t.en[0])
const visible = (t: MTemplate) => t.status === "LIVE" && t.example && t.available
const FRAME_STILL: Partial<Record<FrameTemplateId, string>> = { news: "news", meme: "meme", post_card: "post_card", question_box: "question_box", ranking: "ranking", split_stack: "split_stack", gossip_page: "gossip_page", live: "live" }
function poster(t: MTemplate) {
  const f = t.spec[0]?.frame
  if (f && FRAME_STILL[f]) return { id: `f_tpl_${t.slug}_p`, url: `/mock/frames/${FRAME_STILL[f]}.jpg`, mimeType: "image/jpeg" }
  if (t.tier === "STATIC") return { id: `f_tpl_${t.slug}_p`, url: "/mock/static-2k.jpg", mimeType: "image/jpeg" }
  return null
}
function card(t: MTemplate, fit: TemplateFit | null): TemplateCard {
  return {
    slug: t.slug, name: nameOf(t), description: pt() ? t.pt[1] : t.en[1], out: pt() ? t.pt[2] : t.en[2], tier: t.tier, tab: t.tier === "AI" ? "ai" : "edit",
    category: t.category, credits: t.credits, outputs: t.outputs, pack: !!t.pack, beta: !!t.beta, needs: t.needs,
    example: t.example ? { id: `f_tpl_${t.slug}`, url: "/mock/render.mp4", mimeType: "video/mp4", width: 360, height: 640, durationSec: 27 } : null,
    poster: poster(t), uses: t.uses, available: t.available, sampleOk: t.tier === "EDIT", fit,
  }
}

// ───────────── fit (§6) ─────────────
type Traits = { read: boolean; captions: boolean; face: boolean; writtenHeadline: boolean; durationSec: number; name: string }
const keyOfSource = (s: TemplateSourceRef) => Object.entries(s).find(([, v]) => v)?.join(":") ?? ""
function traits(s: TemplateSourceRef): Traits {
  const id = s.metaAdId ?? s.championId ?? s.creativeId ?? s.uploadId ?? s.researchAdId ?? ""
  const k = keyOfSource(s)
  if (s.uploadId) {
    const up = f2.uploads.find((x) => x.id === s.uploadId)
    const n = (up?.filename ?? "").toLowerCase()
    return { read: S.read.includes(k), captions: n.includes("mock-captions"), face: !n.includes("mock-noface"), writtenHeadline: !n.includes("mock-noheadline"), durationSec: up?.durationSec ?? 30, name: up?.filename.replace(/\.[^.]+$/, "") ?? "Upload" }
  }
  const h = [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 4
  const name = s.metaAdId
    ? adRows(metaOf(), new Set()).find((r) => r.metaAdId === s.metaAdId)?.name ?? "Meta ad"
    : s.creativeId ? (db.library as LibraryItem[]).find((l) => l.id === s.creativeId)?.name ?? "Library video" : s.researchAdId ? researchAdName(s.researchAdId) : "Winner"
  return { read: s.creativeId || s.championId ? true : h !== 3 || S.read.includes(k), captions: h === 1, face: h !== 2, writtenHeadline: true, durationSec: 32, name }
}
let metaWs = "ws_1"
const metaOf = () => db.v2.meta[metaWs] ?? Object.values(db.v2.meta)[0]
function fitOf(t: MTemplate, tr: Traits): TemplateFit {
  if (!t.available) return { level: "hard", reason: "coming_soon" }
  if (!tr.read) return { level: "unknown", reason: "not_read" }
  if (t.pack) return { level: "ok", reason: null }
  // troca-texto-queimado-v1 §15.4 (F1a): a written headline can't be replaced until the motor exists; only `add` is offered
  // F1b (?mockheadline): copied = fits; a blocked reason = hard with that reason
  if (t.key === "HEADLINE" && tr.writtenHeadline && !headlineCopied()) return { level: "hard", reason: headlineBlockedReason() ?? "headline_pending" }
  if (t.needs.includes("face") && !tr.face) return { level: "hard", reason: "no_face" }
  if (t.needs.includes("min_25s") && tr.durationSec < 25) return { level: "hard", reason: "short_video" }
  if (t.needs.includes("clean_face") && tr.captions) return { level: "soft", reason: "burned_captions" }
  return { level: "ok", reason: null }
}

// ───────────── the batch of a template ─────────────
const HEAD = [
  ["Nobody told me 3am wake-ups are a habit", "Ninguém me contou que acordar às 3h é hábito"],
  ["12 minutes a night, before bed", "12 minutos por noite, antes de dormir"],
  ["What changed after night three", "O que mudou depois da terceira noite"],
]
function textsFor(p: MPiece): EditableText[] {
  if (p.type === "HEADLINE") {
    const h = p.variant === "replace" ? COPY_TEXTS[p.n % COPY_TEXTS.length] : HEAD[p.n % HEAD.length]
    return [{ path: "text", label: "headline", value: L(h[0], h[1]), maxChars: 70, source: L("transcript 0:04", "transcrição 0:04") }]
  }
  if (p.type === "FRAME") {
    return [
      { path: "headline", label: "headline", value: L("Doctors are talking about the 12-minute sleep routine", "Médicos estão falando da rotina de 12 minutos"), maxChars: 80, source: L("Brain › promise", "Cérebro › promessa") },
      { path: "cta", label: "cta", value: L("Start tonight", "Comece hoje à noite"), maxChars: 24, source: L("Brain › CTA", "Cérebro › CTA") },
    ]
  }
  return []
}
function piecesFor(b: MIter, specs: { spec: Spec; tpl: MTemplate }[]) {
  const out: MPiece[] = []
  const keyOf: Record<string, string> = {}
  for (const { spec, tpl } of specs) {
    const variants = spec.variants ?? Array.from({ length: spec.n ?? 1 }, () => (spec.type === "HEADLINE" ? (headlineCopied() ? "replace" : "add") : spec.frame ?? ""))
    variants.forEach((v, k) => {
      const p: MPiece = {
        id: mockId("vi"), index: out.length, type: spec.type as MPiece["type"], variant: v, n: k,
        change: spec.type === "FRAME" ? { en: `Your ad inside the ${nameOf(tpl).toLowerCase()} frame.`, pt: `Seu anúncio dentro da moldura ${nameOf(tpl).toLowerCase()}.` }
          : spec.type === "CUT" ? { en: `A ${v} s version that keeps hook, proof and CTA.`, pt: `Uma versão de ${v} s com gancho, prova e chamada.` }
          : spec.type === "HEADLINE" && headlineCopied() ? { en: "Only the headline changes: same place, same style. Cuts, voice and framing stay.", pt: "Só a headline muda: mesmo lugar, mesmo estilo. Cortes, voz e enquadramento ficam." }
          : spec.type === "HEADLINE" ? { en: "Adds a headline band in the brand color. The rest of the video stays the same.", pt: "Põe uma faixa de headline na cor da marca. O resto do vídeo fica igual." }
          : { en: (tpl.en[1]), pt: tpl.pt[1] },
        inZip: true, leftOutAt: null, creativeId: null, inLibrary: false, failFirst: null, sec: spec.type === "CUT" ? Number(v) : b.durationSec,
        ...(spec.frame ? { frame: spec.frame } : {}),
      }
      out.push(p)
      keyOf[p.id] = tpl.key
    })
  }
  return { pieces: out, keyOf }
}

const runOf = (batchId: string) => S.runs.find((r) => r.batchId === batchId) ?? null
const batchOf = (id: string) => it.batches.find((b) => b.id === id && !b.archived) ?? null

function lineViews(run: MRun, b: MIter): RunLineView[] {
  const m = new Map<string, RunLineView>()
  for (const p of b.pieces) {
    if (run.excluded.includes(p.id)) continue
    const key = run.keyOf[p.id]
    const t = S.catalog.find((x) => x.key === key)
    if (!t) continue
    const l = m.get(key) ?? { key, slug: t.slug, name: nameOf(t), tier: t.tier, credits: t.credits ?? 1, pieces: 0, state: run.status === "DRAFT" ? "planned" : run.status === "RESERVED" ? "held" : "charged", delivered: null }
    l.pieces++
    m.set(key, l)
  }
  return [...m.values()]
}
/** templates-multi-v1 §3.4 (04/11): the selection's plan keeps an unchecked line (pieces 0, out of the quote), after the checked ones */
function shownLines(run: MRun, b: MIter): RunLineView[] {
  const lines = lineViews(run, b)
  if (!run.selection || run.status !== "DRAFT") return lines
  for (const p of b.pieces) {
    if (!run.excluded.includes(p.id)) continue
    const t = S.catalog.find((x) => x.key === run.keyOf[p.id])
    if (!t || lines.some((l) => l.slug === t.slug)) continue
    lines.push({ key: t.key, slug: t.slug, name: nameOf(t), tier: t.tier, credits: t.credits ?? 1, pieces: 0, state: "planned", delivered: null })
  }
  return lines
}
function quoteOf(run: MRun, b: MIter) {
  const sum = lineViews(run, b).reduce((a, l) => a + l.credits, 0)
  return Math.min(run.cap ?? Infinity, sum) + run.bump
}
/** §4.3: everything terminal → charge what was delivered, refund the rest */
function settle(run: MRun, v: IterateBatch) {
  if (run.status !== "RESERVED" || v.status !== "LAUNCHED") return
  if (!v.pieces.every((p) => p.status === "ready" || p.status === "failed" || p.status === "left_out")) return
  const b = batchOf(run.batchId)!
  const delivered = lineViews(run, b).filter((l) => v.pieces.some((p) => run.keyOf[p.id] === l.key && p.status === "ready")).reduce((a, l) => a + l.credits, 0)
  const charge = Math.max(0, Math.min(run.cap ?? Infinity, delivered) - run.charged)
  const refund = run.held - Math.min(run.held, charge)
  if (run.pool) {
    entry("CHARGE", run.pool, 0, Math.min(run.held, charge), run)
    if (refund > 0) entry("REFUND", run.pool, refund, refund, run)
  }
  run.charged += Math.min(run.held, charge)
  run.refunded += refund
  run.held = 0
  run.status = "SETTLED"
  run.settledAt = Date.now()
  save()
}
function view(b: MIter): IterateBatch {
  const run = runOf(b.id)!
  const raw = iterView(advanceIter(b))
  const v: IterateBatch = { ...raw, quizEnabled: false } as IterateBatch
  if (raw.status === "PLAN_READY") {
    v.pieces = raw.pieces.filter((p) => !run.excluded.includes(p.id))
    v.notSelected = raw.pieces.filter((p) => run.excluded.includes(p.id))
  }
  // the burned-captions misfit: the plan comes without the piece and the blocked type in insight.captionBlocked
  if (run.fit.level === "soft" && v.insight && raw.status === "PLAN_READY") {
    v.insight = { ...v.insight, captionBlocked: v.pieces.map((p) => ({ type: p.type, template: p.frame?.template ?? null, reason: "burned_captions" as const })) }
    v.pieces = []
  }
  // f1a-handoff: HEADLINE `replace` doesn't appear in the plan nor count in the quote
  if (run.fit.level === "hard" && String(run.fit.reason ?? "").startsWith("headline_") && raw.status === "PLAN_READY") v.pieces = []
  settle(run, v)
  const quote = quoteOf(run, b)
  const balance = run.status === "DRAFT" ? balanceOf(run.pool) : balanceOf(run.pool)
  const template: IterateTemplateRun = {
    runId: run.runId, slug: run.slug, name: runName(run), pack: run.pack, tier: run.selection ? "EDIT" : tplOf(run.slug)!.tier, status: run.status, fit: run.fit, cap: run.cap,
    selection: run.selection
      ? { slugs: run.selection.slugs, skipped: run.selection.skipped.map((x) => ({ slug: x.slug, name: tplOf(x.slug) ? nameOf(tplOf(x.slug)!) : x.slug, reason: x.reason })) }
      : null,
    lines: shownLines(run, b), quote, balance, after: balance === null ? null : balance - quote, enough: balance === null || balance >= quote, pool: run.pool,
    held: run.held, charged: run.charged, refunded: run.refunded,
    texts: raw.status === "PLAN_READY" ? v.pieces.map((p) => ({ pieceId: p.id, items: run.texts[p.id] ?? [] })).filter((x) => x.items.length) : [],
  }
  return { ...v, template }
}

const roleOf = (r: Request) => (typeof window !== "undefined" && sessionStorage.getItem("mock:role")) || mockWorkspaceOf(r.headers.get("Authorization")).role
const sourceOfQuery = (url: string): TemplateSourceRef | null => {
  const q = new URL(url).searchParams
  for (const k of ["championId", "metaAdId", "creativeId", "uploadId", "researchAdId"] as const) if (q.get(k)) return { [k]: q.get(k)! }
  return null
}

export const templateHandlers = [
  http.get(u("/credits"), () => ok(summary())),
  http.get(u("/credits/ledger"), () => {
    captureFromUrl()
    return ok({ items: S.ledger.filter((e) => (access() === "SAMPLE" ? true : e.pool === "CREDITS")), nextCursor: null })
  }),
  http.get(u("/ad-templates/runs"), () => {
    const items: TemplateRunRef[] = S.runs.map((r) => ({
      id: r.runId, batchId: r.batchId, templateSlug: r.slug, templateName: runName(r), pack: r.pack, status: r.status, held: r.held, charged: r.charged,
      refunded: r.refunded, pool: r.pool, championName: r.championName, createdAt: new Date(r.createdAt).toISOString(), settledAt: r.settledAt ? new Date(r.settledAt).toISOString() : null,
      selection: r.selection ? { slugs: r.selection.slugs } : null,
    }))
    return ok({ items, nextCursor: null })
  }),
  http.get(u("/ad-templates"), async ({ request }) => {
    captureFromUrl()
    metaWs = mockWorkspaceOf(request.headers.get("Authorization")).id
    if (roleOf(request) === "CLIENT") return fail("FORBIDDEN", 403, "Clients can't use templates.")
    const src = sourceOfQuery(request.url)
    const tr = src ? traits(src) : null
    await delay(sessionStorage.getItem("mock:templates") === "loading" ? "infinite" : 350)
    const list = [...S.catalog].sort((a, b) => a.order - b.order).filter(visible)
    const pack = list.find((t) => t.pack)
    return ok({
      items: list.filter((t) => !t.pack).map((t) => card(t, tr ? fitOf(t, tr) : null)),
      pack: pack ? card(pack, tr ? fitOf(pack, tr) : null) : null,
      credits: summary(), fitsFor: src && tr ? { championId: src.championId ?? null, read: tr.read } : null,
      selection: LIMITS,
    })
  }),
  http.post(u("/ad-templates/fits"), async ({ request }) => {
    metaWs = mockWorkspaceOf(request.headers.get("Authorization")).id
    const b = await body<TemplateFitsBody>(request)
    if (!!b.slug === !!b.slugs) return fail("VALIDATION_ERROR", 400, "Send slug or slugs.", { fields: [{ field: "slug", rule: "exactlyOneOf:slug,slugs" }] })
    if (b.slugs) {
      // §3.2: the selection's fit (unknown if not read · hard if any is hard · soft if any is soft · ok) + each one in `bySlug`
      if (b.slugs.length < LIMITS.minTemplates || b.slugs.length > LIMITS.maxTemplates || new Set(b.slugs).size !== b.slugs.length)
        return fail("VALIDATION_ERROR", 400, "2-12 distinct slugs.", { fields: [{ field: "slugs", rule: "arrayUnique" }] })
      const ts = b.slugs.map(tplOf)
      if (ts.some((x) => !x || !visible(x))) return fail("NOT_FOUND", 404, "Not found.")
      await delay(250)
      return ok({
        items: b.sources.map((s) => {
          const tr = traits(s)
          const bySlug = ts.map((x) => ({ slug: x!.slug, fit: fitOf(x!, tr) }))
          const hard = bySlug.find((x) => x.fit.level === "hard")
          const fit: TemplateFit = !tr.read ? { level: "unknown", reason: "not_read" } : hard ? hard.fit : bySlug.find((x) => x.fit.level === "soft")?.fit ?? { level: "ok", reason: null }
          return { source: s, read: tr.read, championId: s.championId ?? null, fit, bySlug }
        }),
      })
    }
    const t = tplOf(b.slug!)
    if (!t) return fail("NOT_FOUND", 404, "Not found.")
    await delay(250)
    return ok({ items: b.sources.map((s) => { const tr = traits(s); return { source: s, read: tr.read, championId: s.championId ?? null, fit: fitOf(t, tr) } }) })
  }),
  http.get(u("/ad-templates/:slug"), ({ params, request }) => {
    const t = tplOf(String(params.slug))
    if (!t || !visible(t)) return fail("NOT_FOUND", 404, "Not found.")
    const src = sourceOfQuery(request.url)
    return ok(card(t, src ? fitOf(t, traits(src)) : null))
  }),
  // templates-multi-v1 §3.1: several checked templates, one batch, price = the sum (no cap)
  http.post(u("/ad-templates/use"), async ({ request }) => {
    metaWs = mockWorkspaceOf(request.headers.get("Authorization")).id
    if (roleOf(request) === "CLIENT") return fail("FORBIDDEN", 403, "Clients can't use templates.")
    const b = await body<UseTemplatesBody>(request)
    const slugs = Array.isArray(b.slugs) ? b.slugs : []
    const src: TemplateSourceRef = Object.fromEntries(Object.entries(b).filter(([k, v]) => ["championId", "metaAdId", "creativeId", "uploadId", "researchAdId"].includes(k) && v))
    if (slugs.length < LIMITS.minTemplates || slugs.length > LIMITS.maxTemplates || new Set(slugs).size !== slugs.length || slugs.some((x) => typeof x !== "string" || !x || x.length > 64))
      return fail("VALIDATION_ERROR", 400, "2-12 distinct slugs.", { fields: [{ field: "slugs", rule: "arrayUnique" }] })
    if (Object.keys(src).length !== 1) return fail("VALIDATION_ERROR", 400, "Send exactly one source.", { fields: [{ field: "uploadId", rule: "exactly_one" }] })
    const found = slugs.map(tplOf)
    const missing = slugs.filter((x, i) => !found[i] || !visible(found[i]!))
    if (missing.length) return fail("TEMPLATE_SELECTION_INVALID", 422, "Unknown template.", { reason: "not_found", slugs: missing })
    const list = found as MTemplate[]
    const packs = list.filter((x) => x.pack).map((x) => x.slug)
    if (packs.length) return fail("TEMPLATE_SELECTION_INVALID", 422, "The pack can't be selected.", { reason: "pack", slugs: packs })
    const ai = list.filter((x) => x.tier === "AI").map((x) => x.slug)
    if (ai.length) return fail("TEMPLATE_SELECTION_INVALID", 422, "AI templates can't be selected.", { reason: "ai_tier", slugs: ai })
    const off = list.find((x) => !x.available || x.beta || x.credits == null)
    if (off) return fail("TEMPLATE_UNAVAILABLE", 422, "Not available.", { reason: "coming_soon", slug: off.slug })
    const frames = list.filter((x) => x.category === "frames").map((x) => x.slug)
    if (frames.length > LIMITS.maxFrames) return fail("TEMPLATE_SELECTION_INVALID", 422, "Too many frames.", { reason: "too_many_frames", slugs: frames, frames: frames.length, max: LIMITS.maxFrames })
    const videos = list.reduce((a, x) => a + x.outputs, 0)
    if (videos > LIMITS.maxVideos) return fail("TEMPLATE_SELECTION_INVALID", 422, "Too many videos.", { reason: "too_many_videos", slugs: [], videos, maxVideos: LIMITS.maxVideos })
    const pool = poolNow()
    if (pool === "SAMPLE") {
      const paid = list.filter((x) => x.tier !== "EDIT").map((x) => x.slug)
      if (paid.length) return fail("PAYMENT_REQUIRED", 402, "Paid plan.", { reason: "sample_tier", unlock: { pieces: 0 }, slugs: paid })
      if (S.sampleLeft <= 0) return fail("PAYMENT_REQUIRED", 402, "Sample used.", { reason: "sample_used", unlock: { pieces: 0 } })
      const need = list.reduce((a, x) => a + (x.credits ?? 0), 0)
      if (need > S.sampleLeft) return fail("INSUFFICIENT_CREDITS", 402, "Not enough sample uses.", { need, balance: S.sampleLeft, pool: "SAMPLE" })
    }
    const tr = traits(src)
    const fits = list.map((x) => fitOf(x, { ...tr, read: true }))
    const hard = list.map((x, i) => ({ slug: x.slug, reason: fits[i].reason ?? "" })).filter((_, i) => fits[i].level === "hard")
    if (tr.read && hard.length) return fail("TEMPLATE_DOESNT_FIT", 422, "Doesn't fit.", { reason: hard[0].reason, slug: hard[0].slug, items: hard })
    const offers = db.offers
    if (!b.offerId && offers.length !== 1) return fail("OFFER_REQUIRED", 422, "Pick the offer.", { offers: offers.map((o) => ({ id: o.id, name: o.name })) })
    const offerId = b.offerId ?? offers[0].id
    await delay(300)
    const nb = newIter({ offerId, uploadId: src.uploadId ?? null, sourceCreativeId: src.creativeId ?? null, name: tr.name, durationSec: tr.durationSec, width: 1080, height: 1920, filename: "", sample: pool === "SAMPLE" })
    if (tr.read) nb.startIndex = 9
    // not read before: the misfits only show up after the Reading → left out, not charged (M6)
    const fitting = list.filter((_, i) => fits[i].level !== "hard")
    const { pieces, keyOf } = piecesFor(nb, fitting.flatMap((x) => x.spec.map((spec) => ({ spec, tpl: x }))))
    nb.pieces = pieces
    const fit: TemplateFit = fitting.length ? { level: "ok", reason: null } : fits[0]
    const run: MRun = {
      runId: mockId("tr"), batchId: nb.id, slug: "selection", pack: false, pool, status: "DRAFT", cap: null, excluded: [],
      texts: Object.fromEntries(pieces.map((p) => [p.id, textsFor(p)])), held: 0, charged: 0, refunded: 0, attempt: 0, bump: 0, fit,
      keyOf, createdAt: Date.now(), settledAt: null, championName: tr.name, sourceKey: keyOfSource(src), selection: { slugs, skipped: hard },
    }
    if (!S.read.includes(run.sourceKey)) S.read.push(run.sourceKey)
    S.runs.unshift(run)
    save()
    saveIter()
    return ok(view(nb), 202)
  }),
  http.post(u("/ad-templates/:slug/use"), async ({ params, request }) => {
    metaWs = mockWorkspaceOf(request.headers.get("Authorization")).id
    if (roleOf(request) === "CLIENT") return fail("FORBIDDEN", 403, "Clients can't use templates.")
    const t = tplOf(String(params.slug))
    if (!t || !visible(t)) return fail("NOT_FOUND", 404, "Not found.")
    if (!t.available) return fail("TEMPLATE_UNAVAILABLE", 422, "Not available.", { reason: "coming_soon" })
    const b = await body<UseTemplateBody>(request)
    const src: TemplateSourceRef = Object.fromEntries(Object.entries(b).filter(([k, v]) => ["championId", "metaAdId", "creativeId", "uploadId", "researchAdId"].includes(k) && v))
    if (Object.keys(src).length !== 1) return fail("VALIDATION_ERROR", 400, "Send exactly one source.", { fields: [{ field: "uploadId", rule: "exactly_one" }] })
    const pool = poolNow()
    if (pool === "SAMPLE" && t.tier !== "EDIT") return fail("PAYMENT_REQUIRED", 402, "Paid plan.", { reason: "sample_tier", unlock: { pieces: 0 } })
    if (pool === "SAMPLE" && S.sampleLeft <= 0) return fail("PAYMENT_REQUIRED", 402, "Sample used.", { reason: "sample_used", unlock: { pieces: 0 } })
    const tr = traits(src)
    const fit = fitOf(t, { ...tr, read: true })
    if (tr.read && fit.level === "hard") return fail("TEMPLATE_DOESNT_FIT", 422, "Doesn't fit.", { reason: fit.reason })
    const offers = db.offers
    if (!b.offerId && offers.length !== 1) return fail("OFFER_REQUIRED", 422, "Pick the offer.", { offers: offers.map((o) => ({ id: o.id, name: o.name })) })
    const offerId = b.offerId ?? offers[0].id
    await delay(300)
    const nb = newIter({ offerId, uploadId: src.uploadId ?? null, sourceCreativeId: src.creativeId ?? null, name: tr.name, durationSec: tr.durationSec, width: 1080, height: 1920, filename: "", sample: pool === "SAMPLE" })
    // already read = born in PLANNING (the reading is cached per ad)
    if (tr.read) nb.startIndex = 9
    const specs = t.pack
      ? PACK_SLUGS.map(tplOf).filter((x): x is MTemplate => !!x && fitOf(x, { ...tr, read: true }).level === "ok").flatMap((x) => x.spec.map((spec) => ({ spec, tpl: x })))
      : t.spec.map((spec) => ({ spec, tpl: t }))
    const { pieces, keyOf } = piecesFor(nb, specs)
    nb.pieces = pieces
    const run: MRun = {
      runId: mockId("tr"), batchId: nb.id, slug: t.slug, pack: !!t.pack, pool, status: "DRAFT", cap: t.pack ? t.credits : null, excluded: [],
      texts: Object.fromEntries(pieces.map((p) => [p.id, textsFor(p)])), held: 0, charged: 0, refunded: 0, attempt: 0, bump: 0, fit,
      keyOf, createdAt: Date.now(), settledAt: null, championName: tr.name, sourceKey: keyOfSource(src),
    }
    if (!S.read.includes(run.sourceKey)) S.read.push(run.sourceKey)
    S.runs.unshift(run)
    save()
    saveIter()
    return ok(view(nb), 202)
  }),

  // ───── the Iterate routes, for template batches only (anything else falls through to handlers-iterate)
  http.get(u("/iterate/:id"), ({ params }) => {
    const b = batchOf(String(params.id))
    if (!b || !runOf(b.id)) return undefined
    return ok(view(b))
  }),
  http.patch(u("/iterate/:id/items/:itemId/texts"), async ({ params, request }) => {
    const b = batchOf(String(params.id))
    const run = b ? runOf(b.id) : null
    if (!b || !run) return fail("NOT_FOUND", 404, "Not found.")
    if (iterView(b).status !== "PLAN_READY") return fail("INVALID_STATE", 409, "Not in PLAN_READY.", { state: iterView(b).status, allowed: ["PLAN_READY"] })
    const items = run.texts[String(params.itemId)]
    if (!items?.length) return fail("EDIT_NOT_SUPPORTED", 422, "No editable text.")
    const { texts } = await body<UpdateItemTextsBody>(request)
    // F1b (§16.3): a copied HEADLINE is measured with the same function as the web; no IA on PATCH
    const piece = iterView(b).pieces.find((p) => p.id === String(params.itemId))
    const look = piece?.headline?.mode === "replace" ? piece.headline.fit ?? null : null
    const fitFn = look ? await headlineFitReady : null
    const violations = texts.flatMap((x) => {
      if (look && fitFn && x.path === "text") {
        const r = fitFn(look, x.value)
        if (!r.fits) return [{ path: x.path, rule: `headline_${r.reject ?? "too_long"}`, detail: r.reject === "too_short" ? `E ${r.exposure}` : r.reject === "over_chin" ? `chin gap ${r.chinGapPx} px` : `step none` }]
      }
      const it0 = items.find((i) => i.path === x.path)
      if (!it0) return [{ path: x.path, rule: "unknown_path", detail: "Unknown path." }]
      if (!x.value.trim()) return [{ path: x.path, rule: "required", detail: "Empty." }]
      if (x.value.length > it0.maxChars) return [{ path: x.path, rule: "maxChars", detail: `Max ${it0.maxChars}.` }]
      if (/\d+\s*%/.test(x.value)) return [{ path: x.path, rule: "invented", detail: "A number that isn't in the ad or the Brain." }]
      return []
    })
    await delay(200)
    if (violations.length) return fail("TEXT_INVALID", 422, "Invalid text.", { violations })
    run.texts[String(params.itemId)] = items.map((i) => ({ ...i, value: texts.find((x) => x.path === i.path)?.value.replace(/\s+/g, " ").trim() ?? i.value }))
    save()
    return ok(view(b))
  }),
  http.patch(u("/iterate/:id/items/:itemId"), async ({ params, request }) => {
    const b = batchOf(String(params.id))
    const run = b ? runOf(b.id) : null
    if (!b || !run) return undefined
    const { included } = await body<{ included: boolean }>(request)
    const id = String(params.itemId)
    run.excluded = included ? run.excluded.filter((x) => x !== id) : [...new Set([...run.excluded, id])]
    save()
    await delay(120)
    return ok(view(b))
  }),
  // troca-texto-queimado-v1 §15.3: "Generate anyway" is gone; a stale tab gets a plain toast
  http.post(u("/iterate/:id/caption-blocked/force"), () => fail("CAPTION_FORCE_RETIRED", 410, "This option was retired.")),
  http.delete(u("/iterate/:id/caption-blocked/force"), () => fail("CAPTION_FORCE_RETIRED", 410, "This option was retired.")),
  http.post(u("/iterate/:id/start"), async ({ params, request }) => {
    const b = batchOf(String(params.id))
    const run = b ? runOf(b.id) : null
    if (!b || !run) return undefined
    const v = view(b)
    if (v.status !== "PLAN_READY") return fail("INVALID_STATE", 409, "Not in PLAN_READY.", { state: v.status, allowed: ["PLAN_READY"] })
    const { expectedCredits } = await body<StartIterateBody>(request)
    await delay(300)
    if (typeof window !== "undefined" && sessionStorage.getItem("mock:credits:changed") === "1") {
      sessionStorage.removeItem("mock:credits:changed")
      run.bump = 1
      save()
      return fail("CREDITS_CHANGED", 409, "The quote changed.", { credits: quoteOf(run, b) })
    }
    const quote = quoteOf(run, b)
    if (typeof expectedCredits !== "number") return fail("VALIDATION_ERROR", 400, "expectedCredits is required.", { fields: [{ field: "expectedCredits", rule: "isNumber" }] })
    if (expectedCredits !== quote) return fail("CREDITS_CHANGED", 409, "The quote changed.", { credits: quote })
    const bal = balanceOf(run.pool)
    if (run.pool && bal !== null && bal < quote) return fail("INSUFFICIENT_CREDITS", 402, "Not enough credits.", { need: quote, balance: bal, pool: run.pool })
    // the pieces that go: the included ones (with burned captions blocking this template, none)
    b.pieces = b.pieces.filter((p) => !run.excluded.includes(p.id) && run.fit.level !== "soft")
    if (run.pool) entry("RESERVE", run.pool, -quote, quote, run)
    if (run.pool === "SAMPLE") markSampleUsed()
    run.held = run.pool ? quote : 0
    run.status = run.pool ? "RESERVED" : "SETTLED"
    run.attempt++
    for (const k of new Set(Object.values(run.keyOf))) {
      const t = S.catalog.find((x) => x.key === k)
      if (t) t.uses++
    }
    launchIter(b)
    save()
    return ok(view(b), 202)
  }),

  // ───── admin (§7): only INTERNAL OWNER
  http.get(u("/admin/ad-templates"), ({ request }) => {
    if (access() !== "INTERNAL" || roleOf(request) !== "OWNER") return fail("FORBIDDEN", 403, "Team only.")
    return ok({ items: [...S.catalog].sort((a, b) => a.order - b.order).map(admin) })
  }),
  http.patch(u("/admin/ad-templates/:slug"), async ({ params, request }) => {
    const t = tplOf(String(params.slug))
    if (!t) return fail("NOT_FOUND", 404, "Not found.")
    const b = await body<UpdateTemplateBody>(request)
    const credits = b.credits !== undefined ? b.credits : t.credits
    if ((b.status ?? t.status) === "LIVE" && credits == null) return fail("TEMPLATE_UNPRICED", 422, "Set a price first.")
    t.credits = credits
    if (b.status) t.status = b.status
    if (typeof b.order === "number") t.order = b.order
    if (b.nameEn) t.en[0] = b.nameEn
    if (b.namePt) t.pt[0] = b.namePt
    if (typeof b.beta === "boolean") t.beta = b.beta
    save()
    await delay(200)
    return ok(admin(t))
  }),
  http.post(u("/admin/ad-templates/:slug/example"), async ({ params, request }) => {
    const t = tplOf(String(params.slug))
    if (!t) return fail("NOT_FOUND", 404, "Not found.")
    const b = await body<{ sizeBytes?: number }>(request)
    if ((b.sizeBytes ?? 0) > 60 * 1024 * 1024) return fail("VALIDATION_ERROR", 400, "Up to 60 MB.", { fields: [{ field: "sizeBytes", rule: "max" }] })
    const key = `templates/${t.slug}/example-${Date.now()}.mp4`
    return ok({ uploadUrl: u(`/mock-storage/${encodeURIComponent(key)}`), key, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() })
  }),
  http.put(u("/mock-storage/:key"), async () => {
    await delay(600)
    return new HttpResponse(null, { status: 200 })
  }),
  http.post(u("/admin/ad-templates/:slug/example/complete"), async ({ params }) => {
    const t = tplOf(String(params.slug))
    if (!t) return fail("NOT_FOUND", 404, "Not found.")
    await delay(700)
    t.example = true
    save()
    return ok(admin(t))
  }),
  http.post(u("/admin/credits/grant"), async ({ request }) => {
    if (access() !== "INTERNAL" || roleOf(request) !== "OWNER") return fail("FORBIDDEN", 403, "Team only.")
    const b = await body<GrantCreditsBody>(request)
    if (!b.email && !b.userId) return fail("VALIDATION_ERROR", 400, "email or userId.", { fields: [{ field: "email", rule: "exactlyOneOf:email,userId" }] })
    if (b.email && !b.email.includes("@")) return fail("NOT_FOUND", 404, "No account with this e-mail.")
    if (S.ledger.some((e) => e.id === b.idempotencyKey)) return ok({ entry: S.ledger.find((e) => e.id === b.idempotencyKey)!, balance: S.balance })
    if (S.balance + b.credits < 0) return fail("INVALID_STATE", 409, "Not enough balance.", { state: "insufficient_balance", need: -b.credits, balance: S.balance })
    await delay(250)
    entry("MANUAL", "CREDITS", b.credits, Math.abs(b.credits), null, b.note ?? null)
    S.ledger[0].id = b.idempotencyKey
    S.ledger[0].by = { id: "u_gusta", name: "Gusta" }
    save()
    saveDb()
    return ok({ entry: S.ledger[0], balance: S.balance })
  }),
]

function admin(t: MTemplate): AdminTemplate {
  const c = card(t, null)
  return {
    slug: c.slug, tier: c.tier, tab: c.tab, category: c.category, credits: c.credits, outputs: c.outputs, pack: c.pack, beta: c.beta, needs: c.needs,
    example: c.example, poster: c.example ? c.poster : null, uses: c.uses, available: c.available, sampleOk: c.sampleOk,
    id: `tpl_${t.slug}`, internalKey: t.key, autoType: t.spec[0]?.type ?? null, frameId: t.spec[0]?.frame ?? null, status: t.status, order: t.order,
    nameEn: t.en[0], namePt: t.pt[0], descEn: t.en[1], descPt: t.pt[1], outEn: t.en[2], outPt: t.pt[2], exampleDurationSec: t.example ? 27 : null,
    needsExample: t.status === "LIVE" && !t.example,
  }
}
