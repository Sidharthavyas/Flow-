// Optional AI-written roasts (server only). Set ROAST_AI_PROVIDER to "groq" or "gemini" plus that provider's key;
// without them every function here returns null and Flow uses its built-in lines.
// Only numbers, categories and descriptions are sent — never the user's name or email.

const SYSTEM_PROMPT = `You are Flow, a witty Indian friend inside a personal finance app who roasts the user about their spending.
Write ONE roast in casual Hinglish (Roman script, Hindi + English mix), max 22 words.
Tone: funny, sharp, sarcastic, slightly savage, but ultimately supportive.
Use the facts given — mention a real amount or category when it makes the joke land. Never invent numbers.
Never use profanity, slurs, or jokes about body, caste, religion, gender, or family members' character.
Match the heat to the level: mild = cheeky raised eyebrow; hot = proper roast; inferno = full savage drama.
Reply with the roast only: no quotes, no hashtags, no explanation.`;

export type RoastFacts = Record<string, string | number | undefined>;

function clean(text: string | undefined | null) {
  if (!text) return null;
  const line = text.replace(/\s+/g, " ").replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "").trim();
  if (line.length < 8 || line.length > 220) return null;
  return line;
}

function describe(facts: RoastFacts) {
  return Object.entries(facts).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`).join("\n");
}

export function aiRoastEnabled() {
  const provider = process.env.ROAST_AI_PROVIDER?.toLowerCase();
  return (provider === "groq" && Boolean(process.env.GROQ_API_KEY)) || (provider === "gemini" && Boolean(process.env.GEMINI_API_KEY));
}

export async function aiRoast(facts: RoastFacts, timeoutMs = 4000): Promise<string | null> {
  if (!aiRoastEnabled()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const prompt = `Roast me based on these facts:\n${describe(facts)}`;
  try {
    if (process.env.ROAST_AI_PROVIDER?.toLowerCase() === "groq") {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile", temperature: 1, max_tokens: 80,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
        }),
      });
      if (!response.ok) return null;
      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      return clean(data.choices?.[0]?.message?.content);
    }
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY as string },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        // 2.5 models "think" by default, which is slow and eats the token budget for a one-liner.
        generationConfig: { temperature: 1, maxOutputTokens: 80, ...(model.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return clean(data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join(""));
  } catch {
    return null; // timeout, network, or bad response: caller falls back to built-in lines
  } finally {
    clearTimeout(timer);
  }
}
