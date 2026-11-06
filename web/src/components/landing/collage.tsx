import type { T } from "./landing"

/** the batch shown in the phone, in the order the reel wipes them in (slugs = real templates) */
const BATCH = ["new-headline", "split-screen", "breaking-news", "meme-pov"] as const

/**
 * Hero collage (spec design/hero-motion-2026-11-04.md, approved 04/11 as option C): real product pieces in HTML,
 * plus one Remotion reel (HeroMill) inside the phone. A paused GSAP timeline in landing-motion.tsx follows the
 * reel's clock and drives every `data-tl` element. The server HTML is the timeline's rest frame (12.6 s):
 * everything read, 4 of 4, published paused — so no JS / reduced motion / save-data show the complete story.
 * Each `.lp-slot` is positioned (and moved by the pointer parallax on desktop); the card inside drifts in CSS.
 */
export function Collage({ t }: { t: T }) {
  const count = (c: React.ReactNode) => <span data-tl="count">{c}</span>
  return (
    <div className="lp-collage" role="group" aria-label={t("collage.label")} data-collage data-hero>
      {/* ≤ 560 px only: the winner as one line */}
      <div className="lp-wstrip">
        {/* eslint-disable-next-line @next/next/no-img-element -- 13 KB still from public/, no optimizer needed */}
        <img className="lp-thumb" src="/landing/ex/champion.jpg" alt="" width={34} height={60} />
        <span className="lp-fname">POCKETWISE_UGC_A_9x16.mp4</span>
        <span className="lp-chip ok" data-tl="read">
          {t("collage.read")}
        </span>
        <div className="lp-bar" aria-hidden="true">
          <i data-tl="winner-bar" />
        </div>
      </div>

      {/* 1. the winner going in */}
      <div className="lp-slot lp-s-upload" data-depth="10">
        <article className="lp-cc">
          <span className="lp-flash" data-tl="flash" aria-hidden="true" />
          <div className="lp-cc-lbl">
            {t("collage.winner")}{" "}
            <span className="lp-chip ok" data-tl="read">
              {t("collage.read")}
            </span>
          </div>
          <div className="lp-file">
            {/* eslint-disable-next-line @next/next/no-img-element -- 13 KB still from public/ */}
            <img className="lp-thumb" src="/landing/ex/champion.jpg" alt="" width={34} height={60} />
            <div className="min-w-0">
              <div className="lp-fname">POCKETWISE_UGC_A_9x16.mp4</div>
              <div className="mt-[3px] text-[12px] text-fg-3">{t("collage.winnerMeta")}</div>
            </div>
          </div>
          <div className="lp-bar" aria-hidden="true">
            <i data-tl="winner-bar" />
          </div>
        </article>
      </div>

      {/* 2. why it works (times = whisper of the winner: hook 0:00–0:02, "I saved 400 bucks" 0:14, "Links right below" 0:18) */}
      <div className="lp-slot lp-s-analysis" data-depth="16">
        <article className="lp-cc">
          <div className="lp-cc-lbl">
            {t("collage.why")} <span className="lp-chip example">{t("collage.example")}</span>
          </div>
          <div className="lp-ruler" aria-hidden="true">
            <span className="lp-sg h" />
            <span className="lp-sg p" />
            <span className="lp-sg c" />
            <span className="lp-ruler-fill" data-tl="ruler" />
          </div>
          <div className="lp-why">
            {(
              [
                ["hook", "0:00–0:02", "whyHook"],
                ["proof", "0:14", "whyProof"],
                ["cta", "0:18", "whyCta"],
              ] as const
            ).map(([k, time, body]) => (
              <div className="lp-why-row" key={k} data-tl="why">
                <span className="lp-hl" aria-hidden="true" />
                <b>
                  {t(`collage.${k}`)}
                  <span className="lp-ul" aria-hidden="true" />
                </b>
                <span className="lp-t">{time}</span>
                <span className="lp-tick" aria-hidden="true" />
                <p>{t(`collage.${body}`)}</p>
              </div>
            ))}
          </div>
        </article>
      </div>

      {/* 3. the phone: one Remotion reel, the same woman talking while the frame swaps template */}
      <div className="lp-slot lp-s-preview" data-depth="26">
        <article className="lp-cc lp-on-ink">
          <div className="lp-video">
            <video
              data-hero-reel
              muted
              playsInline
              loop
              preload="none"
              poster="/landing/hero/hero-mill.jpg"
              aria-hidden="true"
              tabIndex={-1}
              width={432}
              height={768}
            >
              <source src="/landing/hero/hero-mill.webm" type="video/webm" />
              <source src="/landing/hero/hero-mill.mp4" type="video/mp4" />
            </video>
            <span className="lp-badge" data-tl="reading" aria-hidden="true">
              {t("collage.reading")}
            </span>
          </div>
          {/* WCAG 2.2.2: the loop runs > 5 s, so it gets a pause; hidden until JS can drive it */}
          <button
            type="button"
            className="lp-reel-ctl"
            data-reel-toggle
            data-state="playing"
            data-pause={t("collage.pause")}
            data-play={t("collage.play")}
            data-preview={t("collage.playPreview")}
            aria-label={t("collage.pause")}
            hidden
          >
            <span className="lp-ic-pause" aria-hidden="true">
              <i />
              <i />
            </span>
            <span className="lp-ic-play" aria-hidden="true" />
          </button>
          <div className="lp-prev-foot" aria-hidden="true">
            <span className="lp-codes">
              {["winner", ...BATCH].map((c) => (
                <b key={c} data-tl="code">
                  {c.toUpperCase()}
                </b>
              ))}
            </span>
            <span className="lp-mono lp-phone-n">
              <span data-tl="count">4</span>/4
            </span>
          </div>
        </article>
      </div>

      {/* 4. variation plan: each row ticks the instant its variation shows up in the phone */}
      <div className="lp-slot lp-s-plan" data-depth="14">
        <article className="lp-cc">
          <div className="lp-cc-lbl">
            {t("collage.plan")} <span className="lp-mono">{t.rich("collage.planCount", { n: count })}</span>
          </div>
          <div className="lp-plan">
            {BATCH.map((c) => (
              <div className="lp-plan-row" key={c} data-tl="plan">
                <span className="lp-box" aria-hidden="true">
                  <span className="lp-chk" />
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element -- tiny stills already in public/landing/ex */}
                <img className="lp-mini" src={`/landing/ex/${c}.jpg`} alt="" width={14} height={24} loading="lazy" />
                <span className="lp-code">{c.toUpperCase()}</span>
                <span className="lp-chip free">{t("collage.free")}</span>
              </div>
            ))}
            <div className="lp-plan-sub">{t("collage.withAi")}</div>
            <div className="lp-plan-row">
              <span className="lp-box" aria-hidden="true" />
              <span className="lp-code off">AVATAR-FACE ×3</span>
              <span className="lp-why-s">{t("collage.newFaces")}</span>
            </div>
          </div>
        </article>
      </div>

      {/* 5. Meta publish template */}
      <div className="lp-slot lp-s-meta" data-depth="20">
        <article className="lp-cc lp-on-ink">
          <div className="lp-cc-lbl">
            <span className="flex items-center gap-2">
              <span className="lp-meta-f" aria-hidden="true">
                f
              </span>
              {t("collage.publish")}
            </span>
            <span className="lp-chip ok">{t("collage.default")}</span>
          </div>
          <dl className="lp-kv">
            <dt>{t("collage.budget")}</dt>
            <dd>{t("collage.budgetV")}</dd>
            <dt>{t("collage.adsets")}</dt>
            <dd>{t("collage.adsetsV")}</dd>
            <dt>{t("collage.status")}</dt>
            <dd>
              <span className="lp-roll">
                <span data-tl="status-draft" aria-hidden="true">
                  {t("collage.statusDraft")}
                </span>
                <span data-tl="status-paused">
                  {t("collage.statusV")}
                  <span className="lp-chip ok lp-ok" data-tl="ok" aria-hidden="true">
                    OK
                  </span>
                </span>
              </span>
            </dd>
          </dl>
          <div className="lp-adsets" role="img" aria-label={t("collage.adsetsLabel")}>
            <i className="full">
              <em data-tl="adset" />
              <span>{t("collage.ads8")}</span>
            </i>
            <i className="full">
              <em data-tl="adset" />
              <span>{t("collage.ads4")}</span>
            </i>
            <i>
              <span>{t("collage.next")}</span>
            </i>
          </div>
        </article>
      </div>

      {/* ≤ 560 px only: the 4-step rail replaces Why it works, the plan and the publish card */}
      <div className="lp-rail">
        <ol className="lp-steps">
          {(["r0", "r1", "r2", "r3"] as const).map((k, i) => (
            <li key={k} className="lp-step" data-tl="step" data-on={i === 3 ? "on" : "done"}>
              <i aria-hidden="true" />
              {t(`collage.rail.${k}`)}
            </li>
          ))}
        </ol>
        <p className="lp-rcap">
          {(["c0", "c0b", "c1", "c2", "c3"] as const).map((k) => (
            <span key={k} data-tl="cap" data-on={k === "c3" ? "on" : undefined}>
              {t.rich(`collage.rail.${k}`, { b: (c) => <b>{c}</b>, n: count })}
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}
