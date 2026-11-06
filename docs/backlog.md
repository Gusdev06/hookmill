# Backlog do HookMill

Ideias e pedidos do Gusta para fazer depois. Cada item tem data e origem. Quando um item entrar em construção, vira contrato em `docs/contratos/` e sai daqui.

## 02/11/2026: template de campanha no fluxo de publicação (pedido do Gusta)

**Pedido:** quando a pessoa cria um anúncio e vai subir na Meta, ela escolhe um **template de campanha**, ou seja, a estrutura em que quer subir os anúncios: campanha, conjunto e anúncio, com orçamento, objetivo, público e quantos anúncios por conjunto. Se ainda não tiver nenhum, **aparece uma tela pra criar um template**, e essa tela é basicamente igual à do Gerenciador de Anúncios da Meta.

**O que já existe (29/10, `20261029000200_amostra_e_meta_templates`):**
- Modelos de publicação em Configurações › Conexões › Templates (`web/src/components/meta/templates/`), criados numa janela (`template-dialog.tsx`) ou importados de uma campanha existente (`import-picker.tsx`).
- Na hora de enviar, um seletor de template com o padrão já marcado, mais a opção "Custom" pra preencher o formulário (`send-template.tsx`, `batch-send.tsx`).
- A 1ª publicação real com template na Graph nunca rodou (pendente com o Tordan, sobe PAUSED).

**O que falta:**
1. **Sem template = tela de criação no próprio fluxo:** no "Publicar na Meta", se a conta não tem template, abrir direto a criação em vez do formulário Custom. Ao salvar, voltar pro envio com o template novo já escolhido.
2. **Tela no formato do Gerenciador:** página inteira, com a coluna da estrutura à esquerda (Campanha › Conjunto › Anúncio) e o painel de campos do nível escolhido à direita, nos mesmos nomes e na mesma ordem da Meta. Hoje é uma janela com formulário.
3. **Mesma tela pra editar** os templates de Configurações.
4. Entra também a skill de CBO do Tordan (4 a 8 anúncios por conjunto) como template pronto, quando ele mandar.

**Antes de construir:** mockup no `maquina-design`, comparado lado a lado com prints do Gerenciador; o Gusta aprova vendo. Depois contrato no `maquina-arquiteto`.

## Checklist do lançamento (anotado 04/11)
- `TEST_MODE` desligado no EasyPanel (apagar ou `off`). Com ele ligado, `/auth/me` diz que toda conta é INTERNAL: o menu "Admin · Templates" e o "Team · unlimited" aparecem pra qualquer conta. **Desde 04/11 (pedido do Gusta) as rotas de admin também liberam no modo teste** (`templates.service.ts` isStaff e `creditos.service.ts` assertStaff): com TEST_MODE ligado em produção, qualquer dono de conta conseguiria se dar créditos e mexer no catálogo. Desligar é obrigatório.
- **EasyPanel (produção), Gusta faz:** serviço hookmill/api → Environment: `AD_LIBRARY_MODE=off` e `ADS_RESEARCH_MODE=off` → Deploy. Desliga o campeão por link da Ad Library (quebrado: o actor não resolve mais anúncio único) e mantém o Ad Radar desligado até a conta Apify própria (R7). Aprovado em 04/11.
