import { BrainConfig } from "./types";

/**
 * Retrieves the top-k most relevant context chunks from the local RAG index
 * for a given query. Uses @qvac/embed-llamacpp for embedding generation and
 * sqlite-vss for vector search.
 * Full implementation delivered in PR-2.
 */
export async function retrieveContext(
  _config: BrainConfig,
  _query: string,
  _topK: number,
): Promise<string[]> {
  // TODO(PR-2)
  throw new Error("Not implemented — pending PR-2");
}

/**
 * Indexes a new document into the local RAG store.
 */
export async function indexDocument(
  _config: BrainConfig,
  _content: string,
  _metadata: Record<string, string>,
): Promise<void> {
  // TODO(PR-2)
  throw new Error("Not implemented — pending PR-2");
}
