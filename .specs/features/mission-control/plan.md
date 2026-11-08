# Mission Control — painel de observabilidade do Apex AEA

## Problem

Hoje o estado do agente existe em dois lugares: linhas que ninguém lê no SQLite e `console.error` no terminal. `npm start` não imprime nada em operação normal, e a única superfície legível por máquina é o `GET /health` do servidor x402, que devolve seis campos e só existe enquanto aquele servidor está de pé.

Quem opera paga isso em três moedas:

- **Diagnóstico**: responder "o agente está vivo?", "em que tier?", "o que ele fez na última hora?" exige abrir um shell, saber o caminho `./data/agent.db` e escrever SQL. A tabela `actions` tem 605 linhas neste repositório e nenhuma leitura agregada.
- **Risco**: abrir o banco com uma ferramenta de escrita — ou reaproveitar o `DatabaseService`, cujo construtor roda `CREATE TABLE` e `PRAGMA journal_mode = WAL` — mexe no arquivo vivo do agente. Não há como olhar sem poder escrever.
- **Contexto**: thresholds, intervalos e o mapeamento tier → `modelClass` vivem no `.env` e no código; o que está carregado em memória não é visível em lugar nenhum.

Não há evidência de incidente no histórico: `ledger`, `lineage` e `polymarket_positions` estão vazios, e as 605 actions são resíduo de execuções de teste de permadeath. O custo é o de qualquer sistema sem observabilidade — cada pergunta vira uma sessão de terminal, e a resposta chega depois do momento em que ela importava.

Vale registrar um limite do que existe: **não há cliente de LLM no runtime**. As dependências são `viem` e `typescript`, e `modelClass` é um rótulo derivado do tier por `evaluateTier`. Um painel que prometesse "modelo X executando" estaria inventando; o que dá para mostrar com honestidade é a classe de modelo atribuída ao tier e as operações liberadas nele.

Quando isso entrar: uma URL local responde, em um relance, se o agente está vivo, em que tier, com que saldo, o que fez nas últimas horas, quanto entrou e saiu, e qual configuração está de fato carregada — sem tocar no banco e sem terminal.

## Flow

Reaproveita o cálculo de tier (`evaluateTier`), o carregador de configuração (`getConfig`) e o esquema das cinco tabelas de `src/core/database.ts`; não reimplementa metabolismo, não relê o `.env` e não fala com RPC.

1. `npm run dashboard` -> `src/modules/dashboard/main.ts` (new) — resolve `DASHBOARD_PORT` (7070), `DASHBOARD_HOST` (127.0.0.1) e `DASHBOARD_TOKEN`, e inicia o servidor; nenhum daemon é criado.
2. `GET /` e `/assets/*` -> `src/modules/dashboard/server.ts` (new) — autentica, roteia e serve o SPA de `src/modules/dashboard/public/` (new, no door — asset estático).
3. a cada 2000 ms -> `src/modules/dashboard/snapshot.ts` (new) — lê `actions`, `ledger`, `polymarket_positions`, `lineage` e `system_config` por um `DatabaseSync` aberto com `readOnly: true`.
4. snapshot -> `DatabaseService` (exists) — o esquema e os nomes de tabela vêm de `src/core/database.ts`; o painel emite seus próprios `SELECT` e nunca chama `initialize()`.
5. snapshot -> `getConfig()` (exists) — a configuração viva é sanitizada, nunca reparseada do `.env`.
6. snapshot -> `evaluateTier()` (exists) — deriva tier, `modelClass` e intervalo a partir do último saldo registrado, com a mesma matemática do daemon.
7. snapshot -> `X402Server` (exists) — `GET /health` sondado com timeout de 800 ms apenas para reportar alcance; a falha não bloqueia o snapshot.
8. snapshot -> `tombstone.json` (exists) — lido do disco para a seção de permadeath; ausência é estado válido.
9. out: `Snapshot` JSON em `GET /api/snapshot` e eventos `snapshot` em `GET /api/stream`, consumidos por `public/app.js` (new).

## Impact

