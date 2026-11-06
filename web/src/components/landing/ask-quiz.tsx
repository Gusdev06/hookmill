"use client"

import { useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Goal = "stretch" | "new" | "both"
const GOALS: Goal[] = ["stretch", "new", "both"]

/** Local demo of quiz Q1 (spec §7). Illustrates iterate-v2's free-template mixes; no API, not the real selectPieces. */
const PICKS: Record<Goal, [code: string, diversity?: true][]> = {
  stretch: [["HEADLINE-01"], ["HEADLINE-02"], ["HEADLINE-03"], ["CUT-01"], ["CUT-02"], ["CHAT-DM", true]],
  new: [["HEADLINE-01"], ["CUT-01"], ["CHAT-DM", true], ["PERSON-MOTION", true], ["FRAME-01", true], ["FRAME-02", true]],
  both: [["HEADLINE-01"], ["HEADLINE-02"], ["CUT-01"], ["CHAT-DM", true], ["PERSON-MOTION", true], ["FRAME-01", true]],
}

export function AskQuiz({ ctaHref }: { ctaHref: string }) {
  const t = useTranslations("landing.ask")
  const [goal, setGoal] = useState<Goal>("both")
  return (
    <div className="lp-quiz" role="group" aria-label={t("label")}>
      <div className="lp-panel-head">
        <b className="text-[16px]">{t("q")}</b>
        <span className="lp-chip example">{t("example")}</span>
      </div>
      <div className="lp-q-opts" role="group" aria-label={t("group")}>
        {GOALS.map((g) => (
          <button key={g} type="button" className="lp-q-opt" aria-pressed={goal === g} onClick={() => setGoal(g)}>
            <b>{t(`opts.${g}.t`)}</b>
            <span>{t(`opts.${g}.d`)}</span>
          </button>
        ))}
      </div>
      <div>
        <p className="lp-eyebrow" id="lp-picks">
          {t("picks")}
        </p>
        <ul className="lp-q-out" aria-labelledby="lp-picks" aria-live="polite">
          {PICKS[goal].map(([code, d]) => (
            <li key={code} className={cn(d && "d")}>
              {code}
            </li>
          ))}
        </ul>
      </div>
      <div className="lp-q-foot">
        <span className="text-[13px] text-fg-3">{t("foot")}</span>
        <Link href={ctaHref} className={buttonVariants({ variant: "brand", className: "lp-btn-text" })}>
          {t("cta")}
        </Link>
      </div>
    </div>
  )
}
