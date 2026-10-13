import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

// Dev only: serves video/public/fixtures at /fixtures/* for the Player test page (/dev/editor-f1), with Range
// support (the <video> seeks with byte ranges). Nothing is copied into web/, so nothing reaches git or the build.
const RAIZ = path.resolve(process.cwd(), "../video/public/fixtures")
const TIPOS: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".json": "application/json", ".wav": "audio/wav", ".mp3": "audio/mpeg" }

export async function GET(req: Request, ctx: { params: Promise<{ arquivo: string[] }> }) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 })
  const { arquivo } = await ctx.params
  const alvo = path.resolve(RAIZ, ...arquivo)
  if (!alvo.startsWith(RAIZ + path.sep)) return new Response("Not found", { status: 404 })
  const info = await stat(alvo).catch(() => null)
  if (!info?.isFile()) return new Response("Not found", { status: 404 })

  const total = info.size
  const base = {
    "Content-Type": TIPOS[path.extname(alvo).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "")
  if (!range) {
    const corpo = Readable.toWeb(createReadStream(alvo)) as ReadableStream
    return new Response(corpo, { headers: { ...base, "Content-Length": String(total) } })
  }
  let inicio = range[1] === "" ? total - Number(range[2]) : Number(range[1])
  let fim = range[1] === "" || range[2] === "" ? total - 1 : Number(range[2])
  inicio = Math.max(0, inicio)
  fim = Math.min(fim, total - 1)
  if (inicio > fim || inicio >= total) {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${total}` } })
  }
  const corpo = Readable.toWeb(createReadStream(alvo, { start: inicio, end: fim })) as ReadableStream
  return new Response(corpo, {
    status: 206,
    headers: { ...base, "Content-Length": String(fim - inicio + 1), "Content-Range": `bytes ${inicio}-${fim}/${total}` },
  })
}
