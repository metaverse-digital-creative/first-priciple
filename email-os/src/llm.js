/**
 * LLM Provider — Unified interface for Gemini / OpenAI
 * 
 * Pattern: llm-provider (OpenClaw → email-os)
 * Creates a provider from environment variables.
 * Supports: Gemini (default), OpenAI
 * 
 * Usage:
 *   import { createProviderFromEnv } from './llm.js';
 *   const llm = createProviderFromEnv();
 *   const result = await llm.chat([...messages], { temperature: 0.1 });
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// Try to load .env manually (no dotenv dependency)
function loadEnv() {
    try {
        const envPath = join(ROOT, '.env');
        const content = readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const value = trimmed.slice(eqIdx + 1).trim();
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    } catch {
        // .env not found — that's fine, use process.env directly
    }
}

loadEnv();

// --- Error Class ---

class LLMError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'LLMError';
        this.provider = details.provider || 'unknown';
        this.raw = details.raw || null;
        this.retryable = details.retryable || false;
    }
}

// --- Gemini Provider ---

class GeminiProvider {
    constructor(apiKey, model = 'gemini-2.0-flash') {
        if (!apiKey || apiKey === 'your-gemini-api-key') {
            throw new LLMError('GEMINI_API_KEY not configured. Set it in email-os/.env');
        }
        this.apiKey = apiKey;
        this.model = model;
        this.name = `gemini/${model}`;
        this.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    }

    async chat(messages, options = {}) {
        const { temperature = 0.1, maxTokens = 200, json = false } = options;

        // Convert chat messages to Gemini format
        const systemMsg = messages.find(m => m.role === 'system');
        const userMsgs = messages.filter(m => m.role !== 'system');

        const body = {
            contents: userMsgs.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            })),
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens,
                ...(json ? { responseMimeType: 'application/json' } : {})
            }
        };

        // Add system instruction if present
        if (systemMsg) {
            body.systemInstruction = { parts: [{ text: systemMsg.content }] };
        }

        try {
            const response = await fetch(`${this.endpoint}?key=${this.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const err = await response.text();
                const retryable = response.status === 429 || response.status >= 500;
                throw new LLMError(`Gemini API error (${response.status}): ${err.slice(0, 200)}`, {
                    provider: this.name,
                    retryable
                });
            }

            const data = await response.json();
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!content) {
                throw new LLMError('Empty response from Gemini', { provider: this.name });
            }

            return {
                content,
                model: this.model,
                usage: {
                    promptTokens: data.usageMetadata?.promptTokenCount || 0,
                    completionTokens: data.usageMetadata?.candidatesTokenCount || 0
                }
            };
        } catch (err) {
            if (err instanceof LLMError) throw err;
            throw new LLMError(`Gemini request failed: ${err.message}`, {
                provider: this.name,
                retryable: true
            });
        }
    }
}

// --- OpenAI Provider ---

class OpenAIProvider {
    constructor(apiKey, model = 'gpt-4o-mini') {
        if (!apiKey || apiKey === 'your-openai-api-key') {
            throw new LLMError('OPENAI_API_KEY not configured.');
        }
        this.apiKey = apiKey;
        this.model = model;
        this.name = `openai/${model}`;
    }

    async chat(messages, options = {}) {
        const { temperature = 0.1, maxTokens = 200, json = false } = options;

        const body = {
            model: this.model,
            messages,
            temperature,
            max_tokens: maxTokens,
            ...(json ? { response_format: { type: 'json_object' } } : {})
        };

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const err = await response.text();
                const retryable = response.status === 429 || response.status >= 500;
                throw new LLMError(`OpenAI API error (${response.status}): ${err.slice(0, 200)}`, {
                    provider: this.name,
                    retryable
                });
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;

            if (!content) {
                throw new LLMError('Empty response from OpenAI', { provider: this.name });
            }

            return {
                content,
                model: this.model,
                usage: {
                    promptTokens: data.usage?.prompt_tokens || 0,
                    completionTokens: data.usage?.completion_tokens || 0
                }
            };
        } catch (err) {
            if (err instanceof LLMError) throw err;
            throw new LLMError(`OpenAI request failed: ${err.message}`, {
                provider: this.name,
                retryable: true
            });
        }
    }
}

// --- Factory ---

function createProviderFromEnv() {
    const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
    const model = process.env.LLM_MODEL;

    switch (provider) {
        case 'gemini':
            return new GeminiProvider(
                process.env.GEMINI_API_KEY,
                model || 'gemini-2.0-flash'
            );
        case 'openai':
            return new OpenAIProvider(
                process.env.OPENAI_API_KEY,
                model || 'gpt-4o-mini'
            );
        default:
            throw new LLMError(`Unknown LLM provider: ${provider}. Use 'gemini' or 'openai'.`);
    }
}

export { createProviderFromEnv, LLMError, GeminiProvider, OpenAIProvider };
export default createProviderFromEnv;
