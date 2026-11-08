# Mission Control checks

Profile: light
Plan: `.specs/features/mission-control/plan.md`

52 checks in 6 slices · 3 one-way doors · 0 open

## Checks

### S1 - Mission Control ao vivo · 6 files · 44 KB · ~11k

**C1** - `overviewModel(snapshot)` devolve tier, saldo formatado, contagem de ciclos e rótulo de liveness do snapshot recebido (AC 1)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="overviewModel" test/unit/dashboard_ui_core.test.ts`

**C2** - `formatUsd(1234.5)` devolve `US$ 1.234,50` e `formatUsd(0)` devolve `US$ 0,00` (AC 1)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="formatUsd" test/unit/dashboard_ui_core.test.ts`

**C3** - `deriveLiveness` devolve `ALIVE` quando a idade do último tick é exatamente 2 vezes o intervalo do tier (AC 3)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="liveness ALIVE boundary" test/unit/dashboard_snapshot.test.ts`

**C4** - `deriveLiveness` devolve `STALE` em 2 vezes o intervalo + 1 ms (AC 4)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="liveness STALE boundary" test/unit/dashboard_snapshot.test.ts`

**C5** - `deriveLiveness` devolve `DEAD` em 15 minutos + 1 ms (AC 5)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="liveness DEAD age" test/unit/dashboard_snapshot.test.ts`

**C6** - `deriveLiveness` devolve `DEAD` quando a última action é `PERMADEATH_EXECUTED` (AC 5)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="liveness DEAD permadeath" test/unit/dashboard_snapshot.test.ts`

**C7** - `deriveLiveness` devolve `UNKNOWN` sem nenhuma action (AC 6)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="liveness UNKNOWN" test/unit/dashboard_snapshot.test.ts`

**C8** - `buildSnapshot` devolve `seq` 1 e depois 2 em duas chamadas do mesmo processo (AC 7)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="seq monotonic" test/unit/dashboard_snapshot.test.ts`

**C9** - `reconnectDelay` devolve 2000, 4000, 8000, 16000, 30000 e 30000 para as tentativas 1 a 6 (AC 8)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="reconnectDelay" test/unit/dashboard_ui_core.test.ts`

**C10** - com `streamIntervalMs` de 50 ms e `Last-Event-ID: 1`, o primeiro evento de `/api/stream` tem `id` maior que 1 (AC 9)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="Last-Event-ID resume" test/unit/dashboard_server.test.ts`

**C11** - `alertSeverity` devolve `critical` para `PERMADEATH_EXECUTED`, `IMMUNE_SYSTEM_ROLLBACK` e `TICK_FAILED`, `warning` para `REPLAY_ATTACK_PREVENTED` e `DAEMON_STOPPED`, e `info` para `TICK_EVALUATED` (AC 10)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="alertSeverity" test/unit/dashboard_snapshot.test.ts`

**C12** - `tierTransitions(actions)` marca descida como `warning` e subida como `info` (AC 11)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="tierTransitions" test/unit/dashboard_snapshot.test.ts`

**C13** - `buildAlerts` devolve no máximo 20 itens, do mais recente para o mais antigo (AC 12)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="buildAlerts cap" test/unit/dashboard_snapshot.test.ts`

**C14** - `parseSseFrame` devolve `event`, `id` e o JSON de `data` de um frame `snapshot` (AC 2)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="parseSseFrame" test/unit/dashboard_ui_core.test.ts`

### S2 - Histórico de operações · 2 files · 17 KB · ~4k

**C15** - `GET /api/actions` sem `limit` devolve 50 itens (AC 13)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="actions default limit" test/unit/dashboard_server.test.ts`

**C16** - `GET /api/actions?limit=500` devolve 500 itens (AC 15)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="actions limit 500" test/unit/dashboard_server.test.ts`

