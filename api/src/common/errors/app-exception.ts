import { HttpException } from '@nestjs/common';
import { DEFAULT_ERROR_MESSAGE, ERROR_HTTP_STATUS, ErrorCode } from './error-codes';

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

/** Única forma de devolver erro de negócio. O filtro global transforma no envelope do contrato. */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    const statusCode = ERROR_HTTP_STATUS[code];
    const body: ErrorBody = { code, message: message ?? DEFAULT_ERROR_MESSAGE[code], statusCode };
    if (details) body.details = details;
    super(body, statusCode);
    this.code = code;
    this.details = details;
  }

  body(): ErrorBody {
    return this.getResponse() as ErrorBody;
  }
}
