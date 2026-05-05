export interface BrainConfig {
  /** Absolute path to the local LLM model file (.gguf). */
  llmModelPath:     string;
  /** Absolute path to the local embedding model file (.gguf). */
  embedModelPath:   string;
  /** Absolute path to the local Whisper model file (.bin). */
  whisperModelPath: string;
  /** Absolute path to the local RAG SQLite database. */
  ragDbPath:        string;
}

export interface MarketContext {
  prices:       Record<string, number>;
  timestamp:    number;
  oracleSource: string;
}

export interface AgentDecision {
  intent:     import("@warden/fhe").ActionIntent;
  confidence: number;
  reasoning:  string;
}
