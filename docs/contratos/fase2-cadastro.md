# Fase 2 · landing + cadastro self-serve (adendo ao fase2-agencia)
Data: 2026-10-12 · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta em 12/10 (pediu o fluxo completo com cadastro)**. Tipos em `@maquina/contratos` (`contratos/src/cadastro.ts` + `export` no `index.ts`), já aplicados e **só aditivos**: o `tsc` do api e do web não muda.
Base: [`fase2-agencia.md`](fase2-agencia.md) (cliente = workspace, papéis, onboarding, `shortCode`, status derivado), `decisions/log.md` 12/10, convenções e erros em [`api.md` §1](api.md), auth em [`api.md` §2](api.md).

Fluxo alvo: **landing `/` → `/signup` → sessão criada → `/onboarding/1` → … → LIVE → criar anúncio** (wizard/variar, sem mudança).

## Assumido (defaults; o Gusta não precisou decidir)
1. **Cadastro aberto.** Qualquer pessoa cria conta. Cada conta é uma "agência" e nasce com **1 cliente vazio** (workspace) em que ela é **OWNER**, em `SETUP`, `onboardingStep = 1`. Não existe tabela de agência (D3 do fase2-agencia continua).
2. **Campos:** nome, e-mail, senha, nome da agência (opcional). O nome da agência vira o **nome do 1º cliente**; sem ele, `"New client"`. Editável no passo 1.
3. **Senha ≥ 10, não 8.** Desvio consciente do default pedido: o convite e a troca de senha já exigem 10 (`AcceptInviteDto`, `PasswordChangeDto`). Uma regra só no produto. Se o Gusta quiser 8, muda nos três juntos.
4. **E-mail já cadastrado** → `409 EMAIL_TAKEN` (código que já existe), mensagem fixa, sem dizer se a conta está ativa nem de quais workspaces é membro.
5. **Resposta = sessão**, igual ao login. O web grava o refresh no cookie e vai direto pro onboarding.
6. **Throttle igual ao login** (`@LoginThrottle()`: 5/min por IP+e-mail, 20/min por IP).
7. **Teto de gasto inicial** no cliente criado pelo cadastro: `SIGNUP_DEFAULT_SPEND_CAP_USD` (padrão `10`). Sem billing, o cadastro aberto deixa qualquer pessoa gastar a chave de IA da casa; o teto que já existe (`SPEND_CAP_EXCEEDED`) é a trava. O OWNER pode subir no passo 5 (sem billing não há como impedir); ver Pendências.
8. **Liga/desliga** por env `SIGNUP_ENABLED` (padrão `true`). `false` → `403 FORBIDDEN`. Serve pra fechar o cadastro em produção num minuto sem deploy de código.

## 1. Modelo de dados
**Nenhuma mudança no `schema.prisma`, nenhuma migração.** Usa `User`, `Workspace` (com os campos do fase2-agencia) e `Membership` como estão.

## 2. Tipos (`contratos/src/cadastro.ts`)
```ts
interface SignupBody {
  name: string;          // 1-120 (trim)
  email: string;         // e-mail ≤ 254; normalizeEmail() como no login
  password: string;      // 10-200
  agencyName?: string;   // 1-80 (trim); nome do 1º cliente. Sem = "New client"
  uiLocale?: UiLocale;   // idioma do usuário E do 1º cliente. Sem = 'EN'
}
type SignupResponse = AuthSession;   // o mesmo do login: { accessToken, refreshToken, expiresIn, user, workspace: { id, name, role: 'OWNER' } }
```

## 3. Endpoint
| método e rota | entrada | saída | erros | quem chama |
|---|---|---|---|---|
| `POST /auth/signup` *pública*, `@LoginThrottle()` | `SignupBody` | `201 SignupResponse` | 400 `VALIDATION_ERROR` (`fields`), 403 `FORBIDDEN` (`SIGNUP_ENABLED=false`), 409 `EMAIL_TAKEN`, 429 `RATE_LIMITED` | web, pelo BFF `POST /api/session/signup` |

