"use client"

import { useEffect, useRef } from "react"
import { useLocale } from "next-intl"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(ScrollTrigger, useGSAP)

const MOTION = "(prefers-reduced-motion: no-preference)"

/**
 * The landing's motion layer (GSAP + ScrollTrigger). Everything it touches is complete and in place in the HTML:
 * no JS or reduced motion = the static page. Only transform/opacity are animated.
 *
 * Inventory (data attributes set by the Server Components):
 *  - hero: masked word reveal [data-hero-title], lime marker drawing in [data-hero-mark], lede/CTAs lift [data-hero-after]
 *  - hero: the reel [data-hero] — one Remotion video (HeroMill) in the phone; a paused timeline follows its clock (heroReel)
 *  - hero: pointer parallax per card depth [data-collage] [data-depth] (≥ 1061 px + hover)
 *  - section titles: masked word reveal on scroll [data-reveal]
 *  - numbers: count-up [data-count]; the 12 variation cards born from the winner [data-multiply]
 *  - cascades on scroll [data-cascade] (direct children, transform only)
 *  - micro: magnetic CTA [data-magnetic], tilt + shine [data-tilt], final CTA glow following the pointer [data-glow]
 *  - EN/PT: content cross-fades when the locale changes
 *  (the workflow pin lives in flow.tsx)
 */
