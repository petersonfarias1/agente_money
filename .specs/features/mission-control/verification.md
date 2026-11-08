# Mission Control verification

**Verdict**: PASS
**Profile**: light
**Diff range**: 9b61aa7..8fde343
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

Scope: every one of the 52 checks in `checks.md` was run by the verifier at `HEAD`
(`8fde343c5c07ef596fbd16d65e62e3a355110ec9`), read-only over the real tree. The four
`test/unit/dashboard_*.test.ts` files are new in the feature commits (`44d8645`, `82b1d99`), so
every proof resolves to a test the feature touched. One batch invocation selected all 52 check
tests (plus the extra asset-inventory test when unfiltered): 52/52 check tests passed, 0 failed,
exit 0. Each C-id appears individually in the output.

## Checks

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | `overviewModel` projects tier, formatted balance, cycle count and liveness label | pass - 52/52 batch; selector `overviewModel` | `test/unit/dashboard_ui_core.test.ts:34` - `assert.equal(view.balanceText, 'US$ 123,45')`; `:36` - `assert.equal(view.liveness, 'ALIVE')` (tier `:31`, cycles `:35`) | PASS |
| C2 | `formatUsd(1234.5)` -> `US$ 1.234,50`, `formatUsd(0)` -> `US$ 0,00` | pass - selector `formatUsd` | `test/unit/dashboard_ui_core.test.ts:41` - `assert.equal(formatUsd(1234.5), 'US$ 1.234,50')`; `:42` - `assert.equal(formatUsd(0), 'US$ 0,00')` | PASS |
| C3 | 2x tier interval is still `ALIVE` | pass - selector `liveness ALIVE boundary` | `test/unit/dashboard_snapshot.test.ts:100` - `assert.equal(liveness.state, 'ALIVE')` with `lastTickAt: NOW - 2 * 60000` | PASS |
| C4 | 2x interval + 1 ms is `STALE` | pass - selector `liveness STALE boundary` | `test/unit/dashboard_snapshot.test.ts:110` - `assert.equal(liveness.state, 'STALE')`; `:111` - `assert.match(liveness.detail, /sem tick há 2 min/)` | PASS |
| C5 | 15 min + 1 ms is `DEAD` | pass - selector `liveness DEAD age` | `test/unit/dashboard_snapshot.test.ts:121` - `assert.equal(liveness.state, 'DEAD')` with age `15 * 60 * 1000 + 1` | PASS |
| C6 | last action `PERMADEATH_EXECUTED` is `DEAD` | pass - selector `liveness DEAD permadeath` | `test/unit/dashboard_snapshot.test.ts:131` - `assert.equal(liveness.state, 'DEAD')`; `:132` - `assert.equal(liveness.detail, 'permadeath executado')` | PASS |
| C7 | no actions is `UNKNOWN` | pass - selector `liveness UNKNOWN` | `test/unit/dashboard_snapshot.test.ts:142` - `assert.equal(liveness.state, 'UNKNOWN')` with `lastTickAt: null` | PASS |
| C8 | two builds in one process return seq 1 then 2 | pass - selector `seq monotonic` | `test/unit/dashboard_snapshot.test.ts:159` - `assert.equal(first.seq, 1)`; `:160` - `assert.equal(second.seq, 2)` | PASS |
| C9 | reconnect delays 2000/4000/8000/16000/30000/30000 | pass - selector `reconnectDelay` | `test/unit/dashboard_ui_core.test.ts:48` - `assert.deepEqual(delays, [2000, 4000, 8000, 16000, 30000, 30000])` | PASS |
| C10 | `Last-Event-ID: 1` yields a first SSE `id` greater than 1 | pass - selector `Last-Event-ID resume` | `test/unit/dashboard_server.test.ts:152` - `assert.ok(match, ...)`; `:153` - `assert.ok(Number(match[1]) > 1)` | PASS |
| C11 | severity mapping critical/warning/info for the six named types | pass - selector `alertSeverity` | `test/unit/dashboard_snapshot.test.ts:166-171` - six `assert.equal(alertSeverity('...'), 'critical'/'warning'/'info')` | PASS |
| C12 | downgrade is `warning`, upgrade is `info` | pass - selector `tierTransitions` | `test/unit/dashboard_snapshot.test.ts:185` - `assert.equal(transitions[0].severity, 'warning')`; `:187` - `assert.equal(transitions[1].severity, 'info')` | PASS |
| C13 | at most 20 alerts, newest first | pass - selector `buildAlerts cap` | `test/unit/dashboard_snapshot.test.ts:200` - `assert.equal(alerts.length, 20)`; `:201` - `assert.equal(alerts[0].id, 1)`; `:203` - non-increasing timestamp loop | PASS |
| C14 | `parseSseFrame` yields event, id and parsed `data` JSON | pass - selector `parseSseFrame` | `test/unit/dashboard_ui_core.test.ts:55` - `assert.equal(parsed.event, 'snapshot')`; `:57` - `assert.equal(parsed.data.seq, 42)` | PASS |
| C15 | `/api/actions` default is 50 items | pass - selector `actions default limit` | `test/unit/dashboard_server.test.ts:169` - `assert.equal(body.items.length, 50)`; `:170` - `nextBefore === items[49].id` | PASS |
| C16 | `limit=500` returns 500 items | pass - selector `actions limit 500` | `test/unit/dashboard_server.test.ts:184` - `assert.equal(body.items.length, 500)` over 520 seeded rows | PASS |
| C17 | `limit=501` is 400 `InvalidParameter limit` | pass - selector `actions limit 501` | `test/unit/dashboard_server.test.ts:197` - `assert.equal(status, 400)`; `:198` - `assert.deepEqual(body, { error: 'InvalidParameter', parameter: 'limit' })` | PASS |
| C18 | `component=heartbeat` returns only that component | pass - selector `actions component filter` | `test/unit/dashboard_server.test.ts:215` - `assert.equal(body.items.length, 10)`; `:216` - `assert.ok(body.items.every(item => item.component === 'heartbeat'))` | PASS |
| C19 | `before=<id>` returns strictly lower ids, descending | pass - selector `actions before cursor` | `test/unit/dashboard_server.test.ts:230-233` - `assert.deepEqual(body.items.map(i => i.id), [5, 4, 3, 2, 1])` for `before=6` | PASS |
| C20 | `detailView` parses JSON, falls back to `{raw}` | pass - selector `detailView` | `test/unit/dashboard_ui_core.test.ts:62` - `assert.deepEqual(detailView('{"a":1}'), { a: 1 })`; `:63` - `assert.deepEqual(detailView('texto'), { raw: 'texto' })` | PASS |
| C21 | loading state: 5 skeleton rows, load-more disabled | pass - selector `listState loading` | `test/unit/dashboard_ui_core.test.ts:68` - `assert.equal(state.skeletonRows, 5)`; `:69` - `assert.equal(state.loadMoreDisabled, true)` | PASS |
| C22 | snapshot computes revenue, expense and net from `ledger` | pass - selector `ledger totals` | `test/unit/dashboard_snapshot.test.ts:247-249` - `revenue.totalUsd 15`, `expenseUsd 3`, `netUsd 12` | PASS |
| C23 | `revenueByType` groups by entry type with value and count | pass - selector `revenueByType` | `test/unit/dashboard_snapshot.test.ts:262-265` - `x402.amountUsd 5`, `x402.count 2`, `bounty.amountUsd 7`, `bounty.count 1` | PASS |
| C24 | `downsample(points, 240)` keeps <=240 points and bucket-last values | pass - selector `downsample` | `test/unit/dashboard_ui_core.test.ts:76` - `assert.ok(capped.length <= 240)`; `:77` - last value `999`; `:78` - first bucket's last value | PASS |
| C25 | empty ledger -> `netUsd 0`, `runwayDays null` | pass - selector `empty ledger` | `test/unit/dashboard_snapshot.test.ts:281` - `assert.equal(revenue.netUsd, 0)`; `:282` - `assert.equal(revenue.runwayDays, null)` | PASS |
| C26 | zero 7-day expenses -> `runwayDays null` | pass - selector `zero burn` | `test/unit/dashboard_snapshot.test.ts:307` - `assert.equal(revenue.burn7dUsd, 0)`; `:308` - `assert.equal(revenue.runwayDays, null)` | PASS |
| C27 | `positionsSummary` open exposure and counts per status | pass - selector `positionsSummary` | `test/unit/dashboard_snapshot.test.ts:320` - `assert.equal(summary.openExposureUsd, 15)`; `:321` - `assert.deepEqual(summary.counts, { OPEN: 2, WON: 1, LOST: 1, CANCELLED: 1 })` | PASS |
| C28 | `winRate(0,0)` is null | pass - selector `winRate null` | `test/unit/dashboard_snapshot.test.ts:326` - `assert.equal(winRate(0, 0), null)`; `:327` - `assert.equal(winRate(3, 1), 0.75)` | PASS |
| C29 | `/api/config` returns network mode, thresholds, intervals, Kelly, x402, mitosis | pass - selector `config endpoint` | `test/unit/dashboard_server.test.ts:250-263` - `body.networkMode 'mock'`, four thresholds, three intervals, `kelly.fraction 0.25`, `x402.port 4020`, `evolution.mitosisMultiplier 3` | PASS |
| C30 | `sanitizeConfig` redacts sensitive fields to `***`, omits `PRIVATE_KEY` | pass - selector `sanitizeConfig` | `test/unit/dashboard_snapshot.test.ts:335` - `assert.equal('privateKey' in sanitized, false)`; `:336-339` - `apiSecret`, `apiPassphrase`, `apiKey`, `githubToken` all `'***'` | PASS |
| C31 | `/api/config`, `/api/snapshot`, `/api/health` carry none of the named secret values | pass - selector `no secret leak` | `test/unit/dashboard_server.test.ts:276-282` - secret values injected; `:289-293` - `assert.equal(body.includes(secret), false, ...)` for each value x each body | PASS |
| C32 | `modelClass` follows tier: advanced/economic/survival | pass - selector `modelClass by tier` | `test/unit/dashboard_snapshot.test.ts:365` - `assert.equal(tier.tier, expected.tier)`; `:366` - `assert.equal(tier.modelClass, expected.modelClass)` over all four tiers | PASS |
| C33 | `index.html` contains the provider badge | pass - selector `provider badge` | `test/unit/dashboard_assets.test.ts:18` - `assert.match(html, /sem provedor de inferência configurado/)` | PASS |
| C34 | `allowedOperations` derives from the two allow-flags | pass - selector `allowedOperations` | `test/unit/dashboard_snapshot.test.ts:380-384` - full includes both, survival excludes both and includes `operações de sobrevivência` | PASS |
| C35 | `/api/lineage` returns generation, child address, status, royalties per child | pass - selector `lineage endpoint` | `test/unit/dashboard_server.test.ts:321-326` - `children.length 1`, `generation 2`, `childAddress`, `status 'ACTIVE'`, `totalRoyaltiesPaidUsd 1.5`, `royaltiesPaidUsd 1.5` | PASS |
| C36 | `readTombstone` returns cause, death time, cycles, revenue and expenses when present | pass - selector `readTombstone present` | `test/unit/dashboard_snapshot.test.ts:392-398` - `present true`, `invalid undefined`, `typeof reason/deathTimestamp === 'string'`, cycle/revenue/expense totals `number` | PASS |
| C37 | `readTombstone` absent -> `{present:false}` | pass - selector `readTombstone absent` | `test/unit/dashboard_snapshot.test.ts:404` - `assert.deepEqual(readTombstone(path.join(dir, 'nope.json')), { present: false })` | PASS |
| C38 | invalid JSON -> `{present:true, invalid:true, path}` | pass - selector `readTombstone invalid` | `test/unit/dashboard_snapshot.test.ts:413-417` - `assert.deepEqual(..., { present: true, invalid: true, path: filePath })` | PASS |
| C39 | read-only handle rejects `CREATE TABLE`; db hash unchanged after route sweep | pass - selector `read-only boundary` | `test/unit/dashboard_server.test.ts:347` - `assert.throws(() => probe.exec('CREATE TABLE ...'))`; `:377` - `assert.equal(hash(), before)` after all swept routes | PASS |
| C40 | `POST /api/snapshot` is 405 `MethodNotAllowed` | pass - selector `method not allowed` | `test/unit/dashboard_server.test.ts:390` - `assert.equal(response.status, 405)`; `:391` - `assert.deepEqual(await response.json(), { error: 'MethodNotAllowed' })` | PASS |
| C41 | non-local host without token exits 1 with the required stderr | pass - selector `host guard` | `test/unit/dashboard_server.test.ts:415` - `assert.equal(result.status, 1)`; `:416` - `assert.match(result.stderr, /DASHBOARD_TOKEN obrigatório fora de localhost/)` | PASS |
| C42 | token configured: 401 without, 200 with bearer | pass - selector `token auth` | `test/unit/dashboard_server.test.ts:431` - `assert.equal(unauthorized.status, 401)`; `:432` - `{ error: 'Unauthorized' }`; `:437` - `assert.equal(authorized.status, 200)` | PASS |
| C43 | hung x402 health -> `degraded.x402 'timeout'`, `reachable false` | pass - selector `x402 probe timeout` | `test/unit/dashboard_server.test.ts:466` - `assert.equal(body.x402.reachable, false)`; `:467` - `assert.equal(body.degraded.x402, 'timeout')` | PASS |
| C44 | non-SQLite file -> 503 `DatabaseUnavailable` | pass - selector `database unavailable` | `test/unit/dashboard_server.test.ts:485` - `assert.equal(status, 503)`; `:486` - `assert.deepEqual(body, { error: 'DatabaseUnavailable' })` | PASS |
| C45 | absent DB -> 200 with `liveness.state UNKNOWN` | pass - selector `database absent` (also selected by `liveness UNKNOWN`) | `test/unit/dashboard_server.test.ts:502` - `assert.equal(status, 200)`; `:503` - `assert.equal(body.liveness.state, 'UNKNOWN')`; `:504-506` - zeroed cycles/actions/net | PASS |
| C46 | CSV export: `text/csv; charset=utf-8`, BOM, CRLF | pass - selector `csv export` | `test/unit/dashboard_server.test.ts:525` - exact content-type; `:526` - first bytes `[0xef, 0xbb, 0xbf]`; `:527-529` - split on `\r\n`, header and >=4 lines | PASS |
| C47 | export table outside whitelist -> 400 `InvalidParameter table` | pass - selector `export table whitelist` | `test/unit/dashboard_server.test.ts:542` - `assert.equal(status, 400)`; `:543` - `assert.deepEqual(body, { error: 'InvalidParameter', parameter: 'table' })` | PASS |
| C48 | `/` has CSP self-only, `lang="pt-BR"`, `aria-live="polite"`, no external refs | pass - selector `index csp` | `test/unit/dashboard_server.test.ts:561-563` - CSP header equals `default-src 'self'`; `:565-567` - lang, aria-live, no `src`/`href` http(s) | PASS |
| C49 | missing asset -> 404 | pass - selector `asset 404` | `test/unit/dashboard_server.test.ts:580` - `assert.equal(response.status, 404)` | PASS |
| C50 | `entryType=BOGUS` -> 400 `InvalidParameter entryType` | pass - selector `ledger entryType validation` | `test/unit/dashboard_server.test.ts:596` - `assert.equal(status, 400)`; `:597` - `assert.deepEqual(body, { error: 'InvalidParameter', parameter: 'entryType' })` | PASS |
| C51 | `/api/health` 200, `database ok`, integer `uptimeMs` | pass - selector `dashboard health` | `test/unit/dashboard_server.test.ts:610` - `assert.equal(status, 200)`; `:611` - `assert.equal(body.database, 'ok')`; `:612` - `assert.equal(Number.isInteger(body.uptimeMs), true)` | PASS |
| C52 | a writer connection's insert appears in the next snapshot without error | pass - selector `concurrent writer` | `test/unit/dashboard_server.test.ts:626` - first snapshot 200; `:628-634` - separate `DatabaseSync` insert of `CONCURRENT_WRITER`; `:638` - `assert.equal(second.body.activity.recentActions[0].actionType, 'CONCURRENT_WRITER')` | PASS |