Regras (backend):
- **Uma transação:** cria `User` (`passwordHash` com o mesmo `hashPassword` do convite, `name`, `email` normalizado, `uiLocale`, `isActive: true`) → `Workspace` (`name = agencyName ?? 'New client'`, `shortCode = shortCodeFromName(name)` de `workspaces/cliente.ts`, `uiLocale`, `onboardingStep: 1`, `onboardingCompletedAt: null`, `pausedAt: null`, `monthlySpendCapUsd = SIGNUP_DEFAULT_SPEND_CAP_USD`) → `Membership` `OWNER`. Depois `issue(user, { id, name, role: 'OWNER' })`, o mesmo do login.
- `shortCode`: `shortCodeFromName` já devolve 2-6 `[A-Z0-9]` (`"New client"` → `NC`, `"Mattress Company"` → `MC`, nada aproveitável → `WS`). Editável no passo 1 via `PATCH /workspace { shortCode }` (sem mudança).
- **E-mail existente:** checa antes; corrida no unique do `User.email` (P2002) também vira `EMAIL_TAKEN`. Mensagem fixa: `"An account with this email already exists. Log in instead."`. Mesmo erro para usuário inativo.
- Não cria oferta, não copia time, não manda e-mail.
- **Login sem membership** (regra atual: `INVALID_CREDENTIALS`) não muda; o cadastro sempre cria a membership na mesma transação, então nunca gera um usuário órfão.
- O `AuthGuard` não muda: a rota é `@Public()`. O `@ClientAllowed()` não se aplica (sem sessão).

Env novas no `api/.env.example` (backend adiciona, com comentário):
```
SIGNUP_ENABLED=true                 # false = POST /auth/signup responde 403
SIGNUP_DEFAULT_SPEND_CAP_USD=10     # teto mensal do 1º cliente criado pelo cadastro (vazio = sem teto)
```

## 4. Web: rotas, proxy e BFF
### 4.1 Rotas
| rota | arquivo | quem vê |
|---|---|---|
| `/` sem sessão | landing, servida por **rewrite** do proxy para `/welcome` (a URL no navegador continua `/`) | público |
| `/` com sessão | Home atual, `app/(app)/page.tsx`, sem mudança | logado |
| `/welcome` | `app/(marketing)/welcome/page.tsx` (layout próprio, sem `AppShell`, sem chamar `/api/session`, estático) | público; com sessão → redirect `/` |
| `/signup` | `app/signup/page.tsx` + `signup-form.tsx`, no molde do `/login` (logo + `LanguageToggle`) | público; com sessão → redirect `/` |
| `/login` | sem mudança, ganha o link **"Create account"** → `/signup` | público; com sessão → redirect `/` |
| `/invite/[token]` | sem mudança | sempre passa |

### 4.2 Proxy (`web/src/proxy.ts`), regra completa
```ts
const PUBLIC = new Set(["/login", "/signup", "/welcome"])
// 1. /invite/* passa sempre (como hoje)
// 2. sem cookie:  "/" → NextResponse.rewrite(new URL("/welcome", req.url))
//                 PUBLIC → next()
//                 resto → redirect /login?next=<path+search> (como hoje)
// 3. com cookie:  PUBLIC → redirect "/"
//                 resto → next()
```
O `matcher` não muda (já exclui `api`, então `/api/session/signup` passa direto). Cookie velho (refresh expirado) em `/`: o shell falha no refresh, o `failSession` apaga o cookie e manda pro `/login`, como hoje; na próxima visita `/` mostra a landing.

### 4.3 BFF de sessão
**Rota nova `POST /api/session/signup`** (`app/api/session/signup/route.ts`), corpo `SignupBody`. Chama `authServer.signup(body)` (novo em `lib/session/auth-server.ts`, com o mock em `mocks/auth.ts` quando `MOCKING`) e responde com o mesmo `respondSession(session, true)` do login (grava cookie e locale). Erro → `failSession(e)`. Não mexer no `POST /api/session` (login/convite).

### 4.4 Telas
- **`/signup`:** campos Name, Email, Password (dica "at least 10 characters"), Agency name (optional, placeholder "Your agency or first client"). Botão "Create account". Link "Already have an account? **Log in**" → `/login`. Erros: `EMAIL_TAKEN` → mensagem no campo e-mail com link "Log in"; `VALIDATION_ERROR` → por campo; `RATE_LIMITED` → "Too many attempts, try again in N s"; `FORBIDDEN` → "Sign-ups are closed right now." Sucesso → `router.replace('/onboarding/1')`. Manda o `uiLocale` do toggle.
- **`/login`:** abaixo do botão, "New to HookMill? **Create account**" → `/signup` (preserva `?next` não é preciso; o cadastro sempre vai pro onboarding).
- **Landing `/welcome`** (EN + PT pelo i18n que já existe; tokens do `design/fase2-telas-novas-2026-10-12.md`, sem mockup novo por ser urgente): header com logo + "Log in" + "Create account"; hero (o que é: criativos de vídeo pra qualquer oferta, do briefing ao MP4 aprovado) com CTA "Create account"; "How it works" em 3 passos (1 Tell us about the client and the offer · 2 Generate scripts, faces and the video · 3 Approve and download, named and ready for Meta); bloco "Built for agencies" (vários clientes, cliente aprova sem gastar); CTA final + footer. **Proibido:** preço, números de resultado, depoimento, logo de cliente e qualquer recurso ⏳ (Meta, Eddy, Campaigns, Score) apresentado como pronto.
- **Onboarding:** sem mudança. O cliente vazio cai no passo 1 com `name` = agência ou "New client" e `shortCode` derivado, editáveis.

