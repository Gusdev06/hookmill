import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { AppException, ErrorBody } from './app-exception';
import { DEFAULT_ERROR_MESSAGE, ErrorCode } from './error-codes';

const BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'VALIDATION_ERROR',
  415: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
};

/** Converte qualquer exceção no envelope de erro do contrato: { success:false, error:{ code, message, statusCode, details? } }. */
export function toErrorBody(exception: unknown): ErrorBody {
  if (exception instanceof AppException) return exception.body();

  if (exception instanceof ThrottlerException) {
    return new AppException('RATE_LIMITED', { retryAfterSec: 60 }).body();
  }

  if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
    return new AppException('NOT_FOUND').body();
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR');
    const body: ErrorBody = { code, message: DEFAULT_ERROR_MESSAGE[code], statusCode: status >= 500 ? 500 : status };
    if (code === 'VALIDATION_ERROR') body.details = { fields: [] };
    return body;
  }

  return { code: 'INTERNAL_ERROR', message: DEFAULT_ERROR_MESSAGE.INTERNAL_ERROR, statusCode: 500 };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = toErrorBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    }
    if (res.headersSent) {
      // SSE ou redirect já começou: não dá pra mandar envelope, só encerra.
      res.end();
      return;
    }
    if (body.code === 'RATE_LIMITED' && body.details?.retryAfterSec) {
      res.setHeader('Retry-After', String(body.details.retryAfterSec));
    }
    res.status(body.statusCode).json({ success: false, error: body });
  }
}
