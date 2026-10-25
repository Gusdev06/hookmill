// Ícones SVG próprios das molduras (D12: nada de emoji; render determinístico). Traço 24x24, cor por `cor`. Igual ao protótipo aprovado.
import React from 'react';

type P = { tam?: number; cor?: string; espessura?: number; style?: React.CSSProperties };

const Traco: React.FC<P & { children: React.ReactNode; preenchido?: boolean }> = ({ tam = 48, cor = 'currentColor', espessura = 2.2, style, children, preenchido }) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill={preenchido ? cor : 'none'} stroke={preenchido ? 'none' : cor} strokeWidth={espessura} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', ...style }}>
    {children}
  </svg>
);

export const SetaBaixo: React.FC<P> = (p) => <Traco {...p}><path d="M12 4v15" /><path d="M5.5 12.5 12 19l6.5-6.5" /></Traco>;
export const Fechar: React.FC<P> = (p) => <Traco {...p}><path d="M6 6l12 12M18 6 6 18" /></Traco>;
export const Coracao: React.FC<P & { cheio?: boolean }> = ({ cheio, ...p }) => (
  <Traco {...p} preenchido={cheio}><path d="M12 20.5s-7.5-4.6-9.3-9.4C1.4 7.6 3.6 4 7.1 4c2 0 3.6 1.1 4.9 2.9C13.3 5.1 14.9 4 16.9 4c3.5 0 5.7 3.6 4.4 7.1-1.8 4.8-9.3 9.4-9.3 9.4Z" /></Traco>
);
export const Enviar: React.FC<P> = (p) => <Traco {...p}><path d="M21 3 10 14" /><path d="M21 3l-6.5 18-4.5-7-7-4.5L21 3Z" /></Traco>;
export const Balao: React.FC<P> = (p) => <Traco {...p}><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z" /></Traco>;
export const Repostar: React.FC<P> = (p) => <Traco {...p}><path d="M4 9V7.5A2.5 2.5 0 0 1 6.5 5H19" /><path d="M16 2l3 3-3 3" /><path d="M20 15v1.5a2.5 2.5 0 0 1-2.5 2.5H5" /><path d="M8 22l-3-3 3-3" /></Traco>;
export const Compartilhar: React.FC<P> = (p) => <Traco {...p}><path d="M12 15V3" /><path d="M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></Traco>;
export const Salvar: React.FC<P> = (p) => <Traco {...p}><path d="M6 3h12v18l-6-4.5L6 21V3Z" /></Traco>;
export const Mais: React.FC<P> = (p) => <Traco {...p} preenchido><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></Traco>;
export const Microfone: React.FC<P> = (p) => <Traco {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></Traco>;
export const Camera: React.FC<P> = (p) => <Traco {...p}><rect x="3" y="6.5" width="12.5" height="11" rx="2.5" /><path d="M15.5 10.5 21 7.5v9l-5.5-3" /></Traco>;
export const Tela: React.FC<P> = (p) => <Traco {...p}><rect x="3" y="4" width="18" height="12.5" rx="2" /><path d="M12 13V7.5" /><path d="M9.5 10 12 7.5l2.5 2.5" /><path d="M8 20.5h8" /></Traco>;
export const Mao: React.FC<P> = (p) => <Traco {...p}><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11" /><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v7" /><path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13" /><path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L4.2 15.6a1.5 1.5 0 0 1 2.3-1.9L8 15" /></Traco>;
export const Desligar: React.FC<P> = (p) => <Traco {...p} preenchido><path d="M12 9c-3.4 0-6.6.9-8.9 2.6-.7.5-.9 1.5-.4 2.2l1.3 1.8c.4.6 1.2.8 1.9.5l2.6-1.1c.6-.3.9-.9.9-1.5v-1.7c1.7-.5 3.5-.5 5.2 0v1.7c0 .6.4 1.2.9 1.5l2.6 1.1c.7.3 1.5.1 1.9-.5l1.3-1.8c.5-.7.3-1.7-.4-2.2C18.6 9.9 15.4 9 12 9Z" /></Traco>;
export const MicMudo: React.FC<P> = (p) => <Traco {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 10.4 5.2" /><path d="M3 3l18 18" /></Traco>;
export const Joinha: React.FC<P> = (p) => <Traco {...p}><path d="M7 11v9H4.5A1.5 1.5 0 0 1 3 18.5v-6A1.5 1.5 0 0 1 4.5 11H7Z" /><path d="M7 11l4-7.5c1.4 0 2.5 1.1 2.5 2.5v3.5h5.2a2 2 0 0 1 2 2.3l-1.2 7.4A2 2 0 0 1 17.5 21H7" /></Traco>;
export const Brilho: React.FC<P> = (p) => <Traco {...p} preenchido><path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7L12 2Z" /><path d="M19 15.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" /></Traco>;
export const Sorriso: React.FC<P> = (p) => <Traco {...p}><circle cx="12" cy="12" r="9" /><path d="M8 14.5a5 5 0 0 0 8 0" /><path d="M9 9.5v.5M15 9.5v.5" /></Traco>;
export const Lua: React.FC<P> = (p) => <Traco {...p} preenchido><path d="M20.5 14.6A8.5 8.5 0 1 1 9.4 3.5a7 7 0 0 0 11.1 11.1Z" /></Traco>;
export const Check: React.FC<P> = (p) => <Traco {...p}><path d="M4.5 12.5l5 5L19.5 7" /></Traco>;
export const Play: React.FC<P> = (p) => <Traco {...p} preenchido><path d="M7 4.5v15l12.5-7.5L7 4.5Z" /></Traco>;
export const Olho: React.FC<P> = (p) => <Traco {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></Traco>;
export const Relogio: React.FC<P> = (p) => <Traco {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></Traco>;

/** Troféu (Ranking). */
export const Trofeu: React.FC<P> = ({ tam = 64, cor = '#F5B301', style }) => (
  <svg width={tam} height={tam} viewBox="0 0 64 64" style={{ display: 'block', ...style }}>
    <defs>
      <linearGradient id="trofeu-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFE27A" /><stop offset="1" stopColor={cor} /></linearGradient>
    </defs>
    <path d="M18 8h28v14c0 9-6 16-14 16s-14-7-14-16V8Z" fill="url(#trofeu-g)" />
    <path d="M18 13H9v4c0 6 4 10 10 10.5M46 13h9v4c0 6-4 10-10 10.5" fill="none" stroke={cor} strokeWidth={4} strokeLinecap="round" />
    <rect x="28" y="37" width="8" height="9" fill={cor} />
    <rect x="20" y="46" width="24" height="9" rx="2.5" fill="#3A2A05" />
    <path d="M25 14l2 0" stroke="#fff" strokeOpacity={0.7} strokeWidth={3} strokeLinecap="round" />
  </svg>
);

const MEDALHA: Record<number, [string, string]> = { 1: ['#FFE27A', '#E3A400'], 2: ['#F2F4F7', '#A3ACB9'], 3: ['#F6C49A', '#B8692E'] };
/** Medalha numerada: 1-3 em metal, 4+ em círculo escuro. */
export const Medalha: React.FC<{ n: number; tam?: number }> = ({ n, tam = 92 }) => {
  const metal = MEDALHA[n];
  return (
    <svg width={tam} height={tam} viewBox="0 0 92 92" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        {metal ? <linearGradient id={`med-${n}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={metal[0]} /><stop offset="1" stopColor={metal[1]} /></linearGradient> : null}
      </defs>
      {metal ? (
        <>
          <path d="M30 4h12l8 22H38L30 4ZM62 4H50l-8 22h12L62 4Z" fill={n === 1 ? '#D92D20' : n === 2 ? '#1F6FEB' : '#12A150'} />
          <circle cx="46" cy="56" r="32" fill={`url(#med-${n})`} />
          <circle cx="46" cy="56" r="25" fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={2.5} />
        </>
      ) : (
        <circle cx="46" cy="50" r="34" fill="#111827" stroke="#fff" strokeOpacity={0.25} strokeWidth={3} />
      )}
      <text x="46" y={metal ? 67 : 62} textAnchor="middle" fontFamily="MaquinaMontserrat" fontWeight={900} fontSize={metal ? 32 : 34} fill={metal ? '#2B1D00' : '#fff'}>{n}</text>
    </svg>
  );
};

/** Estouro (selo "FOFOCA!"), polígono de N pontas. */
export const Estouro: React.FC<{ tam: number; cor: string; borda: string; pontas?: number; children?: React.ReactNode }> = ({ tam, cor, borda, pontas = 18, children }) => {
  const pts: string[] = [];
  for (let i = 0; i < pontas * 2; i++) {
    const r = i % 2 === 0 ? 50 : 39;
    const a = (Math.PI * i) / pontas - Math.PI / 2;
    pts.push(`${50 + r * Math.cos(a)},${50 + r * Math.sin(a)}`);
  }
  return (
    <div style={{ position: 'relative', width: tam, height: tam }}>
      <svg width={tam} height={tam} viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <polygon points={pts.join(' ')} fill="#000" transform="translate(2.5 3)" opacity={0.9} />
        <polygon points={pts.join(' ')} fill={cor} stroke={borda} strokeWidth={2.2} strokeLinejoin="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
    </div>
  );
};
