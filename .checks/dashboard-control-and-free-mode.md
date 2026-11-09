# Controle do agente, despacho dos motores e inferência free/pago

profile: light · handoff: on (sem declaração de perfil no projeto)

Sources:

- `.tasks/dashboard-control-and-free-mode.md` — os 53 critérios, as suas invariantes e as duas questões em `Unresolved`; nada em `Unresolved` se resolve durante a construção.
- `.design/dashboard-control-and-free-mode.md` — **vinculativo para a interface**: tabelas de estado da tela de controlo, contratos `POST /api/agent/start|stop`, semântica do `405` com `Allow`, e as decisões-chave 1–8.
- `.specs/STATE.md` — AD-001, o registo a atualizar na mesma entrada das rotas.
- Código existente — as convenções que os checks reutilizam: `DashboardServer.handle` (gate de método → `authorized()` → `route`), `deriveLiveness`, `sanitizeConfig`, `registerTeardownHook`, `executeMitosisLifecycleTick`, `validateModification`, o padrão `Invalid <VAR>` de `config.ts` e os títulos `Tn-Fnn-nn:` dos testes.

## Out of scope

- Expor o painel fora de `127.0.0.1` — retirado pelo autor; `DASHBOARD_TOKEN` continua opcional.
- Reinício automático do agente — o painel só inicia e para.
- Trocar de modo sem reiniciar o agente.
- Exploração agendada de código e vigilância contínua da árvore — gatilho reativo apenas; rollback destrutivo nunca corre sobre trabalho alheio.
- Escolher e verificar provedores free — `Unresolved 1` (bloqueia ativação); fila vazia por omissão.
- Provar que uma proposta de modelo passa o portão em produção — `Unresolved 2` (bloqueia ativação); a prova aqui é o ciclo com provedor de teste.
- Escrever fora do escopo constitucional, alterar tiers ou artigos da Constituição.
- Mudar o esquema SQLite — nada a migrar.
- Deixar o modelo autorizar operações — inferência é consultiva (key decision 5).

## Landing

Toca `src/modules/dashboard/*` (rotas de controlo, estado em ficheiro de processo, snapshot/SSE, SPA), `src/index.ts` (despacho do tick, arranque do paywall, paragem cooperativa), `src/config.ts` + `src/types.ts` (modo e teto), um módulo novo de inferência (fila de provedores, teto, degraus) e o gatilho reativo em `src/evolution/immune_system.ts`. Reutiliza em vez de duplicar: `registerTeardownHook` para o desligamento, `openReadOnly`/`buildSnapshot` para o painel, `executeMitosisLifecycleTick` e `validateModification` como pontos de entrada dos motores, `sanitizeConfig` para a máscara e o padrão de validação de `config.ts` para os valores novos.

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| Controle fora do SQLite | ficheiro de processo na raiz com pid + reserva atómica; `POST /api/agent/start` e `POST /api/agent/stop` `{}` | estado no SQLite — quebraria a prova C39 de que o painel não escreve no banco |
| Paragem nunca à força | `stopping` gravado de imediato; rota bloqueia até o processo sair; kill proibido em qualquer estado | sinal/força — no Windows `SIGTERM` é kill à força e cortaria o tick a meio |
| Exceção `POST` ao `405` | `Allow: GET` nas rotas existentes, `Allow: GET, POST` nas de controlo; auth antes do encaminhamento | abrir todos os métodos — perderia o contrato `405` provado nos testes de fronteira |
| Modo e teto na arranque | `INFERENCE_MODE=free\|paid`, `INFERENCE_CAP_PER_TICK=5`, fila ordenada, determinístico sempre como último degrau | modo persistido no SQLite — exigiria caminho de escrita num painel que não escreve |
| Gatilho reativo | proposta só sobre ação de falha nova na trilha, uma por falha distinta, nenhuma enquanto se repetir sem tick bom | exploração agendada — pagaria build + 612 testes por tick sem nada a reparar |
| Pré-condição do portão | prova de sujeira só-da-proposta **antes** de `validateModification`; portão nunca corre com sujeira alheia | correr o portão sempre — `reset --hard` + `clean -fd` levaria trabalho não commitado |
| Hooks também no stop | hooks registados correm na paragem graciosa, como já correm em `executePermadeath` | desligar só no permadeath — o paywall ficaria no ar depois de um stop normal |

- Nothing else in this change is hard to reverse.

## Checks

### S1 - Controle do Agente · 12 files · 183 KB · ~46k

**C1** - Com o agente nunca iniciado e sem `tombstone.json`, a tela mostra `stopped` com start habilitado
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="initial snapshot shows stopped with start enabled" test/unit/dashboard_ui_core.test.ts`

**C2** - `start` cria o processo destacado, grava o pid na reserva e responde `200 { state: "running" }` depois de o processo confirmar
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="start spawns detached agent and reserves pid returning running" test/unit/agent_control.test.ts`

