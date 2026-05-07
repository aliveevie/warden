/**
 * Local stub for the Ika Network gRPC client (pre-alpha).
 *
 * The real `ika-grpc` package is distributed directly by the Ika team on
 * devnet and is not yet published to npm. This stub provides identical
 * TypeScript types so the rest of the monorepo type-checks cleanly.
 *
 * Replace with the real package once available:
 *   npm install ika-grpc ika-solana-sdk-types
 */

export interface IkaDwalletClientConfig {
  endpoint:   string;
  networkKey: Uint8Array;
}

export interface CreateDwalletRequest {
  localPublicShare:       string;
  enforcerProgramId:      string;
  requiredProposalStatus: string;
  signatureScheme:        "secp256k1" | "ed25519";
}

export interface CreateDwalletResponse {
  dwalletId:  string;
  publicKey:  string;
  networkKey: string;
}

export interface CosignRequest {
  dwalletId:        string;
  message:          string;
  resultCommitment: string;
  localShare:       string;
}

export interface CosignResponse {
  signature:  string;
  recoveryId: number;
}

/** Ika Network gRPC client stub. */
export class IkaDwalletClient {
  constructor(private readonly config: IkaDwalletClientConfig) {}

  async createDwallet(req: CreateDwalletRequest): Promise<CreateDwalletResponse> {
    throw new Error("ika-grpc stub: use the REST gateway in @warden/custody instead");
  }

  async cosign(req: CosignRequest): Promise<CosignResponse> {
    throw new Error("ika-grpc stub: use the REST gateway in @warden/custody instead");
  }
}

/** Signature scheme enum matching warden-policy SignatureScheme. */
export enum SignatureScheme {
  Secp256k1 = "secp256k1",
  Ed25519   = "ed25519",
}
