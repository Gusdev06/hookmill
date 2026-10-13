/** Example script content per offer (fictional, from the approved mockup). Used by the mock "Claude". */
type B = [label: string, start: number, end: number, speech: string, prompt: string]
export interface ScriptSeed { angle: string; rationale: string; blocks: B[] }

const P = {
  kitchen: "Woman at a kitchen table, morning window light, holds phone toward camera, surprised half-smile, handheld UGC framing",
  scroll: "Same woman scrolling a bank statement on her phone, close-up, mild frustration, same kitchen",
  screen: "Over-the-shoulder shot of a phone screen listing subscriptions with cancel buttons, she taps one",
  point: "Medium shot, she looks into the camera, relaxed, points down toward the link",
}

export const SCRIPTS: Record<string, ScriptSeed[]> = {
  of_orbit: [
    { angle: "Found money", rationale: "Opens on a concrete number; the winners for this offer all led with money found.", blocks: [
      ["Hook", 0, 3, "I found $312 a month I didn't know I was spending.", P.kitchen],
      ["Problem", 3, 11, "Streaming, two apps I never open, a gym I stopped going to. It all hid in my statement.", P.scroll],
      ["Product", 11, 21, "Orbit reads your bank feed and flags every recurring charge. You cancel from the same screen.", P.screen],
      ["CTA", 21, 27, "Try Orbit free for 14 days. Link below.", P.point],
    ] },
    { angle: "Contrarian", rationale: "Disarms people who already quit budgeting apps.", blocks: [
      ["Hook", 0, 4, "Budgeting apps don't work. This one isn't a budgeting app.", P.kitchen],
      ["Problem", 4, 13, "I quit every budget I started. Categories, envelopes, colour codes. Gone by week two.", P.scroll],
      ["Product", 13, 24, "Orbit does one job: it finds what you're paying for every month and lets you cancel it. That's it.", P.screen],
      ["CTA", 24, 31, "Free for 14 days. See what it finds.", P.point],
    ] },
    { angle: "Social proof", rationale: "Borrows authority from a third person and the 18k reviews.", blocks: [
      ["Hook", 0, 3, "My accountant asked what I changed. It was one app.", P.kitchen],
      ["Problem", 3, 10, "I wasn't overspending on big things. It was ten small charges I'd stopped noticing.", P.scroll],
      ["Product", 10, 19, "Orbit listed every one of them. 18,000 people rate it 4.7, and now I get why.", P.screen],
      ["CTA", 19, 24, "Start the free trial. Link below.", P.point],
    ] },
    { angle: "Pain", rationale: "Names the payday feeling from the brief's pains.", blocks: [
      ["Hook", 0, 4, "If payday feels like a refund that's gone in a week, watch this.", P.kitchen],
      ["Problem", 4, 12, "Rent's paid, you didn't go out, and the account is still empty. Something is leaking.", P.scroll],
      ["Product", 12, 23, "Connect your bank to Orbit and it shows every recurring charge in one list. Cancel with one tap.", P.screen],
      ["CTA", 23, 29, "Try it free for 14 days.", P.point],
    ] },
  ],
  of_quiet: [
    { angle: "3am", rationale: "Starts inside the exact moment the audience lives.", blocks: [
      ["Hook", 0, 3, "It's 3am and your brain just started a meeting.", "Man in bed at night, phone light on his face, eyes wide, dim bedroom"],
      ["Problem", 3, 11, "You replay the day, then tomorrow, then something from 2014. Melatonin stopped working.", "Close-up of a ceiling fan turning, blue night light"],
      ["Product", 11, 21, "Quiet Mind is 21 short audio lessons that teach your head to power down without the phone.", "He puts the phone face down, headphones on, lies back"],
      ["CTA", 21, 26, "Start the 21 days tonight. Link below.", "Morning light, he looks rested, smiles at the camera"],
    ] },
    { angle: "Skeptic", rationale: "For people who tried sleep apps and gave up.", blocks: [
      ["Hook", 0, 4, "I deleted four sleep apps before this one.", "Woman on a sofa, scrolling apps, deleting them"],
      ["Problem", 4, 12, "Rain sounds, whale sounds, a man whispering. I was still awake.", "Phone screen with sleep app icons"],
      ["Product", 12, 22, "Quiet Mind isn't sounds. It's a 21-day method, ten minutes a night.", "She listens with headphones, eyes closed"],
      ["CTA", 22, 27, "$47 once. Try it.", "She points to the link, relaxed"],
    ] },
    { angle: "Proof", rationale: "11,400 students and podcast mentions.", blocks: [
      ["Hook", 0, 3, "11,400 people fixed their sleep with a course. I was skeptical too.", "Man at a desk, coffee, talking to camera"],
      ["Problem", 3, 10, "I was tired every single morning.", "Alarm going off, he hits snooze"],
      ["Product", 10, 20, "By day 9 I was asleep in 20 minutes.", "He sleeps peacefully"],
      ["CTA", 20, 25, "Start the 21 days.", "He smiles, points down"],
    ] },
    { angle: "Routine", rationale: "Shows how small the daily commitment is.", blocks: [
      ["Hook", 0, 3, "Ten minutes before bed. That's the whole routine.", "Woman setting a 10-minute timer"],
      ["Problem", 3, 10, "Long routines don't survive a tired evening.", "Messy evening, dishes, she sighs"],
      ["Product", 10, 20, "Quiet Mind is one audio lesson a night for 21 nights.", "She lies down with headphones"],
      ["CTA", 20, 25, "Try it tonight.", "She waves goodnight"],
    ] },
  ],
  of_bright: [
    { angle: "Speed", rationale: "The promise is time: shorter than your coffee.", blocks: [
      ["Hook", 0, 3, "My skincare routine is shorter than my coffee.", "Woman in a bright bathroom, coffee in hand"],
      ["Problem", 3, 10, "I own twelve products and use none of them.", "Shelf crowded with bottles"],
      ["Product", 10, 20, "Brightside is three steps: cleanser, serum, SPF. Five minutes.", "She applies serum, close-up"],
      ["CTA", 20, 24, "Get the kit. Free shipping.", "She holds the kit to camera"],
    ] },
    { angle: "Before/after", rationale: "Visual contrast of dull vs glowing skin.", blocks: [
      ["Hook", 0, 3, "Same face, two weeks apart.", "Split mirror, same woman, two lightings"],
      ["Problem", 3, 10, "Dull skin and a ten-step routine I never kept.", "Tired morning face"],
      ["Product", 10, 20, "Brightside: three products, one routine.", "She uses the three products"],
      ["CTA", 20, 24, "Get the kit.", "She smiles at the camera"],
    ] },
    { angle: "Reviews", rationale: "4.8 from 3,200 reviews.", blocks: [
      ["Hook", 0, 3, "3,200 reviews and the top one says 'finally'.", "Phone with review stars"],
      ["Problem", 3, 10, "Every routine felt like homework.", "Woman reading a long skincare guide"],
      ["Product", 10, 20, "Brightside takes five minutes and it's dermatologist tested.", "She applies SPF"],
      ["CTA", 20, 24, "Get yours.", "Kit on a counter"],
    ] },
    { angle: "Shelf", rationale: "The cluttered shelf is the shared pain.", blocks: [
      ["Hook", 0, 3, "I threw out nine bottles this morning.", "Bin full of skincare bottles"],
      ["Problem", 3, 10, "More products didn't mean better skin.", "Crowded shelf"],
      ["Product", 10, 20, "Now it's just the Brightside kit.", "Clean shelf with the kit"],
      ["CTA", 20, 24, "$39, free shipping.", "She taps the link"],
    ] },
  ],
}

export const FACE_DESCRIPTION: Record<string, string> = {
  of_orbit: "Woman, early 30s, casual sweater, at a kitchen table, soft morning window light, phone in hand. Looks like a real customer, not a model.",
  of_quiet: "Man, late 30s, t-shirt, in a dim bedroom at night, tired eyes. Looks like a real person, not an actor.",
  of_bright: "Woman, early 30s, bright bathroom, natural skin, relaxed. Looks like a real customer.",
}
