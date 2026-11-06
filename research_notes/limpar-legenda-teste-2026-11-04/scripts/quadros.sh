#!/bin/bash
# quadros.sh <id> <dir> <saida_dir> <nome> t1 t2 t3
id=$1; o=$2; out=$3; nome=$4; shift 4; n=1
for t in "$@"; do python3 folha.py $id $o "$out/$nome-quadro-$n-t${t}s.png" $t; n=$((n+1)); done