**C3** - Até o processo confirmar, o estado no snapshot é `starting` e a tela mostra `starting`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="control state stays starting until the child confirms" test/unit/agent_control.test.ts`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="screen renders starting while the child has not confirmed" test/unit/dashboard_ui_core.test.ts`

**C4** - `start` com reserva apontando a processo vivo devolve `409 { error: "AlreadyRunning" }` e não cria processo
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="start with live pid returns 409 AlreadyRunning" test/unit/agent_control.test.ts`

**C5** - `start` com `tombstone.json` presente devolve `409 { error: "Permadeath" }` e não cria nada
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="start with tombstone returns 409 Permadeath" test/unit/agent_control.test.ts`

**C6** - Dois `start` simultâneos: exatamente um cria processo, o outro vê `409 AlreadyRunning`, sem órfão
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="two concurrent starts create exactly one process" test/unit/agent_control.test.ts`

**C7** - `stop` com agente a correr grava `stopping` de imediato e a rota bloqueia até o processo sair, respondendo `200 { state: "stopped" }`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="stop while running records stopping immediately and returns stopped after exit" test/unit/agent_control.test.ts`

**C8** - Com tick em curso, o processo só sai depois de o tick terminar por completo — o último registo do tick entra na trilha antes da saída
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="stop waits for the in-flight tick to finish" test/unit/agent_control.test.ts`

**C9** - Agente que não responde: a rota continua a esperar, `stopping` persiste e nenhum kill é enviado
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="stop never kills an unresponsive agent" test/unit/agent_control.test.ts`

**C10** - `stop` com agente já parado devolve `200 { state: "stopped" }` sem novo efeito
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="stop when already stopped returns 200 stopped with no effect" test/unit/agent_control.test.ts`

**C11** - `stop` durante `starting` é aceite e responde `200 { state: "stopped" }` quando o processo resultante termina ou o spawn falha
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="stop during starting settles when the process settles" test/unit/agent_control.test.ts`

**C12** - Processo que termina sozinho leva o estado a `stopped` no snapshot sem intervenção do painel
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="control state returns to stopped when the child exits alone" test/unit/agent_control.test.ts`

**C13** - Painel reiniciado com agente vivo readoí o pid e mostra `running`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="dashboard restart adopts a live pid as running" test/unit/agent_control.test.ts`

**C14** - Spawn que falha leva o estado a `stopped` com o motivo registado na trilha
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="failed spawn returns stopped with reason in the trail" test/unit/agent_control.test.ts`

**C15** - Ficheiro de processo ilegível → `unknown`; leitura seguinte sem processo vivo → `stopped`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="unreadable process file shows unknown then stopped" test/unit/agent_control.test.ts`

**C16** - Método não-`GET` fora das rotas de controlo → `405 { error: "MethodNotAllowed" }` com `Allow: GET`; nas rotas de controlo `POST` é aceite e os outros métodos dão `405` com `Allow: GET, POST`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="405 contract with Allow header per route" test/unit/dashboard_server.test.ts`

**C17** - O estado de controlo entra no snapshot existente e o SSE o entrega sem rota de leitura nova
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="snapshot carries control state" test/unit/dashboard_snapshot.test.ts`

### S2 - Servidor x402 · 5 files · 55 KB · ~14k

**C18** - Arranque com a porta livre: o paywall sobe dentro do processo e `GET /health` responde
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="dispatch starts x402 and health responds" test/unit/tick_dispatch.test.ts`

**C19** - Porta ocupada: o agente continua sem paywall, `/health` não responde e o motivo fica registado na trilha
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="occupied x402 port leaves agent running and records reason" test/unit/tick_dispatch.test.ts`

**C20** - Stop e permadeath correm os hooks de desligamento; quando o processo sai, `/health` não responde
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="graceful stop runs teardown hooks and health stops responding" test/unit/tick_dispatch.test.ts`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="Permadeath automatic server teardown" test/e2e/tier2_boundaries.test.ts`

**C21** - Nos tiers AMARELO e LARANJA o paywall continua no ar
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="x402 starts in tiers AMARELO and LARANJA" test/unit/tick_dispatch.test.ts`

### S3 - Mitose · 5 files · 87 KB · ~22k

**C22** - Tier Verde com saldo &lt; 3× capital inicial: sem lançamento no livro-razão e sem entrada na linhagem
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="verde tick below 3x creates no ledger or lineage entry" test/unit/tick_dispatch.test.ts`

