/**
 * Sonar Web Search Provider
 *
 * Routes Perplexity Sonar Pro requests through a local LLM proxy
 * (e.g. LiteLLM) that forwards to Perplexity. Uses plain OpenAI-compat
 * chat completions; citations come back via message.extensions.citations.
 *
 * Configuration (settings take precedence over env vars):
 *   sonar.proxyUrl  - Base URL of the LLM proxy (e.g. http://localhost:6655)
 *   sonar.apiKey    - Bearer token accepted by the proxy
 *   sonar.model     - Model name forwarded to the proxy (default: sonar-pro)
 *
 * Environment variable fallbacks:
 *   SONAR_PROXY_URL - Base URL of the LLM proxy
 *   SONAR_API_KEY   - Bearer token accepted by the proxy
 *   SONAR_MODEL     - Model name (default: sonar-pro)
 */

import type { AuthStorage, FetchImpl } from "@oh-my-pi/pi-ai";

import { settings } from "../../../config/settings";
import type { SearchCitation, SearchResponse, SearchSource } from "../../../web/search/types";
import { SearchProviderError } from "../../../web/search/types";
import type { SearchParams } from "./base";
import { SearchProvider } from "./base";
import { classifyProviderHttpError, withHardTimeout } from "./utils";

const DEFAULT_MODEL = "sonar-pro";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0.2;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function findProxyUrl(): string | null {
	try {
		const url = settings.get("sonar.proxyUrl");
		if (url) return url;
	} catch {
		// Settings not initialized yet
	}
	return process.env.SONAR_PROXY_URL ?? null;
}

function findApiKey(): string | null {
	try {
		const key = settings.get("sonar.apiKey");
		if (key) return key;
	} catch {
		// Settings not initialized yet
	}
	return process.env.SONAR_API_KEY ?? null;
}

function findModel(): string {
	try {
		const model = settings.get("sonar.model");
		if (model) return model;
	} catch {
		// Settings not initialized yet
	}
	return process.env.SONAR_MODEL ?? DEFAULT_MODEL;
}

// ---------------------------------------------------------------------------
// Wire types — proxy response shape
// ---------------------------------------------------------------------------

interface ProxyCitation {
	ref_id: number;
	title: string;
	url: string;
}

interface ProxyMessage {
	role: string;
	content: string;
	extensions?: {
		citations?: ProxyCitation[];
	};
}

interface ProxyChoice {
	index: number;
	message: ProxyMessage;
	finish_reason: string;
}

interface ProxyUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

interface ProxyResponse {
	id: string;
	model: string;
	choices: ProxyChoice[];
	usage?: ProxyUsage;
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function callProxyApi(
	proxyUrl: string,
	apiKey: string,
	body: Record<string, unknown>,
	fetchImpl: FetchImpl | undefined,
	signal?: AbortSignal,
): Promise<ProxyResponse> {
	const base = proxyUrl.replace(/\/+$/, "");
	const response = await (fetchImpl ?? fetch)(`${base}/litellm/v1/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: withHardTimeout(signal),
	});

	if (!response.ok) {
		const errorText = await response.text();
		const classified = classifyProviderHttpError("sonar", response.status, errorText);
		if (classified) throw classified;
		throw new SearchProviderError("sonar", `Sonar proxy error (${response.status}): ${errorText}`, response.status);
	}

	return response.json() as Promise<ProxyResponse>;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseResponse(response: ProxyResponse): SearchResponse {
	const message = response.choices[0]?.message;
	const answer = message?.content ?? "";
	const rawCitations = message?.extensions?.citations ?? [];

	const sources: SearchSource[] = rawCitations.map(c => ({
		title: c.title,
		url: c.url,
	}));

	const citations: SearchCitation[] = rawCitations.map(c => ({
		url: c.url,
		title: c.title,
	}));

	return {
		provider: "sonar",
		answer: answer || undefined,
		sources,
		citations: citations.length > 0 ? citations : undefined,
		usage: response.usage
			? {
					inputTokens: response.usage.prompt_tokens,
					outputTokens: response.usage.completion_tokens,
					totalTokens: response.usage.total_tokens,
				}
			: undefined,
		model: response.model,
		requestId: response.id,
		authMode: "api_key",
	};
}

// ---------------------------------------------------------------------------
// Public search function
// ---------------------------------------------------------------------------

export interface SonarSearchParams {
	query: string;
	systemPrompt?: string;
	recency?: "day" | "week" | "month" | "year";
	limit?: number;
	maxOutputTokens?: number;
	temperature?: number;
	signal?: AbortSignal;
	fetch?: FetchImpl;
}

/** Execute a Sonar Pro search via the configured LLM proxy. */
export async function searchSonar(params: SonarSearchParams): Promise<SearchResponse> {
	const proxyUrl = findProxyUrl();
	if (!proxyUrl) {
		throw new SearchProviderError(
			"sonar",
			"Sonar proxy not configured. Set sonar.proxyUrl in settings or SONAR_PROXY_URL in environment.",
		);
	}

	const apiKey = findApiKey();
	if (!apiKey) {
		throw new SearchProviderError(
			"sonar",
			"Sonar API key not configured. Set sonar.apiKey in settings or SONAR_API_KEY in environment.",
		);
	}

	const messages: Array<{ role: string; content: string }> = [];
	if (params.systemPrompt) {
		messages.push({ role: "system", content: params.systemPrompt });
	}
	messages.push({ role: "user", content: params.query });

	const body: Record<string, unknown> = {
		model: findModel(),
		messages,
		max_tokens: params.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
		temperature: params.temperature ?? DEFAULT_TEMPERATURE,
	};

	if (params.recency) {
		body.search_recency_filter = params.recency;
	}

	const response = await callProxyApi(proxyUrl, apiKey, body, params.fetch, params.signal);
	const result = parseResponse(response);

	if (params.limit && result.sources.length > params.limit) {
		result.sources = result.sources.slice(0, params.limit);
	}

	return result;
}

// ---------------------------------------------------------------------------
// Provider class
// ---------------------------------------------------------------------------

/** Search provider for Sonar Pro via LLM proxy. */
export class SonarProvider extends SearchProvider {
	readonly id = "sonar";
	readonly label = "Sonar Pro";

	isAvailable(_authStorage: AuthStorage): boolean {
		return !!findProxyUrl() && !!findApiKey();
	}

	search(params: SearchParams): Promise<SearchResponse> {
		return searchSonar({
			query: params.query,
			systemPrompt: params.systemPrompt,
			recency: params.recency,
			limit: params.limit,
			maxOutputTokens: params.maxOutputTokens,
			temperature: params.temperature,
			signal: params.signal,
			fetch: params.fetch,
		});
	}
}
