/**
 * ==============================================================================
 * APEX AEA — Inference Layer: LLM provider adapters
 * ==============================================================================
 * Provider-agnostic probability estimation with first-class local support:
 * the `ollama` provider speaks Ollama's OpenAI-compatible chat-completions
 * endpoint (`POST {baseUrl}/v1/chat/completions`), so a locally hosted open
 * model runs as the free inference backend with zero credits spent.
 *
 * Hosted presets (OpenRouter, Groq, Gemini, Anthropic) all expose an
 * OpenAI-compatible `/chat/completions` endpoint and use `OpenAIProvider`.
 */

import type {
  InferenceProvider,
  InferenceEstimate,
  InferenceRequest,
  BountyInferenceRequest,
  InferenceScoreEstimate,
} from './types.ts';
import type { InferenceProviderConfig, InferenceProviderType, TokenPricing } from '../../types.ts';

/** Default per-call timeout for estimation calls. */
export const DEFAULT_INFERENCE_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = [
  'You are the forecasting engine of an autonomous economic agent.',
  'You must answer with a single JSON object and nothing else:',
  '{"pYes": <probability of the YES outcome, strictly between 0 and 1>,"pNo": <probability of the NO outcome, strictly between 0 and 1>}',
  'The two probabilities must be numbers in (0, 1).',
].join(' ');

const BOUNTY_SYSTEM_PROMPT = [
  'You assess whether a bounded software bounty is feasible for an autonomous coding agent.',
  'Return only JSON: {"score": <number from 0 to 1>}.',
  'Score feasibility and clarity, not reward size. Never authorize submission.',
].join(' ');

const PING_SYSTEM_PROMPT = 'Health check. Reply with the JSON object {"ok":true} and nothing else.';

/**
 * Extracts a JSON object from a completion. Free-tier models frequently wrap
 * the answer in ```json fences or add prose around it, so the first balanced
 * `{...}` block is accepted when the raw text is not valid JSON.
 */
export function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to tolerant extraction
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error('no JSON object found');
}

function parseScore(content: string): number {
  let parsed: { score?: unknown };
  try {
    parsed = extractJsonObject(content) as { score?: unknown };
  } catch {
    throw new Error('LLM provider returned a non-JSON bounty score');
  }
  if (typeof parsed?.score !== 'number' || !Number.isFinite(parsed.score)) {
    throw new Error('LLM provider returned a non-numeric bounty score');
  }
  return parsed.score;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
}

interface ChatCompletionParams {
  url: string;
  apiKey?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

interface ChatCompletionResult {
  content: string;
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
}

async function chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
  let response: Response;
  try {
    response = await params.fetchImpl(params.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: params.model,
        temperature: 0,
        messages: params.messages,
      }),
      signal: AbortSignal.timeout(params.timeoutMs),
    });
  } catch (error) {
    const name = (error as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(`LLM provider timed out after ${params.timeoutMs}ms`);
    }
    throw new Error(`LLM provider unreachable: ${(error as Error)?.message ?? String(error)}`);
  }
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 200);
    } catch {
      // body unavailable
    }
    throw new Error(
      `LLM provider HTTP ${response.status}: ${response.statusText}${detail ? ` — ${detail}` : ''}`
    );
  }
  const body = (await response.json()) as ChatCompletionResponse;
  const content = body?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM provider returned an empty completion');
  }
  return {
    content,
    tokensUsed: body?.usage?.total_tokens,
    promptTokens: body?.usage?.prompt_tokens,
    completionTokens: body?.usage?.completion_tokens,
  };
}

function parseProbability(content: string): { pYes: number; pNo: number } {
  let parsed: { pYes?: unknown; pNo?: unknown };
  try {
    parsed = extractJsonObject(content) as { pYes?: unknown; pNo?: unknown };
  } catch {
    throw new Error('LLM provider returned a non-JSON completion');
  }
  const pYes = parsed?.pYes;
  const pNo = parsed?.pNo;
  if (typeof pYes !== 'number' || typeof pNo !== 'number' || !Number.isFinite(pYes) || !Number.isFinite(pNo)) {
    throw new Error('LLM provider returned a non-numeric probability');
  }
  return { pYes, pNo };
}

/**
 * Converts reported token usage into USD using per-1M-token prices. Returns
 * undefined when either the prices or the token split are unknown, so no
 * expense is ever invented.
 */
export function computeCostUsd(
  usage: { promptTokens?: number; completionTokens?: number },
  prices: TokenPricing
): number | undefined {
  if (prices.priceInPerMTok === undefined || prices.priceOutPerMTok === undefined) return undefined;
  if (typeof usage.promptTokens !== 'number' || typeof usage.completionTokens !== 'number') return undefined;
  const cost =
    (usage.promptTokens * prices.priceInPerMTok + usage.completionTokens * prices.priceOutPerMTok) / 1_000_000;
  return Number.isFinite(cost) ? cost : undefined;
}

/** Cost field to spread into an estimate; empty when no cost is known. */
function costField(usage: ChatCompletionResult, prices: TokenPricing): { costUsd?: number } {
  const costUsd = computeCostUsd(usage, prices);
  return costUsd === undefined ? {} : { costUsd };
}