## Contracts

| Contract | Evidence | Status |
| --- | --- | --- |
| Snapshot top-level keys are exactly the 17 in `Landing` | `src/modules/dashboard/snapshot.ts:697-769` returns exactly `generatedAt, seq, networkMode, agent, liveness, tier, balance, kpi, revenue, activity, alerts, positions, lineage, x402, config, degraded, tombstone`; runtime `Object.keys` probe printed the same 17 in that order, `count=17` | PASS |
| No route handler outside GET | `src/modules/dashboard/server.ts:210-213` rejects every non-GET with 405 before routing; `route()` (`:256-277`) contains only reads; C40 proves the POST path | PASS |
| SQLite opened only with `{ readOnly: true }` | `src/modules/dashboard/snapshot.ts:113` - `new DatabaseSync(dbPath, { readOnly: true })` is the only `new DatabaseSync` under `src/modules/dashboard` (grep); `server.ts` and `main.ts` never import `DatabaseService` | PASS |
| No edit to `src/core/*`, `src/config.ts`, `src/types.ts`, `src/index.ts` | `git diff 9b61aa7..HEAD -- src/core src/config.ts src/types.ts src/index.ts` is empty | PASS |
| Only pre-existing file changed is `package.json`, one script line | `git diff 9b61aa7..HEAD -- package.json` adds exactly `"dashboard": "node ... src/modules/dashboard/main.ts"` | PASS |
| `Surface` has 11 routes and every enumerated status is reachable | `src/modules/dashboard/server.ts:220-273`: `/`, `/assets/*`, `/api/stream`, `/api/snapshot`, `/api/actions`, `/api/ledger`, `/api/positions`, `/api/lineage`, `/api/config`, `/api/export`, `/api/health`; runtime probe returned `/ 200`, assets `200/404`, snapshot `200/503`, actions `200/400`, ledger `200/400`, positions `200`, lineage `200`, config `200`, export `200/400`, health `200`, and every `/api/*`, `/`, `/api/stream` returned 401 without a token | PASS |