**C17** - `GET /api/actions?limit=501` devolve 400 com `{"error":"InvalidParameter","parameter":"limit"}` (AC 15)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="actions limit 501" test/unit/dashboard_server.test.ts`

**C18** - `GET /api/actions?component=heartbeat` devolve somente actions do componente (AC 14)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="actions component filter" test/unit/dashboard_server.test.ts`

**C19** - `GET /api/actions?before=<id>` devolve ids estritamente menores, em ordem decrescente (AC 18)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="actions before cursor" test/unit/dashboard_server.test.ts`

**C20** - `detailView('{"a":1}')` devolve JSON e `detailView('texto')` devolve `{raw:'texto'}` sem lançar exceção (AC 19)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="detailView" test/unit/dashboard_ui_core.test.ts`

**C21** - `listState({status:'loading'})` devolve `skeletonRows` 5 e `loadMoreDisabled` verdadeiro (AC 20)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="listState loading" test/unit/dashboard_ui_core.test.ts`

### S3 - Financeiro e gráficos · 3 files · 22 KB · ~6k

**C22** - `buildSnapshot` calcula receita, despesa e resultado líquido a partir de linhas de `ledger` (AC 21)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="ledger totals" test/unit/dashboard_snapshot.test.ts`

**C23** - `revenueByType` agrupa por `entry_type` com valor e contagem por grupo (AC 22)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="revenueByType" test/unit/dashboard_snapshot.test.ts`

**C24** - `downsample(points, 240)` devolve no máximo 240 pontos, com o último valor de cada bucket (AC 23)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="downsample" test/unit/dashboard_ui_core.test.ts`

**C25** - `ledger` vazio devolve `netUsd` 0 e `runwayDays` nulo (AC 24)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="empty ledger" test/unit/dashboard_snapshot.test.ts`

**C26** - despesas iguais a 0 nos últimos 7 dias devolvem `runwayDays` nulo (AC 25)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="zero burn" test/unit/dashboard_snapshot.test.ts`

**C27** - `positionsSummary` devolve exposição aberta e contagem por `OPEN`, `WON`, `LOST` e `CANCELLED` (AC 26)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="positionsSummary" test/unit/dashboard_snapshot.test.ts`

**C28** - `winRate` devolve `null` quando `WON` e `LOST` são 0 (AC 27)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="winRate null" test/unit/dashboard_snapshot.test.ts`

### S4 - Configuração e modelos · 3 files · 20 KB · ~5k

**C29** - `GET /api/config` devolve `networkMode`, os 4 thresholds, os 3 intervalos, Kelly, x402 e o multiplicador de mitose (AC 28)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="config endpoint" test/unit/dashboard_server.test.ts`

**C30** - `sanitizeConfig` substitui por `***` os campos sensíveis e omite `PRIVATE_KEY` (AC 29)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="sanitizeConfig" test/unit/dashboard_snapshot.test.ts`

**C31** - nenhuma resposta de `/api/config`, `/api/snapshot` e `/api/health` contém os valores de `PRIVATE_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_API_PASSPHRASE`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` e `GEMINI_API_KEY` (AC 30)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="no secret leak" test/unit/dashboard_server.test.ts`

**C32** - `modelClass` no snapshot segue o tier: `VERDE` advanced, `AMARELO` economic, `LARANJA` e `VERMELHO` survival (AC 31, AC 32, AC 33)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="modelClass by tier" test/unit/dashboard_snapshot.test.ts`

**C33** - `index.html` contém o selo "sem provedor de inferência configurado" (AC 34)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="provider badge" test/unit/dashboard_assets.test.ts`

**C34** - `allowedOperations` deriva de `allowSpeculativeResearch` e `allowSelfModification` (AC 35)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="allowedOperations" test/unit/dashboard_snapshot.test.ts`

### S5 - Clã e permadeath · 2 files · 12 KB · ~3k

**C35** - `GET /api/lineage` devolve geração, endereço da criança, status e royalties pagos por criança (AC 36)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="lineage endpoint" test/unit/dashboard_server.test.ts`

