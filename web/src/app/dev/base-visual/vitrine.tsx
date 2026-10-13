"use client"

import { AdFrame } from "@/components/ad-frame"
import { FlowBar } from "@/components/flow-bar"
import { SoonBlock, SoonSection, ExampleBadge } from "@/components/soon"
import { WizardRail } from "@/components/wizard-rail"
import { Button } from "@/components/ui/button"
import { Alert, AlertBody, AlertTitle } from "@/components/ui/alert"

/* Dev-only showcase; the strings here are fixture text, not product copy. */
export function Vitrine() {
  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-6 px-[var(--gut)] py-6">
      <h1>Base visual · F2</h1>
      <FlowBar flow="concepts" current="generate" running client="Mooncloth" hrefs={{ know: "#", scripts: "#", face: "#", engine: "#" }} />
      <FlowBar flow="iterate" current="generate" running client="Mooncloth" hrefs={{ analyze: "#" }} />
      <FlowBar flow="concepts" current="review" client="Mooncloth" hrefs={{ edit: "#" }} />
      <div className="flex flex-wrap gap-2">
        <Button variant="brand">Generate</Button>
        <Button variant="default">Ink</Button>
        <Button>Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Reject</Button>
        <Button variant="brand" size="lg">Large</Button>
        <Button size="sm">Small</Button>
      </div>
      <div className="grid gap-2">
        <Alert variant="warning"><AlertBody><AlertTitle>Changes not in the preview yet</AlertTitle></AlertBody></Alert>
        <Alert variant="destructive"><AlertBody><AlertTitle>Over the monthly cap</AlertTitle></AlertBody></Alert>
        <Alert variant="success"><AlertBody><AlertTitle>All 5 scenes ready</AlertTitle></AlertBody></Alert>
        <Alert variant="info"><AlertBody><AlertTitle>Generating · 2 of 5</AlertTitle></AlertBody></Alert>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="w-full max-w-[320px]">
          <WizardRail
            aria-label="Setup steps"
            eyebrow="New client setup"
            name="Mooncloth"
            current={3}
            steps={[
              { title: "Business", desc: "Name, site and team", href: "#" },
              { title: "Connect Meta", desc: "Ad account, Page and pixel", href: "#" },
              { title: "Product & offer", desc: "What we sell and why it sells" },
              { title: "Audience & voice", desc: "Who buys and how we talk" },
              { title: "Goals & guardrails", desc: "Targets, budget, approvals" },
              { title: "Build the Brain", desc: "Import ads and first read" },
            ]}
            footer={<Button className="w-full">Save and exit</Button>}
          />
        </div>
        <div className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
          <AdFrame hook="I tried 11 sleep masks. This is the only one I kept." label="Original" duration="0:32" />
          <AdFrame tone="dawn" hook="The 5am problem" label="Hook 1" duration="0:28" size="sm" />
          <AdFrame tone="plum" hook="Partner reads till 1am" label="Face 2" duration="0:30" ratio="4:5" />
          <AdFrame tone="ink" size="xs" />
        </div>
      </div>
      <SoonBlock what={<><b>Results from Meta.</b> Spend, purchases, cost per purchase and ROAS show here once Meta is connected.</>} example>
        <div className="grid grid-cols-2 gap-3 tablet:grid-cols-4">
          {["$8,912", "341", "$26.13", "2.41x"].map((v) => (
            <div key={v} className="rounded-lg border border-line bg-card p-4 font-mono text-2xl">{v}</div>
          ))}
        </div>
      </SoonBlock>
      <SoonSection
        title="Campaigns"
        heading="Campaigns reads Mooncloth's Meta results every day."
        promise="It needs the Meta connection, which isn't built yet."
        actions={<><Button variant="brand">Iterate a winner</Button><Button>Open the Library</Button></>}
        preview={<div className="rounded-lg border border-line bg-card p-6">Chart</div>}
      />
      <div className="on-ink flex flex-col gap-3 rounded-xl bg-ink p-[22px]">
        <span className="eyebrow">This batch</span>
        <span className="font-mono text-[54px] leading-none font-semibold text-brand">12</span>
        <ExampleBadge />
        <Button variant="outline">On ink</Button>
      </div>
    </div>
  )
}
