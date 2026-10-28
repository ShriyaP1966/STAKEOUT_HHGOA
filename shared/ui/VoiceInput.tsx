"use client";
// Voice input for the web app (Person 3 imports this). React, no extra dependencies.
// The screen always says which engine is used.
// Wispr Flow is NOT wired in: its availability is unconfirmed. Add it as a second engine once the sponsor confirms.
import { useRef, useState } from "react";

// Minimal local types for the browser speech API, so no extra type package is needed.
interface SpeechRecognitionEventLike {
  results: ArrayLike<{ 0: { transcript: string } }>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

type Props = {
  /** BCP-47 language tag, e.g. from app config. Required so no language is hardcoded here. */
  lang: string;
  onText: (text: string) => void;
};

export function VoiceInput({ lang, onText }: Props) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // No window on the server render.
  const Ctor: SpeechRecognitionCtor | undefined =
    typeof window !== "undefined"
      ? (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition
      : undefined;
  const engine = "Browser speech recognition";

  function start() {
    setError(null);
    if (!Ctor) return setError("This browser has no speech recognition. Type the complaint instead (Chrome or Edge support voice).");
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = false;
    rec.onresult = (e) => onText(Array.from(e.results).map((r) => r[0].transcript).join(" "));
    rec.onerror = (e) => setError(`Voice error: ${e.error}`);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <div>
      <button type="button" onClick={listening ? () => recRef.current?.stop() : start}>
        {listening ? "Stop" : "Speak your complaint"}
      </button>
      <small> Engine: {engine}{Ctor ? "" : " (unavailable)"}</small>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
