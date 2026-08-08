// Voice transcription (M3). Abstracted behind a single transcribe() function so
// the provider can be swapped (e.g. Groq) without touching the voice flow.
//
// Default: OpenAI Whisper (POST /v1/audio/transcriptions, model whisper-1) —
// Anthropic has no audio transcription, and this is one HTTP call.
const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";

export function isTranscriptionConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Transcribe an audio buffer to text. Throws on misconfiguration or API error;
 * callers decide how to surface that to the user.
 */
export async function transcribe(audio: Buffer, filename = "voice.ogg"): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");

  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/ogg" }), filename);

  const res = await fetch(WHISPER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Whisper transcription failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
