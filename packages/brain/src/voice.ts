import { BrainConfig } from "./types";

export type VoiceCommand =
  | { type: "pause" }
  | { type: "resume" }
  | { type: "setMaxPositionSize"; bps: number }
  | { type: "queryPerformance" };

/**
 * Transcribes audio input using @qvac/transcription-whispercpp (fully offline)
 * and parses the transcript into a structured VoiceCommand via the local LLM.
 * Full implementation delivered in PR-2.
 */
export async function transcribeAndParse(
  _config: BrainConfig,
  _audioBuffer: Uint8Array,
): Promise<VoiceCommand> {
  // TODO(PR-2)
  throw new Error("Not implemented — pending PR-2");
}
