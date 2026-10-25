import type { CreateOfferBody, FieldSources, OfferBrief, OfferReadMeta, ReadMode, UpdateOfferBody } from '@maquina/contratos';
import {
  IsObject, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength, ValidateIf, registerDecorator, type ValidationOptions,
} from 'class-validator';

export const BRIEF_FIELDS = ['kind', 'what', 'audience', 'promise', 'pains', 'proof', 'offerAndPrice', 'cta', 'notes'] as const satisfies readonly (keyof OfferBrief)[];
export const SOURCE_KEYS = [...BRIEF_FIELDS, 'name', 'language'] as const;

const TEXT_MAX = 5000;
/** BCP 47 simplificado: en, pt-BR, es-419, zh-Hant-TW. */
export const BCP47 = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$/;
const URL_OPTS = { require_protocol: true, protocols: ['http', 'https'] };

/** { "<campo>": "page" | "user" } só com campos do briefing + name/language. */
function IsFieldSources(opts?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isFieldSources',
      target: object.constructor,
      propertyName,
      options: opts,
      validator: {
        validate: (v: unknown) =>
          !!v && typeof v === 'object' && !Array.isArray(v) &&
          Object.entries(v).every(([k, s]) => (SOURCE_KEYS as readonly string[]).includes(k) && (s === 'page' || s === 'user')),
      },
    });
}

export const READ_MODES: readonly ReadMode[] = ['pasted', 'http', 'rendered', 'crawled', 'vision'];
/** Teto do JSON `read_meta` (imagens entram SEM base64: só src + o que o modelo leu). */
const READ_META_MAX_JSON = 60_000;

/** briefing-leitura-v2 D5: `{ readMode, pages[], imagesRead[], fieldOrigins{}, costUsd, readAt? }`, sem base64, ≤ 60 KB. */
export function isReadMeta(v: unknown): v is OfferReadMeta {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const m = v as Record<string, unknown>;
  if (!(READ_MODES as readonly string[]).includes(m.readMode as string)) return false;
  if (!Array.isArray(m.pages) || !Array.isArray(m.imagesRead)) return false;
  if (m.fieldOrigins !== undefined && (!m.fieldOrigins || typeof m.fieldOrigins !== 'object' || Array.isArray(m.fieldOrigins))) return false;
  if (m.costUsd !== undefined && typeof m.costUsd !== 'number') return false;
  if (m.readAt !== undefined && typeof m.readAt !== 'string') return false;
  if ((m.imagesRead as unknown[]).some((i) => !i || typeof i !== 'object' || 'base64' in (i as object) || 'data' in (i as object))) return false;
  return JSON.stringify(v).length <= READ_META_MAX_JSON;
}
function IsReadMeta(opts?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({ name: 'isReadMeta', target: object.constructor, propertyName, options: opts, validator: { validate: (v: unknown) => isReadMeta(v) } });
}

/** Campo de texto livre do briefing: string ou null (null limpa). */
const Brief = () => (target: object, key: string) => {
  IsOptional()(target, key);
  ValidateIf((_, v) => v !== null)(target, key);
  IsString()(target, key);
  MaxLength(TEXT_MAX)(target, key);
};

export class CreateOfferDto implements CreateOfferBody {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsString() @Matches(BCP47) @MaxLength(35) language: string;
  @IsOptional() @IsUrl(URL_OPTS) @MaxLength(2000) sourceUrl?: string;
  @Brief() kind?: string | null;
  @Brief() what?: string | null;
  @Brief() audience?: string | null;
  @Brief() promise?: string | null;
  @Brief() pains?: string | null;
  @Brief() proof?: string | null;
  @Brief() offerAndPrice?: string | null;
  @Brief() cta?: string | null;
  @Brief() notes?: string | null;
  @IsOptional() @IsObject() @IsFieldSources() fieldSources?: FieldSources;
  /** briefing-leitura-v2 D5: o web manda `output.readMeta` do OFFER_EXTRACT. */
  @IsOptional() @IsObject() @IsReadMeta() readMeta?: OfferReadMeta;
}

export class UpdateOfferDto implements UpdateOfferBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @Matches(BCP47) @MaxLength(35) language?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUrl(URL_OPTS) @MaxLength(2000) sourceUrl?: string | null;
  @Brief() kind?: string | null;
  @Brief() what?: string | null;
  @Brief() audience?: string | null;
  @Brief() promise?: string | null;
  @Brief() pains?: string | null;
  @Brief() proof?: string | null;
  @Brief() offerAndPrice?: string | null;
  @Brief() cta?: string | null;
  @Brief() notes?: string | null;
  /** apply do reread; null limpa. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsObject() @IsReadMeta() readMeta?: OfferReadMeta | null;
  /** QA bug 14: origem por campo que o web aplica (`page` ao aplicar a leitura); vence o `user` automático do autosave. */
  @IsOptional() @IsObject() @IsFieldSources() fieldSources?: FieldSources;
}

/** ExtractOfferBody = { url } | { pageText, url? }: união não dá pra `implements`; a regra "um dos dois" fica no service. */
export class ExtractOfferDto {
  @IsOptional() @IsUrl(URL_OPTS) @MaxLength(2000) url?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200_000) pageText?: string;
}

/** RereadOfferBody = {} | { pageText }. */
export class RereadOfferDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200_000) pageText?: string;
}

/** variacao-auto-v1 D4: PUT /offers/:id/product-image (SetProductImageBody). */
export class ProductImageDto {
  @IsString() @MinLength(1) @MaxLength(64) uploadId: string;
}
