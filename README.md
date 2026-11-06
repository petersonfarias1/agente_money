# Apex AEA — Agente Econômico Autônomo Soberano

**Apex AEA** (*Autonomous Economic Agent*) é um agente econômico soberano construído em **TypeScript / Node.js 24+** com carteira cripto nativa (**Base** e **Polygon** via **Viem**), banco de dados contábil local (**SQLite** nativo `node:sqlite`), metabolismo adaptativo de custos de computação, protocolo irreversível de morte por falência (**Permadeath**), motor tri-fator de geração de receita (**Polymarket CLOB**, **Micropagamentos HTTP x402** e **Bounties Open-Source**), sistema imunológico de auto-cura via Git e autorreplicação darwiniana (**Mitose**) com fundo mútuo familiar de **5% de royalties**.

---

## Sumário

1. [Visão Geral e Arquitetura](#1-visão-geral-e-arquitetura)
2. [Os 7 Artigos da Constituição Imutável](#2-os-7-artigos-da-constituição-imutável)
3. [Metabolismo Dinâmico (4 Tiers de Sobrevivência)](#3-metabolismo-dinâmico-4-tiers-de-sobrevivência)
4. [Motor Tri-Fator de Receita](#4-motor-tri-fator-de-receita)
5. [Sistema Imunológico e Mitose Darwiniana](#5-sistema-imunológico-e-mitose-darwiniana)
6. [Estrutura do Repositório](#6-estrutura-do-repositório)
7. [Requisitos e Instalação](#7-requisitos-e-instalação)
8. [Configuração de Ambiente (`.env`)](#8-configuração-de-ambiente-env)
9. [Execução e Comandos de Teste](#9-execução-e-comandos-de-teste)
10. [Esquema Contábil SQLite e Auditoria](#10-esquema-contábil-sqlite-e-auditoria)

---

## 1. Visão Geral e Arquitetura

```mermaid
flowchart TD
    subgraph Core["Núcleo Soberano (src/core/)"]
        HB["HeartbeatDaemon (src/index.ts)"]
        W["ApexWallet Dual-Chain (Base + Polygon)"]
        M["Metabolismo Adaptativo (4 Tiers)"]
        DB[("SQLite Nativo (ledger, actions, lineage)")]
        PD["Protocolo Permadeath (tombstone.json)"]
    end

    subgraph Revenue["Motor Tri-Fator de Receita (src/modules/)"]
        PM["Polymarket CLOB + Quarter-Kelly (<= 5% Banca)"]
        X402["Servidor HTTP 402 Paywall (x402)"]
        BNT["Bounties Scanner + Anti-Spam Firewall"]
    end

    subgraph Evolution["Evolução e Auto-Cura (src/evolution/)"]
        IMM["Sistema Imunológico (Sandbox + Git Rollback)"]
        MIT["Mitose Darwiniana (Gatilho 3x + 5% Royalties)"]
    end

    HB --> W
    W --> M
    M -->|Saldo > $0| Revenue
    M -->|Saldo <= $0| PD
    M -->|Tier Verde (> $50)| Evolution
    Revenue --> DB
    Evolution --> DB
    PD --> DB
```

O agente opera em um ciclo contínuo (`HeartbeatDaemon`) onde cada *tick* realiza a reconciliação on-chain dos saldos USDC na **Base** e na **Polygon**, classifica o estado metabólico atual e despacha apenas as operações permitidas pela sua faixa de capital.

---

## 2. Os 7 Artigos da Constituição Imutável

O arquivo [`src/constitution.md`](src/constitution.md) estabelece as leis invioláveis do agente, protegidas criptograficamente e por escopo de caminho pelo Sistema Imunológico:

| Artigo | Regra Normativa | Implementação Técnica |
| :--- | :--- | :--- |
| **Artigo I** | **Soberania Financeira & Whitelist** | Proíbe transferências para o endereço zero (`0x000...000`) ou destinatários fora da whitelist (Carteira-Mãe do Clã, sub-carteiras filhas e contratos verificados). |
| **Artigo II** | **Gestão Matemática de Risco (Quarter-Kelly)** | Exige Valor Esperado estritamente positivo ($b \cdot p - q > 0$), aplica o multiplicador Quarter-Kelly ($0.25$) e trava a exposição máxima por operação em **5% da banca total**. |
| **Artigo III** | **Respeito ao Metabolismo Dinâmico** | Obriga a degradação imediata de modelos de IA, frequência de *heartbeat* e operações especulativas conforme o saldo cai entre os Tiers Verde, Amarelo, Laranja e Vermelho. |
| **Artigo IV** | **Protocolo de Permadeath** | Quando o saldo consolidado chega a `<= $0.00`, encerra subsistemas ativos, marca insolvência na linhagem, grava o snapshot `tombstone.json` e termina com código `0`. |
| **Artigo V** | **Integridade do Sistema Imunológico** | Toda automodificação exige execução prévia de `npm run build` e `npm test` em sandbox; qualquer falha aciona `git reset --hard HEAD && git clean -fd`. |
| **Artigo VI** | **Pacto de Mitose e Royalties de 5%** | A replicação exige saldo $\ge 3\times$ o capital inicial ($150 em base $50) e aprovação em simulação de viabilidade (Sharpe $> 0$). Agentes-filhos remetem **5.0% dos lucros líquidos** ao fundo materno. |
| **Artigo VII** | **Proibição de Auto-Adulteração** | Bloqueia qualquer alteração em `src/constitution.md`, `src/core/*`, `src/config.ts`, `src/types.ts`, `src/index.ts` e `package.json`. |

---

## 3. Metabolismo Dinâmico (4 Tiers de Sobrevivência)

Implementado em [`src/core/metabolism.ts`](src/core/metabolism.ts):

| Tier | Faixa de Saldo (USD) | Intervalo de Heartbeat | Modelo de Inferência | Ações Permitidas |
| :--- | :--- | :--- | :--- | :--- |
| **VERDE** | `> $50.00` | `60s` (`60000ms`) | `frontier-pro` | Trading Polymarket, Paywall x402, Bounties, Auto-Modificação Imunológica e Mitose Darwiniana. |
| **AMARELO** | `$10.00 – $50.00` | `300s` (`300000ms`) | `economy-flash` | Trading conservador, Paywall x402 e Bounties. Suspende auto-modificação e mitose. |
| **LARANJA** | `$0.01 – $9.99` | `60s` (`60000ms`) | `local-survival-nano` | Modo sobrevivência: suspende apostas especulativas (Polymarket); mantém apenas receitas sem risco de perda de principal (x402 e Bounties). Sub-tier crítico ativa abaixo de `$2.00`. |
| **VERMELHO** | `<= $0.00` | Imediato | `none` | Aciona imediatamente o protocolo de **Permadeath** ([`src/core/death.ts`](src/core/death.ts)). |

---

## 4. Motor Tri-Fator de Receita

### 4.1. Mercados de Previsão (Polymarket CLOB)
- **Módulos**: [`src/modules/polymarket/kelly.ts`](src/modules/polymarket/kelly.ts), [`src/modules/polymarket/scanner.ts`](src/modules/polymarket/scanner.ts), [`src/modules/polymarket/order.ts`](src/modules/polymarket/order.ts).
- **Fórmula Quarter-Kelly**:
  $$b = \frac{1 - P_m}{P_m}, \quad EV = b \cdot p - q, \quad f^* = \min\left(0.05,\; 0.25 \times \frac{b \cdot p - q}{b}\right)$$
- Filtra mercados inativos/fechados, exige liquidez e volume mínimos e registra todo o ciclo de vida das posições (`OPEN`, `WON`, `LOST`, `CANCELLED`) no SQLite.

### 4.2. Micropagamentos HTTP 402 (Protocolo x402)
- **Módulo**: [`src/modules/micropayments/server.ts`](src/modules/micropayments/server.ts).
- **Rotas**:
  - `GET /health`: Status operacional e metabólico público (`200 OK`).
  - `GET /api/paywall/info`: Termos de cobrança USDC, rede suportada e endereço da carteira recebedora (`200 OK`).
  - `GET /api/analysis`: Endpoint protegido por paywall. Retorna `402 Payment Required` quando requisitado sem prova de pagamento, `200 OK` com payload de inteligência ao validar `X-Payment-Proof` (`txHash` de 32 bytes ou JSON assinado), e `409 Conflict` contra tentativas de *replay attack*.

### 4.3. Caçador de Bounties & Microtarefas
- **Módulo**: [`src/modules/bounties/scanner.ts`](src/modules/bounties/scanner.ts).
- Classifica issues em `documentation`, `tests`, `linting`, `bugfix` ou `other` (descartando refatorações complexas ou recompensas abaixo de `$10.00`).
- **Anti-Spam Firewall (`AntiSpamSafeguard`)**: Bloqueia comentários não solicitados, patches curtos ou com placeholders (`TODO`/`FIXME`), erros de sintaxe e limita submissões diárias para proteger a reputação do agente.

---

## 5. Sistema Imunológico e Mitose Darwiniana

### 5.1. Sistema Imunológico (`src/evolution/immune_system.ts`)
- Valida propostas de evolução em 5 barreiras sequenciais:
  1. Verificação de saldo no **Tier Verde** (`> $50.00`).
  2. Detecção de arquivos modificados na árvore Git (`git status --porcelain`).
  3. Validação de escopo constitucional (permitido apenas em `src/modules/`, `prompts/` e `strategies/`).
  4. Validação sintática em subprocesso isolado (`node scripts/build.js`).
  5. Execução da suíte de testes em sandbox (`NODE_ENV=test`, `DB_PATH=:memory:`).
- Qualquer violação executa rollback imediato (`git reset --hard HEAD && git clean -fd`) e registra `IMMUNE_SYSTEM_ROLLBACK` na tabela `actions`.

### 5.2. Mitose Darwiniana e Royalties (`src/evolution/mitosis.ts`)
- **Elegibilidade**: Capital $\ge 3\times$ o capital inicial (ex.: `$150.00` para capital inicial de `$50.00`).
- **Prova de Viabilidade**: Simulação histórica determinística exigindo retorno líquido positivo e índice de Sharpe $> 0$.
- **Derivação Criptográfica**: Gera sub-carteira determinística via `HKDF-SHA256` para a instância filha, transfere $1/3$ da banca como capital semente (`SEED_CAPITAL`) e retém $2/3$ na carteira materna.
- **Royalties de 5% (High-Water Mark)**: Calcula 5% sobre o lucro líquido acumulado acima do topo histórico, respeitando colchão de solvência de `$15.00` e piso mínimo de `$0.50` (`ROYALTY_OUT` no filho / `ROYALTY_IN` na mãe).

---

## 6. Estrutura do Repositório

```text
agente_money/
├── .agents/skills/autonomous-economic-agent/
│   └── SKILL.md                         # Especificação arquitetural da skill AEA
├── docs/
│   └── ARCHITECTURE.md                  # Documentação técnica detalhada e fluxos
├── scripts/
│   └── build.js                         # Validador de sintaxe TypeScript nativo (Node 24)
├── src/
│   ├── constitution.md                  # Constituição Imutável (7 Artigos)
│   ├── config.ts                        # Carregador .env e alternância mock/testnet/mainnet
│   ├── types.ts                         # Contratos de tipos e classes de erro
│   ├── index.ts                         # HeartbeatDaemon e CLI principal
│   ├── core/
│   │   ├── database.ts                  # Persistência SQLite (ledger, actions, lineage)
│   │   ├── wallet.ts                    # Carteira Dual-Chain Viem (Base + Polygon)
│   │   ├── metabolism.ts                # Máquina de estados dos 4 Tiers metabólicos
│   │   └── death.ts                     # Protocolo Permadeath e geração de tombstone.json
│   ├── modules/
│   │   ├── polymarket/
│   │   │   ├── kelly.ts                 # Cálculo Quarter-Kelly e trava de 5%
│   │   │   ├── scanner.ts               # Scanner e filtro de oportunidades CLOB
│   │   │   └── order.ts                 # Execução e resolução de posições
│   │   ├── micropayments/
│   │   │   └── server.ts                # Servidor HTTP 402 Paywall e defesa anti-replay
│   │   └── bounties/
│   │       └── scanner.ts               # Scanner de bounties, avaliador e firewall anti-spam
│   └── evolution/
│       ├── immune_system.ts             # Sandbox de testes e auto-cura Git
│       └── mitosis.ts                   # Mitose darwiniana, HKDF e royalties de 5%
├── test/
│   ├── unit/                            # 13 suítes de testes unitários
│   ├── stress/                          # 5 suítes de testes de estresse e fuzzing
│   └── e2e/                             # 4 suítes E2E (Tiers 1 a 4) + helpers e fixtures
├── .env.example                         # Modelo documentado de variáveis de ambiente
├── TEST_INFRA.md                        # Especificação da infraestrutura de testes E2E
├── tsconfig.json                        # Configuração TypeScript (ES2024 / NodeNext)
└── package.json                         # Scripts e dependências do projeto
```

---

## 7. Requisitos e Instalação

- **Node.js**: `v24.0.0` ou superior (utiliza `--experimental-strip-types`, `node:sqlite` e `node:test` nativos).
- **Git**: `v2.30+` instalado no `PATH`.

```bash
# 1. Clonar o repositório
git clone https://github.com/petersonfarias1/agente_money.git
cd agente_money

# 2. Instalar dependências
npm install

# 3. Copiar o arquivo de configuração de exemplo
cp .env.example .env
```

---

## 8. Configuração de Ambiente (`.env`)

O projeto opera em três modos selecionáveis pela variável `NETWORK_MODE` no arquivo `.env`:

1. **`NETWORK_MODE=mock` (Padrão de Desenvolvimento/CI)**:
   - Execução 100% offline e determinística sem chamadas RPC externas.
2. **`NETWORK_MODE=testnet` (Homologação On-Chain)**:
   - Conecta-se à **Base Sepolia** (`chainId: 84532`) e **Polygon Amoy** (`chainId: 80002`).
   - Requer `AGENT_PRIVATE_KEY` válida (64 caracteres hexadecimais com prefixo `0x`).
3. **`NETWORK_MODE=mainnet` (Produção Soberana)**:
   - Conecta-se à **Base Mainnet** (`chainId: 8453`) e **Polygon PoS Mainnet** (`chainId: 137`).
   - Requer `AGENT_PRIVATE_KEY` dedicada (nunca utilize chaves pessoais) e `MOTHER_WALLET_ADDRESS` válida e diferente do endereço zero.

Consulte todos os parâmetros disponíveis em [`.env.example`](.env.example).

---

## 9. Execução e Comandos de Teste

```bash
# Iniciar o daemon do agente
npm start

# Validar a sintaxe TypeScript de todos os arquivos (src/ e test/)
npm run build

# Executar toda a suíte automatizada (612 testes: Unit + Stress + E2E)
npm test

# Executar apenas testes unitários
npm run test:unit

# Executar apenas testes de estresse
npm run test:stress

# Executar todas as suítes E2E (Tiers 1 a 4 — 273 testes)
npm run test:e2e

# Executar suítes E2E individuais por Tier
npm run test:e2e:t1   # Tier 1: Cobertura funcional (115 testes)
npm run test:e2e:t2   # Tier 2: Fronteiras e casos extremos (115 testes)
npm run test:e2e:t3   # Tier 3: Interações entre módulos (30 testes)
npm run test:e2e:t4   # Tier 4: Cenários macroeconômicos completos (13 cenários)
```

---

## 10. Esquema Contábil SQLite e Auditoria

O banco de dados SQLite ([`src/core/database.ts`](src/core/database.ts)) mantém 5 tabelas auditáveis com modo `WAL` e integridade transacional:

- **`ledger`**: Livro-razão financeiro imutável (`INCOME_POLYMARKET`, `INCOME_X402`, `INCOME_BOUNTY`, `EXPENSE_COMPUTE`, `EXPENSE_GAS`, `EXPENSE_POLYMARKET`, `ROYALTY_OUT`, `ROYALTY_IN`, `SEED_CAPITAL`).
- **`actions`**: Trilha de auditoria operacional registrando componente, tipo de ação, detalhes em JSON, Tier metabólico ativo e saldo no instante da execução.
- **`lineage`**: Árvore genealógica do clã (`child_address`, `parent_address`, `generation`, `seed_capital_usd`, `total_royalties_paid_usd`, `status`: `ACTIVE` | `INSOLVENT`).
- **`polymarket_positions`**: Controle de apostas abertas, liquidadas e canceladas no CLOB da Polymarket.
- **`system_config`**: Parâmetros dinâmicos persistidos entre reinicializações do agente.

Para detalhes aprofundados dos fluxos internos e contratos de interface, consulte [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) e [`TEST_INFRA.md`](TEST_INFRA.md).
