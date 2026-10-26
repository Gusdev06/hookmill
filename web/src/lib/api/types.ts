/**
 * API types come from @maquina/contratos (docs/contratos/api.md, owner: maquina-arquiteto).
 * This file only re-exports them and adds web-side runtime constants.
 */
export type * from "@maquina/contratos"
import type { Step } from "@maquina/contratos"

export const STEPS: readonly Step[] = ["offer", "scripts", "avatar", "engine", "generation", "edit", "review"]
