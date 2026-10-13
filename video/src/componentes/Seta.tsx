import React from 'react';

export const Seta: React.FC<{ cor: string; tamanho: number }> = ({ cor, tamanho }) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
    <path d="M4 12h14M13 6l6 6-6 6" stroke={cor} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
