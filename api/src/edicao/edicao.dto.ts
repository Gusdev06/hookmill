import type { UpdateEditBody } from '@maquina/contratos';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateEditDto implements UpdateEditBody {
  @IsOptional() @IsIn(['clean', 'bold', 'headline']) templateId?: string;
  @IsOptional() @IsIn(['word', 'line', 'off']) captionStyle?: 'word' | 'line' | 'off';
  @IsOptional() @IsIn(['top', 'middle', 'bottom']) captionPosition?: 'top' | 'middle' | 'bottom';
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) headline?: string | null;
  @IsOptional() @IsString() @MaxLength(120) ctaText?: string;
  @IsOptional() @IsBoolean() endCard?: boolean;
}

/** POST /render: corpo vazio. */
export class EmptyDto {}
