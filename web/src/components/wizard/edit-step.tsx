"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { CreativeDetail, EditorState, EditResponse, EditSettings, Render } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Checklist } from "@/components/fx"
import { Icon } from "@/components/icon"
import { Panel } from "@/components/page"
import { VideoPlayer } from "@/components/video-player"
import { qk } from "@/hooks/use-creative"
import { useErrorMessage } from "@/hooks/use-error-message"
import { EditorDirtyBanner, EditorEntryCard, TemplateSwitchDialog, useEditorDocFlags } from "@/components/editor/entry"
import { ActionBar, stepHref, WizardFrame, WzHead } from "./shell"
import { Banner, Memo } from "./common"

function MiniFrame({ id }: { id: string }) {
  return (
    <div className="relative aspect-[9/16] max-w-full overflow-hidden rounded-[4px] bg-[#1c1c1c]" aria-hidden="true">
      {id === "headline" ? <i className="absolute inset-x-[15%] top-[10%] h-[6%] rounded-[2px] bg-[#e9e9e9]" /> : null}
      <i className={`absolute inset-x-[15%] bottom-[22%] rounded-[2px] bg-[#e9e9e9] ${id === "bold" ? "h-[8%]" : "h-[5%]"}`} />
    </div>
  )
}

function RenderOverlay({ r, onAgain, busy }: { r: Render; onAgain: () => void; busy: boolean }) {
  const t = useTranslations("wizard.edit")
  if (r.status === "FAILED") {
    return (
      <div className="on-ink absolute inset-0 grid grid-cols-[minmax(0,1fr)] content-center gap-3.5 bg-black/78 p-5 text-fg" role="alert">
        <span className="text-status-failed">
          <Icon name="alert" />
        </span>
        <b className="font-semibold">{t("failedTitle", { frame: r.failedFrame ?? r.frame ?? 0 })}</b>
        <span className="text-[13px] text-fg-2">{r.failReason}</span>
        <div>
          <Button size="sm" disabled={busy} onClick={onAgain}>
            <Icon name="refresh" />
            {t("renderAgain")}
          </Button>
        </div>
      </div>
    )
  }
  const stage = r.status === "QUEUED" ? "queued" : (r.stage ?? "rendering")
  const order = ["queued", "bundling", "rendering", "encoding"]
  const at = order.indexOf(stage)
  const items = [
    { label: t("joined"), state: at > 1 ? "done" : at === 1 ? "now" : "todo" },
    { label: t("timed"), state: at > 1 ? "done" : "todo" },
    { label: t("frames"), state: at > 2 ? "done" : at === 2 ? "now" : "todo" },
    { label: t("uploading"), state: at === 3 ? "now" : "todo" },
  ] as const
  return (
    <div className="on-ink absolute inset-0 grid grid-cols-[minmax(0,1fr)] content-center gap-3.5 bg-black/78 p-5 text-fg" role="status">
      <b className="font-semibold">{t("renderingTitle", { pct: r.progress })}</b>
      <Progress value={r.progress} className="bg-white/15" aria-label={t("renderingTitle", { pct: r.progress })} />
      <span className="font-mono text-[13px] text-fg-2">{t("frame", { frame: r.frame ?? 0, total: r.totalFrames ?? 0 })}</span>
      <Checklist items={items.map((i) => ({ ...i }))} />
    </div>
  )
}

