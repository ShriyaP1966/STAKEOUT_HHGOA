// Voice input for the web app (Person 3 imports this). React, no extra dependencies.
// Engine: browser speech recognition. The screen always says which engine is used.
// Wispr Flow is NOT wired in: its availability is unconfirmed. Add it as a second engine once the sponsor confirms.
import { useRef, useState } from "react";

type Props = {
  /** BCP-47 language tag, e.g. from app config. Required so no language is hardcoded here. */
  lang: string;
  onText: (text: string) => void;
};

export function VoiceInput({ lang, onText }: Props) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<any>(null);

  const Ctor = typeof window !== "undefined" ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;
  const engine = "Browser speech recognition";

  function start() {
    setError(null);
    if (!Ctor) return setError("This browser has no speech recognition. Type the complaint instead (Chrome or Edge support voice).");
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = false;
    rec.onresult = (e: any) => onText(Array.from(e.results).map((r: any) => r[0].transcript).join(" "));
    rec.onerror = (e: any) => setError(`Voice error: ${e.error}`);
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
