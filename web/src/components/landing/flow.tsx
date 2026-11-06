"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"
import { cn } from "@/lib/utils"
import { Words } from "./words"

gsap.registerPlugin(ScrollTrigger, useGSAP)

type Stage = { t: string; d: string; feats: string[] }
const WIDE = "(min-width: 1061px)"
const PIN = `(prefers-reduced-motion: no-preference) and ${WIDE} and (min-height: 720px)`

/**
 * §5 The whole cycle, 7 real steps. ≥ 1061 px: tabs on the left, sticky panel on the right; with motion on, the
 * section pins and scrolling walks the steps (progress line fills, each panel builds itself in). Below 1061 px:
 * accordion (one open), no pin. Reduced motion: plain tabs/accordion.
 */
export function Flow() {
  const t = useTranslations("landing.flow")
  const stages = t.raw("stages") as Stage[]
  const [active, setActive] = useState(0)
  const section = useRef<HTMLElement>(null)
  const flow = useRef<HTMLDivElement>(null)
  const pin = useRef<ScrollTrigger | null>(null)
  const first = useRef(true)

  /* the pin: scroll position → active step; the progress line is scrubbed by the same trigger */
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(PIN, () => {
        const n = stages.length
        const bar = flow.current!.querySelector("[data-flow-bar]")
        const st = ScrollTrigger.create({
          trigger: flow.current,
          start: "top 84px",
          end: () => `+=${(n - 1) * Math.round(window.innerHeight * 0.42)}`,
          pin: section.current?.querySelector("[data-flow-pin]") ?? flow.current,
          pinSpacing: true,
          refreshPriority: -1,
          snap: { snapTo: 1 / (n - 1), inertia: false, duration: { min: 0.15, max: 0.4 }, delay: 0.05, ease: "power1.inOut" },
          animation: gsap.fromTo(bar, { scaleY: 0 }, { scaleY: 1, ease: "none", transformOrigin: "top" }),
          scrub: true,
          onUpdate: (s) => setActive(Math.round(s.progress * (n - 1))),
        })
        pin.current = st
        return () => {
          pin.current = null
        }
      })
      // without the pin (narrow, or short screens) the line still follows the scroll on desktop
      mm.add(`(prefers-reduced-motion: no-preference) and ${WIDE} and (max-height: 719px)`, () => {
        gsap.fromTo(flow.current!.querySelector("[data-flow-bar]"), { scaleY: 0 }, { scaleY: 1, ease: "none", transformOrigin: "top", scrollTrigger: { trigger: flow.current, start: "top 70%", end: "bottom 60%", scrub: true } })
      })
      return () => mm.revert()
    },
    { scope: section }
  )

  /* each panel builds itself in when it becomes the active one */
  useGSAP(
    () => {
      if (first.current) {
        first.current = false
        return
      }
      if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return
      const panel = flow.current?.querySelector(`#lp-p${active} .lp-panel`)
      if (!panel) return
      gsap.fromTo(panel, { y: 10, autoAlpha: 0.5 }, { y: 0, autoAlpha: 1, duration: 0.4, ease: "power2.out" })
      gsap.fromTo(panel.children, { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, ease: "power3.out", stagger: 0.07, delay: 0.05 })
    },
    { dependencies: [active], scope: flow }
  )

  const open = (i: number, btn: HTMLButtonElement) => {
    const wide = window.matchMedia(WIDE).matches
    const st = pin.current
    if (wide && st) {
      // pinned: jump the scroll to that step, the trigger sets it active
      const y = st.start + ((st.end - st.start) * i) / (stages.length - 1)
      window.scrollTo({ top: y, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
      setActive(i)
      return
    }
    if (wide) return setActive(i)
    const next = active === i ? -1 : i
    setActive(next)
    if (next >= 0) requestAnimationFrame(() => btn.scrollIntoView({ block: "nearest", behavior: "smooth" }))
  }

  return (
    <section id="how" ref={section} className="lp-band lp-wrap" aria-labelledby="how-t">
      <p className="lp-eyebrow">{t("eyebrow")}</p>
      <h2 id="how-t" className="lp-display lp-h2 mt-3.5 max-w-[16em]" data-reveal>
        <Words text={t("title")} />
      </h2>
      <div data-flow-pin>
        <div className="lp-flow" ref={flow}>
          <span className="lp-flow-progress" aria-hidden="true">
            <i data-flow-bar />
          </span>
          {stages.map((s, i) => {
            const on = active === i
            return (
              <div className="lp-stage" data-on={on || undefined} key={i}>
                <button className="lp-stage-btn" type="button" aria-expanded={on} aria-controls={`lp-p${i}`} onClick={(e) => open(i, e.currentTarget)}>
                  <span className="lp-n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="lp-st">{s.t}</span>
                  <span className="lp-chev" aria-hidden="true" />
                  <span className="lp-sd">{s.d}</span>
                  <span className="lp-feats">
                    {s.feats.map((f) => (
                      <span key={f}>{f}</span>
                    ))}
                  </span>
                </button>
                <div className="lp-stage-panel" id={`lp-p${i}`} role="region" aria-label={s.t}>
                  {on ? <Panel i={i} /> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function Example() {
  const t = useTranslations("landing.flow")
  return <span className="lp-chip example">{t("example")}</span>
}

function Panel({ i }: { i: number }) {
  const t = useTranslations("landing.flow")
  switch (i) {
    case 0: {
      const rows = t.raw("brain.rows") as { t: string; s: string; ok: boolean }[]
      return (
        <div className="lp-panel">
          <div className="lp-panel-head">
            <b>{t("brain.title")}</b>
            <Example />
          </div>
          <div className="lp-field">
            <span>mooncloth.com</span>
            <span className="lp-chip ok">{t("brain.read")}</span>
          </div>
          <div className="lp-rows">
            {rows.map((r) => (
              <div key={r.t}>
                <span className="min-w-0">
                  {r.t} <span className="lp-src-s">{r.s}</span>
                </span>
                <span className={cn("lp-chip", r.ok ? "ok" : "warn")}>{r.ok ? t("brain.filled") : t("brain.partial")}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }
    case 1: {
      const reasons = t.raw("breakdown.reasons") as { t: string; d: string; at: string }[]
      const sw = ["var(--brand)", "var(--info-on-ink)", "#f3d27a"]
      return (
        <div className="lp-panel lp-on-ink">
          <div className="lp-panel-head">
            <b>MC_NEW_1012_A_F1_9x16.mp4</b>
            <Example />
          </div>
          <div className="lp-tl" aria-hidden="true">
            <i className="b" />
            <i className="h">{t("breakdown.hook")}</i>
            <i className="p">{t("breakdown.proof")}</i>
            <i className="c">{t("breakdown.cta")}</i>
          </div>
          <div className="lp-ticks" aria-hidden="true">
            <span>0:00</span>
            <span>0:10</span>
            <span>0:20</span>
            <span>0:31</span>
          </div>
          <div className="lp-reasons">
            {reasons.map((r, k) => (
              <div key={r.t}>
                <b>
                  <span className="lp-sw" style={{ background: sw[k] }} />
                  {r.t}
                </b>
                <p>{r.d}</p>
                <span className="lp-t">{r.at}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }
    case 2: {
      const tpl = t.raw("variations.tpl") as { c: string; d: string }[]
      const ai = t.raw("variations.aiItems") as { c: string; d: string }[]
      return (
        <div className="lp-panel">
          <div className="lp-two">
            <div className="lp-vlist">
              <header>
                <b>{t("variations.templates")}</b>
                <span className="lp-chip free">{t("variations.free")}</span>
              </header>
              {tpl.map((v) => (
                <div className="lp-vrow" key={v.c}>
                  <span className="lp-box on" aria-hidden="true" />
                  <span className="lp-code">
                    {v.c}
                    <small>{v.d}</small>
                  </span>
                </div>
              ))}
            </div>
            <div className="lp-vlist">
              <header>
                <b>{t("variations.ai")}</b>
                <span className="lp-chip plain">{t("variations.paid")}</span>
              </header>
              {ai.map((v) => (
                <div className="lp-vrow" key={v.c}>
                  <span className="lp-box" aria-hidden="true" />
                  <span className="lp-code">
                    {v.c}
                    <small>{v.d}</small>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="lp-note">{t("variations.note")}</div>
        </div>
      )
    }
    case 3: {
      const steps = t.raw("concepts.steps") as string[]
      return (
        <div className="lp-panel">
          <div className="lp-steps">
            {steps.map((s, k) => (
              <span key={s} className={cn(k < 4 && "done", k === 4 && "now")}>
                {s}
              </span>
            ))}
          </div>
          <div className="lp-progress">
            <b>{t("concepts.status")}</b>
            <div className="lp-segs" aria-hidden="true">
              <i className="f" />
              <i className="f" />
              <i className="h" />
              <i />
              <i />
            </div>
            <span className="lp-mono text-[11px] text-fg-3">{t("concepts.detail")}</span>
          </div>
        </div>
      )
    }
    case 4:
      return (
        <div className="lp-panel">
          <div className="lp-fmts" aria-hidden="true">
            {(
              [
                ["s916", "9:16"],
                ["s45", "4:5"],
                ["s11", "1:1"],
              ] as const
            ).map(([c, l]) => (
              <div className="lp-fmt" key={c}>
                <span className={cn("lp-shape", c)} />
                <small>{l}</small>
              </div>
            ))}
          </div>
          <div className="lp-namechips" role="img" aria-label={t("formats.label")}>
            {["MC", "ITER", "1031", "H02", "ORIG", "9x16"].map((p, k, all) => (
              <span key={p} className="contents">
                <span className={cn(k === 1 && "k")}>{p}</span>
                <em>{k < all.length - 1 ? "_" : ".mp4"}</em>
              </span>
            ))}
          </div>
        </div>
      )
    case 5:
      return (
        <div className="lp-panel lp-on-ink">
          <div className="lp-panel-head">
            <b className="flex items-center gap-2">
              <span className="lp-meta-f" aria-hidden="true">
                f
              </span>
              {t("meta.title")}
            </b>
            <span className="lp-chip ok">{t("meta.default")}</span>
          </div>
          <dl className="lp-kv wide">
            <dt>{t("meta.campaign")}</dt>
            <dd>{t("meta.campaignV")}</dd>
            <dt>{t("meta.adset")}</dt>
            <dd>{t("meta.adsetV")}</dd>
            <dt>{t("meta.ad")}</dt>
            <dd>{t("meta.adV")}</dd>
            <dt>{t("meta.imported")}</dt>
            <dd>{t("meta.importedV")}</dd>
          </dl>
          <div>
            <p className="lp-eyebrow">{t("meta.goesIn")}</p>
            <div className="lp-adsets">
              <i className="full">{t("meta.set1")}</i>
              <i className="full">{t("meta.set2")}</i>
            </div>
          </div>
        </div>
      )
    default:
      return (
        <div className="lp-panel">
          <div className="lp-panel-head">
            <b>{t("results.title")}</b>
            <Example />
          </div>
          <div className="lp-rangebar" aria-hidden="true">
            <span className="zone" />
            <span className="lb" style={{ left: "35%" }}>
              $18
            </span>
            <span className="lb" style={{ left: "60%" }}>
              $24
            </span>
            {(
              [
                ["g", 26],
                ["g", 44],
                ["y", 58],
                ["r", 83],
              ] as const
            ).map(([c, l]) => (
              <span key={l} className={cn("pt", c)} style={{ left: `${l}%` }} />
            ))}
          </div>
          <div className="lp-tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("results.ad")}</th>
                  <th className="r">{t("results.spend")}</th>
                  <th className="r">{t("results.cpa")}</th>
                  <th>{t("results.vs")}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["MC_ITER_1031_H02", "$412", "$16.40", "ok", "winner"],
                    ["MC_ITER_1031_CUT01", "$380", "$20.10", "ok", "inRange"],
                    ["MC_ITER_1031_H01", "$295", "$23.80", "warn", "edge"],
                    ["MC_ITER_1031_CHATDM", "$210", "$31.50", "bad", "above"],
                  ] as const
                ).map(([ad, sp, cpa, tone, k]) => (
                  <tr key={ad}>
                    <td className="lp-mono">{ad}</td>
                    <td className="r">{sp}</td>
                    <td className="r">{cpa}</td>
                    <td>
                      <span className={cn("lp-chip", tone)}>{t(`results.${k}`)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
  }
}
