// Optional AI-written roasts (server only). Nothing provider- or model-specific lives in code: every provider is
// called through the OpenAI-compatible chat completions API, configured entirely by environment variables.
//   ROAST_AI_PROVIDER  "groq" | "gemini" | "custom"   (picks a default base URL and key variable)
//   ROAST_AI_MODEL     model id, e.g. whatever your provider currently lists (required)
//   ROAST_AI_API_KEY   key (or GROQ_API_KEY / GEMINI_API_KEY for those providers)
//   ROAST_AI_BASE_URL  optional override, required for "custom"
// Without a provider, key and model, every function returns null and Flow uses its built-in lines.
// Only numbers, categories and descriptions are sent — never the user's name or email.

const SYSTEM_PROMPT = `You are Flow, a witty Indian friend inside a personal finance app who roasts the user about their spending.
Write ONE roast in casual Hinglish (Roman script, Hindi + English mix), max 22 words.
Tone: funny, sharp, sarcastic, slightly savage, but ultimately supportive.
Use the facts given — mention a real amount or category when it makes the joke land. Never invent numbers.
Never use profanity, slurs, or jokes about body, caste, religion, gender, or family members' character.
Match the heat to the level: mild = cheeky raised eyebrow; hot = proper roast; inferno = full savage drama.
Reply with the roast only: no quotes, no hashtags, no explanation.`;

// Only the OpenAI-compatible endpoint roots; these are stable across model releases and can be overridden.
const DEFAULT_BASE_URLS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};
const PROVIDER_KEY_VARS: Record<string, string> = { groq: "GROQ_API_KEY", gemini: "GEMINI_API_KEY" };

export type RoastFacts = Record<string, string | number | undefined>;

function config() {
  const provider = (process.env.ROAST_AI_PROVIDER || "").trim().toLowerCase();
  const baseUrl = (process.env.ROAST_AI_BASE_URL || DEFAULT_BASE_URLS[provider] || "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.ROAST_AI_API_KEY || process.env[PROVIDER_KEY_VARS[provider] ?? ""] || "").trim();
  const model = (process.env.ROAST_AI_MODEL || "").trim();
  return provider && baseUrl && apiKey && model ? { baseUrl, apiKey, model } : null;
}

function clean(text: string | undefined | null) {
  if (!text) return null;
  // Some models wrap output in reasoning tags; keep only the final answer.
  const answer = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const line = answer.replace(/\s+/g, " ").replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "").trim();
  if (line.length < 8 || line.length > 220) return null;
  return line;
}

function describe(facts: RoastFacts) {
  return Object.entries(facts).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`).join("\n");
}

export function aiRoastEnabled() {
  return config() !== null;
}

export async function aiRoast(facts: RoastFacts, timeoutMs = 4000): Promise<string | null> {
  const settings = config();
  if (!settings) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        // Generous ceiling so models that reason before answering still have room for the one-liner.
        max_tokens: 400, temperature: 1,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `Roast me based on these facts:\n${describe(facts)}` }],
      }),
    });
    if (!response.ok) {
      console.warn(`AI roast failed: ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`);
      return null;
    }
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return clean(data.choices?.[0]?.message?.content);
  } catch {
    return null; // timeout, network, or bad response: caller falls back to built-in lines
  } finally {
    clearTimeout(timer);
  }
}