## 5. Erros
Nenhum código novo. Usos novos:
| code | http | quando |
|---|---|---|
| `EMAIL_TAKEN` | 409 | `POST /auth/signup` com e-mail que já tem conta (antes: só convite) |
| `FORBIDDEN` | 403 | `POST /auth/signup` com `SIGNUP_ENABLED=false` |
| `RATE_LIMITED` | 429 | throttle do login aplicado ao signup |

`api.md`: §1 (linha do `EMAIL_TAKEN` passa a citar o cadastro), §2 (linha do `POST /auth/signup`) e §16 (Login/Signup/Landing) recebem a atualização do arquiteto junto com este adendo.

## 6. Tarefas por agente
| # | agente | tarefa | depende de | verificação |
|---|---|---|---|---|
| A2 | arquiteto | ~~tipos `cadastro.ts`~~ (feito 12/10, `tsc` do pacote ok); atualizar `api.md` §1/§2/§16; revisar B3/F2 contra este arquivo | — | — |
| B3 | backend | `SignupDto implements SignupBody` (class-validator: `@IsEmail @MaxLength(254)`, senha `@MinLength(10) @MaxLength(200)`, `agencyName` 1-80 opcional, `uiLocale @IsIn`) · `POST /auth/signup` `@Public() @LoginThrottle() @HttpCode(201)` · `AuthService.signup()` na transação do §3 reaproveitando `hashPassword`, `normalizeEmail`, `shortCodeFromName`, `issue()` · envs do §3 no `.env.example` | A2 (feito) | Jest + int: 201 devolve sessão com role OWNER e o `GET /workspace` seguinte vem `SETUP`, `onboarding.step 1`, `shortCode` válido, teto = env; e-mail duplicado (inclusive com maiúscula/espaço) → 409 sem criar nada; P2002 na corrida → 409; senha 9 → 400; `SIGNUP_ENABLED=false` → 403; 6ª tentativa/min → 429; login com a conta nova funciona; api `tsc` ok |
| F2 | frontend | proxy do §4.2; `(marketing)/welcome`; `/signup` + form; link no `/login`; `POST /api/session/signup` + `authServer.signup` + mock MSW (`mocks/auth.ts`: e-mail `taken@…` → 409, senão sessão nova com workspace em SETUP); i18n EN/PT dos textos novos | A2 (feito); B3 ou MSW | web `tsc` ok; sem cookie `/` mostra landing e `/clients` vai pro `/login?next=`; com cookie `/welcome`, `/signup`, `/login` → `/`; `/invite/x` passa nos dois casos |
| Q2 | qa | ponta a ponta como usuário novo: landing → Create account → `/signup` → onboarding passo 1 (nome "New client"/agência, `shortCode`) → passos 3-6 → LIVE → criar 1 anúncio pelo wizard até o download. Casos: e-mail repetido, senha curta, throttle, cadastro fechado, logout → `/` volta a ser landing, `/invite` intacto, desktop e 390 px, EN/PT | B3, F2 | só o qa declara "funciona" |
| — | design, ia, video | nada (landing usa tokens existentes; sem mockup novo) | — | — |

Pastas sem conflito: A2 = `docs/`, `contratos/src/`; B3 = `api/src/auth/` (+ `api/.env.example`); F2 = `web/`; Q2 = `testes/`. B3 e F2 em paralelo (F2 roda no MSW até o B3 entrar).

## 7. Pendências (fora deste adendo, ninguém coda agora)
- **Verificação de e-mail** (hoje qualquer e-mail entra, inclusive de outra pessoa).
- **Recuperar senha.**
- **OAuth** (Google).
- **Billing/planos** e teto de gasto que o usuário não pode subir sozinho. Até lá o cadastro aberto gasta a chave de IA da casa até o teto que o próprio OWNER define: **fechar com `SIGNUP_ENABLED=false` em produção** se não for só pra teste.
- Captcha/antiabuso além do throttle.
- Entidade agência (quando houver cobrança ou mais de uma agência por conta).