/** Minimal liveness completion shared by every chat-completions adapter. */
async function pingChatCompletion(
  params: Omit<ChatCompletionParams, 'messages'>
): Promise<void> {
  await chatCompletion({
    ...params,
    messages: [
      { role: 'system', content: PING_SYSTEM_PROMPT },
      { role: 'user', content: 'ping' },
    ],
  });
}

/**
 * Local provider: Ollama speaks an OpenAI-compatible chat-completions
 * endpoint, so locally hosted open models are usable as the free backend.
 */
export class OllamaProvider implements InferenceProvider {
  public readonly id: string;
  public readonly type: InferenceProviderType = 'ollama';
  public readonly free = true;
  public readonly model: string;
  public readonly baseUrl: string;
  public readonly fetchImpl: typeof fetch;
  public readonly timeoutMs: number;

  constructor(
    config: { id?: string; baseUrl: string; model: string; apiKey?: string; timeoutMs?: number },
    fetchImpl: typeof fetch = fetch
  ) {
    this.id = config.id ?? 'ollama';
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS;
  }

  private get url(): string {
    return `${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  }

  public async ping(timeoutMs: number): Promise<void> {
    await pingChatCompletion({ url: this.url, model: this.model, fetchImpl: this.fetchImpl, timeoutMs });
  }

  public async estimate(request: InferenceRequest): Promise<InferenceEstimate> {
    const { content, tokensUsed } = await chatCompletion({
      url: this.url,
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            question: request.market.question,
            outcomes: request.market.outcomePrices,
          }),
        },
      ],
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
    const { pYes, pNo } = parseProbability(content);
    return {
      pYes,
      pNo,
      origin: 'provider',
      providerId: this.id,
      model: this.model,
      tokensUsed,
    };
  }

  public async evaluateBounty(request: BountyInferenceRequest): Promise<InferenceScoreEstimate> {
    const { content, tokensUsed } = await chatCompletion({
      url: this.url,
      model: this.model,
      messages: [
        { role: 'system', content: BOUNTY_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(request.task) },
      ],
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
    return { score: parseScore(content), origin: 'provider', providerId: this.id, model: this.model, tokensUsed };
  }
}

/**
 * Hosted provider: speaks the OpenAI chat-completions wire protocol. When
 * per-token prices are configured, the token split reported by the provider
 * is converted into `costUsd`, which the engine books as EXPENSE_LLM only in
 * paid mode.
 */
export class OpenAIProvider implements InferenceProvider {
  public readonly id: string;
  public readonly type: InferenceProviderType = 'openai';
  public readonly free: boolean;
  public readonly model: string;
  public readonly baseUrl: string;
  public readonly apiKey?: string;
  public readonly fetchImpl: typeof fetch;
  public readonly timeoutMs: number;
  public readonly priceInPerMTok?: number;
  public readonly priceOutPerMTok?: number;

  constructor(
    config: {
      id?: string;
      baseUrl: string;
      model: string;
      apiKey?: string;
      free?: boolean;
      timeoutMs?: number;
    } & TokenPricing,
    fetchImpl: typeof fetch = fetch
  ) {
    this.id = config.id ?? 'openai';
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.free = config.free ?? false;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS;
    this.priceInPerMTok = config.priceInPerMTok;
    this.priceOutPerMTok = config.priceOutPerMTok;
  }

  private get url(): string {
    return `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
  }

  private costFor(result: ChatCompletionResult): { costUsd?: number } {
    return costField(result, { priceInPerMTok: this.priceInPerMTok, priceOutPerMTok: this.priceOutPerMTok });
  }

  public async ping(timeoutMs: number): Promise<void> {
    await pingChatCompletion({
      url: this.url,
      apiKey: this.apiKey,
      model: this.model,
      fetchImpl: this.fetchImpl,
      timeoutMs,
    });
  }

  public async estimate(request: InferenceRequest): Promise<InferenceEstimate> {
    const result = await chatCompletion({
      url: this.url,
      apiKey: this.apiKey,
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            question: request.market.question,
            outcomes: request.market.outcomePrices,
          }),
        },
      ],
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
    const { pYes, pNo } = parseProbability(result.content);
    return {
      pYes,
      pNo,
      origin: 'provider',
      providerId: this.id,
      model: this.model,
      tokensUsed: result.tokensUsed,
      ...this.costFor(result),
    };
  }

  public async evaluateBounty(request: BountyInferenceRequest): Promise<InferenceScoreEstimate> {
    const result = await chatCompletion({
      url: this.url,
      apiKey: this.apiKey,
      model: this.model,
      messages: [
        { role: 'system', content: BOUNTY_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(request.task) },
      ],
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
    return {
      score: parseScore(result.content),
      origin: 'provider',
      providerId: this.id,
      model: this.model,
      tokensUsed: result.tokensUsed,
      ...this.costFor(result),
    };
  }
}

/**
 * Factory: resolves a provider adapter from its configuration entry.
 */
export function createInferenceProvider(
  config: InferenceProviderConfig,
  fetchImpl: typeof fetch = fetch
): InferenceProvider {
  if (config.type === 'ollama') {
    const { id, ...rest } = config;
    return new OllamaProvider({ ...rest, id }, fetchImpl);
  }
  const { id, ...rest } = config;
  return new OpenAIProvider({ ...rest, id }, fetchImpl);
}
