# Time de agentes — HookMill
Criado: 2026-10-05 · Definições em `.claude/agents/maquina-*.md` · Todo agente lê este arquivo antes de trabalhar.

## O produto
SaaS (uso interno hoje: Gusta + Tordan; depois agência e escola) que gera criativos de vídeo pra **qualquer oferta** a partir de um briefing e aprende com os vencedores. v1 = criativo do zero num wizard: Oferta → Roteiros → Avatar → Motor → Geração → Edição → OK final → Biblioteca. Sem chat na v1.
Fontes: `brainstorms/2026-10-05-maquina-anuncios-estrutura.md` (estrutura), `decisions/log.md` (05/10), mockup aprovado https://claude.ai/artifact/N271PVVM6NiKRAdBHM17YV + spec `design/wizard-v1-2026-10-05.md`.

## Estrutura (decidida, não reabrir)
- **web/** Next 16 + Tailwind + shadcn/ui (Vercel). **api/** NestJS + Prisma + Postgres/Neon (VPS/EasyPanel, URL pública pros webhooks). Separados, falando por HTTP/JSON com contrato escrito.
- **Sem worker de agente.** A API chama direto a Anthropic (Claude) e a WaveSpeed; geração assíncrona por **webhook**, status no banco.
- **Edição = templates Remotion renderizados dentro da própria API** (sem Lambda). Arquivos no Cloudflare R2 (S3-compatível) — a confirmar pelo arquiteto com o Gusta.
- Auth email+senha/JWT com **workspace** desde o início. Interface EN padrão + PT-BR.
- Motor por criativo: **cenas Kling 3.0/Seedance** (áudio nativo, image-to-video do mesmo rosto) **ou avatar + TTS + lipsync (Pruna)**.

## Raiz e git
`projects/maquina-anuncios/` é um **monorepo com git PRÓPRIO** (fora do git do AIS-OS — o arquiteto garante o `.gitignore` do AIS-OS). Ninguém faz commit/push sem o Gusta pedir.

## Quem é dono de quê
| agente | função | pastas |
|---|---|---|
| maquina-arquiteto | tech lead: contratos, estrutura, revisão, deploy | `docs/`, `api/prisma/`, raiz (package.json, configs) |
| maquina-design | UX/UI, mockup + spec | `design/` |
| maquina-backend | API NestJS: auth, workspace, ofertas, criativos, estados do wizard, webhooks, storage; feature 2: uploads, campeões, lotes | `api/src/` (menos `integracoes/`, `render/` e `medicao/`) |
| maquina-ia | Claude + WaveSpeed: prompts, chamadas, custos, webhooks de geração | `api/src/integracoes/` |
| maquina-video | templates Remotion + render na API + medição de mídia (feature 2) | `video/`, `api/src/render/`, `api/src/medicao/` |
| maquina-frontend | implementa o mockup aprovado ligado na API | `web/` |
| maquina-qa | testa ponta a ponta e só ele declara "funciona" | `testes/` |
Mexer na pasta de outro = pedir ao dono (ou ao arquiteto).

## Regras comuns

> **⚠️ BANCO (incidente 07/10: um `prisma migrate diff` com shadow apontado pro `maquina` apagou os dados de teste do Gusta).**
> - Comando Prisma que recebe shadow database **só via `npm run db:diff`** (URL literal do `maquina_shadow`). Nunca passe `--shadow-database-url` na mão, nunca derive a URL de outra.
> - **Antes de qualquer migração no `maquina`: `npm run db:backup`** (o `npm run db:migrate` já faz; `.infra/backups/`, últimos 10; o `infra:up` faz um se o último tiver mais de 12 h). Restaurar: `npm run db:restore -- <arquivo> [--into <banco>]` (banco migrado e vazio; no `maquina` só com `--into maquina --yes-i-know`, que faz backup antes).
> - Proibido nos bancos locais: `prisma migrate dev`, `migrate reset`, `db push`. O `scripts/guard-db.mjs` bloqueia shadow que não seja `maquina_shadow`.
1. **Contrato primeiro.** Ninguém escreve código antes de `docs/contratos/` estar aprovado pelo Gusta (modelo de dados, API, eventos). Mudou o contrato? Só o arquiteto muda, e avisa os afetados.
2. **Nenhum código sem permissão do Gusta** (regra dele, 05/10). Plano → ok → código.
3. **Nada pago sem perguntar.** Chamada de geração (imagem, voz, vídeo, lipsync) custa dinheiro: estime antes, sonda de centavos pode, geração cara só com ok. Testes automatizados usam mocks.
4. **Segredos só em `.env` local**, nunca no código nem no git. Antes de rodar algo, confira pra qual banco o `.env` aponta (no clonador o `.env.local` apontava pra produção).
5. **Verificado = executado.** `tsc`/build/teste rodados de verdade; não declare pronto o que não rodou.
6. **Relatório curto:** o que fez, o que verificou, o que falta — 5 linhas. O Gusta não lê relatório denso.
7. O clonador (`projects/clonador/`) é só referência de aprendizado (prompts, armadilhas do Pruna, custos). **Não copie a estrutura dele.**
