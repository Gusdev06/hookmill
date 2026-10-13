import { staticFile } from 'remotion';

/** URL assinada (http/https/data/blob) passa direto; caminho relativo vira arquivo de public/ (fixtures do dev). */
export const resolverSrc = (url: string) => (/^(https?:|data:|blob:)/.test(url) ? url : staticFile(url.replace(/^\/+/, '')));