**C23** - Tier Verde com saldo ≥ 3×: limite avaliado, simulação de viabilidade corre e só executa se aprovar, com lançamento e linhagem
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="verde tick at or above 3x runs threshold and viability before executing" test/unit/tick_dispatch.test.ts`

**C24** - Simulação não aprova: nenhum capital transferido, nenhum registo na linhagem
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="failed viability moves no capital" test/unit/tick_dispatch.test.ts`

**C25** - Tick fora de tier Verde: o ciclo devolve sem avaliar
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="tick outside verde evaluates nothing" test/unit/tick_dispatch.test.ts`

**C26** - Agente-filho em Verde com mãe configurada: royalties remetidos antes de qualquer outra operação do tick
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="child agent remits royalties before other tick work" test/unit/tick_dispatch.test.ts`

### S4 - Modo de Inferência · 7 files · 115 KB · ~29k

**C27** - `INFERENCE_MODE=free` com provedor a responder: snapshot mostra modo efetivo `free` com o provedor atual, e o tick não cria `EXPENSE_LLM`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="free mode uses provider and records no EXPENSE_LLM" test/unit/inference_mode.test.ts`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="snapshot shows inference mode free with provider" test/unit/dashboard_snapshot.test.ts`

**C28** - Falha do provedor atual: fila avança na ordem configurada e o motivo do salto fica registado como alerta
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="provider failure advances the queue in configured order" test/unit/inference_mode.test.ts`

**C29** - Fila free toda indisponível: queda no determinístico, tick continua, alerta registado
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="empty free queue falls back to deterministic with alert" test/unit/inference_mode.test.ts`

**C30** - Ao atingir `INFERENCE_CAP_PER_TICK` (5): nenhuma chamada adicional, resto no determinístico sem erro, contador visível no snapshot
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="cap of five stops further calls" test/unit/inference_mode.test.ts`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="snapshot shows inference call counter" test/unit/dashboard_snapshot.test.ts`

**C31** - Modo `paid` com chaves: snapshot mostra `paid`; despesa registada só quando o provedor reporta custo, sem número nenhum l ançamento inventado
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="paid mode records expense only when provider reports cost" test/unit/inference_mode.test.ts`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="snapshot shows inference mode paid" test/unit/dashboard_snapshot.test.ts`

**C32** - `paid` sem chave ou cota: queda no determinístico com alerta — nunca paragem
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="paid without key degrades to deterministic and never stops" test/unit/inference_mode.test.ts`

**C33** - Troca no `.env` só tem efeito no próximo arranque; o painel mostra o modo efetivo
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="mode change takes effect only on next start" test/unit/inference_mode.test.ts`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="snapshot shows effective mode not intended" test/unit/dashboard_snapshot.test.ts`

**C34** - Probabilidade fora de `(0, 1)` ou não numérica: descartada, degrau seguinte usado, valor rejeitado registado
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="invalid probability discarded to next step with value recorded" test/unit/inference_mode.test.ts`

**C35** - `INFERENCE_MODE` inválido ou `INFERENCE_CAP_PER_TICK` não inteiro positivo: arranque falha com `Invalid INFERENCE_MODE` / `Invalid INFERENCE_CAP_PER_TICK`
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="invalid INFERENCE_MODE or cap fails startup with Invalid message" test/unit/inference_mode.test.ts`

### S5 - Estimador Polymarket · 4 files · 35 KB · ~9k

**C36** - Candidato dentro do teto: `estimatedProb` vem do modelo e alimenta edge e Quarter-Kelly
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="candidate within cap uses model estimatedProb in edge and Kelly" test/unit/polymarket.test.ts`

**C37** - Fora do teto ou sem provedor: comportamento idêntico ao determinístico atual
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="candidate beyond cap or no provider is identical to today" test/unit/polymarket.test.ts`

**C38** - Fila indisponível no meio da varredura: degrau seguinte ou determinístico sem travar o tick, com alerta
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="provider failure mid-scan falls through without stalling" test/unit/polymarket.test.ts`

### S6 - Avaliador de Bounties · 3 files · 45 KB · ~11k

**C39** - Bounty dentro do teto: modelo avalia, score entra na decisão e a avaliação identifica a origem
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="bounty within cap evaluated by model with origin" test/unit/bounties.test.ts`

**C40** - Fora do teto ou sem provedor: avaliador determinístico atual, sem mudança
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="bounty beyond cap uses deterministic evaluator" test/unit/bounties.test.ts`

**C41** - Score fora do intervalo esperado: descartado, degrau seguinte, valor rejeitado registado
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="out-of-range model score discarded with value recorded" test/unit/bounties.test.ts`

**C42** - Bloqueio duro do firewall recusa sempre, qualquer que seja o score do modelo (comentário não solicitado, placeholder, limite diário)
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="hard firewall blocks regardless of model score" test/unit/bounties.test.ts`

