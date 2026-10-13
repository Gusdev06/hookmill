import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException } from '../errors/app-exception';

export interface FieldError {
  field: string;
  rule: string;
}

/** Achata os erros do class-validator em [{ field: "a.b.0.c", rule: "isEmail" }]. */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  const out: FieldError[] = [];
  for (const e of errors) {
    const field = parent ? `${parent}.${e.property}` : e.property;
    for (const rule of Object.keys(e.constraints ?? {})) {
      out.push({ field, rule: rule === 'whitelistValidation' ? 'notAllowed' : rule });
    }
    if (e.children?.length) out.push(...flattenValidationErrors(e.children, field));
  }
  return out;
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new AppException('VALIDATION_ERROR', { fields: flattenValidationErrors(errors) }),
  });
}
