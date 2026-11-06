import React from 'react';
import { AbsoluteFill, Easing, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';

/**
 * HeroMill (landing, 04/11; spec design/hero-motion-2026-11-04.md §8.1). Marketing piece, NOT a product template:
 * it is registered in Root.tsx outside templates/registro.tsx.
 *
 * The same Pocketwise avatar keeps talking while the frame around her swaps template every 1.5 s, on the same
 * speech frame (all sources came out of the same take: audio cross-correlation = 0 ms lag). No UI text, no logo,
 * no lock: everything that is interface lives in the landing's HTML, driven by a GSAP timeline on this clock.
 *
 * 432×768, 30 fps, 420 frames (14.0 s), no audio, seamless loop. Media: `landing/hero/*.mp4` in the public dir
 * (432×768/30 fps intermediates made from design/exemplos-templates/2026-11-04 by render-hero.sh, which renders
 * with --public-dir pointing at a temp folder, so the 1080p sources never enter the repo).
 *
 * Keep these numbers in sync with HERO_T / HERO_W in web/src/components/landing/landing-motion.tsx.
 */
export const HERO_MILL = { width: 432, height: 768, fps: 30, durationInFrames: 420 } as const;

/** second of the take where the loop starts: inside the pause before "I tried…" (whisper: 1.94–3.26 s), so the
 * loop ends inside the pause after "…400 bucks." (17.16–18.22 s) */
const S = 96; // 3.2 s
const WIPE = 13; // frames
/** wipe-in frames: 4.2, 5.7, 7.2, 8.7 s */
const LAYERS: { file: string; in: number }[] = [
  { file: 'new-headline', in: 126 },
  { file: 'split-screen', in: 171 },
  { file: 'breaking-news', in: 216 },
  { file: 'meme-pov', in: 261 },
];
/** loop seam: the raw take wipes back in (same lime wipe, no crossfade: two poses of one face would ghost),
 * timed so frame 419 = take at S − 1 frame and frame 0 = take at S: no cut on the wrap */
const LOOP_IN = 420 - 1 - WIPE; // 406
const LIME = '#c8f03c';

const src = (f: string) => staticFile(`landing/hero/${f}.mp4`);
const fill: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' };

const Wipe: React.FC<{ file: string; at: number; until: number; from: number }> = ({ file, at, until, from }) => {
  const frame = useCurrentFrame() + at; // absolute frame (we are inside a Sequence that starts at `at`)
  const p = interpolate(frame, [at, at + WIPE], [0, 100], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `inset(0 ${100 - p}% 0 0)` }}>
        {/* `from` = source frame shown at `at`; S + at keeps the same speech frame as the champion */}
        <OffthreadVideo src={src(file)} startFrom={from} muted style={fill} />
      </AbsoluteFill>
      {p > 0 && p < 100 && frame < until ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${p}%`,
            width: 2,
            marginLeft: -1,
            background: LIME,
            boxShadow: `0 0 12px ${LIME}`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const HeroMill: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: '#1d2027' }}>
      {/* layer 0: the raw winner, all the time */}
      <OffthreadVideo src={src('avatar')} startFrom={S} muted style={fill} />
      {/* layers 1–4: each one wipes in over the previous; earlier ones stop once fully covered */}
      {LAYERS.map((l, i) => {
        const next = LAYERS[i + 1];
        const end = next ? next.in + WIPE : HERO_MILL.durationInFrames;
        return (
          <Sequence key={l.file} from={l.in} durationInFrames={end - l.in} layout="none">
            <Wipe file={l.file} at={l.in} until={end} from={S + l.in} />
          </Sequence>
        );
      })}
      {/* loop seam: back to the raw winner, landing exactly on the second the loop restarts */}
      <Sequence from={LOOP_IN} durationInFrames={HERO_MILL.durationInFrames - LOOP_IN} layout="none">
        <Wipe file="avatar" at={LOOP_IN} until={HERO_MILL.durationInFrames} from={S - (HERO_MILL.durationInFrames - LOOP_IN)} />
      </Sequence>
    </AbsoluteFill>
  );
};
