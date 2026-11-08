# Project state

## Decisions

| ID | Decision | Rationale | Status | Date |
| --- | --- | --- | --- | --- |
| AD-001 | Observabilidade é processo separado e somente leitura: o painel abre o SQLite com `readOnly: true`, expõe apenas `GET` e nunca inicia, pausa ou controla o daemon | evita uma segunda instância do agente e mantém `src/core/*`, `src/config.ts`, `src/types.ts` e `src/index.ts` intocados; status ao vivo é derivado de `actions` | active | 2026-11-08 |

## Handoff

**Feature**: mission-control
**Where**: C52 - verificação independente PASS, 52/52 checks com evidência localizada, profile `light`, gate `validate_verification.py` exit 0
**In progress**: nada; feature e verificação encerradas
**Next step**: operar com `npm run dashboard` (127.0.0.1:7070) enquanto `npm start` roda o agente
**Blockers**: none
**Uncommitted**: alterações pré-existentes em `.gitignore` e nos scripts de `package.json` (`setup:testnet`, `wallet:status`), não tocadas por esta feature
**Branch**: master
