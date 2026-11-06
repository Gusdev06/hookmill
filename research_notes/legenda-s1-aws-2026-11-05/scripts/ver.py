import json,sys
acum=0
for l in open('medidas/invocacoes.jsonl'):
    r=json.loads(l); s=r['saida']; acum+=r['usd']
    k={x:s.get(x) for x in ('faixa','t_faixa_s','t_mascaras_s','ler_mascara_s','temporal_s','gravar_s','t_prefill_s','t_fluxo_s','t_prop_s','t_tel_s','buraco_telea_pct','r5_s','r3_s','r5_roi_s','r3_roi_s','mascara_s','psnr_vs_r5_r3','psnr_vs_r5_r5_roi','area_a_vista_media','area_a_vista_p95','escrever_s','baixar_s','subir_s','cpu_python_s','cpu_ffmpeg_s') if s.get(x) is not None}
    print(f"{r['rotulo']:<24} {'F' if s.get('frio') else 'm'} rel {r['relogio_s']:>7} bill {r['billed_ms']} mem {r['max_mem_MB']} arv {s.get('pico_arvore_MB')} py {s.get('rss_python_MB')} acum {acum:.4f} {'' if s.get('ok') else 'ERRO '+str(s.get('exit'))+str(s.get('erro'))[-200:]+str(r.get('erro_funcao'))} {k if len(sys.argv)>1 else ''}")