export function LandingMotion({ className, children }: { className?: string; children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const locale = useLocale()
  const firstLocale = useRef(locale)

  useGSAP(
    (_, contextSafe) => {
      const stopReel = heroReel(root.current!, contextSafe as Safe)
      const mm = gsap.matchMedia()
      mm.add(
        { motion: MOTION, wide: `${MOTION} and (min-width: 1061px) and (hover: hover)`, hover: `${MOTION} and (hover: hover)` },
        (ctx) => {
          const { motion, wide, hover } = ctx.conditions as { motion: boolean; wide: boolean; hover: boolean }
          if (!motion) return
          const el = root.current!
          const q = gsap.utils.selector(el)
          const off: (() => void)[] = []
          const listen = (t: Element, type: string, fn: (e: PointerEvent) => void) => {
            const safe = contextSafe!(fn as (...a: unknown[]) => void) as EventListener
            t.addEventListener(type, safe)
            off.push(() => t.removeEventListener(type, safe))
          }

          /* 1. hero: masked word reveal + the lime marker + the rest lifting in (on load, not scroll) */
          const hero = gsap.timeline({ defaults: { ease: "power3.out" } })
          hero
            .from(q("[data-hero-title] [data-word]"), { yPercent: 108, duration: 0.8, stagger: 0.045 })
            .fromTo(q("[data-hero-mark]"), { backgroundSize: "0% 30%" }, { backgroundSize: "100% 30%", duration: 0.7, ease: "power2.inOut" }, "-=.35")
            .from(q("[data-hero-after]"), { y: 14, duration: 0.6, stagger: 0.08 }, "-=.6")

          /* 2. the hero reel: lives outside this matchMedia block (heroReel below), it also serves reduced motion */

          /* 3. collage: pointer parallax, depth per card (desktop with a pointer only) */
          const collage = el.querySelector("[data-collage]")
          if (wide && collage) {
            const movers = gsap.utils.toArray<HTMLElement>(collage.querySelectorAll("[data-depth]")).map((m) => ({
              d: Number(m.dataset.depth),
              x: gsap.quickTo(m, "x", { duration: 0.6, ease: "power3" }),
              y: gsap.quickTo(m, "y", { duration: 0.6, ease: "power3" }),
            }))
            listen(collage, "pointermove", (e) => {
              const r = collage.getBoundingClientRect()
              const nx = (e.clientX - r.left) / r.width - 0.5
              const ny = (e.clientY - r.top) / r.height - 0.5
              movers.forEach((m) => (m.x(nx * m.d), m.y(ny * m.d)))
            })
            listen(collage, "pointerleave", () => movers.forEach((m) => (m.x(0), m.y(0))))
          }

          /* 4. section titles: masked word reveal as they come in */
          q("[data-reveal]").forEach((h) => {
            gsap.from(h.querySelectorAll("[data-word]"), {
              yPercent: 108,
              duration: 0.75,
              ease: "power3.out",
              stagger: 0.035,
              scrollTrigger: { trigger: h, start: "top 88%", once: true },
            })
          })

          /* 5. counters: the final number is in the HTML; it counts up only once the band is in view */
          q("[data-count]").forEach((n) => {
            const end = Number(n.dataset.count)
            const text = n.firstChild
            if (!text || text.nodeType !== Node.TEXT_NODE) return
            const o = { v: 0 }
            ScrollTrigger.create({
              trigger: n,
              start: "top 88%",
              once: true,
              onEnter: () => gsap.fromTo(o, { v: 0 }, { v: end, duration: 1.2, ease: "power2.out", onUpdate: () => void (text.nodeValue = String(Math.round(o.v))) }),
            })
          })

          /* 6. the multiplication: 12 variations fly out of the winner (from its centre, scaled down, behind it) */
          const multiply = el.querySelector("[data-multiply]")
          const champ = multiply?.querySelector<HTMLElement>("[data-champ]")
          if (multiply && champ) {
            const cards = gsap.utils.toArray<HTMLElement>(multiply.querySelectorAll("[data-vcard]"))
            const c = champ.getBoundingClientRect()
            const cx = c.left + c.width / 2
            const cy = c.top + c.height / 2
            const vec = cards.map((card) => {
              const r = card.getBoundingClientRect()
              return { x: cx - (r.left + r.width / 2), y: cy - (r.top + r.height / 2) }
            })
            const tl = gsap.timeline({ scrollTrigger: { trigger: multiply, start: "top 80%", once: true } })
            tl.from(champ, { scale: 0.86, duration: 0.6, ease: "back.out(1.6)" }).from(
              cards,
              { x: (i) => vec[i].x, y: (i) => vec[i].y, scale: 0.4, rotation: (i) => (i % 2 ? 8 : -8), duration: 0.9, ease: "expo.out", stagger: { each: 0.05, from: "center" } },
              "-=.25"
            )
          }

          /* 7. cascades: direct children lift into place (transform only, from a visible state) */
          q("[data-cascade]").forEach((group) => {
            const kids = Array.from(group.children)
            ScrollTrigger.create({
              trigger: group,
              start: "top 88%",
              once: true,
              onEnter: () => gsap.fromTo(kids, { y: 18 }, { y: 0, duration: 0.7, ease: "power3.out", stagger: 0.06 }),
            })
          })

          if (hover) {
            /* 8. magnetic CTA */
            q("[data-magnetic]").forEach((b) => {
              const x = gsap.quickTo(b, "x", { duration: 0.5, ease: "power3" })
              const y = gsap.quickTo(b, "y", { duration: 0.5, ease: "power3" })
              listen(b, "pointermove", (e) => {
                const r = b.getBoundingClientRect()
                x((e.clientX - r.left - r.width / 2) * 0.3)
                y((e.clientY - r.top - r.height / 2) * 0.4)
              })
              listen(b, "pointerleave", () => (x(0), y(0)))
            })

            /* 9. tilt + shine */
            q("[data-tilt]").forEach((card) => {
              gsap.set(card, { transformPerspective: 700 })
              const rx = gsap.quickTo(card, "rotationX", { duration: 0.5, ease: "power3" })
              const ry = gsap.quickTo(card, "rotationY", { duration: 0.5, ease: "power3" })
              listen(card, "pointermove", (e) => {
                const r = card.getBoundingClientRect()
                const nx = (e.clientX - r.left) / r.width
                const ny = (e.clientY - r.top) / r.height
                ry((nx - 0.5) * 10)
                rx((0.5 - ny) * 8)
                card.style.setProperty("--mx", `${nx * 100}%`)
                card.style.setProperty("--my", `${ny * 100}%`)
              })
              listen(card, "pointerleave", () => (rx(0), ry(0)))
            })

            /* 10. final CTA: the lime glow follows the pointer */
            const fin = el.querySelector<HTMLElement>("[data-final]")
            const glow = el.querySelector<HTMLElement>("[data-glow]")
            if (fin && glow) {
              const gx = gsap.quickTo(glow, "x", { duration: 0.8, ease: "power3" })
              const gy = gsap.quickTo(glow, "y", { duration: 0.8, ease: "power3" })
              listen(fin, "pointermove", (e) => {
                const r = fin.getBoundingClientRect()
                gx(e.clientX - r.left - r.width * 0.7)
                gy(e.clientY - r.top - r.height * 0.3)
              })
            }
          } else {
            /* touch: the glow breathes instead */
            gsap.to(q("[data-glow]"), { scale: 1.25, opacity: 0.7, duration: 3, ease: "sine.inOut", yoyo: true, repeat: -1 })
          }

          return () => off.forEach((f) => f())
        }
      )
      // the workflow pin (flow.tsx) adds spacing: recompute every trigger below it once everything exists
      requestAnimationFrame(() => ScrollTrigger.refresh())
      return () => {
        stopReel()
        mm.revert()
      }
    },
    { scope: root }
  )

  /* 04/11: example videos [data-lp-video] play only while on screen (preload="none" until then); reduced motion = posters */
  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === "undefined" || !window.matchMedia(MOTION).matches) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement
          if (e.isIntersecting) {
            if (v.preload !== "auto") v.preload = "auto"
            void v.play().catch(() => {})
          } else v.pause()
        }
      },
      { rootMargin: "120px 0px" }
    )
    el.querySelectorAll("video[data-lp-video]").forEach((v) => io.observe(v))
    return () => io.disconnect()
  }, [locale])

  /* EN/PT: a short cross-fade when the language switches (content swaps in place via router.refresh) */
  useGSAP(
    () => {
      if (firstLocale.current === locale) return
      firstLocale.current = locale
      if (!window.matchMedia(MOTION).matches) return
      gsap.fromTo(root.current!.querySelectorAll("main, footer"), { autoAlpha: 0.25, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out", clearProps: "transform,opacity,visibility" })
    },
    { dependencies: [locale], scope: root }
  )

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Hero reel (spec design/hero-motion-2026-11-04.md §4, approved 04/11 without the "unlock" beat).
 * Keep in sync with video/src/landing/HeroMill.tsx: 14.0 s loop, wipes at 4.2 / 5.7 / 7.2 / 8.7 s. */
const HERO_T = 14
const HERO_W = [4.2, 5.7, 7.2, 8.7]
const ADSETS = 10.0
const PAUSED = 11.4
const RESET = 13.4
/** the rest frame = the poster (hero-mill.jpg, frame 378) = the server HTML */
const HERO_REST = 12.6

type Conn = { saveData?: boolean; effectiveType?: string }

function heroTimeline(scope: Element) {
  const q = gsap.utils.selector(scope)
  const all = (k: string) => q(`[data-tl="${k}"]`)
  const codes = all("code")
  const rows = all("why")
  const plan = all("plan")
  const adsets = all("adset")
  // hand the CSS rest positions over to GSAP (y: 0 + yPercent) and start from the t = 0 state: a rewound
  // immediateRender:false tween goes back to the value it found, so that value must be the loop's start
  gsap.set([...codes, ...all("status-draft"), ...all("status-paused")], { y: 0, yPercent: 0 })
  gsap.set([...codes.slice(1), ...all("status-paused")], { yPercent: 130 })

  const tl = gsap.timeline({ paused: true })
  tl.fromTo(all("winner-bar"), { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: "power2.inOut" }, 0)
    .fromTo(all("read"), { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: "back.out(2)" }, 0.9)
    .fromTo(all("flash"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, 0.9)
    .to(all("flash"), { autoAlpha: 0, duration: 0.45 }, 1.15)
    .fromTo(all("reading"), { autoAlpha: 0, y: -4 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: "power3.out" }, 1.0)
    .to(all("reading"), { autoAlpha: 0, duration: 0.25 }, HERO_W[0])
    .fromTo(all("ruler"), { scaleX: 0 }, { scaleX: 1, duration: 3.2, ease: "none" }, 1.0)
  // why it works: hook, proof and CTA light up one after the other
  ;[
    [1.0, 2.0],
    [2.0, 3.1],
    [3.1, 4.2],
  ].forEach(([s, e], i) => {
    const r = rows[i]
    if (!r) return
    tl.fromTo(r.querySelector(".lp-hl"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, s)
      .to(r.querySelector(".lp-hl"), { autoAlpha: 0, duration: 0.25 }, e)
      .fromTo(r.querySelector(".lp-ul"), { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power3.out" }, s + 0.05)
      .fromTo(r.querySelector(".lp-tick"), { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, e - 0.15)
  })
  // the batch: each variation ticks in the plan the instant the reel wipes it in
  HERO_W.forEach((w, i) => {
    const row = plan[i]
    tl.fromTo(codes[i], { yPercent: 0 }, { yPercent: -130, duration: 0.4, ease: "power3.in", immediateRender: false }, w)
      .fromTo(codes[i + 1], { yPercent: 130 }, { yPercent: 0, duration: 0.45, ease: "power3.out", immediateRender: false }, w + 0.15)
    if (!row) return
    tl.fromTo(row.querySelector(".lp-chk"), { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, w + 0.1)
      .fromTo(row.querySelector(".lp-chip"), { autoAlpha: 0, x: -6 }, { autoAlpha: 1, x: 0, duration: 0.3, ease: "power3.out" }, w + 0.15)
      .fromTo(row, { backgroundColor: "rgba(200,240,60,0)" }, { backgroundColor: "rgba(200,240,60,0.22)", duration: 0.2 }, w + 0.1)
      .to(row, { backgroundColor: "rgba(200,240,60,0)", duration: 0.7 }, w + 0.6)
  })
  // the publish template fills, then the status rolls to Paused on Meta
  tl.fromTo(adsets[0] ?? [], { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, ADSETS)
    .fromTo(adsets[1] ?? [], { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, ADSETS + 0.3)
    .fromTo(all("status-draft"), { yPercent: 0 }, { yPercent: -130, duration: 0.35, ease: "power3.in" }, PAUSED)
    .fromTo(all("status-paused"), { yPercent: 130 }, { yPercent: 0, duration: 0.4, ease: "power3.out" }, PAUSED + 0.1)
    .fromTo(all("ok"), { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, PAUSED + 0.3)
    // 13.4: soft reset, so the loop has no cut (the reel wipes back to the raw winner at the same time)
    .to([...all("read"), ...all("ok"), ...q(".lp-tick"), ...q(".lp-chk"), ...plan.map((r) => r.querySelector(".lp-chip"))], { autoAlpha: 0, duration: 0.4 }, RESET)
    .to([...q(".lp-ul"), ...adsets, ...all("ruler"), ...all("winner-bar")], { scaleX: 0, duration: 0.4, ease: "power2.inOut" }, RESET)
    .fromTo(codes[codes.length - 1], { yPercent: 0 }, { yPercent: -130, duration: 0.35, ease: "power3.in", immediateRender: false }, RESET + 0.05)
    .fromTo(codes[0], { yPercent: 130 }, { yPercent: 0, duration: 0.4, ease: "power3.out", immediateRender: false }, RESET + 0.2)
    .fromTo(all("status-paused"), { yPercent: 0 }, { yPercent: 130, duration: 0.35, ease: "power3.in", immediateRender: false }, RESET + 0.05)
    .fromTo(all("status-draft"), { yPercent: -130 }, { yPercent: 0, duration: 0.4, ease: "power3.out", immediateRender: false }, RESET + 0.2)
    .set({}, {}, HERO_T)

  // text/state that is not a tween: counters, the mobile rail and its caption
  const counts = all("count")
  const steps = all("step")
  const caps = all("cap")
  let last = ""
  const sync = (t: number) => {
    const n = t >= RESET + 0.05 ? 0 : HERO_W.filter((w) => t >= w + 0.1).length
    const step = t < HERO_W[0] ? 0 : t < ADSETS ? 1 : t < PAUSED ? 2 : t < RESET ? 3 : -1
    const cap = t < 1.0 ? 0 : t < HERO_W[0] ? 1 : t < ADSETS ? 2 : t < PAUSED ? 3 : 4
    const key = `${n}|${step}|${cap}`
    if (key === last) return
    last = key
    counts.forEach((c) => c.firstChild && (c.firstChild.nodeValue = String(n)))
    steps.forEach((s, i) => s.setAttribute("data-on", i === step ? "on" : step > i || step === -1 ? "done" : "todo"))
    caps.forEach((c, i) => (i === cap ? c.setAttribute("data-on", "on") : c.removeAttribute("data-on")))
  }
  const seek = (t: number) => {
    tl.time(t, false)
    sync(t)
  }
  return { seek, kill: () => tl.kill() }
}

/**
 * Drives the hero: the reel's clock → the timeline (requestVideoFrameCallback, rAF as fallback). The video loads only
 * after the first paint (idle after `load`), never with save-data / 2g / 3g (then the poster stays and a wall clock
 * drives the cards). Until the reel plays, the cards sit on the rest frame so they match the poster. Pauses off
 * screen, in a hidden tab and with the button. Reduced motion: nothing moves; the button plays the preview once.
 */
type Safe = <F extends (...a: never[]) => void>(fn: F) => F

function heroReel(root: HTMLElement, contextSafe: Safe) {
  const scope = root.querySelector<HTMLElement>("[data-hero]")
  const video = scope?.querySelector<HTMLVideoElement>("video[data-hero-reel]")
  const btn = scope?.querySelector<HTMLButtonElement>("[data-reel-toggle]")
  if (!scope || !video || !btn) return () => {}

  const reduce = !window.matchMedia(MOTION).matches
  const conn = (navigator as Navigator & { connection?: Conn }).connection
  const lite = !!conn?.saveData || /(^|-)(2g|3g)$/.test(conn?.effectiveType ?? "")
  const tl = heroTimeline(scope)
  tl.seek(HERO_REST)

  let userPaused = reduce // reduced motion starts (and stays) still until the button is pressed
  let onScreen = true
  let started = false // the video (or the wall clock) has taken over from the rest frame
  let wall = lite // no video: a wall clock drives the cards
  let wallT = 0
  let raf = 0
  let vfc = 0
  let lastNow = 0
  let ready = false // first paint done, allowed to load
  const off: (() => void)[] = []
  const on = (t: EventTarget, type: string, fn: () => void) => {
    const f = contextSafe(fn)
    t.addEventListener(type, f)
    off.push(() => t.removeEventListener(type, f))
  }
  const running = () => ready && !userPaused && onScreen && !document.hidden

  const label = () => {
    const playing = !userPaused
    btn.dataset.state = playing ? "playing" : "paused"
    btn.setAttribute("aria-label", (playing ? btn.dataset.pause : reduce ? btn.dataset.preview : btn.dataset.play) ?? "")
  }

  const stopLoops = () => {
    cancelAnimationFrame(raf)
    raf = 0
    if (vfc && "cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(vfc)
    vfc = 0
  }
  const finishOnce = () => {
    // reduced motion: one pass, then back to the still rest frame
    userPaused = true
    started = false
    stopLoops()
    video.pause()
    if (!wall) video.currentTime = HERO_REST // the reel's own rest frame (= the poster)
    tl.seek(HERO_REST)
    label()
  }
  const wallTick = (now: number) => {
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0
    lastNow = now
    wallT += dt
    if (reduce && wallT >= HERO_T) return finishOnce()
    tl.seek(wallT % HERO_T)
    raf = requestAnimationFrame(wallTick)
  }
  const videoTick = () => {
    tl.seek(video.currentTime % HERO_T)
    if ("requestVideoFrameCallback" in video) vfc = video.requestVideoFrameCallback(videoTick)
    else raf = requestAnimationFrame(videoTick)
  }

  const update = () => {
    stopLoops()
    if (!running()) {
      if (!wall) video.pause()
      return
    }
    if (wall) {
      started = true
      lastNow = 0
      raf = requestAnimationFrame(wallTick)
      return
    }
    video.loop = !reduce
    if (video.preload !== "auto") video.preload = "auto"
    video.play().then(
      contextSafe(() => {
        if (!running()) return void video.pause()
        started = true
        stopLoops()
        videoTick()
      }),
      contextSafe(() => {
        // autoplay refused / no source: keep the poster, run the cards on a wall clock
        wall = true
        update()
      })
    )
  }

  on(video, "ended", () => reduce && finishOnce())
  on(btn, "click", () => {
    if (reduce && userPaused && !started) {
      // "Play preview": one pass from the start
      wallT = 0
      if (!wall) video.currentTime = 0
    }
    userPaused = !userPaused
    label()
    update()
  })
  on(document, "visibilitychange", update)

  const io =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          contextSafe((entries: IntersectionObserverEntry[]) => {
            onScreen = entries[entries.length - 1].isIntersecting
            update()
          })
        )
  io?.observe(scope)

  // never before the first paint: after `load`, when the main thread is idle (2 s at most)
  let idle = 0
  const go = contextSafe(() => {
    ready = true
    update()
  })
  const afterLoad = () => {
    idle = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(go, { timeout: 2000 }) : (window as Window).setTimeout(go, 600)
  }
  if (document.readyState === "complete") afterLoad()
  else on(window, "load", afterLoad)

  btn.hidden = false
  label()

  return () => {
    stopLoops()
    io?.disconnect()
    off.forEach((f) => f())
    if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle)
    clearTimeout(idle)
    video.pause()
    btn.hidden = true
    tl.kill()
  }
}
