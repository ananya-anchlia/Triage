// Milestone 1: hello-world Gemini call. The real intake (structured checklist pre-fill) comes in milestone 4.
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.8-flash";

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server." });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: "Reply with one short sentence saying hello from Gemini to the Triage app.",
      config: { temperature: 0 },
    });
    return res.status(200).json({ model: MODEL, reply: response.text });
  } catch (err) {
    // Log the message only; never echo the key or full request.
    console.error("Gemini call failed:", err?.message);
    return res.status(502).json({ error: "Gemini request failed." });
  }
}