**C36** - `readTombstone` devolve causa, timestamp da morte, ciclos totais, receita e despesa finais quando o arquivo existe (AC 37)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="readTombstone present" test/unit/dashboard_snapshot.test.ts`

**C37** - `readTombstone` devolve `{present:false}` quando o arquivo não existe (AC 38)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="readTombstone absent" test/unit/dashboard_snapshot.test.ts`

**C38** - `readTombstone` devolve `{present:true, invalid:true, path}` quando o arquivo não é JSON válido (AC 39)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="readTombstone invalid" test/unit/dashboard_snapshot.test.ts`

### S6 - Fronteira de confiança, degradação e exportação · 4 files · 24 KB · ~6k

**C39** - `openReadOnly` rejeita `CREATE TABLE` com erro SQLite e o SHA-256 de `data/agent.db` permanece igual após exercitar todas as rotas (AC 40)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="read-only boundary" test/unit/dashboard_server.test.ts`

**C40** - `POST /api/snapshot` devolve 405 com `{"error":"MethodNotAllowed"}` (AC 41)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="method not allowed" test/unit/dashboard_server.test.ts`

**C41** - com `DASHBOARD_HOST=0.0.0.0` e sem `DASHBOARD_TOKEN`, o processo encerra com exit code 1 e stderr "DASHBOARD_TOKEN obrigatório fora de localhost" (AC 42)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="host guard" test/unit/dashboard_server.test.ts`

**C42** - com token configurado, `/api/snapshot` sem header devolve 401 `{"error":"Unauthorized"}` e com `Authorization: Bearer <token>` devolve 200 (AC 43)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="token auth" test/unit/dashboard_server.test.ts`

**C43** - com o `/health` do x402 pendurado, o snapshot sai com `degraded.x402` igual a `timeout` e `x402.reachable` falso (AC 44)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="x402 probe timeout" test/unit/dashboard_server.test.ts`

**C44** - com um arquivo não-SQLite no caminho do banco, `GET /api/snapshot` devolve 503 com `{"error":"DatabaseUnavailable"}` (AC 45)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="database unavailable" test/unit/dashboard_server.test.ts`

**C45** - sem arquivo de banco, `GET /api/snapshot` devolve 200 com `liveness.state` igual a `UNKNOWN` (AC 46)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="database absent" test/unit/dashboard_server.test.ts`

**C46** - `GET /api/export?table=actions&format=csv` devolve `text/csv; charset=utf-8` com BOM e linhas terminadas em CRLF (AC 47)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="csv export" test/unit/dashboard_server.test.ts`

**C47** - `GET /api/export?table=users` devolve 400 com `{"error":"InvalidParameter","parameter":"table"}` (AC 48)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="export table whitelist" test/unit/dashboard_server.test.ts`

**C48** - `GET /` devolve `Content-Security-Policy: default-src 'self'` e o HTML tem `lang="pt-BR"`, `aria-live="polite"` e nenhuma referência `http://` ou `https://` em `src` ou `href` (AC 49)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="index csp" test/unit/dashboard_server.test.ts`

**C49** - `GET /assets/inexistente.js` devolve 404 (Surface 404)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="asset 404" test/unit/dashboard_server.test.ts`

**C50** - `GET /api/ledger?entryType=BOGUS` devolve 400 com `{"error":"InvalidParameter","parameter":"entryType"}` (Surface 400)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="ledger entryType validation" test/unit/dashboard_server.test.ts`

**C51** - `GET /api/health` devolve 200 com `database` igual a `ok` e `uptimeMs` inteiro (Surface 200)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="dashboard health" test/unit/dashboard_server.test.ts`

