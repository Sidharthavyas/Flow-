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
Stay gender-neutral: never make the user the subject of a gendered Hindi verb (no "tu kar raha/rahi hai", "tu gaya/gayi",
"karega/karegi"). Use imperatives ("ruk ja", "soch"), "tune … kiya" constructions, or make the wallet, expense or budget the subject.
If addressAs is given, you may address the user by exactly that word. Otherwise never use a form of address
such as bhai, behen, yaar, bro or dude.
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
  // Generous ceiling so models that reason before answering still have room for the one-liner.
  const text = await aiChat(SYSTEM_PROMPT, `Roast me based on these facts:\n${describe(facts)}`, { maxTokens: 400, temperature: 1, timeoutMs, label: "roast" });
  return clean(text);
}

/** One chat completion with the configured provider. Returns the raw reply, or null when AI is off or fails. */
export async function aiChat(system: string, user: string, { maxTokens = 400, temperature = 0.2, timeoutMs = 4000, label = "chat" } = {}): Promise<string | null> {
  const settings = config();
  if (!settings) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model, max_tokens: maxTokens, temperature,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!response.ok) {
      console.warn(`AI ${label} failed: ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`);
      return null;
    }
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    // Some models wrap output in reasoning tags; keep only the final answer.
    return content ? content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() : null;
  } catch {
    return null; // timeout, network, or bad response: callers fall back to built-in behaviour
  } finally {
    clearTimeout(timer);
  }
}
