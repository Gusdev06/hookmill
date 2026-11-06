// kit-marca-v1 §5 (31/10): logo do kit da marca numa placa (círculo ou quadrado), contain + respiro. A placa é clara ou
// escura pela "tinta" do logo (`placaDoLogo`), então SVG/PNG transparente pra fundo claro ou escuro aparece nos dois.
// Imagem que não carrega (URL vencida, arquivo sumido) não derruba o render: cai no `reserva` (as iniciais).
import React, { useState } from 'react';
import { Img } from 'remotion';
import { placaDoLogo, respiroDoLogo, type BrandLogo } from '../lib/logo';
import { resolverSrc } from './midia';

export const LogoMarca: React.FC<{
  logo: BrandLogo;
  tam: number;
  forma?: 'circulo' | 'quadrado';
  /** raio do quadrado (px); o círculo ignora */
  raio?: number;
  /** contorno opcional (ex.: borda na cor da marca do monograma) */
  borda?: string;
  /** o que desenhar se a imagem falhar (iniciais) */
  reserva: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ logo, tam, forma = 'circulo', raio, borda, reserva, style }) => {
  const [falhou, setFalhou] = useState(false);
  if (falhou) return <>{reserva}</>;
  const pad = Math.round(tam * respiroDoLogo(forma));
  return (
    <div
      style={{
        width: tam, height: tam, flexShrink: 0, boxSizing: 'border-box', overflow: 'hidden',
        borderRadius: forma === 'circulo' ? '50%' : (raio ?? tam * 0.22), background: placaDoLogo(logo.colors),
        border: borda, display: 'flex', alignItems: 'center', justifyContent: 'center', ...style,
      }}
    >
      <Img
        src={resolverSrc(logo.url)}
        maxRetries={1}
        onError={() => setFalhou(true)}
        style={{ width: '100%', height: '100%', objectFit: 'contain', padding: pad, boxSizing: 'border-box', display: 'block' }}
      />
    </div>
  );
};
