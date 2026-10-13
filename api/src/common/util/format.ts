import { Prisma } from '@prisma/client';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : parts[0][1] ?? '';
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
