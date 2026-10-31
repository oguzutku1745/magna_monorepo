import type { AbiEvent } from 'viem';
export const inboxMessageSentEvent: AbiEvent;
export function selectInboxMessage(logs: readonly unknown[], expected: {hash: unknown; index: bigint; recipient: unknown; sender: unknown; content: unknown; secretHash: unknown}): bigint;