## Swept

- validation: C17 (`server.ts:282-284`), C47 (`server.ts:498-503`), C50 (`server.ts:332-334`) - each rejects with the exact `{error, parameter}` body asserted.
- failure modes: C43 (`snapshot.ts:513-518` timeout reason), C44 (`snapshot.ts:601-605` -> `server.ts:238-243`), C45 (`snapshot.ts:554` absent-file guard) - present.
- idempotency: C10 (`server.ts:575-580` advances `seq` past the cursor), C39 (`snapshot.ts:112-114` engine-level read-only) - present.
- authorization: C41 (`main.ts:17-20`), C42 (`server.ts:215-218`, `:248-253`) - present.
- concurrency: C52 - per-request read handle (`server.ts:298-327`) sees a WAL commit from another connection.
- dependency failure: C43 - x402 probe failure degrades only `x402`/`degraded`, snapshot still 200.
- state transitions: C3-C6 (`snapshot.ts:130-181`), C12 (`snapshot.ts:219-236`) - thresholds and severity branches present.
- observability: C51 (`server.ts:533-555`) - `database`/`uptimeMs`/`seq`/`version` present.
- data lifecycle: `n/a` - approved policy (dashboard persists nothing), so no code to re-read.

## Profile-scoped steps

Coverage, Test policy rows and Faults injected were not run because the approved profile is `light`; step 1 (binding-source comparison) is `ui`-only and was not owed, though the cited sources were read for the contract review above.

