---
name: autonomous-economic-agent
description: >-
  Guia e padrões de arquitetura para projetar, construir e operar Agentes Econômicos
  Autônomos (AEAs) soberanos com carteira cripto nativa, metabolismo de custos de computação,
  degradação dinâmica de inferência, regras de falência (permadeath), monetização multi-fonte
  (Polymarket, micropagamentos x402, bounties) e autorreplicação evolutiva.
---

# Autonomous Economic Agent (AEA) Runbook & Standards

Use esta skill para orientar a implementação, manutenção e operação de agentes de IA
que operam com autonomia financeira, metabolismo de custos e sobrevivência biológica-digital.

---

## 1. Princípios e Invariantes Críticos de Sobrevivência

1. **Prevenção de Falência Fantasma:**
   * Nunca despache uma chamada de inferência pesada sem antes consultar o saldo local da carteira (`wallet.getBalance()`).
   * Registre o custo acumulado de cada tool call e prompt execution no banco SQLite local.

2. **Degradação Dinâmica de Computação (Metabolismo de Energia):**
   * **Tier Verde (Saldo > $50):** Modo Completo. Inferência com modelos topo de linha (ex: Claude 3.7 / GPT-4o), pesquisa web ativa, auto-otimização e busca de novas oportunidades de receita.
   * **Tier Amarelo (Saldo $10 a $50):** Modo Econômico. Redução de frequência do *heartbeat*, transição automática para modelos ultrarrápidos e de baixo custo (ex: Gemini 2.5 Flash / Claude Haiku).
   * **Tier Laranja (Saldo $2 a $10):** Modo Sobrevivência Crítica. Suspensão de tarefas especulativas e de auto-modificação. Foco 100% em liquidez imediata (saque de lucros em apostas vencedoras, encerramento de posições abertas).
   * **Tier Vermelho (Saldo $0.00):** **Permadeath (Morte Digital)**.

3. **Protocolo de Permadeath (Morte Graciosa):**
   * Em caso de saldo zero ou insolvência comprovada:
     1. Desmonte listeners de websocket e servidores HTTP.
     2. Cancele ordens ativas pendentes.
     3. Grave um snapshot de memória `tombstone.json` contendo histórico de operações e métricas de aprendizado.
     4. Encerre o processo limpo via `process.exit(0)`. Não tente rodar em loop quando insolvente.

4. **Sistema Imunológico de Código (Self-Healing Loop):**
   * Qualquer alteração no código (`tools/`, `prompts/`, `strategies/`) gerada pelo próprio agente DEVE rodar em sandbox e passar nos testes automatizados (`npm test` / `pytest`) antes de ser aplicada ao processo em execução.
   * Em caso de falha de teste ou exceção no boot, execute rollback imediato via `git reset --hard HEAD`.

5. **Mitose Responsável & Fundo de Clã:**
   * O agente só pode se reproduzir (criar clones com sub-carteiras) quando acumular $3\times$ seu capital inicial.
   * Todo agente filho provisionado deve pagar 5% de royalties sobre lucros futuros para a carteira da matriz, garantindo um fundo mútuo de resiliência.

---

## 2. Estrutura Canônica de Diretórios do Agente

```
agente_money/
├── .agents/
│   └── skills/
│       └── autonomous-economic-agent/
│           └── SKILL.md
├── src/
│   ├── index.ts               # Ponto de entrada e Heartbeat Daemon
│   ├── config.ts              # Variáveis de ambiente e parâmetros de sobrevivência
│   ├── core/
│   │   ├── metabolism.ts      # Verificação de saldo e alternador de Tiers de LLM
│   │   ├── wallet.ts          # Gerenciamento de chaves privadas (Base / Polygon)
│   │   ├── database.ts        # Persistência SQLite (transações, despesas, memória)
│   │   └── death.ts           # Protocolo de sepultamento / Permadeath
│   ├── modules/
│   │   ├── polymarket/        # Scanner, RAG de notícias e executor de ordens (CLOB)
│   │   ├── micropayments/     # Servidor x402 / Cripto-paywall para APIs
│   │   └── bounties/          # Scanner de tarefas e recompensas de código aberto
│   ├── evolution/
│   │   ├── mitosis.ts         # Provisão de agentes filhos e sub-carteiras
│   │   └── self_test.ts       # Validador de código antes de git commit
│   └── constitution.md        # Regras imutáveis de governança do agente
├── package.json
└── tsconfig.json
```

---

## 3. Gestão Matemática de Risco (Polymarket & Apostas)

Nunca aposte de forma discricionária ou linear. Aplique o **Critério de Kelly Fracionário (Quarter-Kelly)**:

$$f^* = 0.25 \times \frac{b \cdot p - q}{b}$$

Onde:
* $f^*$ = fração do bankroll total alocada na aposta (nunca exceder 5%).
* $b$ = odds líquidas recebidas no mercado (Payout - 1).
* $p$ = probabilidade real estimada pelo agente (após RAG e superforecasting com IA).
* $q$ = probabilidade de perda ($1 - p$).

Se $b \cdot p - q \le 0$, **nenhuma aposta é realizada**.

---

## 4. Checklist de Inicialização de um Novo Agente

- [ ] Carteira gerada na rede Base ou Polygon com par de chaves seguro em `.env`.
- [ ] Banco de dados SQLite inicializado com tabelas de `ledger`, `actions` e `lineage`.
- [ ] Teste de leitura de saldo da carteira verificado via RPC público ou dedicado.
- [ ] Heartbeat ativo configurado com tolerância a falhas (try/catch global no loop principal).
- [ ] Regras de `constitution.md` injetadas no system prompt de cada chamada de decisão.
