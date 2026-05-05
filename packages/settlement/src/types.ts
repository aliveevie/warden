export type VkScopeType = "full" | "dateRange" | "positionSet";

export interface VkScope {
  type:        VkScopeType;
  from?:       number;
  to?:         number;
  positionIds?: Uint8Array[];
}

export interface SettlementTransfer {
  recipientCommitment: Uint8Array;
  encryptedAmount:     Uint8Array;
  nullifier:           Uint8Array;
}
