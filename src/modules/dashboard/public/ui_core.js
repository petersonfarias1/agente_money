/**
 * ==============================================================================
 * APEX AEA — Mission Control: pure view helpers
 * ==============================================================================
 * No DOM, no network, no imports. Every export is a pure function so the same
 * code can be proven from node:test and consumed by the browser as an ES module.
 */

export const TIER_LABELS = {
  VERDE: 'Verde',
  AMARELO: 'Amarelo',
  LARANJA: 'Laranja',
  VERMELHO: 'Vermelho',
};

export const LIVENESS_LABELS = {
  ALIVE: 'vivo',
  STALE: 'sem tick recente',
  DEAD: 'encerrado',
  UNKNOWN: 'sem dados',
};

export function controlViewModel(control = {}) {
  const state = control?.state ?? 'stopped';
  return {
    state,
    startEnabled: state === 'stopped',
    stopEnabled: state === 'running' || state === 'starting',
    label: control?.error && state === 'stopped' ? `${state}: ${control.error}` : state,
  };
}

/**
 * Formats USD in pt-BR without relying on Intl being present.
 * 1234.5 -> "US$ 1.234,50"
 */
export function formatUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const negative = n < 0;
  const [intPart, decPart] = Math.abs(n).toFixed(2).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}US$ ${grouped},${decPart}`;
}

export function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

export function formatDateTime(timestamp) {
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const d = new Date(n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatAge(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 60) return `${Math.floor(n)} s`;
  if (n < 3600) return `${Math.floor(n / 60)} min`;
  return `${Math.floor(n / 3600)} h`;
}

/**
 * Collapses a snapshot into the four numbers the overview answers first.
 */
export function overviewModel(snapshot) {
  const tier = snapshot?.tier?.tier ?? null;
  const balanceUsd = snapshot?.balance?.totalUsd ?? null;
  const liveness = snapshot?.liveness?.state ?? 'UNKNOWN';
  return {
    tier,
    tierLabel: tier ? TIER_LABELS[tier] ?? tier : '—',
    modelClass: snapshot?.tier?.modelClass ?? null,
    balanceUsd,
    balanceText: formatUsd(balanceUsd),
    cycles: Number(snapshot?.kpi?.cycles ?? 0),
    actions: Number(snapshot?.kpi?.actions ?? 0),
    liveness,
    livenessLabel: LIVENESS_LABELS[liveness] ?? liveness,
    dataAgeSeconds: Number(snapshot?.liveness?.ageMs ?? 0) / 1000,
  };
}

/**
 * 2000, 4000, 8000, 16000, 30000, 30000, ...
 */
export function reconnectDelay(attempt) {
  const steps = [2000, 4000, 8000, 16000, 30000];
  const index = Math.min(Math.max(Math.trunc(Number(attempt)) || 1, 1), steps.length);
  return steps[index - 1];
}

/**
 * Parses one SSE frame (the text between two blank lines).
 */
export function parseSseFrame(frame) {
  const result = { event: 'message', id: null, data: null };
  const dataLines = [];
  for (const line of String(frame ?? '').split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') result.event = value;
    else if (field === 'id') result.id = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length > 0) {
    const payload = dataLines.join('\n');
    try {
      result.data = JSON.parse(payload);
    } catch {
      result.data = payload;
    }
  }
  return result;
}

/**
 * `details` is free-form text; valid JSON becomes the parsed value, anything
 * else survives as `{ raw }` so the UI never throws on a bad row.
 */
export function detailView(details) {
  if (typeof details !== 'string') return { raw: String(details ?? '') };
  const trimmed = details.trim();
  if (!trimmed) return { raw: '' };
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: details };
  }
}

export function listState(input) {
  const status = input?.status ?? 'idle';
  const emptyMessage = input?.emptyMessage ?? 'Nenhum registro encontrado';
  return {
    skeletonRows: status === 'loading' ? 5 : 0,
    loadMoreDisabled: status === 'loading',
    emptyMessage: status === 'empty' ? emptyMessage : null,
    errorMessage: status === 'error' ? input?.errorMessage ?? 'Falha ao carregar' : null,
  };
}

/**
 * Buckets a series down to `max` points, keeping the last value of each bucket.
 */
export function downsample(points, max = 240) {
  const list = Array.isArray(points) ? points : [];
  const limit = Math.max(1, Math.trunc(Number(max)) || 1);
  if (list.length <= limit) return list.slice();
  const out = [];
  for (let i = 0; i < limit; i++) {
    const end = Math.floor(((i + 1) * list.length) / limit) - 1;
    out.push(list[Math.max(0, Math.min(end, list.length - 1))]);
  }
  return out;
}

export function winRate(won, lost) {
  const w = Number(won) || 0;
  const l = Number(lost) || 0;
  const total = w + l;
  if (total <= 0) return null;
  return w / total;
}

/**
 * Line path for an SVG chart: points are { t, usd }, mapped into a viewBox.
 */
export function seriesPath(points, width = 720, height = 220, padding = 12) {
  const list = Array.isArray(points) ? points.filter((p) => Number.isFinite(Number(p.usd))) : [];
  if (list.length === 0) return '';
  const values = list.map((p) => Number(p.usd));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return list
    .map((p, i) => {
      const x =
        list.length === 1
          ? width / 2
          : padding + (i * (width - padding * 2)) / (list.length - 1);
      const y =
        height - padding - ((Number(p.usd) - min) / span) * (height - padding * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
