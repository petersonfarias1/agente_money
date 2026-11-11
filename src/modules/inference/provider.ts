/**
 * ==============================================================================
 * APEX AEA — Inference Layer: LLM provider adapters
 * ==============================================================================
 * Provider-agnostic probability estimation with first-class local support:
 * the `ollama` provider speaks Ollama's OpenAI-compatible chat-completions
 * endpoint (`POST {baseUrl}/v1/chat/completions`), so a locally hosted open
 * model runs as the free inference backend with zero credits spent.
 */

import type {
  InferenceProvider,
  InferenceEstimate,
  InferenceRequest,
  BountyInferenceRequest,
  InferenceScoreEstimate,
} from './types.ts';
import type { InferenceProviderConfig, InferenceProviderType } from '../../types.ts';

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

function parseScore(content: string): number {
  let parsed: { score?: unknown };
  try {
    parsed = JSON.parse(content);
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
  usage?: { total_tokens?: number };
}

interface ChatCompletionParams {
  url: string;
  apiKey?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  fetchImpl: typeof fetch;
}

async function chatCompletion(params: ChatCompletionParams): Promise<{ content: string; tokensUsed?: number }> {
  const response = await params.fetchImpl(params.url, {
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
  });
  if (!response.ok) {
    throw new Error(`LLM provider HTTP ${response.status}: ${response.statusText}`);
  }
  const body = (await response.json()) as ChatCompletionResponse;
  const content = body?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM provider returned an empty completion');
  }
  return { content, tokensUsed: body?.usage?.total_tokens };
}

function parseProbability(content: string): { pYes: number; pNo: number } {
  let parsed: { pYes?: unknown; pNo?: unknown };
  try {
    parsed = JSON.parse(content);
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

  constructor(
    config: { id?: string; baseUrl: string; model: string; apiKey?: string },
    fetchImpl: typeof fetch = fetch
  ) {
    this.id = config.id ?? 'ollama';
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.fetchImpl = fetchImpl;
  }

  public async estimate(request: InferenceRequest): Promise<InferenceEstimate> {
    const { content, tokensUsed } = await chatCompletion({
      url: `${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
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
      url: `${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
      model: this.model,
      messages: [
        { role: 'system', content: BOUNTY_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(request.task) },
      ],
      fetchImpl: this.fetchImpl,
    });
    return { score: parseScore(content), origin: 'provider', providerId: this.id, model: this.model, tokensUsed };
  }
}

/**
 * Hosted provider: speaks the OpenAI chat-completions wire protocol and can
 * report token cost, which the engine books as an EXPENSE_LLM only in paid mode.
 */
export class OpenAIProvider implements InferenceProvider {
  public readonly id: string;
  public readonly type: InferenceProviderType = 'openai';
  public readonly free: boolean;
  public readonly model: string;
  public readonly baseUrl: string;
  public readonly apiKey?: string;
  public readonly fetchImpl: typeof fetch;

  constructor(
    config: { id?: string; baseUrl: string; model: string; apiKey?: string; free?: boolean },
    fetchImpl: typeof fetch = fetch
  ) {
    this.id = config.id ?? 'openai';
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.free = config.free ?? false;
    this.fetchImpl = fetchImpl;
  }

  public async estimate(request: InferenceRequest): Promise<InferenceEstimate> {
    const { content, tokensUsed } = await chatCompletion({
      url: `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
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
    });
    const { pYes, pNo } = parseProbability(content);
    return {
      pYes,
      pNo,
      origin: 'provider',
      providerId: this.id,
      model: this.model,
      tokensUsed,
      // Token counts alone do not justify inventing a USD amount. Adapters
      // with explicit provider cost metadata can populate costUsd.
    };
  }

  public async evaluateBounty(request: BountyInferenceRequest): Promise<InferenceScoreEstimate> {
    const { content, tokensUsed } = await chatCompletion({
      url: `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
      apiKey: this.apiKey,
      model: this.model,
      messages: [
        { role: 'system', content: BOUNTY_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(request.task) },
      ],
      fetchImpl: this.fetchImpl,
    });
    return { score: parseScore(content), origin: 'provider', providerId: this.id, model: this.model, tokensUsed };
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
