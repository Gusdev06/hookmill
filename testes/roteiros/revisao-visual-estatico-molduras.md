# Roteiro de revisão visual: estático montado (sondas S2/S3) e molduras (contact sheet)
Fonte: `docs/contratos/estatico-montado-e-molduras-v1.md` §A3.1, §A4, §A6, §A7, §B2, §B4, §B6 (aprovado 25/10). Dono: maquina-qa.
Regra: o QA **lê cada imagem** (Read do PNG, zoom quando o texto é pequeno) e marca a folha. Sem folha marcada, não tem "aprovado".

## 1. Estático: sondas S2 (3 briefings × 9:16) e S3 (1 briefing × 4:5 e 1:1)
As sondas são da maquina-ia e **só rodam com ok do Gusta** (S2 US$ 1,20 + ~0,01; S3 US$ 0,80, em 2k). O QA não roda sonda.

### 1.1 O que a sonda precisa gravar (pedido à maquina-ia)
Por imagem, na pasta da sonda (`api/src/integracoes/sondas/out/estatico-v2-<data>/`): `<nome>.png` + `<nome>.json` com
`{ aspect, spec: StaticImageSpecV2, brief: { name, kind, what, audience, pains, promise, proof, offerAndPrice, cta, notes }, transcript, textCheck, prompt, predictionId, costUsd, sec }`.
Sem o JSON a revisão vira chute: não dá pra dizer se um texto da imagem tem fonte.

### 1.2 Briefings da S2 (o que cada um prova)
| sonda | Brain | o que tem que acontecer |
|---|---|---|
| S2-a agnóstico | oferta real com Brain cheio (preço, trial, prova) | todos os blocos; "grátis"/preço só porque o Brain tem |
| S2-b nada inventado | mesma oferta **sem** `offerAndPrice`, `proof`, `cta` | some `cta.sub`, faixa de confiança e todo número; nada de "7 dias grátis", "iOS e Android", "Plano de 21 dias" |
| S2-c omissão de bloco | Brain mínimo (só `what` + `pains`) | `benefits: []`, `trust: []`, herói e tela crescem, sem buraco no layout |
Nicho diferente do experimento de 25/10 (dor nas costas), pra provar que o prompt é agnóstico.

### 1.3 Passo a passo
1. `node ferramentas/roteiro-estatico.mjs <pasta-da-sonda> > test-results/revisao-estatico-<data>.md` (de `testes/`). A parte **A** sai sozinha: fonte de cada bloco, campo vazio, número/afirmação sem dado (oráculo próprio do QA, `harness/estatico-molduras.ts`), o que entra em cada aspecto.
2. Qualquer linha em **negrito** na parte A já é falha de contrato (o backend deixou passar ou a ia mandou fonte errada). Dono: backend (`regras.ts`) se o plano passou na validação; ia se o fake/prompt gerou.
3. Abrir cada PNG e marcar a parte **B** da folha. Pontos que já falharam antes e merecem zoom:
   - grafia nos textos manuscritos ("vólta" no 1k de 25/10): acento a mais, letra trocada;
   - **conteúdo da tela do celular** (o experimento inventou "Gato e vaca 2 min", "3 de 5"): sem referência, tela só abstrata;
   - selos e rodapé ("7 DIAS GRÁTIS", "iOS E ANDROID");
   - CTA dentro dos 10 % de baixo no 9:16 (D6).
4. Conferir o `textCheck` da API contra o que eu li: se eu vejo erro e ele diz `ok` (ou o contrário), é falha da checagem (ia: `checkStaticText`; backend: `compararTexto`).
5. Ler a imagem reduzida a 390 px de largura (`sips -Z 390 <png> --out <scratch>`), porque é assim que ela aparece no celular: título e linha dos cards têm que se ler.
6. S3: os mesmos itens + a tabela de blocos por aspecto (§A4): 4:5 sem fechamento e com até 3 cards; 1:1 sem tagline, sem manuscrito, sem confiança, sem fechamento, cards só com título, herói e device lado a lado.
7. Veredito por imagem (aprovado/reprovado + bloco + dono). Reprovado em grafia de texto crítico com o `textCheck` certo **não** reprova a peça (o fluxo refaz 1×); reprova se a refação também errar e o aviso não aparecer.

### 1.4 Tabela "nada inventado" (§A3.1), o que eu confiro na imagem
| bloco | pode aparecer se | se faltar dado |
|---|---|---|
| nome da marca | sempre (wordmark do `offer.name`, sem ícone, D2) | — |
| linha da marca | `what`/`kind`/`promise` | só o nome |
| tagline | `promise`/`pains`/fala, ou frase genérica sem número nem afirmação | canto vazio |
| headline | `promise`/`pains`/fala (nunca genérica) | peça não existe |
| subheadline | `what`/`promise`/`proof`/`offerAndPrice`/fala | some |
| faixa manuscrita | qualquer, sem afirmação | some |
| cards (3-5) | `what`/`promise`/`pains`/`proof`/`offerAndPrice` | coluna some |
| faixa de confiança (3) | `proof`/`offerAndPrice`/`what`/`notes` | some |
| CTA | `cta`/fala, ou verbo sem promessa | sempre existe |
| CTA 2ª linha ("7 dias grátis") | `offerAndPrice`/`cta` | botão de 1 linha |
| fechamento | qualquer, sem afirmação | canto vazio |
| título da tela | `what`/`name`/`kind` | tela sem texto |
| conteúdo da tela | referência (captura/foto) | abstrato, **sem texto** |

## 2. Molduras: contact sheet e render real (§B6, pronto B1)
Arquivo do video: `testes/molduras/contact-sheet.png` (stills de cada template × formato no fixture). Antes de olhar: o §B6 fala em "10 × 3 = 30 quadros", o §B2 lista **12** de 1 fonte e a §C.1 pede **18 × 3**. Conferir com o arquiteto qual é o total do B1 (36 ou 30) antes de dar o "pronto".

Por quadro (template × formato):
- [ ] É o template do protótipo aprovado (`video/out/prototipo-molduras-2026-10-25/`), lado a lado; diferença de layout = falha (o protótipo vale sobre o texto do contrato no visual).
- [ ] Caixas dentro do canvas; vídeo ≥ mínimo (4:5: caixa do vídeo ≥ 55 % da altura); 9:16 com os slots fora da safe area.
- [ ] Texto ≥ 36 px na saída de 1080 (medir no PNG: altura de caixa-alta); nada cortado; acento certo em pt e es.
- [ ] 1:1 sem `dek`, `subtitle`, CTA do meme; ranking com no máximo 3 itens.
- [ ] Sem logo, nome de app ou cor-marca de Instagram/Meet/X; ícones SVG próprios, **nenhum emoji**.
- [ ] Prova social falsa ausente (D9): Live sem nº de espectadores; post_card sem selo de verificado, avatar de iniciais, "2h"; call com "Convidado".
- [ ] Textos fixos de interface no idioma do quadro ("Faça uma pergunta", "Leia a legenda", "AO VIVO", "POV:").
- [ ] Rosto redondo (question_box, live) = frame do campeão, não rosto gerado.
Render real (pronto B1, item 2): 1 lote com mock de IA **desligado** e Remotion real, 2 molduras: assistir os 2 MP4 inteiros (`python3 ferramentas/qa_video.py peca …` pra frames e áudio), conferir áudio do campeão do início ao fim, entrada de 0,4 s, emenda com fade de 40 ms sem palavra cortada. Esse lote chama o Claude de verdade (centavos): **só com ok do Gusta**.