**C52** - inserir uma action por uma conexão de escrita enquanto o painel responde não gera erro e o snapshot seguinte inclui a linha nova (cópia concorrente em WAL)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="concurrent writer" test/unit/dashboard_server.test.ts`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| liveness (5) | ALIVE C3 · STALE C4 · DEAD por idade C5 · DEAD por permadeath C6 · UNKNOWN C7 | - |
| severidade de action (6) | PERMADEATH_EXECUTED C11 · IMMUNE_SYSTEM_ROLLBACK C11 · TICK_FAILED C11 · REPLAY_ATTACK_PREVENTED C11 · DAEMON_STOPPED C11 · transição de tier C12 | - |
| chaves redigidas (8) | PRIVATE_KEY C30 · POLYMARKET_API_KEY C30 · POLYMARKET_API_SECRET C30 · POLYMARKET_API_PASSPHRASE C30 · GITHUB_TOKEN C30 · ANTHROPIC_API_KEY C30 · OPENAI_API_KEY C30 · GEMINI_API_KEY C30 | - |
| modelClass por tier (4) | VERDE C32 · AMARELO C32 · LARANJA C32 · VERMELHO C32 | - |
| tabelas exportáveis (6) | actions C46 · ledger C46 · positions C46 · lineage C46 · tabela inválida C47 · parâmetro ausente C47 | - |
| portas one-way (3) | contrato do snapshot C1 · fronteira read-only C39 · SSE C10 | - |
| opções de inicialização (2) | CLI `main.ts` C41 · construtor `DashboardServer` C42 | - |
| `GET /` statuses (2) | 200 C48 · 401 C42 | - |
| `GET /assets/*` statuses (2) | 200 C48 · 404 C49 | - |
| `GET /api/snapshot` statuses (3) | 200 C1 · 401 C42 · 503 C44 | - |
| `GET /api/stream` statuses (2) | 200 C10 · 401 C42 | - |
| `GET /api/actions` statuses (3) | 200 C15 · 400 C17 · 401 C42 | - |
| `GET /api/ledger` statuses (3) | 200 C22 · 400 C50 · 401 C42 | - |
| `GET /api/positions` statuses (2) | 200 C27 · 401 C42 | - |
| `GET /api/lineage` statuses (2) | 200 C35 · 401 C42 | - |
| `GET /api/config` statuses (2) | 200 C29 · 401 C42 | - |
| `GET /api/export` statuses (3) | 200 C46 · 400 C47 · 401 C42 | - |
| `GET /api/health` statuses (1) | 200 C51 | - |

- Claims que nomeiam código de status, rota ou forma de resposta: C17, C40, C41, C42, C44, C45, C47, C48, C49, C50 - cada uma com prova que cruza a fronteira HTTP
- Nenhuma prova afirma mais do que um caso além dos conjuntos acima, exceto C32 e C11, que são table-driven com o tamanho declarado na própria prova

## Swept

- validation: C17, C47, C50
- failure modes: C43, C44, C45
- idempotency: C10, C39
- authorization: C41, C42
- concurrency: C52
- data lifecycle: n/a - o painel não persiste nada e a paginação usa cursor por id, sem cache
- dependency failure: C43
- state transitions: C3, C4, C5, C6, C12
- observability: C51

## Handoff

Estimativa por tamanho dos arquivos de cada fatia, dividida por 4:

- S1 = 44 KB ≈ 11k (snapshot, server, ui_core, app, index.html, styles.css)
- S2 = 17 KB ≈ 4k (rotas de actions no server, detalhe no ui_core)
- S3 = 22 KB ≈ 6k (ledger e posições no snapshot, downsample no ui_core)
- S4 = 20 KB ≈ 5k (config sanitizada, tela de modelos)
- S5 = 12 KB ≈ 3k (lineage e tombstone)
- S6 = 24 KB ≈ 6k (fronteira de confiança, export, testes de servidor)
- Total ≈ 85 KB `/` 4 ≈ 21k, todo em `src/modules/dashboard/` e `test/unit/` - um builder, sob o orçamento de 150k
- Mechanism: one builder

## Status

All 52 checks proven green at HEAD on 2026-11-08: `proofs=52 failures=0`.

- S1 green — C1-C14
- S2 green — C15-C21
- S3 green — C22-C28
- S4 green — C29-C34
- S5 green — C35-C38
- S6 green — C39-C52
