# Sondas S1/S2 do §13.15 (08/10, autorizadas pelo Gusta, teto US$ 4)
Scripts das sondas pagas do Trocar avatar com Kling/Seedance. Rodam fora do Nest (Node 22, `.mjs`), com a chave do
`api/.env` (nunca impressa); saída em `./out/` (log, `custos.jsonl` com o Δ de saldo por chamada, mp4 baixados e
validados decodificando inteiro).
- `lib.mjs`: upload, submit+polling com Δ de saldo (`/api/v3/balance`), download com 3 tentativas, Whisper, Soul.
- `s1.mjs` (A): Kling mudo → corte no nº de frames do trecho → 3 lipsync v2v lado a lado.
- `s2.mjs [kling|seedance]` (B): 3 janelas com voz do motor e descritor fixo (w1 parte do último frame da w0; w2 do rosto).
- `voz.py` (embedding de locutor Resemblyzer + F0 Praat + Whisper local), `sync2.py`/`bocas.py` (boca × áudio).
  Precisam de venv própria: `uv venv --python 3.12 venv && uv pip install resemblyzer praat-parselmouth openai-whisper opencv-python-headless 'setuptools<70'`.
Resultado e recomendação: `docs/integracoes.md` §13.15. O saldo é da conta inteira: outra geração no mesmo minuto entra no Δ.
