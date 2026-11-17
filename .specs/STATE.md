# Project state

## Decisions

| ID | Decision | Rationale | Status | Date |
| --- | --- | --- | --- | --- |
| AD-003 | O modo de inferência do `.env` (ou do `{ mode }` do arranque) é um **teto**; o tier só o rebaixa: com teto `paid`, só VERDE usa a fila paga — AMARELO e abaixo usam a fila free (`INFERENCE_MODE_DOWNGRADED` / `INFERENCE_MODE_RESTORED`); teto `free` nunca sobe. Com teto `paid`, a fila free é montada e pingada no arranque só como aviso (`INFERENCE_FREE_PREFLIGHT_OK` / `_FAILED`), nunca bloqueia | Artigo III (degradação de modelo por tier) sem um terceiro nível de modelo: o rótulo `economic` passa a valer "custo zero"; LARANJA já não chama LLM e fica como está; sem histerese — a troca acontece no limite de $50 do `evaluateTier` | active | 2026-11-12 |
| AD-002 | O agente só arranca com LLM: preflight bloqueante por modo (`NoLLMAvailable`, saída 78, `500 AgentStartFailed`); fila free/paga montada pelas chaves do `.env` (fecha Unresolved 1); despesa paga = tokens reportados × preços do `.env`; `POST /api/agent/start` aceita `{ mode }` para um arranque | decisão do autor na revisão do diff de preflight; substitui "nunca paragem" no arranque — a queda para o determinístico continua a valer tick a tick depois de arrancar | active | 2026-11-12 |
| AD-001 | Observabilidade é processo separado e somente leitura no SQLite: o painel abre o SQLite com `readOnly: true`, expõe rotas `GET` de leitura e (emendado por AD-002) controla o ciclo de vida do processo via `POST /api/agent/start` e `POST /api/agent/stop` por arquivos de sinalização/PID | evita escrita direta no banco pelo painel e mantém o estado financeiro isolado; status ao vivo é derivado de `actions` e controle de PID | active (amended by AD-002) | 2026-11-08 |

## Handoff

**Feature**: mission-control
**Where**: C52 - verificação independente PASS, 52/52 checks com evidência localizada, profile `light`, gate `validate_verification.py` exit 0
**In progress**: nada; feature e verificação encerradas
**Next step**: operar com `npm run dashboard` (127.0.0.1:7070) enquanto `npm start` roda o agente
**Blockers**: none
**Uncommitted**: alterações pré-existentes em `.gitignore` e nos scripts de `package.json` (`setup:testnet`, `wallet:status`), não tocadas por esta feature
**Branch**: master
