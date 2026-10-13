# Validação de design da F2 (web/): decisões que a spec não cobria
Data: 2026-10-05 · Quem valida: agente de UX/UI · Base: prints em `scratchpad/wz`, `wz390`, `shots`, `st` e o código em `web/src/components/wizard/` (só leitura)
Spec de referência: `projects/maquina-anuncios/design/wizard-v1-2026-10-05.md`. O que virou regra foi pra lá, na seção 10.

| # | Decisão do frontend | Veredito |
|---|---|---|
| 1 | Diálogo de confirmação quando uma mudança descarta cenas/renders | **Ajusto** |
| 2 | "Editar prompt" inline na cena que falhou | **Ajusto** |
| 3 | Custo do retrabalho em cada caminho de "Pedir ajustes" | **Aprovo** |
| 4 | Aviso de "oferta travada" na etapa Oferta | **Ajusto** |
| 5 | "Reescrever uma fala" volta pra Geração | **Aprovo** |
| 6a | Tela de Login | **Aprovo com 2 ajustes** |
| 6b | Menu de conta com "Log out" | **Aprovo** (não havia print; regra abaixo) |
| 6c | Convite como Dialog em Configurações | **Aprovo com ajuste** |
| 6d | Idioma do briefing como Select | **Aprovo** |

## 1. Confirmação de descarte: ajusto
O que está certo: o texto diz quantas cenas e renders se perdem e quanto dinheiro já foi gasto neles. O gatilho também está certo: a API devolve `CONFIRM_DOWNSTREAM_RESET`, o front pergunta e reenvia com `confirm: true`.

Ajustes:
- Trocar `Dialog` por **`AlertDialog`**, porque é uma ação destrutiva. Assim clicar fora não confirma nada, e o foco inicial vai pro botão de cancelar.
- Os dois botões hoje têm o mesmo peso e o confirmar é branco (`default`). O certo é:
  - cancelar: `AlertDialogCancel` com o texto **"Manter como está"** / "Keep as is", com estilo de botão padrão e foco inicial;
  - confirmar: `AlertDialogAction` com o texto **"Descartar e refazer"** / "Discard and redo", em variante `destructive` (texto vermelho `--red` sobre a superfície com borda; nada de botão vermelho cheio).
- O título fica como está. O corpo ganha uma segunda frase com o que vem depois, por exemplo "O novo roteiro gera 4 cenas de novo, cerca de US$ 3,80." Use a estimativa que a API já tem; se ela não mandar o valor, omita a frase.
- Cabeçalho e rodapé alinhados à esquerda também no mobile. No mobile os botões empilham, com o destrutivo embaixo.

## 2. "Editar prompt" na cena que falhou: ajusto
Em 1440 e 390, o motivo da falha fica abaixo do campo e do "Cancelar", e o botão "Refazer cena" continua sozinho na lateral. Não fica claro se ele usa o prompt editado ou o antigo.

Regra:
- Ordem dentro do card: rótulo da cena → fala → **motivo da falha (vermelho)** → campo do prompt visual → linha de ações.
- Durante a edição, a linha de ações fica embaixo do campo: botão primário **"Refazer com este prompt"** / "Regenerate with this prompt" e `ghost` "Cancelar". O botão lateral "Refazer cena" some enquanto a edição está aberta.
- Fora da edição, a cena que falhou mostra dois botões: "Refazer cena" (usa o mesmo prompt) e `ghost` "Editar prompt".
- O campo abre com o prompt atual selecionado e foco nele, em mono 12 px, que é o mesmo estilo do prompt em leitura.

## 3. Custo do retrabalho em "Pedir ajustes": aprovo
O formato "Cerca de US$ 0,95 · 3 min" em mono, logo depois da explicação, e "Sem custo" no caminho de legenda/CTA ficaram bons. Isso não contradiz a regra de custo: o painel de ajustes faz parte da revisão final, e o custo aparece só ali, nunca no botão "Voltar pra …".

## 4. Oferta travada: ajusto
Hoje a etapa mostra a lista inteira com as outras ofertas desabilitadas e uma frase cinza embaixo. A lista desabilitada parece um defeito, e não ajuda a pessoa a fazer o que provavelmente queria.

Regra:
- Quando o criativo já existe, a etapa Oferta mostra **só o card da oferta escolhida**, em modo leitura: nome, tipo, preço, idioma e vencedores, com um ícone de cadeado à esquerda do nome.
- Embaixo do card vai o texto "A oferta não muda depois que o criativo é criado." e um link `ghost` **"Criar outro criativo com outra oferta"**, que abre Novo criativo.
- O botão "Editar briefing" leva pra Ofertas. Avisar ali que a edição vale pros próximos roteiros e não reescreve os atuais.
- A aba "Oferta existente / Nova pelo link" não aparece nesse estado.

## 5. "Reescrever uma fala" → Geração: aprovo
A API manda assim, e faz sentido: mudar uma fala regera só a cena dela, e quem decide isso é a Geração. A pessoa escreve a fala nova no próprio painel de ajustes; o botão vira **"Voltar pra Geração"** e a cena afetada já entra na fila. O roteiro salvo passa a ter a fala nova (Roteiros mostra a versão atualizada). O mockup tinha esse caminho apontando pra Roteiros; vale a API e a spec.

## 6. Login, conta, convite, idioma
- **Login: aprovo, com 2 ajustes.** O layout (coluna de 360 px, título à esquerda, botão primário de largura total, seletor EN/PT no canto) segue o sistema. Ajustes:
  1. o quadro "Mock mode: email / senha" só pode aparecer em desenvolvimento (`NODE_ENV !== "production"`);
  2. falta o estado de erro: `Alert` destrutivo acima do botão com "Email ou senha incorretos." e o campo de senha limpo; durante o envio, o botão fica desabilitado com "Entrando…". Recuperar senha fica fora da v1 (o dono do workspace troca a senha).
- **Menu de conta: aprovo** (não vi print). Regra: `DropdownMenu` no avatar "GU", alinhado à direita, com nome e email (texto secundário), um separador, "Configurações" e "Sair" / "Log out". "Sair" não pede confirmação. O idioma fica no seletor do header, não no menu.
- **Convite como Dialog: aprovo, com ajuste.** O print em 390 tem título e descrição centralizados (padrão do `DialogHeader` abaixo de `sm`). Forçar `text-left`. Depois de "Criar link", o diálogo mostra o link num `Input` só leitura com o botão "Copiar" e o texto "Expira em 7 dias"; o diálogo não fecha sozinho. "Criar link" fica desabilitado até o email ser válido, e isso já está feito.
- **Idioma do briefing como Select: aprovo.** A lista vai crescer, e o segmented não escala. O valor inicial é o idioma detectado na página; quando veio da leitura, a tag "Da página" fica ao lado do rótulo, como nos outros campos.

## Achados extras (fora da lista, baixa prioridade)
- Em 390 e em PT, o filtro "Todos / Em andamento / Precisa de você / Aprovados" corta "Aprovados" na borda. Ele rola por dentro, mas nada indica isso. Ponha um degradê de 24 px na borda direita do `ToggleGroup` enquanto houver rolagem, ou troque por `Select` abaixo de 400 px.
- O nome do criativo é conteúdo do usuário e não se traduz com a interface ("Orbit — found money" em PT está certo).
