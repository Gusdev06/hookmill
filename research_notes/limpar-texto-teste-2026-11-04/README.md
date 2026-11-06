# Trocar texto fixo queimado por texto novo, no mesmo lugar (teste 04/11/2026)

Teste local, custo zero, feito fora do código do produto. A pergunta era se o método de `references/limpar-texto-video.md` (máscara de pixel claro e parado + `cv2.inpaint` TELEA) consegue trocar a headline queimada dos campeões por outra com o mesmo visual. Seria uma alternativa à placa opaca do template HEADLINE.

## O que os vídeos têm de fato
- **O texto não fica parado o vídeo todo.** Ele fica parado num trecho do começo e some num corte seco. Medi a diferença da caixa quadro a quadro: no 06 a caixa vai de 0 a 11,17 s (335 quadros), no 02 de 0 a 6,60 s (198 quadros). Depois disso o vídeo muda de cena (lista, contador, CTA). Por isso o processamento é feito só nesse trecho e o resto passa intacto. Conferido por PSNR: logo depois do corte, saída e original são iguais (≈50 dB).
- **Nos dois, o texto fica dentro de uma caixa opaca** (vermelha no 06, faixa azul no 02). O fundo atrás da letra é a própria caixa, não a cena. A faixa do 02 é uns 5% transparente: dá pra ver um vulto da cabeça se mexendo nela.
- Os vídeos não são 1080×1920 (06 = 720×960, 02 = 716×1278). O script original escala tudo pra 1080×1920, o que distorce o 06. A cópia adaptada trabalha na resolução nativa.

## As duas remoções comparadas (texto novo idêntico nas duas)
- **A, inpaint TELEA** (o método do script, com máscara de claro e parado dentro da caixa). Com `--dilata 5` sobra um fantasma escuro das letras antigas, por causa do halo de compressão em volta delas. Com 9 ele quase some, mas no 06 ainda ficam pontinhos avermelhados mais claros onde o texto novo não cobre (fim das linhas, que ficaram mais curtas).
- **B, caixa lisa**: a caixa inteira é repintada com a própria cor, amostrada por quadro (média gaussiana só dos pixels que não são letra). Mantém o gradiente e o vulto translúcido do 02. **Não deixa resíduo.** É a melhor das duas e também a mais rápida.
- Texto novo: a fonte foi escolhida por correlação contra o texto original (Avenir Next Medium no 06, Inter Bold no 02). Tamanho, entrelinha, linha de base e centro foram ajustados por busca em grade, o sublinhado do 02 foi refeito e o texto recebeu um blur de 0,6 px pra imitar a compressão.

## Veredito
- **Ficou nativo?** Com B, sim. Assistindo ao vídeo, a caixa e o texto novo parecem do original. No lado a lado do 02 dá pra notar que a fonte não é exatamente a mesma (a original parece mais larga e geométrica, a Inter é mais compacta). Sozinho, ninguém percebe.
- **Onde aparece borrão ou contorno?** Só em A: fantasma das letras com dilata baixo e pontinhos no 06. Em B, nada.
- **O texto novo esconde tudo?** Em B não precisa esconder nada, porque a caixa fica limpa mesmo sem texto (o texto novo pode ser mais curto). Em A, a área sem texto novo mostra resíduo.
- **Tempo** (MacBook, CPU): trecho do 06 em 16,8 s, sendo o inpaint 8,6 s e a caixa lisa 1,1 s; mais 13 s pra montar o vídeo inteiro de 73 s com áudio. Trecho do 02 em 20,3 s (inpaint 11,5 s, lisa 1,8 s); mais 37 s pra recodificar o vídeo inteiro de 128 s. Pico de RAM ≈1,1 GB, porque o trecho inteiro fica em memória. No produto teria que ser streaming em duas passadas.
- **Levar pro produto?** Sim, como opção do HEADLINE quando o original tem texto fixo em caixa. Mas a parte que vale é a **B (caixa lisa)**, não o inpaint. Na prática é uma "placa" com a cor, o gradiente e a geometria exatos da caixa original, mais o texto na mesma fonte e posição. O inpaint TELEA só faria sentido com texto solto sobre a cena, e aí o borrado volta (é o caso reprovado em 28/10). O que falta pra virar produto: (1) detectar sozinho o retângulo e o trecho em que a caixa está parada (aqui foi medido à mão com ajuda de script); (2) catálogo de fontes pro casamento automático (Montserrat, Avenir, Inter, Poppins, SF...); (3) quebra de linha que caiba na largura da caixa original, ou caixa que cresce na mesma cor; (4) texto que muda no meio do vídeo tratado por trecho.

## Arquivos
- `06-antes-depois.mp4`, `02-antes-depois.mp4`: lado a lado curto, com áudio.
- `0X-depois-B.mp4` (caixa lisa, a recomendada) e `0X-depois-A.mp4` (inpaint): vídeo inteiro com o áudio original. Os MP4 ficam fora do git (`research_notes/**/*.mp4` no `.gitignore`).
- `0X-quadro-{1,2,3}-t*.jpg`: antes, A e B lado a lado em 3 momentos do trecho.
- `0X-recorte-etapas.png`: de cima pra baixo, original, limpo A, limpo B, texto original recriado sobre B (teste de fonte), final A, final B.
- `0X-mascara.png`: máscara do inpaint.
- `scripts/`: `trocar_texto.py` + `c06.json`/`c02.json` (config), `montar.sh` (junta e faz o lado a lado), `quadros.py`.
