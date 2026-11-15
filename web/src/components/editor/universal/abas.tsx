"use client"

// 16/11 (protótipo aprovado pelo Gusta, "editor simples"): o painel em 3 abas com palavras comuns.
// Textos = os textos da peça (o que mais se mexe); Vídeo = enquadrar com botões (arrastar no vídeo também funciona);
// Estilo = cor, formato e o ajuste fino do elemento clicado. A lógica (doc, histórico, checagens) é a mesma de antes.
import type { ControlDecl } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { useU } from "./context"
import { ContentCard, LayerTab, TemplateTab, VideoFramingSec } from "./panel"
import { ZOOM_MAX, clampFraming, framingNow, setVideoGeo, videoGeo } from "./model"

/** O que a aba Textos mostra: os campos de texto da peça; com um texto clicado no vídeo, também o estilo dele. */
export function TextosTab() {
  const { st, sel, decl, t } = useU()
  const content = st.manifest.controls.filter((c): c is ControlDecl => c.group === "content")
  const d = sel ? decl(sel) : undefined
  const textoSel = d && (d.kind === "text" || d.kind === "list" || d.kind === "chat" || d.kind === "caption")
  return (
    <>
      {content.length ? <ContentCard controls={content} /> : (
        <section className="card"><p className="sub" style={{ margin: 0 }}>{t("simples.semTextos")}</p></section>
      )}
      {textoSel ? (
        <details className="card fino">
          <summary>{t("simples.estiloDoTexto")}</summary>
          <div className="fino-corpo"><LayerTab /></div>
        </details>
      ) : null}
    </>
  )
}

/** Vídeo: Automático · Mais perto · Mais longe (+ os controles de sempre). Arrastar na prévia move o vídeo. */
export function VideoTab() {
  const U = useU()
  const { t, s, r, doc, fmt, principal, ro, st } = U
  const temVideo = st.manifest.layers.some((l) => l.kind === "video" && l.editable.reframe)
  if (!temVideo) return <section className="card"><p className="sub" style={{ margin: 0 }}>{t("simples.semVideo")}</p></section>
  const f = framingNow(r, doc, fmt, principal)
  const auto = r?.layout.video?.auto ?? !videoGeo(doc, fmt, principal).framing
  const modo: "auto" | "perto" | "longe" | "livre" = auto ? "auto" : f.fit === "contain_blur" ? "longe" : f.zoom > 1.01 ? "perto" : "livre"
  const aplicar = (qual: "auto" | "perto" | "longe") => {
    if (qual === "auto") return s.commit(t("hist.autoReframe"), (d) => setVideoGeo(d, fmt, principal, { framing: null }))
    if (qual === "longe") return s.commit(t("hist.reframe"), (d) => setVideoGeo(d, fmt, principal, { framing: { fit: "contain_blur", zoom: 1, panX: 0, panY: 0 } }))
    const atual = framingNow(r, doc, fmt, principal)
    const zoom = Math.min(ZOOM_MAX, (atual.fit === "cover" ? atual.zoom : 1) + 0.35)
    return s.commit(t("hist.reframe"), (d) => setVideoGeo(d, fmt, principal, { framing: clampFraming({ ...atual, fit: "cover", zoom }) }))
  }
  const ops: [typeof modo, string, string][] = [
    ["auto", t("simples.enqAuto"), t("simples.enqAutoSub")],
    ["perto", t("simples.enqPerto"), t("simples.enqPertoSub")],
    ["longe", t("simples.enqLonge"), t("simples.enqLongeSub")],
    ["livre", t("simples.enqLivre"), t("simples.enqLivreSub")],
  ]
  return (
    <>
      <section className="card">
        <h2>{t("simples.enquadramento")}</h2>
        <div className="enq">
          {ops.map(([k, nome, sub]) => (
            <button key={k} type="button" className={cn("enq-op")} aria-pressed={modo === k} disabled={ro || k === "livre"} onClick={() => k !== "livre" && aplicar(k)}>
              <b>{nome}</b><small>{sub}</small>
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "10px 0 0" }}>{t("simples.dicaVideo")}</p>
      </section>
      <details className="card fino">
        <summary>{t("simples.ajusteFinoVideo")}</summary>
        <div className="fino-corpo"><VideoFramingSec /></div>
      </details>
    </>
  )
}

/** Estilo: cor, formato e o que mais o template oferecer; o elemento clicado (caixa, faixa) ganha o ajuste fino. */
export function EstiloTab() {
  const { sel, decl, t } = useU()
  const d = sel ? decl(sel) : undefined
  const elemento = d && d.kind !== "video" && d.kind !== "text" && d.kind !== "list" && d.kind !== "chat" && d.kind !== "caption"
  return (
    <>
      <TemplateTab omit={["content", "guides"]} />
      {elemento ? (
        <details className="card fino">
          <summary>{t("simples.ajusteFinoElemento")}</summary>
          <div className="fino-corpo"><LayerTab /></div>
        </details>
      ) : null}
    </>
  )
}