## Precision and robustness notes

1. C10 asserts only `first id > 1` (`test/unit/dashboard_server.test.ts:153`) while plan AC 9 requires resuming at cursor+1 (43 from 42). The implementation does produce cursor+1 (`server.ts:578-580`), but the assertion would also accept any larger id. Precision gap in the check, not a failing check.
2. C39 exercises a temporary copy, not `data/agent.db`, and its route sweep omits `/api/stream`. The read-only mechanism and hash invariance are proven; the literal "data/agent.db / all routes" wording overstates the fixture.
3. C31 injects 5 of the 7 named secret values. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GEMINI_API_KEY` are not fields of `AppConfig` (`src/types.ts:65-112`) and are referenced nowhere in `src` (grep: 0 matches), so those values cannot reach a config-derived response; the redaction regex covers those names by construction (`src/modules/dashboard/snapshot.ts:334,343`). The proof does not exercise those three names.
4. C36 reads the operator's repo-root `tombstone.json` (`test/unit/dashboard_snapshot.test.ts:390`) instead of a temporary fixture; that file is gitignored/untracked, so the proof is green at this HEAD but would fail on a clean checkout without it.
5. C52 inserts between two requests rather than during an in-flight response; the asserted behaviour (no error, next snapshot sees the row) matches the check's observable claim, but it is not a true overlap test.
6. Two statuses are reachable beyond the approved `Surface` set: `/api/positions?status=BOGUS` -> 400 (`server.ts:421-423`) and `/api/export` with an absent DB -> 503 (`server.ts:505-507`). Every status enumerated in `checks.md` Coverage is reachable and proven.
7. Working tree carries uncommitted changes outside `9b61aa7..HEAD` (`.gitignore`, extra `setup:testnet`/`wallet:status` scripts in `package.json`, untracked `.codex/` and `scripts/*`). They are not part of the feature diff and did not affect the proofs; only `package.json`'s committed `dashboard` line belongs to this feature.

## Gate

```powershell
node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="overviewModel|formatUsd|liveness ALIVE boundary|liveness STALE boundary|liveness DEAD age|liveness DEAD permadeath|liveness UNKNOWN|seq monotonic|reconnectDelay|Last-Event-ID resume|alertSeverity|tierTransitions|buildAlerts cap|parseSseFrame|actions default limit|actions limit 500|actions limit 501|actions component filter|actions before cursor|detailView|listState loading|ledger totals|revenueByType|downsample|empty ledger|zero burn|positionsSummary|winRate null|config endpoint|sanitizeConfig|no secret leak|modelClass by tier|provider badge|allowedOperations|lineage endpoint|readTombstone present|readTombstone absent|readTombstone invalid|read-only boundary|method not allowed|host guard|token auth|x402 probe timeout|database unavailable|database absent|csv export|export table whitelist|index csp|asset 404|ledger entryType validation|dashboard health|concurrent writer" test/unit/dashboard_assets.test.ts test/unit/dashboard_server.test.ts test/unit/dashboard_snapshot.test.ts test/unit/dashboard_ui_core.test.ts
```

Result: exit 0 - `tests 52`, `pass 52`, `fail 0`; selector resolution check found 52 patterns and all of C1..C52 present individually. The unfiltered run of the same four files is exit 0 - `tests 53`, `pass 53`, `fail 0` (the 53rd is the asset-inventory test, outside the 52 checks).

`python "C:\Users\peter\.config\opencode\skills\tlc-spec-lean\scripts\validate_verification.py" mission-control --root .`

Result: exit 0 - `validate_verification: 0 error(s), 0 warning(s) across [mission-control]`.