| Front | What changes |
| --- | --- |
| domínio | novo termo: `Snapshot` — retrato imutável do estado do agente em um instante, com `seq` e `generatedAt`, em `src/modules/dashboard/snapshot.ts` |
| domínio | novo termo: liveness `ALIVE` / `STALE` / `DEAD` / `UNKNOWN` — derivado da idade do último `TICK_EVALUATED`, não da existência do processo |
| domínio | termo existente: "modelo" — o código só tem `modelClass` (`advanced`/`economic`/`survival`); o painel passa a exibir esse rótulo e nunca um nome de provedor. Quem ramifica hoje: `src/index.ts` (auditoria) e `src/modules/micropayments/server.ts` (`/health`) |
| dados armazenados | nada a migrar; as cinco tabelas existentes são lidas, nenhuma escrita |
| arquivos protegidos | nenhuma edição em `src/core/*`, `src/config.ts`, `src/types.ts`, `src/index.ts`; o único arquivo existente alterado é `package.json`, com um script `dashboard` |
| dependências | nenhuma dependência npm nova e nenhum passo de build para o frontend |

## Relations

`None - no stored-data shape change`: o painel lê as cinco tabelas existentes e não escreve nenhuma.

## Surface

Somente rotas que esta feature adiciona.

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `GET /` | — | HTML do SPA | 200, 401 |
| `GET /assets/*` | caminho do asset | arquivo estático | 200, 404 |
| `GET /api/snapshot` | — | `Snapshot` completo | 200, 401, 503 |
| `GET /api/stream` | `Last-Event-ID` | eventos SSE `snapshot` com `id` e `seq` | 200, 401 |
| `GET /api/actions` | `component`, `limit`, `before` | `items[]`, `nextBefore` | 200, 400, 401 |
| `GET /api/ledger` | `entryType`, `chain`, `limit` | `items[]`, `totals` | 200, 400, 401 |
| `GET /api/positions` | `status` | `items[]`, `summary` | 200, 401 |
| `GET /api/lineage` | — | `children[]`, `royaltiesPaidUsd` | 200, 401 |
| `GET /api/config` | — | configuração sanitizada | 200, 401 |
| `GET /api/export` | `table`, `format` | arquivo JSON ou CSV | 200, 400, 401 |
| `GET /api/health` | — | estado do próprio painel e do canal SQLite | 200 |

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| Contrato do snapshot | chaves de topo `generatedAt`, `seq`, `networkMode`, `agent`, `liveness`, `tier`, `balance`, `kpi`, `revenue`, `activity`, `alerts`, `positions`, `lineage`, `x402`, `config`, `degraded`, `tombstone`; `seq` inteiro estritamente crescente; dinheiro em USD decimal; tempo em epoch ms | endpoints por tela (`/api/overview`, `/api/finance`, ...): cada tela fixaria seu próprio formato e os totais divergiriam entre telas, com N requisições por ciclo |
| Fronteira de confiança do painel | `new DatabaseSync(dbPath, { readOnly: true })`, nenhum handler fora de `GET`, bind `127.0.0.1` por padrão, `DASHBOARD_TOKEN` obrigatório fora de localhost, redaction de `/(PRIVATE_KEY\|SECRET\|PASSPHRASE\|TOKEN\|API_KEY)/i` para `"***"` | reutilizar `DatabaseService`: o construtor roda `CREATE TABLE` e `PRAGMA journal_mode = WAL`, ou seja, escreve no banco vivo do agente |
| Streaming por SSE sem dependência | `GET /api/stream` responde `text/event-stream`, `event: snapshot`, `id: <seq>`, comentário `: ping` a cada 15 s; SPA em ES modules servido de `public/`, sem build | WebSocket: exigiria a dependência `ws` e um upgrade de protocolo para um push unidirecional que o SSE já cobre; polling puro: uma requisição por cliente por ciclo e latência igual ao intervalo |

- Nada mais nesta mudança é difícil de reverter.

## Criteria

### S1: Mission Control ao vivo (P1)

O operador abre uma URL e vê, sem terminal, se o agente está vivo, em que tier, com que saldo, e o que aconteceu de relevante.

**Acceptance Criteria**

