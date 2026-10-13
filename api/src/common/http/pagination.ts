import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AppException } from '../errors/app-exception';

/** ?limit (1-100, padrão 30) & ?cursor (api.md §1). */
export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}

export const DEFAULT_LIMIT = 30;

/** Cursor opaco de ordenação (data desc, id desc): base64url de { t, i }. */
export interface CursorKey { t: string; i: string }

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: at.toISOString(), i: id })).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorKey;
    const at = new Date(v.t);
    if (typeof v.i !== 'string' || !v.i || Number.isNaN(at.getTime())) throw new Error('bad');
    return { at, id: v.i };
  } catch {
    throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'cursor', rule: 'isCursor' }] });
  }
}

/** where pra "depois do cursor" numa ordenação (campo desc, id desc). */
export function afterCursor<F extends string>(field: F, c: { at: Date; id: string } | null) {
  if (!c) return {};
  return { OR: [{ [field]: { lt: c.at } }, { [field]: c.at, id: { lt: c.id } }] } as Record<string, unknown>;
}

/** Busca limit+1, devolve a página e o próximo cursor (null no fim). */
export function page<T extends { id: string }>(rows: T[], limit: number, at: (r: T) => Date): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(at(last), last.id) : null };
}
