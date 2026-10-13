#!/usr/bin/env node
// `npm run check:remotion`: falha se as versões do Remotion divergirem (editor-v1 §8, risco 4).
// O Remotion exige TODOS os pacotes (`remotion` e `@remotion/*`) na mesma versão exata; o web (Player) e o video/api
// (render) têm que tocar a mesma composição. Confere:
//   1. o que web/, video/ e api/ DECLARAM no package.json (tem que ser versão exata, sem ^ ou ~, e todas iguais);
//   2. o que está INSTALADO (node_modules da raiz e de cada workspace, se houver cópia local).
// Dono: maquina-arquiteto.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACES = ['web', 'video', 'api'];
const isRemotion = (name) => name === 'remotion' || name.startsWith('@remotion/');

const problems = [];
const seen = new Map(); // versão -> [onde]
const add = (version, where) => {
  if (!seen.has(version)) seen.set(version, []);
  seen.get(version).push(where);
};

for (const ws of WORKSPACES) {
  const pkg = JSON.parse(readFileSync(join(ROOT, ws, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!isRemotion(name)) continue;
      if (!/^\d+\.\d+\.\d+$/.test(spec)) problems.push(`${ws}/package.json ${field}.${name} = "${spec}" (tem que ser versão exata)`);
      add(spec, `${ws}/package.json ${name}`);
    }
  }
}

const installed = (nmDir, label) => {
  if (!existsSync(nmDir)) return;
  const core = join(nmDir, 'remotion', 'package.json');
  if (existsSync(core)) add(JSON.parse(readFileSync(core, 'utf8')).version, `${label}/remotion`);
  const scope = join(nmDir, '@remotion');
  if (!existsSync(scope)) return;
  for (const d of readdirSync(scope)) {
    const p = join(scope, d, 'package.json');
    if (!existsSync(p)) continue;
    add(JSON.parse(readFileSync(p, 'utf8')).version, `${label}/@remotion/${d}`);
  }
};
installed(join(ROOT, 'node_modules'), 'node_modules');
for (const ws of WORKSPACES) installed(join(ROOT, ws, 'node_modules'), `${ws}/node_modules`);

if (seen.size > 1) {
  problems.push('versões diferentes do Remotion:');
  for (const [v, where] of seen) problems.push(`  ${v}: ${where.slice(0, 8).join(', ')}${where.length > 8 ? ` (+${where.length - 8})` : ''}`);
}
if (seen.size === 0) problems.push('nenhum pacote do Remotion encontrado (rode npm install)');

if (problems.length) {
  console.error('[check:remotion] FALHOU');
  for (const p of problems) console.error(`[check:remotion] ${p}`);
  console.error('[check:remotion] Alinhe tudo na mesma versão exata (web, video e api) e rode npm install.');
  process.exit(1);
}
const [[version, where]] = [...seen];
console.log(`[check:remotion] ok: remotion ${version} em ${where.length} lugares (declarado em ${WORKSPACES.join(', ')} e instalado)`);