1. WHEN o painel abre THEN o sistema SHALL renderizar, a partir do primeiro snapshot recebido, tier atual, saldo total com 2 casas decimais, contagem de ciclos e estado de liveness.
2. WHEN um evento `snapshot` chega por `GET /api/stream` THEN o sistema SHALL atualizar os valores na tela sem recarregar a página e exibir a idade do dado em segundos.
3. WHILE a idade do último `TICK_EVALUATED` for menor ou igual a 2 vezes o intervalo do tier atual o sistema SHALL exibir liveness `ALIVE`.
4. IF a idade do último `TICK_EVALUATED` estiver entre 2 vezes o intervalo do tier e 15 minutos THEN o sistema SHALL exibir liveness `STALE` com o texto "sem tick há N min".
5. IF a idade do último `TICK_EVALUATED` exceder 15 minutos, ou existir uma action `PERMADEATH_EXECUTED`, THEN o sistema SHALL exibir liveness `DEAD` e manter o último snapshot visível.
6. IF não existir nenhuma linha em `actions` THEN o sistema SHALL exibir o estado vazio "Nenhuma operação registrada ainda" e o comando `npm start`.
7. The system SHALL emitir um evento `snapshot` a cada 2000 ms por cliente conectado, com `seq` crescente e `generatedAt` em epoch ms.
8. IF a conexão SSE for interrompida THEN o sistema SHALL reconectar após 2000, 4000, 8000, 16000 e 30000 ms, repetindo o teto, e enviar `Last-Event-ID` com o último `seq` recebido.
9. IF o cliente enviar `Last-Event-ID: 42` THEN o sistema SHALL continuar o stream a partir do `seq` 43.
10. WHEN existir action com `action_type` em `PERMADEATH_EXECUTED`, `IMMUNE_SYSTEM_ROLLBACK` ou `TICK_FAILED` THEN o sistema SHALL exibir o evento no feed de alertas com severidade `critical`, componente e timestamp.
11. WHEN o tier do tick atual diferir do tier do tick anterior THEN o sistema SHALL exibir a transição com severidade `warning` para descida e `info` para subida.
12. The system SHALL exibir no máximo 20 alertas, do mais recente para o mais antigo, em um contêiner com `aria-live="polite"`.

**Independent test:** abrir `/` contra uma cópia de `data/agent.db` e inserir um `TICK_EVALUATED` novo por outra conexão, observando tier, saldo e liveness mudarem sem recarregar.

### S2: Histórico de operações (P1)

O operador investiga o que o agente fez, filtrando por componente e abrindo o detalhe de qualquer registro.

**Acceptance Criteria**

13. WHEN o operador abre "Operações" THEN o sistema SHALL listar as 50 actions mais recentes com componente, tipo, tier, saldo e timestamp local.
14. WHEN o operador filtra por componente THEN o sistema SHALL retornar apenas actions daquele componente.
15. WHEN o operador solicita `limit=500` THEN o sistema SHALL retornar 500 itens; WHEN solicita `limit=501` THEN o sistema SHALL responder 400 com `{"error":"InvalidParameter","parameter":"limit"}`.
16. IF o filtro não tiver resultado THEN o sistema SHALL exibir "Nenhuma operação encontrada para este filtro" e preservar os filtros aplicados.
17. WHEN o operador seleciona uma linha THEN o sistema SHALL abrir o detalhe com `details` formatado e um botão "copiar".
18. WHEN o operador pagina com `before=<id>` THEN o sistema SHALL retornar somente registros com `id` menor que `<id>`, em ordem decrescente de `id`.
19. IF `details` não for JSON válido THEN o sistema SHALL exibir o texto bruto sem erro.
20. WHILE a lista estiver carregando THEN o sistema SHALL exibir 5 linhas de esqueleto e desabilitar o botão "Carregar mais".

**Independent test:** semear 60 actions sintéticas, filtrar por `heartbeat` e paginar até o fim.

### S3: Financeiro e gráficos (P2)

O operador vê de onde vem e para onde vai o dinheiro, com a evolução do saldo no tempo.

**Acceptance Criteria**

21. WHEN o operador abre "Financeiro" THEN o sistema SHALL exibir receita total, despesa total, resultado líquido e saldo atual calculados da tabela `ledger`.
22. The system SHALL exibir receita agrupada por `entry_type` (`INCOME_X402`, `INCOME_POLYMARKET`, `INCOME_BOUNTY`, `ROYALTY_IN`) com valor e contagem por grupo.
23. The system SHALL renderizar a série de saldo dos `TICK_EVALUATED` em no máximo 240 pontos, usando o último valor de cada bucket.
24. IF o `ledger` estiver vazio THEN o sistema SHALL exibir "Sem lançamentos financeiros" com `netUsd = 0` e sem executar divisão em `runwayDays`.
25. IF as despesas dos últimos 7 dias forem iguais a 0 THEN o sistema SHALL exibir `runwayDays = null` e o texto "sem queima registrada".
26. WHEN existir posição com status `OPEN` THEN o sistema SHALL exibir exposição aberta em USD e a contagem por status `OPEN`, `WON`, `LOST` e `CANCELLED`.
27. The system SHALL calcular `winRate` como `WON / (WON + LOST)` e exibir `null` quando o denominador for 0.

**Independent test:** semear o `ledger` com uma receita e uma despesa e conferir totais, agrupamento e série no gráfico.

### S4: Configuração e modelos (P2)

