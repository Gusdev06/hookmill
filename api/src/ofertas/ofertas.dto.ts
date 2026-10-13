import type { CreateOfferBody, FieldSources, OfferBrief, UpdateOfferBody } from '@maquina/contratos';
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
