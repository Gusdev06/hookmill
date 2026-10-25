// Tamanho de um JSON Schema de saída estruturada (bug live 25/10: "The compiled grammar is too large"). A API não publica
// o limite interno da gramática (só 24 opcionais / 16 uniões / 20 tools strict); o que pesa é o nº de propriedades, os
// valores de enum (cada um vira alternativa na gramática) e o aninhamento de objetos dentro de arrays. Os testes travam
// o esquema do plano abaixo de um teto medido em live (ver auto-plano.spec / schema-stats).
export interface SchemaStats {
  /** propriedades de objeto, somadas em todos os níveis */
  properties: number;
  /** soma dos valores de todos os enums */
  enumValues: number;
  /** nº de campos com enum */
  enums: number;
  /** anyOf / oneOf / type em array */
  unions: number;
  /** propriedades fora do `required` */
  optional: number;
  /** maior profundidade de objetos aninhados */
  depth: number;
}

export function schemaStats(schema: unknown): SchemaStats {
  const st: SchemaStats = { properties: 0, enumValues: 0, enums: 0, unions: 0, optional: 0, depth: 0 };
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.enum)) {
      st.enums++;
      st.enumValues += o.enum.length;
    }
    if (o.anyOf || o.oneOf || Array.isArray(o.type)) st.unions++;
    if (o.type === 'object' && o.properties && typeof o.properties === 'object') {
      const keys = Object.keys(o.properties);
      st.properties += keys.length;
      const req = new Set(Array.isArray(o.required) ? (o.required as string[]) : []);
      st.optional += keys.filter((k) => !req.has(k)).length;
      st.depth = Math.max(st.depth, depth + 1);
      for (const k of keys) walk((o.properties as Record<string, unknown>)[k], depth + 1);
    }
    if (o.items) walk(o.items, depth);
    for (const k of ['anyOf', 'oneOf', 'allOf'] as const) if (Array.isArray(o[k])) (o[k] as unknown[]).forEach((x) => walk(x, depth));
  };
  walk(schema, 0);
  return st;
}
