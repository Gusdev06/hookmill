#!/bin/bash
# S4 do começo ao fim, de scripts/. Local, US$ 0. Os vídeos de origem vêm de origem/ (symlinks e cortes) e de work-leg/.
set -e
python3 placa_solta.py && python3 jobs_solto.py && node render.mjs ../medidas/jobs-solto.json && python3 final_solto.py 2
for k in aprovada longa longa2 curta minima prova-originais; do mv ../saida/solto/$k-y.mp4 ../saida/solto/$k.mp4; done
python3 conferir_solto.py && python3 regua_chrome.py
python3 caixa_medir.py && python3 placa_02_porquadro.py && python3 jobs_caixa.py && node render.mjs ../medidas/jobs-caixa.json && python3 final_caixa.py && python3 regua_caixa.py && python3 conferir_caixa.py
(cd ../work-leg && PYTHONPATH=../scripts/s2 python3 ../scripts/s2/detectar.py v13.mp4 d13.npz && PYTHONPATH=../scripts/s2 python3 ../scripts/s2/detectar.py v02.mp4 d02.npz --caixa && PYTHONPATH=../scripts/s2 python3 ../scripts/dump_legenda.py)
node render.mjs ../medidas/jobs-legenda.json && python3 final_legenda.py
python3 resumo.py
