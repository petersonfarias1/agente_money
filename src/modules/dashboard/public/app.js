/**
 * ==============================================================================
 * APEX AEA — Mission Control: browser application
 * ==============================================================================
 * Renders snapshots received over SSE and the read-only API. No framework, no
 * build step, no external origin.
 */

import {
  LIVENESS_LABELS,
  detailView,
  formatAge,
  formatDateTime,
  formatPercent,
  formatUsd,
  listState,
  overviewModel,
  parseSseFrame,
  reconnectDelay,
  seriesPath,
} from './ui_core.js';

const params = new URLSearchParams(location.search);
const TOKEN = params.get('token') ?? '';

const el = (id) => document.getElementById(id);

let snapshot = null;
let lastSeq = 0;
let stream = null;
let attempt = 0;
let reconnectTimer = null;
let actionsCursor = null;
let actionsComponent = '';
let actionsLoading = false;
let actionCache = new Map();
let tombstoneData = null;

// ==============================================================================
// Utilities
// ==============================================================================

function apiUrl(pathname, query = {}) {
  const url = new URL(pathname, location.origin);
  if (TOKEN) url.searchParams.set('token', TOKEN);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchJson(pathname, query) {
  const response = await fetch(apiUrl(pathname, query), {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    cache: 'no-store',
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function setConnection(state, label) {
  const badge = el('connection');
  badge.dataset.state = state;
  el('connection-label').textContent = label;
}

// ==============================================================================
// Streaming
// ==============================================================================

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (stream) stream.close();

  const url = apiUrl('/api/stream');
  if (lastSeq > 0) url.searchParams.set('lastEventId', String(lastSeq));

  stream = new EventSource(url);
  setConnection('connecting', 'conectando');

  stream.addEventListener('open', () => {
    attempt = 0;
    setConnection('live', 'ao vivo');
  });

  stream.addEventListener('snapshot', (event) => {
    attempt = 0;
    setConnection('live', 'ao vivo');
    try {
      const frame = parseSseFrame(event.data);
      const next = typeof frame.data === 'object' && frame.data ? frame.data : null;
      if (!next) return;
      lastSeq = Number(event.lastEventId || next.seq || lastSeq);
      applySnapshot(next);
    } catch {
      // A malformed frame is dropped; the next one arrives in 2s.
    }
  });

  stream.addEventListener('error', () => {
    setConnection('retrying', 'reconectando');
    if (stream) stream.close();
    stream = null;
    attempt += 1;
    const delay = reconnectDelay(attempt);
    reconnectTimer = setTimeout(connect, delay);
  });
}

// ==============================================================================
// Snapshot rendering
// ==============================================================================

function applySnapshot(next) {
  snapshot = next;
  renderTopbar(next);
  renderOverview(next);
  renderFinance(next);
  renderConfig(next);
  renderModels(next);
  renderClan(next);
  refreshExportLinks();
}

function renderTopbar(data) {
  const overview = overviewModel(data);
  const liveness = el('liveness');
  liveness.dataset.state = overview.liveness;
  liveness.textContent = LIVENESS_LABELS[overview.liveness] ?? overview.liveness;
  if (data.liveness?.detail && data.liveness.state !== 'ALIVE') {
    liveness.textContent = `${LIVENESS_LABELS[overview.liveness] ?? overview.liveness} · ${data.liveness.detail}`;
  }
  const tier = el('tier');
  tier.dataset.tier = overview.tier ?? '';
  tier.textContent = overview.tier ? `tier ${overview.tierLabel}` : 'tier —';
  el('balance').textContent = overview.balanceText;
  el('network-mode').textContent = data.networkMode ?? '—';

  const ageSeconds = Math.max(0, (Date.now() - Number(data.generatedAt ?? Date.now())) / 1000);
  el('data-age').textContent = `dados de ${formatAge(ageSeconds)} atrás`;
}

function renderOverview(data) {
  const overview = overviewModel(data);
  el('kpi-balance').textContent = overview.balanceText;
  el('kpi-balance-source').textContent =
    data.balance?.source === 'last-action'
      ? `último registro · ${formatDateTime(data.balance.updatedAt)}`
      : 'sem leitura de saldo';
  el('kpi-cycles').textContent = String(overview.cycles);
  el('kpi-actions').textContent = String(overview.actions);
  el('kpi-components').textContent = `${data.kpi?.components ?? 0} componentes`;
  el('kpi-model').textContent = overview.modelClass ?? '—';
  el('kpi-model-note').textContent = overview.tier
    ? `derivada do tier ${overview.tierLabel}`
    : 'sem tier calculado';

  el('empty-agent').hidden = overview.actions > 0;

  const series = data.revenue?.series ?? [];
  renderChart(el('balance-chart'), series);
  el('chart-caption').textContent = series.length
    ? `${series.length} pontos · ${formatUsd(series[series.length - 1].usd)}`
    : 'sem ciclos';

  renderAlerts(data.alerts ?? []);
  renderRecentActions(data.activity?.recentActions ?? []);
}

function renderChart(container, series) {
  if (!container) return;
  if (!Array.isArray(series) || series.length === 0) {
    container.innerHTML = '<div class="chart-empty">Sem série de saldo registrada</div>';
    return;
  }

  const width = 720;
  const height = 220;
  const pad = 18;
  const values = series.map((point) => Number(point.usd));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const pointAt = (point, index) => {
    const x =
      series.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (series.length - 1);
    const y = height - pad - ((Number(point.usd) - min) / span) * (height - pad * 2);
    return [x, y];
  };

  const line = seriesPath(series, width, height, pad);
  const first = pointAt(series[0], 0);
  const last = pointAt(series[series.length - 1], series.length - 1);
  const area = `${line} L${last[0].toFixed(1)},${height - pad} L${first[0].toFixed(1)},${height - pad} Z`;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const y = pad + ratio * (height - pad * 2);
      return `<line class="grid-line" x1="${pad}" y1="${y.toFixed(1)}" x2="${width - pad}" y2="${y.toFixed(1)}"></line>`;
    })
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Saldo por ciclo">
      ${grid}
      <path class="area" d="${area}"></path>
      <path class="line" d="${line}"></path>
      <circle class="end-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4"></circle>
      <text class="axis-label" x="${pad}" y="${pad - 4}">${escapeHtml(formatUsd(max))}</text>
      <text class="axis-label" x="${pad}" y="${height - 4}">${escapeHtml(formatUsd(min))}</text>
    </svg>
  `;
}

function renderAlerts(alerts) {
  const feed = el('alert-feed');
  if (!Array.isArray(alerts) || alerts.length === 0) {
    feed.innerHTML = '<li class="alert alert-info">Nenhum alerta registrado.</li>';
    return;
  }
  feed.innerHTML = alerts
    .map(
      (alert) => `
      <li class="alert alert-${escapeHtml(alert.severity)}">
        <span>${escapeHtml(alert.message ?? alert.actionType)}</span>
        <span class="alert-time">${escapeHtml(formatDateTime(alert.timestamp))}</span>
      </li>`
    )
    .join('');
}

function renderRecentActions(actions) {
  const body = el('recent-actions');
  const empty = el('recent-actions-empty');
  if (!Array.isArray(actions) || actions.length === 0) {
    body.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  body.innerHTML = actions
    .map((action) => {
      actionCache.set(Number(action.id), action);
      return `
        <tr data-action-id="${Number(action.id)}" tabindex="0">
          <td>${escapeHtml(action.component)}</td>
          <td>${escapeHtml(action.actionType)}</td>
          <td>${escapeHtml(action.tier)}</td>
          <td class="num">${escapeHtml(formatUsd(action.balanceUsd))}</td>
          <td class="mono">${escapeHtml(formatDateTime(action.timestamp))}</td>
        </tr>`;
    })
    .join('');
}

function renderFinance(data) {
  const revenue = data.revenue ?? {};
  el('fin-revenue').textContent = formatUsd(revenue.totalUsd ?? 0);
  el('fin-expense').textContent = formatUsd(revenue.expenseUsd ?? 0);
  const net = Number(revenue.netUsd ?? 0);
  const netEl = el('fin-net');
  netEl.textContent = formatUsd(net);
  netEl.className = `kpi-value ${net >= 0 ? 'positive' : 'negative'}`;
  el('fin-runway').textContent =
    revenue.runwayDays == null ? 'sem queima registrada' : `${revenue.runwayDays} dias`;
  el('fin-burn').textContent = `queima 7d ${formatUsd(revenue.burn7dUsd ?? 0)}`;

  const groups = Array.isArray(revenue.byType) ? revenue.byType : [];
  const groupList = el('revenue-groups');
  el('revenue-empty').hidden = groups.length > 0;
  const maxAmount = Math.max(...groups.map((group) => Math.abs(Number(group.amountUsd) || 0)), 1);
  groupList.innerHTML = groups
    .map(
      (group) => `
      <li class="bar-row">
        <span>${escapeHtml(group.entryType)}</span>
        <span class="bar-track"><span class="bar-fill" data-width="${((Math.abs(Number(group.amountUsd)) / maxAmount) * 100).toFixed(1)}"></span></span>
        <span class="bar-value">${escapeHtml(formatUsd(group.amountUsd))} · ${Number(group.count)}x</span>
      </li>`
    )
    .join('');
  groupList.querySelectorAll('.bar-fill').forEach((fill) => {
    fill.style.width = `${fill.dataset.width}%`;
  });

  const positions = data.positions ?? { counts: {} };
  const counts = positions.counts ?? {};
  const winrate = positions.winRate;
  el('positions-summary').innerHTML = `
    <div class="mini"><p class="mini-label">Exposição aberta</p><p class="mini-value">${escapeHtml(formatUsd(positions.openExposureUsd ?? 0))}</p></div>
    <div class="mini"><p class="mini-label">Win rate</p><p class="mini-value">${winrate == null ? '—' : escapeHtml(formatPercent(winrate))}</p></div>
    <div class="mini"><p class="mini-label">Abertas</p><p class="mini-value">${Number(counts.OPEN ?? 0)}</p></div>
    <div class="mini"><p class="mini-label">Ganhas / perdidas</p><p class="mini-value">${Number(counts.WON ?? 0)} / ${Number(counts.LOST ?? 0)}</p></div>
    <div class="mini"><p class="mini-label">Canceladas</p><p class="mini-value">${Number(counts.CANCELLED ?? 0)}</p></div>
    <div class="mini"><p class="mini-label">Total</p><p class="mini-value">${Number(positions.total ?? 0)}</p></div>
  `;

  renderChart(el('finance-chart'), revenue.series ?? []);
}

// ==============================================================================
// Config
// ==============================================================================

const CONFIG_LABELS = {
  nodeEnv: 'NODE_ENV',
  logLevel: 'Log level',
  networkMode: 'Network mode',
  motherWalletAddress: 'Carteira mãe',
  initialCapitalUsd: 'Capital inicial (USD)',
  tierThresholds: 'Thresholds do tier',
  heartbeatIntervals: 'Intervalos de heartbeat',
  kelly: 'Kelly',
  polymarket: 'Polymarket',
  x402: 'x402',
  bounties: 'Bounties',
  evolution: 'Evolução',
  mock: 'Mock',
  network: 'Rede',
  systemConfig: 'Overrides no SQLite',
};

function displayValue(value) {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderConfig(data) {
  const config = data.config ?? null;
  const grid = el('config-grid');
  if (!config) {
    grid.innerHTML = '';
    el('config-empty').hidden = false;
    return;
  }
  el('config-empty').hidden = true;

  const blocks = [];
  const scalars = Object.entries(config).filter(([, value]) => value === null || typeof value !== 'object');
  if (scalars.length > 0) {
    blocks.push(renderKvBlock('Geral', scalars));
  }
  for (const [key, value] of Object.entries(config)) {
    if (value === null || typeof value !== 'object') continue;
    const rows = Array.isArray(value)
      ? value.map((entry, index) => [String(index + 1), entry])
      : Object.entries(value);
    blocks.push(renderKvBlock(CONFIG_LABELS[key] ?? key, rows));
  }
  grid.innerHTML = blocks.join('');
}

function renderKvBlock(title, entries) {
  const rows = entries
    .map(([key, value]) => {
      const rendered =
        value && typeof value === 'object'
          ? Object.entries(value)
              .map(([innerKey, innerValue]) => `${innerKey}: ${displayValue(innerValue)}`)
              .join(' · ')
          : displayValue(value);
      return `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(rendered)}</dd></div>`;
    })
    .join('');
  return `
    <section class="kv-block">
      <h3>${escapeHtml(title)}</h3>
      <dl class="kv-list">${rows}</dl>
    </section>`;
}

// ==============================================================================
// Models
// ==============================================================================

function renderModels(data) {
  const tier = data.tier ?? null;
  el('model-tier').dataset.tier = tier?.tier ?? '';
  el('model-tier').textContent = tier?.tier ? `tier ${tier.tier}` : 'tier —';
  el('model-class').textContent = tier?.modelClass ?? '—';
  el('model-interval').textContent = tier ? `${Math.round(tier.heartbeatIntervalMs / 1000)} s` : '—';
  el('model-research').textContent = tier ? (tier.allowSpeculativeResearch ? 'liberada' : 'bloqueada') : '—';
  el('model-modification').textContent = tier ? (tier.allowSelfModification ? 'liberada' : 'bloqueada') : '—';
  el('model-reason').textContent = tier?.reason ?? '—';
  const operations = tier?.operations ?? [];
  el('model-operations').innerHTML = operations
    .map((operation) => `<li class="chip">${escapeHtml(operation)}</li>`)
    .join('');
}

// ==============================================================================
// Clan and permadeath
// ==============================================================================

function renderClan(data) {
  const lineage = data.lineage ?? { children: [] };
  const children = Array.isArray(lineage.children) ? lineage.children : [];
  el('royalties-total').textContent = `royalties ${formatUsd(lineage.royaltiesPaidUsd ?? 0)}`;
  el('lineage-empty').hidden = children.length > 0;
  el('lineage-rows').innerHTML = children
    .map(
      (child) => `
      <tr>
        <td>${Number(child.generation)}</td>
        <td class="mono">${escapeHtml(child.childAddress)}</td>
        <td>${escapeHtml(child.status)}</td>
        <td class="num">${escapeHtml(formatUsd(child.totalRoyaltiesPaidUsd))}</td>
      </tr>`
    )
    .join('');

  const tombstone = data.tombstone ?? { present: false };
  const body = el('tombstone-body');
  const download = el('download-tombstone');
  tombstoneData = null;
  download.hidden = true;

  if (!tombstone.present) {
    body.innerHTML = '<p class="empty-inline">agente vivo</p>';
    return;
  }
  if (tombstone.invalid) {
    body.innerHTML = `<p class="empty-inline">tombstone inválido</p><p class="mono muted">${escapeHtml(tombstone.path ?? '')}</p>`;
    return;
  }
  tombstoneData = tombstone.data ?? null;
  download.hidden = false;
  body.innerHTML = `
    <dl class="kv-list">
      <div><dt>Causa</dt><dd>${escapeHtml(tombstone.reason ?? '—')}</dd></div>
      <div><dt>Morte</dt><dd>${escapeHtml(tombstone.deathTimestamp ?? '—')}</dd></div>
      <div><dt>Ciclos totais</dt><dd>${Number(tombstone.totalCyclesExecuted ?? 0)}</dd></div>
      <div><dt>Receita final</dt><dd>${escapeHtml(formatUsd(tombstone.totalRevenueGenerated ?? 0))}</dd></div>
      <div><dt>Despesa final</dt><dd>${escapeHtml(formatUsd(tombstone.totalExpensesIncurred ?? 0))}</dd></div>
      <div><dt>Arquivo</dt><dd>${escapeHtml(tombstone.path ?? '')}</dd></div>
    </dl>`;
}

function downloadTombstone() {
  if (!tombstoneData) return;
  const blob = new Blob([JSON.stringify(tombstoneData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'tombstone.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

// ==============================================================================
// Operations
// ==============================================================================

function renderActionRows(items) {
  return items
    .map((action) => {
      actionCache.set(Number(action.id), action);
      return `
        <tr data-action-id="${Number(action.id)}" tabindex="0">
          <td class="mono">${Number(action.id)}</td>
          <td>${escapeHtml(action.component)}</td>
          <td>${escapeHtml(action.actionType)}</td>
          <td>${escapeHtml(action.tier)}</td>
          <td class="num">${escapeHtml(formatUsd(action.balanceUsd))}</td>
          <td class="mono">${escapeHtml(formatDateTime(action.timestamp))}</td>
        </tr>`;
    })
    .join('');
}

function renderSkeletonRows() {
  return Array.from({ length: 5 })
    .map(
      () => `
      <tr aria-hidden="true">
        <td><span class="skeleton"></span></td>
        <td><span class="skeleton"></span></td>
        <td><span class="skeleton"></span></td>
        <td><span class="skeleton"></span></td>
        <td><span class="skeleton"></span></td>
        <td><span class="skeleton"></span></td>
      </tr>`
    )
    .join('');
}

async function loadActions({ reset = false } = {}) {
  if (actionsLoading) return;
  actionsLoading = true;
  const body = el('action-rows');
  const empty = el('actions-empty');
  const loadMore = el('load-more');
  const count = el('actions-count');

  if (reset) {
    actionsCursor = null;
    body.innerHTML = '';
  }
  const loadingState = listState({ status: 'loading' });
  if (reset) body.innerHTML = renderSkeletonRows();
  loadMore.disabled = loadingState.loadMoreDisabled;
  loadMore.hidden = false;

  try {
    const query = { limit: 50 };
    if (actionsComponent) query.component = actionsComponent;
    if (actionsCursor != null) query.before = actionsCursor;
    const data = await fetchJson('/api/actions', query);
    if (reset) body.innerHTML = '';
    body.insertAdjacentHTML('beforeend', renderActionRows(data.items ?? []));
    actionsCursor = data.nextBefore ?? null;
    loadMore.hidden = actionsCursor == null;
    empty.hidden = body.children.length > 0;
    count.textContent = `${body.children.length} registros nesta visão`;
    if (body.children.length === 0) {
      empty.hidden = false;
    }
  } catch (error) {
    if (reset) body.innerHTML = '';
    empty.hidden = false;
    if (error.status === 401) empty.textContent = 'Não autorizado: informe ?token=<token> na URL.';
    else if (error.status === 503) empty.textContent = 'Banco indisponível para leitura.';
    else empty.textContent = 'Nenhuma operação encontrada para este filtro';
    loadMore.hidden = true;
  } finally {
    actionsLoading = false;
    loadMore.disabled = false;
  }
}

// ==============================================================================
// Detail dialog
// ==============================================================================

function openDetail(actionId) {
  const action = actionCache.get(Number(actionId));
  if (!action) return;
  const dialog = el('detail-dialog');
  el('detail-title').textContent = action.actionType;
  el('detail-meta').textContent = `${action.component} · ${formatDateTime(action.timestamp)} · ${formatUsd(action.balanceUsd)}`;
  const detail = detailView(action.details);
  el('detail-body').textContent =
    detail && typeof detail === 'object' && 'raw' in detail
      ? detail.raw
      : JSON.stringify(detail, null, 2);
  dialog.showModal();
}

async function copyDetail() {
  const text = el('detail-body').textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
    el('copy-detail').textContent = 'Copiado';
    setTimeout(() => {
      el('copy-detail').textContent = 'Copiar';
    }, 1500);
  } catch {
    el('copy-detail').textContent = 'Falha ao copiar';
  }
}

// ==============================================================================
// Navigation and wiring
// ==============================================================================

function showView(name) {
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== name;
  });
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.view === name);
  });
  if (name === 'operations') {
    loadActions({ reset: true });
  }
}

function refreshExportLinks() {
  const links = {
    'export-snapshot': ['/api/export', { table: 'actions', format: 'json' }],
    'export-actions-csv': ['/api/export', { table: 'actions', format: 'csv' }],
    'export-actions-json': ['/api/export', { table: 'actions', format: 'json' }],
    'export-ledger': ['/api/export', { table: 'ledger', format: 'csv' }],
  };
  for (const [id, [pathname, query]] of Object.entries(links)) {
    const link = el(id);
    if (link) link.href = apiUrl(pathname, query).toString();
  }
}

function wire() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => showView(item.dataset.view));
  });
  document.querySelectorAll('[data-goto]').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.goto));
  });

  el('action-filters').addEventListener('submit', (event) => {
    event.preventDefault();
    actionsComponent = el('filter-component').value.trim();
    loadActions({ reset: true });
  });
  el('clear-filters').addEventListener('click', () => {
    el('filter-component').value = '';
    actionsComponent = '';
    loadActions({ reset: true });
  });
  el('load-more').addEventListener('click', () => loadActions());
  el('copy-detail').addEventListener('click', copyDetail);
  el('download-tombstone').addEventListener('click', downloadTombstone);

  document.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-action-id]');
    if (row) openDetail(row.dataset.actionId);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('tr[data-action-id]');
    if (row) {
      event.preventDefault();
      openDetail(row.dataset.actionId);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!stream || stream.readyState === 2)) {
      connect();
    }
  });
}

async function bootstrap() {
  wire();
  refreshExportLinks();
  try {
    const first = await fetchJson('/api/snapshot');
    lastSeq = Number(first.seq ?? 0);
    applySnapshot(first);
  } catch (error) {
    setConnection('offline', error.status === 401 ? 'não autorizado' : 'sem resposta');
  }
  connect();
}

bootstrap();
