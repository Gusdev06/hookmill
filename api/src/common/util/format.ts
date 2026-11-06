import { Prisma } from '@prisma/client';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  // Index Unicode characters, not UTF-16 halves: initials also go into persisted render JSON.
  const firstWord = Array.from(parts[0]);
  const first = firstWord[0] ?? '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : firstWord[1] ?? '';
  return (first + last).toUpperCase();
}

/** Decimal do Prisma → número (dinheiro em USD sai como número na API). */
export function num(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? v : v.toNumber();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