### S7 - Auto-Modificação Imunológica · 6 files · 81 KB · ~20k

**C43** - Sem falha nova na trilha desde a última proposta: nenhuma proposta, portão não corre, duração do tick inalterada
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="no new failure means no proposal and gate not run" test/unit/immune_dispatch.test.ts`

**C44** - Dado falha registada em tier Verde desde a última proposta (com provedor de teste configurado): proposta gerada, portão corre, `IMMUNE_SYSTEM_VERIFIED` ou `IMMUNE_SYSTEM_ROLLBACK` na trilha
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="failure in verde with provider generates proposal and gate records result" test/unit/immune_dispatch.test.ts`

**C45** - Falha fora de tier Verde: nenhuma proposta
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="failure outside verde generates no proposal" test/unit/immune_dispatch.test.ts`

**C46** - Árvore com alterações que não são da proposta: o portão não é chamado, nada é apagado, recusa registada
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="foreign dirty tree refuses without calling gate and deletes nothing" test/unit/immune_dispatch.test.ts`

**C47** - Proposta fora do escopo constitucional: desfeita, `IMMUNE_SYSTEM_ROLLBACK` com motivo
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="out-of-scope proposal is undone with ROLLBACK reason" test/unit/immune_dispatch.test.ts`

**C48** - Build falha no sandbox: proposta desfeita, `IMMUNE_SYSTEM_ROLLBACK` com o erro
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="build failure undoes proposal with ROLLBACK" test/unit/immune_dispatch.test.ts`

**C49** - Suíte falha no sandbox: proposta desfeita, `IMMUNE_SYSTEM_ROLLBACK` com o erro
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="suite failure undoes proposal with ROLLBACK" test/unit/immune_dispatch.test.ts`

**C50** - Build e suíte passam: proposta commitada com mensagem de auditoria e `IMMUNE_SYSTEM_VERIFIED` na trilha
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="passing build and suite commits with audit message and VERIFIED" test/unit/immune_dispatch.test.ts`

**C51** - Durante o check: liveness pode dizer `STALE` e o estado de supervisor diz `running` no snapshot
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="long check shows liveness STALE while supervisor says running" test/unit/dashboard_snapshot.test.ts`

**C52** - Mesmas falhas a repetir-se sem tick bom no meio: nenhuma nova proposta — uma tentativa por falha distinta
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="repeated failures without a good tick produce no new proposal" test/unit/immune_dispatch.test.ts`

**C53** - No despacho do tick, o bloco imunológico corre por último, depois dos outros motores
Proof: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="immune block runs last in the tick dispatch" test/unit/tick_dispatch.test.ts`

## Swept

- validation: C35 (configuração) — C34, C41 (valores devolvidos pelo modelo)
- failure modes: C14 (spawn) — C19 (porta ocupada) — C28, C29, C32 (provedor)
- idempotency and retry: C10 (stop repetido sem efeito) — C6 (dois starts, um processo)
- authorization: existing — `authorized()` (Bearer ou `?token`) antes do encaminhamento cobre as rotas novas; token opcional só em `127.0.0.1`
- concurrency and ordering: C6 (reserva atómica) — C53 (ordem do despacho)
- data lifecycle: C2, C12, C13, C15 (ciclo do ficheiro de processo) — esquema SQLite: nada a migrar
- external-dependency failure: C28, C29, C32 (fila de provedores) — C19 (porta do paywall)
- state transitions: C1–C15 (máquina de estados do task)
- observability: C44, C47–C50 (trilha imunológica) — C30 (contador) — C27, C31 (modo no snapshot) — C19, C28 (motivo registado)

## Handoff

Divisão em lotes declarada antes de qualquer código, por fatias inteiras e pelo custo de leitura (`wc -c` dos ficheiros que a fatia toca ÷ 4):

- **Lote 1 — S1+S2+S3 ≈ 46k + 14k + 22k = 82k** (sob o limite de 150k). Superfície: HTTP do painel + SPA, depois despacho do daemon.
- **Lote 2 — S4+S5+S6+S7 ≈ 29k + 9k + 11k + 20k ≈ 69k + releituras partilhadas ≈ 90k** (sob o limite). A superfície muda depois de S3: de despacho do daemon para camada de configuração/provedores, que S4 cria e S5–S7 reutilizam.
- Fronteira escolhida onde a superfície muda (regra de desempate): quem entra no Lote 2 não precisa de reler o `server.ts`/SPA do Lote 1, e quem fechou o Lote 1 não toca na fila de provedores.

Linhas de fronteira (preenchidas pelo agente que fecha cada lote):

- Lote 1 → Lote 2:
