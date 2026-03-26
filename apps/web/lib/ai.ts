// ============================================================
// BLOOM SPINE — callAI wrapper
// Claude primary, GPT-4o fallback. Logs every call to ai_usage_log.
// spec rule 4: Claude primary, GPT-4o fallback. Log every call with cost.
// spec rule 30: Keep under $25/venue/month.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createServiceClient } from '@/lib/supabase/server';

// Lazy singletons — instantiated on first use so missing keys only throw
// when AI is actually called, not at module load time (which would crash
// the entire /api/trpc route for every request).
let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// Claude pricing (per million tokens, in cents)
const CLAUDE_INPUT_COST_PER_M = 300;   // $3.00/M input
const CLAUDE_OUTPUT_COST_PER_M = 1500; // $15.00/M output

// GPT-4o pricing (per million tokens, in cents)
const GPT4O_INPUT_COST_PER_M = 250;    // $2.50/M input
const GPT4O_OUTPUT_COST_PER_M = 1000;  // $10.00/M output

// Whisper pricing: $0.006/minute = 0.6 cents/minute
const WHISPER_COST_PER_MINUTE_CENTS = 0.6;

export interface AIResult {
  text: string;
  provider: 'claude' | 'gpt4o';
  fallbackUsed: boolean;
}

export interface AIOptions {
  systemPrompt?: string;
  maxTokens?: number;
  venueId?: string;
  taskType?: string;
  temperature?: number;
}

/**
 * Fire-and-forget: logs usage to Supabase. Never awaited by callers,
 * never throws — failures are silently swallowed so AI calls are unaffected.
 */
function logAIUsage(
  provider: 'claude' | 'gpt4o' | 'whisper',
  taskType: string,
  latencyMs: number,
  inputTokens: number,
  outputTokens: number,
  success: boolean,
  fallbackUsed: boolean,
  venueId?: string,
  durationMinutes?: number
): void {
  try {
    let costCents: number;

    if (provider === 'whisper') {
      // Whisper: cost based on audio duration
      costCents = Math.round((durationMinutes ?? 0) * WHISPER_COST_PER_MINUTE_CENTS * 100) / 100;
    } else if (provider === 'claude') {
      costCents = Math.round(
        (inputTokens / 1_000_000) * CLAUDE_INPUT_COST_PER_M +
        (outputTokens / 1_000_000) * CLAUDE_OUTPUT_COST_PER_M
      );
    } else {
      // gpt4o
      costCents = Math.round(
        (inputTokens / 1_000_000) * GPT4O_INPUT_COST_PER_M +
        (outputTokens / 1_000_000) * GPT4O_OUTPUT_COST_PER_M
      );
    }

    const supabase = createServiceClient();
    // Fire-and-forget — intentionally not awaited.
    // Wrap in Promise.resolve to ensure .catch is available on all promise-like types.
    Promise.resolve(
      supabase.from('ai_usage_log').insert({
        venue_id: venueId ?? null,
        provider,
        task_type: taskType,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_cents: costCents,
        latency_ms: latencyMs,
        success,
        fallback_used: fallbackUsed,
      })
    ).then(({ error }) => {
      if (error) console.error('[logAIUsage] insert failed:', error.message);
    }).catch(() => {
      // Swallow — logging must never break the caller
    });
  } catch {
    // Never throw on logging failures
  }
}

export async function callAI(
  prompt: string,
  opts: AIOptions = {}
): Promise<AIResult> {
  const {
    systemPrompt,
    maxTokens = 2000,
    venueId,
    taskType = 'general',
    temperature = 0.3,
  } = opts;

  const start = Date.now();

  // ── Claude (primary) ──────────────────────────────────────
  try {
    const res = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      temperature,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      res.content[0].type === 'text' ? res.content[0].text : '';
    const latency = Date.now() - start;

    logAIUsage(
      'claude',
      taskType,
      latency,
      res.usage.input_tokens,
      res.usage.output_tokens,
      true,
      false,
      venueId
    );

    return { text, provider: 'claude', fallbackUsed: false };
  } catch (claudeErr) {
    console.error('[callAI] Claude failed, falling back to GPT-4o:', claudeErr);
  }

  // ── GPT-4o (fallback) ─────────────────────────────────────
  const fallbackStart = Date.now();
  try {
    const res = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      max_tokens: maxTokens,
      temperature,
      messages: [
        ...(systemPrompt
          ? [{ role: 'system' as const, content: systemPrompt }]
          : []),
        { role: 'user' as const, content: prompt },
      ],
    });

    const text = res.choices[0]?.message?.content ?? '';
    const latency = Date.now() - fallbackStart;

    logAIUsage(
      'gpt4o',
      taskType,
      latency,
      res.usage?.prompt_tokens ?? 0,
      res.usage?.completion_tokens ?? 0,
      true,
      true,
      venueId
    );

    return { text, provider: 'gpt4o', fallbackUsed: true };
  } catch (gptErr) {
    const latency = Date.now() - fallbackStart;
    logAIUsage('gpt4o', taskType, latency, 0, 0, false, true, venueId);
    throw new Error(`Both Claude and GPT-4o failed. Last error: ${gptErr}`);
  }
}

// ── Structured JSON output ────────────────────────────────────
// Parses JSON from AI response, handles markdown code blocks
export async function callAIJson<T>(
  prompt: string,
  opts: AIOptions = {}
): Promise<T> {
  const result = await callAI(prompt, {
    ...opts,
    systemPrompt:
      (opts.systemPrompt ? opts.systemPrompt + '\n\n' : '') +
      'Respond with valid JSON only. No markdown, no code blocks, no explanation.',
  });

  // Strip markdown code blocks if present
  const cleaned = result.text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(
      `AI returned invalid JSON from ${result.provider}: ${cleaned.slice(0, 200)}`
    );
  }
}

// ── Vision (for uploads/screenshots) ─────────────────────────
export async function callAIVision(
  imageBase64: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  prompt: string,
  opts: Omit<AIOptions, 'systemPrompt'> & { systemPrompt?: string } = {}
): Promise<AIResult> {
  const { maxTokens = 2000, venueId, taskType = 'vision', systemPrompt } = opts;
  const start = Date.now();

  try {
    const res = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: imageBase64,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const text =
      res.content[0].type === 'text' ? res.content[0].text : '';
    logAIUsage(
      'claude',
      taskType,
      Date.now() - start,
      res.usage.input_tokens,
      res.usage.output_tokens,
      true,
      false,
      venueId
    );

    return { text, provider: 'claude', fallbackUsed: false };
  } catch (err) {
    logAIUsage('claude', taskType, Date.now() - start, 0, 0, false, false, venueId);
    throw err;
  }
}
