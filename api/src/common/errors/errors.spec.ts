import { BadRequestException, NotFoundException, type ValidationError } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { IsEmail, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { createValidationPipe, flattenValidationErrors } from '../http/validation';
import { AppException } from './app-exception';
import { toErrorBody } from './all-exceptions.filter';
import { ERROR_HTTP_STATUS } from './error-codes';

class Inner { @IsString() current: string }
class Dto {
  @IsEmail() email: string;
  @ValidateNested() @Type(() => Inner) password: Inner;
}

describe('erros padronizados', () => {
  it('AppException usa o status do contrato pra cada código', () => {
    for (const [code, status] of Object.entries(ERROR_HTTP_STATUS)) {
      const body = new AppException(code as keyof typeof ERROR_HTTP_STATUS).body();
      expect(body.statusCode).toBe(status);
      expect(body.code).toBe(code);
    }
  });

  it('mapeia exceções de fora pro envelope', () => {
    expect(toErrorBody(new NotFoundException())).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(toErrorBody(new BadRequestException())).toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400, details: { fields: [] } });
    expect(toErrorBody(new ThrottlerException())).toMatchObject({ code: 'RATE_LIMITED', statusCode: 429 });
    const p2025 = new Prisma.PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: '6' });
    expect(toErrorBody(p2025)).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    const boom = toErrorBody(new Error('segredo interno'));
    expect(boom).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong.', statusCode: 500 });
  });

  it('ValidationPipe: campo a mais e inválido viram VALIDATION_ERROR com details.fields (inclusive aninhado)', async () => {
    const pipe = createValidationPipe();
    try {
      await pipe.transform({ email: 'nope', password: { current: 1 }, extra: true }, { type: 'body', metatype: Dto });
      fail('devia lançar');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      const body = (e as AppException).body();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details!.fields).toEqual(
        expect.arrayContaining([
          { field: 'extra', rule: 'notAllowed' },
          { field: 'email', rule: 'isEmail' },
          { field: 'password.current', rule: 'isString' },
        ]),
      );
    }
  });

  it('flattenValidationErrors sem constraints não quebra', () => {
    const e = { property: 'a', children: [] } as unknown as ValidationError;
    expect(flattenValidationErrors([e])).toEqual([]);
  });
});