O operador confere o que está de fato carregado em memória e qual classe de modelo o tier atual libera, sem que nenhum segredo apareça.

**Acceptance Criteria**

28. WHEN o operador abre "Configuração" THEN o sistema SHALL exibir `networkMode`, os 4 thresholds, os 3 intervalos de heartbeat, a fração e o teto de Kelly, porta, preço e rede do x402, e o multiplicador de mitose carregados por `getConfig()`.
29. The system SHALL substituir por `"***"` o valor de toda chave que corresponda a `/(PRIVATE_KEY|SECRET|PASSPHRASE|TOKEN|API_KEY)/i` e SHALL omitir `PRIVATE_KEY` do payload.
30. The system SHALL NOT incluir no corpo de nenhuma resposta os valores de `PRIVATE_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_API_PASSPHRASE`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` e `GEMINI_API_KEY`.
31. WHEN o tier atual for `VERDE` THEN o sistema SHALL exibir `modelClass = "advanced"`.
32. WHEN o tier atual for `AMARELO` THEN o sistema SHALL exibir `modelClass = "economic"`.
33. WHEN o tier atual for `LARANJA` ou `VERMELHO` THEN o sistema SHALL exibir `modelClass = "survival"`.
34. WHILE nenhum cliente de LLM estiver integrado ao runtime o sistema SHALL exibir o selo "sem provedor de inferência configurado" na tela de modelos.
35. The system SHALL listar as operações liberadas no tier atual a partir de `allowSpeculativeResearch` e `allowSelfModification`.

**Independent test:** definir segredos no `.env`, abrir a tela e procurar cada valor no corpo das respostas de `/api/config` e `/api/snapshot`.

### S5: Clã e permadeath (P3)

O operador vê a linhagem do clã e o pós-morte do agente quando ele morre.

**Acceptance Criteria**

36. WHEN existirem linhas em `lineage` THEN o sistema SHALL exibir geração, endereço da criança, status `ACTIVE`/`INSOLVENT` e royalties pagos por criança.
37. WHEN `tombstone.json` existir THEN o sistema SHALL exibir causa, timestamp da morte, ciclos totais, receita e despesa finais, e permitir baixar o arquivo.
38. IF `tombstone.json` não existir THEN o sistema SHALL exibir "agente vivo" na seção de permadeath.
39. IF `tombstone.json` existir e não for JSON válido THEN o sistema SHALL exibir "tombstone inválido" e o caminho do arquivo.

**Independent test:** copiar o `tombstone.json` atual e conferir a seção, depois renomeá-lo e confirmar o estado "agente vivo".

### S6: Fronteira de confiança, degradação e exportação (P3)

O painel não consegue escrever no banco, não vaza segredo e continua útil quando uma dependência falha.

**Acceptance Criteria**

40. The system SHALL abrir o SQLite com `{ readOnly: true }` e SHALL manter o SHA-256 de `data/agent.db` idêntico antes e depois de exercitar todas as rotas.
41. The system SHALL responder 405 com `{"error":"MethodNotAllowed"}` a todo método diferente de `GET`.
42. WHEN `DASHBOARD_HOST` for diferente de `127.0.0.1` e `DASHBOARD_TOKEN` estiver vazio THEN o sistema SHALL encerrar com exit code 1 e a mensagem "DASHBOARD_TOKEN obrigatório fora de localhost".
43. WHILE `DASHBOARD_TOKEN` estiver definido o sistema SHALL exigir `Authorization: Bearer <token>` ou `?token=<token>` e responder 401 `{"error":"Unauthorized"}` quando ausente ou inválido.
44. IF a sondagem `GET /health` do x402 não responder em 800 ms THEN o snapshot SHALL sair com `degraded.x402 = "timeout"` e `x402.reachable = false`.
45. IF o arquivo SQLite existir e a abertura falhar THEN `GET /api/snapshot` SHALL responder 503 com `{"error":"DatabaseUnavailable"}`.
46. IF o arquivo SQLite não existir THEN `GET /api/snapshot` SHALL responder 200 com agregados zerados e `liveness.state = "UNKNOWN"`.
47. WHEN o operador exporta a tabela `actions` em CSV THEN o sistema SHALL responder `text/csv; charset=utf-8` com BOM, linha de cabeçalho e linhas terminadas em CRLF.
48. WHEN o operador exporta uma tabela fora de `actions`, `ledger`, `positions` e `lineage` THEN o sistema SHALL responder 400 com `{"error":"InvalidParameter","parameter":"table"}`.
49. The system SHALL servir `/` e `/assets/*` com `Content-Security-Policy: default-src 'self'` e sem requisição a origem externa.

**Independent test:** exercitar todas as rotas, comparar o SHA-256 do `.db` e tentar `POST /api/snapshot`.

## Out of scope

| Excluded | Why |
| --- | --- |
| Controle do agente (pausar, retomar, tick manual, kill switch) | O painel é observador em outro processo; controle exigiria IPC e amplia a superfície de ataque sobre capital |
| Escrita de configuração pelo painel | O runtime não recarrega configuração; um editor de `.env` daria uma falsa sensação de efeito imediato |
| Autenticação multiusuário e papéis | Uso local, um operador por máquina |
| Tokens e custo por chamada de LLM | Não existe cliente de LLM no runtime; medir o que não é chamado seria número inventado |
| Alertas externos (Telegram, e-mail, Slack) | Não há canal de saída configurado, e a decisão de para onde um alerta vaza é do operador, não desta feature |
| Retenção, compactação ou arquivamento do SQLite | Fora do escopo de observabilidade; nenhuma tabela é alterada |
| Backtest e simulação de estratégia | Não há histórico de mercado persistido |
| Acesso remoto com TLS e múltiplos dispositivos | Bind em localhost por padrão; exposição em LAN é decisão de rede do operador |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Porta do painel | 7070, configurável por `DASHBOARD_PORT` | não colide com 4020 do x402 nem com portas de dev comuns | n |
| Idioma da interface | pt-BR | o repositório e o operador operam em português | n |
| Origem do saldo | último `balance_usd` registrado em `TICK_EVALUATED`, sem chamada RPC | evita gasto e dependência de RPC; o painel não duplica a lógica da carteira | n |
| Stack do frontend | HTML, CSS e JS com ES modules, sem dependência e sem build | o repositório é zero-dependência (`viem` e `typescript`) e `npm run build` é um validador de sintaxe | n |
| Gráficos | SVG e canvas gerados no cliente, sem biblioteca | `Content-Security-Policy: default-src 'self'` proíbe CDN e o painel precisa funcionar offline | n |
| Postura de escrita | leitura estrita: banco em `readOnly`, API somente `GET` | o banco é a contabilidade do agente; um bug de painel não pode virar lançamento | n |
| Acesso | `127.0.0.1` por padrão, token obrigatório fora dele | superfície nova não deve herdar exposição de rede | n |

**Open questions:** none — todas as decisões acima têm default escolhido.

## Observable

Planilha de varredura, não a revisão.

| Surface | Decision | Landing |
| --- | --- | --- |
| screen `overview` | empty state | AC 6 |
| screen `overview` | loading state | AC 1 |
| screen `overview` | error state | AC 2, AC 8, AC 44 |
| screen `overview` | unauthorised | AC 43 |
| screen `overview` | destructive action confirms | n/a - o painel não executa ação destrutiva |
| screen `operações` | empty state | AC 16 |
| screen `operações` | loading state | AC 20 |
| screen `operações` | error state | AC 15, AC 19 |
| screen `financeiro` | empty state | AC 24, AC 25 |
| screen `financeiro` | loading state | AC 23 |
| screen `financeiro` | error state | AC 27 |
| screen `configuração` | unauthorised e redaction | AC 29, AC 30, AC 43 |
| screen `configuração` | empty state | AC 28 |
| screen `modelos` | empty state | AC 34 |
| screen `clã e permadeath` | empty state | AC 38 |
| screen `clã e permadeath` | error state | AC 39 |
| API `GET /api/snapshot` | error shape e códigos | AC 45, AC 46 |
| API `GET /api/actions` | error shape e códigos | AC 15 |
| API `GET /api/export` | error shape e códigos | AC 48 |
| all `GET /api/*` | método não permitido | AC 41 |
| all `GET /api/*` | autorização | AC 42, AC 43 |
| all routes | versionamento | n/a - painel local servido e consumido pelo mesmo processo, sem cliente externo |
| all routes | rate limit | n/a - bind localhost, um operador, e cada requisição custa uma leitura SQLite |
| all routes | headers de segurança | AC 49 |

## Sources

- `README.md` seções 3 a 10 — estabelece os quatro tiers, os rótulos de modelo, os comandos e o esquema SQLite.
- `src/constitution.md` artigos I a IV — estabelece a postura sem transferência de capital, o teardown de permadeath e a degradação por tier.
- `docs/ARCHITECTURE.md` seções 1 a 4 — estabelece o fluxo do daemon e o contrato do servidor x402.
