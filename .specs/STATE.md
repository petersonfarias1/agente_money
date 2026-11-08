# Project state

## Decisions

| ID | Decision | Rationale | Status | Date |
| --- | --- | --- | --- | --- |
| AD-001 | Observabilidade é processo separado e somente leitura: o painel abre o SQLite com `readOnly: true`, expõe apenas `GET` e nunca inicia, pausa ou controla o daemon | evita uma segunda instância do agente e mantém `src/core/*`, `src/config.ts`, `src/types.ts` e `src/index.ts` intocados; status ao vivo é derivado de `actions` | active | 2026-11-08 |

## Handoff

**Feature**: mission-control
**Where**: C52 - as 52 provas estão verdes (`proofs=52 failures=0`), o build de sintaxe passa e o painel foi exercitado contra `data/agent.db` com o SHA-256 inalterado
**In progress**: nada; builder encerrado, aguardando o Verifier independente
**Next step**: despachar um Verifier novo sobre a base da feature até `HEAD`, com todos os checks, e gravar `verification.md`
**Blockers**: none
**Uncommitted**: alterations pré-existentes em `.gitignore` e nos scripts de `package.json` (`setup:testnet`, `wallet:status`), não tocadas por esta feature
**Branch**: master
