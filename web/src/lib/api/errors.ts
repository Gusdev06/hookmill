import type { ApiErrorCode } from "./types"

export type ApiErrorKind = "http" | "timeout" | "network"

/** Every failure from the API client is an ApiError. The UI translates by `code` (errors.<code> in messages). */
export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    public readonly code: ApiErrorCode | string,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}
