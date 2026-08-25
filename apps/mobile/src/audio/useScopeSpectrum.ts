import { useCallback, useEffect, useRef, useState } from "react";
import { nativeMidiHost } from "@tonehub/midi-host-android";
import { logBands, realFftMagnitudes } from "./fft";
import { preferredPitchInputId } from "./pickPitchInput";

export type SpectrumFrame = {
  readonly bands: Float32Array;
  readonly rms: number;
};

const BANDS = 32;
const FFT_SIZE = 2048;

function micAllowed(result: unknown): boolean {
  if (result == null || typeof result !== "object") return false;
  const rec = result as Record<string, unknown>;
  if (rec.granted === true || rec.status === "granted") return true;
  const nested = rec.RECORD_AUDIO;
  if (nested && typeof nested === "object") {
    const inner = nested as Record<string, unknown>;
    return inner.granted === true || inner.status === "granted";
  }
  return false;
}

function asSamples(raw: unknown): ArrayLike<number> {
  if (raw == null) return [];
  if (Array.isArray(raw) || ArrayBuffer.isView(raw)) return raw as ArrayLike<number>;
  if (typeof raw === "object" && "length" in raw) return raw as ArrayLike<number>;
  return [];
}

/**
 * Native PCM → log-frequency bands for the Live HUD scope.
 * Stops when the screen blurs so Tuner can own AudioRecord.
 */
export function useScopeSpectrum(active: boolean) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<SpectrumFrame>({
    bands: new Float32Array(BANDS),
    rms: 0,
  });
  const prevBandsRef = useRef<Float32Array>(new Float32Array(BANDS));

  const stop = useCallback(() => {
    void nativeMidiHost?.stopPitchCapture().catch(() => undefined);
    setListening(false);
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    if (nativeMidiHost == null || typeof nativeMidiHost.startPitchCapture !== "function") {
      setError("TUNER_NATIVE_MISSING");
      return;
    }

    let cancelled = false;
    const pcm = nativeMidiHost.addListener("onPcmFrames", (event) => {
      const samples = asSamples(event.samples);
      if (samples.length < 256) return;
      let fftSize = 256;
      while (fftSize * 2 <= samples.length && fftSize < FFT_SIZE) fftSize *= 2;
      const mags = realFftMagnitudes(samples, fftSize);
      const bands = logBands(mags, event.sampleRate || 22050, BANDS, prevBandsRef.current);
      prevBandsRef.current = bands;
      const eventRms = (event as { rms?: number }).rms;
      let rms = typeof eventRms === "number" && Number.isFinite(eventRms) ? eventRms : 0;
      if (rms <= 0) {
        let sum = 0;
        const n = samples.length;
        for (let i = 0; i < n; i += 1) {
          const s = samples[i] ?? 0;
          sum += s * s;
        }
        rms = Math.sqrt(sum / Math.max(1, n));
      }
      frameRef.current = { bands, rms };
    });

    void (async () => {
      try {
        const permission = await nativeMidiHost.requestMicPermission();
        if (cancelled) return;
        if (!micAllowed(permission)) {
          setError("TUNER_MIC_DENIED");
          return;
        }
        let id = -1;
        try {
          const inputs = await nativeMidiHost.listPitchInputs();
          id = preferredPitchInputId(inputs);
        } catch {
          /* default capture */
        }
        if (cancelled) return;
        await nativeMidiHost.startPitchCapture(id);
        if (!cancelled) {
          setError(null);
          setListening(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setListening(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      pcm.remove();
      stop();
    };
  }, [active, stop]);

  return { listening, error, frameRef };
}
