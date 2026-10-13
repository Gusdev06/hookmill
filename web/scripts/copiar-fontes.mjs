// Copia as fontes do catálogo (video/public/fonts) pra web/public/fonts, servidas em /fonts pro @remotion/player
// (staticFile('fonts/...') no Player vira /fonts/...). Roda no predev e no prebuild; a cópia fica fora do git.
import { cpSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const origem = path.resolve(web, "../video/public/fonts")
const destino = path.join(web, "public/fonts")
mkdirSync(destino, { recursive: true })
cpSync(origem, destino, { recursive: true, filter: (f) => !path.basename(f).startsWith(".") })
console.log(`fontes: ${origem} -> ${destino}`)
