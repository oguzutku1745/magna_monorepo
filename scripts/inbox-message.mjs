import { InboxArtifact } from '@aztec-labs/ethereum/l1-artifacts';
export const inboxMessageSentEvent = InboxArtifact.contractAbi.find(item => item.type === 'event' && item.name === 'MessageSent');
export function selectInboxMessage(logs, expected) {
  const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
  const matches = logs.filter(({args}) => {
    const message = args?.message;
    return message && same(args.hash, expected.hash) && message.index === expected.index &&
      same(message.recipient.actor, expected.recipient) && same(message.sender.actor, expected.sender) &&
      same(message.content, expected.content) && same(message.secretHash, expected.secretHash);
  });
  if (matches.length !== 1) throw new Error(`Expected exactly one matching V6 Inbox message; found ${matches.length}.`);
  return matches[0].args.message.index;
}
