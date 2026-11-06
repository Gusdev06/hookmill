import React from 'react';
import { Composition } from 'remotion';
import { Sonda, type SondaProps } from './Sonda';

const padrao: SondaProps = { w: 464, h: 832, frames: 1, fontes: [], blocos: [] };
export const Root: React.FC = () => (
  <Composition id="Sonda" component={Sonda as unknown as React.FC<Record<string, unknown>>} width={464} height={832} fps={30} durationInFrames={1}
    defaultProps={padrao as unknown as Record<string, unknown>}
    calculateMetadata={({ props }) => { const p = props as unknown as SondaProps; return { width: p.w, height: p.h, durationInFrames: p.frames }; }} />
);
