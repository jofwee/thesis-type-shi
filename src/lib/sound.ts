"use client";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  return audioCtx;
}

function beep(frequency: number, startTime: number, duration: number, ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

let cachedVoices: SpeechSynthesisVoice[] | null = null;

function getVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  // Chrome loads voices asynchronously; the first call can return [] even
  // though voices exist. Cache once populated so we don't re-query every alert.
  if (cachedVoices && cachedVoices.length) return cachedVoices;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) cachedVoices = voices;
  return voices;
}

function findFilipinoVoice(): SpeechSynthesisVoice | null {
  const voices = getVoices();
  return (
    voices.find((v) => /^fil|^tl/i.test(v.lang) || /filipino|tagalog/i.test(v.name)) ?? null
  );
}

export function playFatigueAlert() {
  const ctx = getAudioContext();
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    beep(880, now, 0.15, ctx);
    beep(880, now + 0.22, 0.15, ctx);
    beep(660, now + 0.44, 0.25, ctx);
  }

  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const filipinoVoice = findFilipinoVoice();

    // Most browsers/OSes have no real Filipino voice installed — setting
    // lang="fil-PH" alone doesn't fix that, the default voice just reads the
    // literal spelling with English letter-to-sound rules and mangles it
    // (e.g. rhyming "Gising" with "rising"). If we found a real Filipino
    // voice, use the correct spelling; otherwise respell it phonetically
    // ("Ghee-sing" — hard G, like the word "ghee" — plus "sing") so a
    // default English voice lands close to the real /ˈɡisɪŋ/ pronunciation.
    const text = filipinoVoice ? "Gising! Gising!" : "Ghee-sing! Ghee-sing!";
    const utterance = new SpeechSynthesisUtterance(text);
    if (filipinoVoice) {
      utterance.voice = filipinoVoice;
      utterance.lang = filipinoVoice.lang;
    } else {
      utterance.lang = "en-US";
    }
    utterance.rate = 0.95;
    utterance.pitch = 1.05;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  }
}
