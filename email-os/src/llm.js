/**
 * LLM Provider — OpenClaw-Pattern Multi-Provider Adapter
 * 
 * Pattern: llm-provider (openclaw → email-os)
 * Unified interface for LLM providers with retry, error normalization,
 * and provider factory. Supports Gemini, OpenAI, Claude.
 * 
 * Usage:
 *   const llm = createProviderFromEnv();
 *   const result = await llm.chat(messages, options);
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// --- Load Environment ---

function loadEnv() {
    try {
        const envPath = join(ROOT, '.env');
        const content = readFileSync(envPath, 'utf8');
        const env = {};
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const [key, ...rest] = trimmed.split('=');
            env[key.trim()] = rest.join('=').trim();
        }
        return env;
    } catch {
        return {};
    }
}

// --- Error Normalization (OpenClaw Pattern) ---

class LLMError extends Error {
    constructor(message, { provider, code, retryable = false, raw = null } = {}) {
        super(message);
        this.name = 'LLMError';
        this.provider = provider;
        this.code = code;
        this.retryable = retryable;
        this.raw = raw;
    }
}

// --- Retry with Exponential Backoff (OpenClaw Pattern) ---

async function withRetry(fn, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const initialDelay = options.initialDelay || 5000;  // 5s — longer than rate limit gap
    const maxDelay = options.maxDelay || 15000;
    const multiplier = options.multiplier || 2;

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;

            // Don't retry non-retryable errors
            if (err instanceof LLMError && !err.retryable) throw err;

            // Don't retry after last attempt
            if (attempt === maxRetries) throw err;

            const delay = Math.min(initialDelay * Math.pow(multiplier, attempt), maxDelay);
            console.warn(`  ⏳ LLM retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastError;
}

// --- Rate Limiter ---

class RateLimiter {
    constructor(maxPerMinute = 15) {
        this.maxPerMinute = maxPerMinute;
        this.minGapMs = Math.ceil(60000 / maxPerMinute) + 500; // 4.5s gap for 15 RPM
        this.lastCall = 0;
    }

    async wait() {
        const now = Date.now();
        const elapsed = now - this.lastCall;

        if (this.lastCall > 0 && elapsed < this.minGapMs) {
            const waitMs = this.minGapMs - elapsed;
            await new Promise(r => setTimeout(r, waitMs));
        }

        this.lastCall = Date.now();
    }
}

// --- Gemini Provider ---

class GeminiProvider {
    constructor(apiKey, options = {}) {
        this.name = 'gemini';
        this.apiKey = apiKey;
        this.model = options.model || 'gemini-2.0-flash';
        this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
        this.rateLimiter = new RateLimiter(options.rpm || 15);
    }

    async chat(messages, options = {}) {
        await this.rateLimiter.wait();

        const systemInstruction = messages.find(m => m.role === 'system');
        const userMessages = messages.filter(m => m.role !== 'system');

        const body = {
            contents: userMessages.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            })),
            generationConfig: {
                temperature: options.temperature ?? 0.1,
                maxOutputTokens: options.maxTokens || 500,
                responseMimeType: options.json ? 'application/json' : undefined
            }
        };

        if (systemInstruction) {
            body.systemInstruction = {
                parts: [{ text: systemInstruction.content }]
            };
        }

        return withRetry(async () => {
            const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const error = await res.text();
                const retryable = res.status === 429 || res.status >= 500;
                throw new LLMError(`Gemini API error: ${res.status}`, {
                    provider: 'gemini',
                    code: res.status,
                    retryable,
                    raw: error
                });
            }

            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            return {
                content: text,
                model: this.model,
                usage: {
                    promptTokens: data.usageMetadata?.promptTokenCount || 0,
                    completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
                    totalTokens: data.usageMetadata?.totalTokenCount || 0
                }
            };
        });
    }
}

// --- OpenAI Provider (for future use) ---

class OpenAIProvider {
    constructor(apiKey, options = {}) {
        this.name = 'openai';
        this.apiKey = apiKey;
        this.model = options.model || 'gpt-4o-mini';
        this.baseUrl = 'https://api.openai.com/v1';
    }

    async chat(messages, options = {}) {
        const body = {
            model: this.model,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            temperature: options.temperature ?? 0.1,
            max_tokens: options.maxTokens || 500
        };

        if (options.json) {
            body.response_format = { type: 'json_object' };
        }

        return withRetry(async () => {
            const res = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const error = await res.text();
                const retryable = res.status === 429 || res.status >= 500;
                throw new LLMError(`OpenAI API error: ${res.status}`, {
                    provider: 'openai', code: res.status, retryable, raw: error
                });
            }

            const data = await res.json();
            return {
                content: data.choices?.[0]?.message?.content || '',
                model: data.model,
                usage: {
                    promptTokens: data.usage?.prompt_tokens || 0,
                    completionTokens: data.usage?.completion_tokens || 0,
                    totalTokens: data.usage?.total_tokens || 0
                }
            };
        });
    }
}

// --- Provider Factory (OpenClaw Pattern) ---

function createProviderFromEnv() {
    const env = { ...loadEnv(), ...process.env };
    const provider = (env.LLM_PROVIDER || 'gemini').toLowerCase();

    switch (provider) {
        case 'gemini': {
            const key = env.GEMINI_API_KEY;
            if (!key) throw new LLMError('GEMINI_API_KEY not set in .env', { provider: 'gemini' });
            return new GeminiProvider(key, { model: env.LLM_MODEL });
        }
        case 'openai': {
            const key = env.OPENAI_API_KEY;
            if (!key) throw new LLMError('OPENAI_API_KEY not set in .env', { provider: 'openai' });
            return new OpenAIProvider(key, { model: env.LLM_MODEL });
        }
        default:
            throw new LLMError(`Unknown LLM provider: ${provider}`, { provider });
    }
}

export { LLMError, GeminiProvider, OpenAIProvider, createProviderFromEnv, withRetry };
export default createProviderFromEnv;
