// Escopos obrigatórios do Facebook Login for Business (meta-v1.md §4). Reserva (pages_read_engagement,
// pages_manage_ads) entra na configuração do login sem mudar código; o health mostra o que foi concedido.
export const REQUIRED_SCOPES = ['ads_management', 'ads_read', 'business_management', 'pages_show_list'] as const;

export function missingScopes(granted: string[]): string[] {
  const set = new Set(granted.map((s) => s.trim().toLowerCase()));
  return REQUIRED_SCOPES.filter((s) => !set.has(s));
}
