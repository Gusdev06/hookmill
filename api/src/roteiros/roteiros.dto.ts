import type { GenerateScriptsBody, RegenerateScriptBody, SelectBody, UpdateScriptBody } from '@maquina/contratos';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

export class GenerateScriptsDto implements GenerateScriptsBody {
  @IsInt() @Min(1) @Max(5) count: number;
  @IsBoolean() replace: boolean;
  @IsOptional() @IsBoolean() confirm?: boolean;
}

export class ConfirmDto implements RegenerateScriptBody, SelectBody {
  @IsOptional() @IsBoolean() confirm?: boolean;
}

export class BlockEditDto {
  @IsInt() @Min(0) @Max(49) index: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) speech?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) visualPrompt?: string;
}

export class UpdateScriptDto implements UpdateScriptBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) angle?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => BlockEditDto) blocks?: BlockEditDto[];
  @IsOptional() @IsBoolean() confirm?: boolean;
}
