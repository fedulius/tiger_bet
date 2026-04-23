export function resolveMatchId({ routeParamId = '', search = '' } = {}) {
  const cleanRouteId = String(routeParamId || '').trim();
  if (cleanRouteId) {
    return cleanRouteId;
  }

  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  return String(params.get('id') || '').trim();
}

export function buildMatchBackLink() {
  return '/webapp';
}
