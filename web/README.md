# web — HookMill (Next 16 + Tailwind v4 + shadcn/ui + next-intl)

F1 (05/10): shell, Login, Home, Offers, Library, Settings. F2 (05/10): wizard das 7 etapas (`/creatives/new`, `/creatives/[id]/[step]`) com SSE, convite `/invite/[token]`. Tudo em mock (MSW) até o F3.

- Subir: `cp .env.example .env.local` → `npm run dev -w web` → http://localhost:3000
- Padrão (F3): API real em `NEXT_PUBLIC_API_URL` (local: `npm run infra:up`, api com `INTEGRACOES_MODE=mock` na 3001, web na 3000 por causa do CORS `WEB_ORIGIN`).
- Modo MSW opcional pra dev sem API (`NEXT_PUBLIC_API_MOCKING=enabled`, rebuild): login `gusta@maquina.dev` / `maquina123`.
  Estados de tela: abra qualquer página com `?mock=empty|loading|error` (fica na aba; `?mock=off` limpa).
  `error` na Home: a 1ª carga funciona e o polling seguinte estoura os 10 s → banner com a lista em cache.
- Mock do wizard: estado em `localStorage` (sobrevive a reload; `?mock=reset` volta ao seed). Gatilhos de falha = api.md §17 (`mock-403` na URL, `[mock:fail-slot:N]` nas notes, `[mock:SAFETY_BLOCK]` na descrição do rosto ou no prompt da cena…). Só do web: `[mock:RENDER_ERROR]` no texto do CTA faz o render falhar.
- Cliente HTTP: `src/lib/api/client.ts` (único lugar que monta URL), tipos re-exportados de `@maquina/contratos` em `src/lib/api/types.ts`. Tipos vêm de `@maquina/contratos`; SSE em `src/lib/sse.ts` (fetch + Bearer, reconecta) aplicado no cache em `src/hooks/use-creative.ts`.
- Sessão: refresh token só em cookie httpOnly cifrado (`/api/session`, `SESSION_COOKIE_SECRET`); access token só em memória.
- Tokens de design: `src/app/globals.css` (spec §3). Breakpoints `tablet:` ≥761 px e `desktop:` ≥901 px (spec §6).