/** Step 6 · Edit (spec §5.6): player left, template panel right (340px); render overlay with %, frame and checklist. */
export function EditStep({ creative, live }: { creative: CreativeDetail; live: "connecting" | "open" | "retrying" }) {
  const t = useTranslations("wizard")
  const tSteps = useTranslations("steps")
  const tTpl = useTranslations("template")
  const tc = useTranslations("common")
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const qc = useQueryClient()
  const id = creative.id
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.edit.templates, staleTime: Infinity })
  const q = useQuery({ queryKey: qk.edit(id), queryFn: () => api.edit.get(id), retry: false })
  const [settings, setSettings] = useState<EditSettings | null>(null)
  const pendingPatch = useRef<Partial<EditSettings>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (q.data && !settings) setSettings(q.data.settings)

  const flush = () => {
    const b = pendingPatch.current
    pendingPatch.current = {}
    if (!Object.keys(b).length) return
    // editor-v1 §3.2: template / caption position change the saved EditDoc on the server (transforms dropped).
    // Strip them from the cache right away, and refetch the editor + edit state only after the PATCH landed.
    const repositions = b.templateId !== undefined || b.captionPosition !== undefined
    if (repositions)
      qc.setQueryData<EditorState>(qk.editor(id), (p) =>
        p?.doc ? { ...p, doc: { ...p.doc, layers: p.doc.layers.map((l) => (b.templateId !== undefined || l.id === "caption" ? { ...l, transform: undefined } : l)) } } : p
      )
    api.edit
      .update(id, b)
      .then(() => {
        qc.invalidateQueries({ queryKey: qk.creative(id) })
        if (repositions) {
          qc.invalidateQueries({ queryKey: qk.editor(id) })
          qc.invalidateQueries({ queryKey: qk.edit(id) })
        }
      })
      .catch((e) => toast(errorMessage(e)))
  }
  const change = (b: Partial<EditSettings>, debounce = false) => {
    setSettings((s) => (s ? { ...s, ...b } : s))
    qc.setQueryData<EditResponse>(qk.edit(id), (p) => (p ? { ...p, dirty: true } : p))
    pendingPatch.current = { ...pendingPatch.current, ...b }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, debounce ? 700 : 0)
  }

  const render = useMutation({
    mutationFn: async () => {
      if (timer.current) clearTimeout(timer.current)
      const b = pendingPatch.current
      pendingPatch.current = {}
      if (Object.keys(b).length) await api.edit.update(id, b)
      return api.edit.render(id)
    },
    onSuccess: (r) => {
      qc.setQueryData<EditResponse>(qk.edit(id), (p) => (p ? { ...p, dirty: false, latestRender: r } : p))
      qc.invalidateQueries({ queryKey: qk.creative(id) })
    },
    onError: (e) => toast(errorMessage(e)),
  })

  // toast only when the SAME render we watched goes from queued/rendering to READY
  // (QA bug 05/10: a status-only check fired on a failed render)
  const watched = useRef<{ id: string; status: string } | null>(null)
  const latest = q.data?.latestRender ?? null
  useEffect(() => {
    const prev = watched.current
    if (latest && prev && prev.id === latest.id && prev.status !== "READY" && prev.status !== "FAILED" && latest.status === "READY")
      toast(
        <>
          <Icon name="check" />
          {t("edit.rendered")}
        </>
      )
    watched.current = latest ? { id: latest.id, status: latest.status } : null
  }, [latest?.id, latest?.status, latest, t])

  const notReady = q.isError && isApiError(q.error) && q.error.status === 409
  const rendering = latest?.status === "QUEUED" || latest?.status === "RENDERING"
  const renderFailed = latest?.status === "FAILED"
  const dirty = q.data?.dirty ?? false
  const preview = q.data?.previewRender ?? null
  const tpl = templates.data?.find((x) => x.id === settings?.templateId)
  const overlay = latest && (rendering || renderFailed) ? <RenderOverlay r={latest} busy={render.isPending} onAgain={() => render.mutate()} /> : undefined
  const canContinue = creative.state === "RENDER_READY" && !dirty && !rendering
  // §13: a variation that keeps the winner's edit has nothing to set (PATCH /edit = 409 variation_locked); render stays free
  const locked = settings?.templateId === "remix-keep"
  const tv = useTranslations("variar.keep")
  const te = useTranslations("editor.entry")
  // editor-v1 §3.2: switching template with positioned layers asks first; the backend repositions on confirm
  const flags = useEditorDocFlags(id, q.data)
  const [askTpl, setAskTpl] = useState<string | null>(null)
  const tplLabel = (tid: string) => {
    const x = templates.data?.find((y) => y.id === tid)
    const k = (x?.labelKey ?? "").replace(/^template\./, "")
    return x && tTpl.has(k as never) ? tTpl(k as never) : tid
  }
  const editorDirty = !!q.data?.hasEditorChanges && dirty

  return (
    <WizardFrame
      creative={creative}
      viewing="edit"
      live={live}
      actionbar={
        <ActionBar
          hint={
            rendering || renderFailed || !q.data
              ? null
              : editorDirty
                ? te("hintEditor")
                : dirty
                ? t("edit.hintDirty")
                : preview
                  ? t("edit.hintFresh", { ago: format.relativeTime(new Date(preview.createdAt), now) })
                  : null
          }
          back={{ href: stepHref(id, "generation") }}
          primary={
            <Button data-primary variant="default" disabled={!canContinue} onClick={() => {
                // leave no edit toast over the Final OK (QA bug 05/10)
                toast.dismiss()
                router.push(stepHref(id, "review"))
              }}>
              {t("continueTo", { step: tSteps("review") })}
            </Button>
          }
        />
      }
    >
      <WzHead title={t("edit.title")} sub={t("edit.sub")} />
      {notReady ? (
        <Memo icon="info">{t("edit.waitScenes")}</Memo>
      ) : q.isError ? (
        <Banner kind="error" title={errorMessage(q.error)} actions={<Button size="sm" onClick={() => q.refetch()}>{tc("retry")}</Button>} />
      ) : !q.data || !settings ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 desktop:grid-cols-[minmax(0,1fr)_340px]">
          <span className="sk aspect-[9/16] w-full max-w-[360px] justify-self-center rounded-xl" />
          <span className="sk h-[420px] rounded-lg" />
        </div>
      ) : (
        <>
        {editorDirty && !rendering ? <EditorDirtyBanner id={id} /> : null}
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 desktop:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-w-0 place-items-center rounded-xl tablet:border tablet:border-line tablet:bg-stage tablet:p-5">
            <VideoPlayer video={preview?.video ?? null} poster={creative.thumbnail?.url} format={creative.format} size="sm" overlay={overlay} />
            {!preview && !overlay ? <p className="mt-3 text-[13px] text-fg-2">{t("edit.noPreview")}</p> : null}
          </div>
          {locked ? (
            <Panel>
              <EditorEntryCard id={id} edit={q.data} locked />
              <Banner icon="lock" title={tv("lockedTitle")} body={tv("lockedBody")} />
              <Button variant="outline" disabled={rendering || render.isPending} onClick={() => render.mutate()}>
                <Icon name="refresh" />
                {t("edit.render")}
              </Button>
              <Memo icon="info">{t("edit.free")}</Memo>
            </Panel>
          ) : (
          <Panel>
            <EditorEntryCard id={id} edit={q.data} />
            <div className="grid gap-1.5">
              <Label>{t("edit.template")}</Label>
              <RadioGroupPrimitive.Root
                value={settings.templateId}
                onValueChange={(v) => (flags.anyTransform ? setAskTpl(v) : change({ templateId: v }))}
                aria-label={t("edit.template")}
                className="grid grid-cols-3 gap-2"
              >
                {(templates.data ?? []).filter((x) => x.kind !== "remix").map((x) => (
                  <RadioGroupPrimitive.Item
                    key={x.id}
                    value={x.id}
                    className="grid min-w-0 gap-1.5 rounded-sm border border-line bg-surface-2 p-1.5 text-left text-xs text-fg-2 data-[state=checked]:border-fg data-[state=checked]:text-fg"
                  >
                    <MiniFrame id={x.id} />
                    {tTpl.has(x.labelKey.replace(/^template\./, "") as never) ? tTpl(x.labelKey.replace(/^template\./, "") as never) : x.id}
                  </RadioGroupPrimitive.Item>
                ))}
              </RadioGroupPrimitive.Root>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("edit.captions")}</Label>
              <div>
                <ToggleGroup type="single" value={settings.captionStyle} onValueChange={(v) => v && change({ captionStyle: v as EditSettings["captionStyle"] })} aria-label={t("edit.captions")}>
                  <ToggleGroupItem value="word">{t("edit.word")}</ToggleGroupItem>
                  <ToggleGroupItem value="line">{t("edit.line")}</ToggleGroupItem>
                  <ToggleGroupItem value="off">{t("edit.off")}</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("edit.position")}</Label>
              <div>
                <ToggleGroup type="single" value={settings.captionPosition} onValueChange={(v) => v && change({ captionPosition: v as EditSettings["captionPosition"] })} aria-label={t("edit.position")}>
                  <ToggleGroupItem value="top">{t("edit.top")}</ToggleGroupItem>
                  <ToggleGroupItem value="middle">{t("edit.middle")}</ToggleGroupItem>
                  <ToggleGroupItem value="bottom">{t("edit.bottom")}</ToggleGroupItem>
                </ToggleGroup>
              </div>
              {flags.captionTransform ? <p className="text-xs text-fg-3">{te("capPosEditor")}</p> : null}
            </div>
            {tpl?.supportsHeadline ? (
              <div className="grid gap-1.5">
                <Label htmlFor="hl">{t("edit.headline")}</Label>
                <Input id="hl" value={settings.headline ?? ""} onChange={(e) => change({ headline: e.target.value || null }, true)} />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="ctat">{t("edit.cta")}</Label>
              <Input id="ctat" value={settings.ctaText} onChange={(e) => change({ ctaText: e.target.value }, true)} />
            </div>
            <div className="flex items-center justify-between gap-2.5">
              <Label htmlFor="endsw">{t("edit.endCard")}</Label>
              <Switch id="endsw" checked={settings.endCard} onCheckedChange={(v) => change({ endCard: v })} />
            </div>
            {dirty && !rendering ? (
              <div className="flex items-center gap-2 text-[13px] text-status-waiting">
                <Icon name="info" />
                {t("edit.dirty")}
              </div>
            ) : null}
            <Button variant={dirty ? "default" : "outline"} disabled={rendering || render.isPending} onClick={() => render.mutate()}>
              <Icon name="refresh" />
              {t("edit.render")}
            </Button>
            <Memo icon="info">{t("edit.free")}</Memo>
          </Panel>
          )}
        </div>
        </>
      )}
      <TemplateSwitchDialog
        name={askTpl ? tplLabel(askTpl) : null}
        onKeep={() => setAskTpl(null)}
        onSwap={() => {
          if (askTpl) change({ templateId: askTpl })
          setAskTpl(null)
          toast(te("swapped"))
        }}
      />
    </WizardFrame>
  )
}
