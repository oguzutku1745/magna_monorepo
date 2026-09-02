#!/usr/bin/env bash
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AZTEC_51_HOME="${AZTEC_51_HOME:-$HOME/.aztec/versions/5.1.0}"
NODE_24_BIN="${NODE_24_BIN:-$(command -v node)}"
FOUNDRY_BIN="${FOUNDRY_BIN:-$HOME/.foundry/bin}"
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/magna-recovery-gate-a.XXXXXX")"
WALLET_DIR="$RUN_DIR/wallet"
NETWORK_LOG="$RUN_DIR/network.log"
WALLET_LOG="$RUN_DIR/wallet.log"
RPC_URL="http://127.0.0.1:8545"
NODE_URL="http://127.0.0.1:8080"
INBOX="0x0665fbb86a3aceca91df68388ec4bbe11556ddce"
PROTOCOL_VERSION="3031439860"
CONTENT="0x4242"
PORTAL_DEPLOYER="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
PORTAL_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
DIRECT_SENDER="$PORTAL_DEPLOYER"
ARTIFACT="$SPIKE_DIR/contract/target/recovery_inbox_consumer-RecoveryInboxConsumer.json"

export AZTEC_HOME="$AZTEC_51_HOME"
export PATH="$(dirname "$NODE_24_BIN"):$AZTEC_51_HOME/bin:$FOUNDRY_BIN:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

for executable in aztec aztec-wallet anvil cast forge jq rg; do
  command -v "$executable" >/dev/null || { echo "missing executable: $executable" >&2; exit 1; }
done
node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if (( node_major < 20 )); then
  echo "Aztec 5.1 requires a modern Node runtime; received $(node --version)" >&2
  exit 1
fi

mkdir -p "$WALLET_DIR"
network_pid=""
cleanup() {
  if [[ -n "$network_pid" ]]; then
    kill -INT "$network_pid" 2>/dev/null || true
    wait "$network_pid" 2>/dev/null || true
  fi
  echo "Gate A run directory retained at: $RUN_DIR"
}
trap cleanup EXIT

echo "Compiling official Aztec 5.1 consumer and Solidity portal"
(cd "$SPIKE_DIR/contract" && aztec compile)
(cd "$SPIKE_DIR/portal" && forge build)

echo "Starting official Aztec 5.1 local network"
(cd "$SPIKE_DIR" && exec aztec start --local-network >"$NETWORK_LOG" 2>&1) &
network_pid=$!
for _ in $(seq 1 180); do
  if rg -q "Aztec Node started on chain" "$NETWORK_LOG" \
    && cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 \
    && aztec get-node-info --node-url "$NODE_URL" --json >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$network_pid" 2>/dev/null; then
    echo "Aztec local network exited before readiness" >&2
    tail -100 "$NETWORK_LOG" >&2
    exit 1
  fi
  sleep 1
done
rg -q "Aztec Node started on chain" "$NETWORK_LOG" || { echo "network readiness timed out" >&2; exit 1; }
aztec get-node-info --node-url "$NODE_URL" --json >/dev/null 2>&1 || { echo "Aztec node API readiness timed out" >&2; exit 1; }
rg -q '"realProofs":false' "$NETWORK_LOG" || { echo "expected local preset declaration was not recorded" >&2; exit 1; }

aztec-wallet --data-dir "$WALLET_DIR" import-test-accounts --json >>"$WALLET_LOG" 2>&1

portal_nonce="$(cast nonce "$PORTAL_DEPLOYER" --rpc-url "$RPC_URL")"
portal_address="$(cast compute-address "$PORTAL_DEPLOYER" --nonce "$portal_nonce" | sed -E 's/^Computed Address: //')"
portal_field="0x000000000000000000000000${portal_address#0x}"

echo "Deploying consumer with immutable portal $portal_address"
deploy_output="$RUN_DIR/consumer-deploy.log"
aztec-wallet --data-dir "$WALLET_DIR" deploy "$ARTIFACT" \
  --args "$portal_field" --from test0 --json --no-wait | tee "$deploy_output"
consumer_address="$(rg -o '"address": "0x[0-9a-f]{64}"' "$deploy_output" | tail -1 | sed -E 's/.*"(0x[0-9a-f]{64})"/\1/')"
consumer_deploy_tx="$(rg -o '"hash": "0x[0-9a-f]{64}"' "$deploy_output" | head -1 | sed -E 's/.*"(0x[0-9a-f]{64})"/\1/')"
[[ -n "$consumer_address" && -n "$consumer_deploy_tx" ]] || { echo "failed to parse consumer deployment" >&2; exit 1; }

for _ in $(seq 1 90); do
  deploy_status="$(aztec-wallet --data-dir "$WALLET_DIR" get-tx "$consumer_deploy_tx" 2>&1 || true)"
  if rg -q "Status: proven" <<<"$deploy_status"; then
    break
  fi
  sleep 2
done
rg -q "Status: proven" <<<"$deploy_status" || { echo "consumer deployment did not become proven" >&2; exit 1; }

echo "Deploying Solidity portal at the precommitted address"
portal_deploy_output="$RUN_DIR/portal-deploy.log"
(cd "$SPIKE_DIR/portal" && forge create --broadcast --rpc-url "$RPC_URL" \
  --private-key "$PORTAL_PRIVATE_KEY" src/RecoveryInboxPortal.sol:RecoveryInboxPortal \
  --constructor-args "$INBOX" "$consumer_address" "$PROTOCOL_VERSION") | tee "$portal_deploy_output"
actual_portal="$(sed -n -E 's/^Deployed to: (0x[0-9A-Fa-f]{40})$/\1/p' "$portal_deploy_output")"
portal_deploy_tx="$(sed -n -E 's/^Transaction hash: (0x[0-9a-f]{64})$/\1/p' "$portal_deploy_output")"
actual_portal_lower="$(printf '%s' "$actual_portal" | tr '[:upper:]' '[:lower:]')"
portal_address_lower="$(printf '%s' "$portal_address" | tr '[:upper:]' '[:lower:]')"
[[ "$actual_portal_lower" == "$portal_address_lower" ]] || { echo "predicted portal mismatch" >&2; exit 1; }

aztec-wallet --data-dir "$WALLET_DIR" create-secret --alias recovery-message >>"$WALLET_LOG" 2>&1
message_secret="$(aztec-wallet --data-dir "$WALLET_DIR" get-alias secrets:recovery-message 2>&1 | rg '^0x[0-9a-f]{64}$')"
secret_hash="$(aztec-wallet --data-dir "$WALLET_DIR" get-alias secrets:recovery-message:hash 2>&1 | rg '^0x[0-9a-f]{64}$')"

echo "Sending portal and direct non-portal Inbox messages"
cast send "$portal_address" 'authorize(bytes32,bytes32)' \
  "$(printf '0x%064x' 0x4242)" "$secret_hash" --private-key "$PORTAL_PRIVATE_KEY" \
  --rpc-url "$RPC_URL" --json >"$RUN_DIR/portal-send.json"
portal_l1_tx="$(jq -r '.transactionHash' "$RUN_DIR/portal-send.json")"
portal_leaf="$(jq -r '.logs[0].topics[2]' "$RUN_DIR/portal-send.json")"
portal_index_hex="$(jq -r '.logs[0].data[0:66]' "$RUN_DIR/portal-send.json")"
portal_index="$((16#${portal_index_hex#0x}))"

cast send "$INBOX" 'sendL2Message((bytes32,uint256),bytes32,bytes32)' \
  "($consumer_address,$PROTOCOL_VERSION)" "$(printf '0x%064x' 0x4242)" "$secret_hash" \
  --private-key "$PORTAL_PRIVATE_KEY" --rpc-url "$RPC_URL" --json >"$RUN_DIR/direct-send.json"
direct_l1_tx="$(jq -r '.transactionHash' "$RUN_DIR/direct-send.json")"
direct_leaf="$(jq -r '.logs[0].topics[2]' "$RUN_DIR/direct-send.json")"
direct_index_hex="$(jq -r '.logs[0].data[0:66]' "$RUN_DIR/direct-send.json")"
direct_index="$((16#${direct_index_hex#0x}))"

echo "Advancing only through normal L2 transactions until the proposer imports the messages"
for attempt in $(seq 1 12); do
  if aztec get-l1-to-l2-message-witness --contract-address "$consumer_address" \
    --message-hash "$portal_leaf" --secret "$message_secret" --node-url "$NODE_URL" \
    >"$RUN_DIR/portal-witness.log" 2>&1; then
    break
  fi
  aztec-wallet --data-dir "$WALLET_DIR" deploy "$ARTIFACT" --args "$portal_field" \
    --from test0 --json --no-wait >"$RUN_DIR/checkpoint-$attempt.log"
done
rg -q "L1 to L2 message index: $portal_index" "$RUN_DIR/portal-witness.log" || {
  echo "portal message did not enter the canonical tree" >&2; exit 1;
}
aztec get-l1-to-l2-message-witness --contract-address "$consumer_address" \
  --message-hash "$direct_leaf" --secret "$message_secret" --node-url "$NODE_URL" \
  >"$RUN_DIR/direct-witness.log"
rg -q "L1 to L2 message index: $direct_index" "$RUN_DIR/direct-witness.log" || {
  echo "direct message did not enter the canonical tree" >&2; exit 1;
}

echo "Proving the imported direct message cannot satisfy the immutable portal check"
if aztec-wallet --data-dir "$WALLET_DIR" simulate consume_recovery_authorization \
  --args "$CONTENT" "$message_secret" "$direct_index" --contract-address "$consumer_address" \
  --contract-artifact "$ARTIFACT" --from test0 >"$RUN_DIR/direct-rejection.log" 2>&1; then
  echo "direct non-portal message unexpectedly authorized consumption" >&2
  exit 1
fi
rg -q "No L1 to L2 message found" "$RUN_DIR/direct-rejection.log" || {
  echo "direct message failed for an unexpected reason" >&2; exit 1;
}

echo "Proving content and secret mutations cannot consume the portal message"
if aztec-wallet --data-dir "$WALLET_DIR" simulate consume_recovery_authorization \
  --args "0x4243" "$message_secret" "$portal_index" --contract-address "$consumer_address" \
  --contract-artifact "$ARTIFACT" --from test0 >"$RUN_DIR/content-rejection.log" 2>&1; then
  echo "mutated content unexpectedly authorized consumption" >&2
  exit 1
fi
rg -q "No L1 to L2 message found" "$RUN_DIR/content-rejection.log" || {
  echo "mutated content failed for an unexpected reason" >&2; exit 1;
}
if aztec-wallet --data-dir "$WALLET_DIR" simulate consume_recovery_authorization \
  --args "$CONTENT" "0x1" "$portal_index" --contract-address "$consumer_address" \
  --contract-artifact "$ARTIFACT" --from test0 >"$RUN_DIR/secret-rejection.log" 2>&1; then
  echo "mutated secret unexpectedly authorized consumption" >&2
  exit 1
fi
rg -q "No L1 to L2 message found" "$RUN_DIR/secret-rejection.log" || {
  echo "mutated secret failed for an unexpected reason" >&2; exit 1;
}

echo "Consuming the portal message privately with a real ClientIVC proof"
consume_output="$RUN_DIR/consume.log"
aztec-wallet --data-dir "$WALLET_DIR" send consume_recovery_authorization \
  --args "$CONTENT" "$message_secret" "$portal_index" --contract-address "$consumer_address" \
  --contract-artifact "$ARTIFACT" --from test0 --no-wait | tee "$consume_output"
consume_tx="$(sed -n -E 's/^Transaction hash: (0x[0-9a-f]{64})$/\1/p' "$consume_output")"
[[ -n "$consume_tx" ]] || { echo "failed to parse consumption transaction" >&2; exit 1; }
for _ in $(seq 1 90); do
  consume_status="$(aztec-wallet --data-dir "$WALLET_DIR" get-tx "$consume_tx" 2>&1 || true)"
  if rg -q "Status: proven" <<<"$consume_status"; then
    break
  fi
  sleep 2
done
rg -q "Status: proven" <<<"$consume_status" || { echo "consumption did not become proven" >&2; exit 1; }
printf '%s\n' "$consume_status" >"$RUN_DIR/consume-receipt.log"

echo "Proving replay and duplicate portal authorization fail"
if aztec-wallet --data-dir "$WALLET_DIR" simulate consume_recovery_authorization \
  --args "$CONTENT" "$message_secret" "$portal_index" --contract-address "$consumer_address" \
  --contract-artifact "$ARTIFACT" --from test0 >"$RUN_DIR/replay-rejection.log" 2>&1; then
  echo "replay unexpectedly succeeded" >&2
  exit 1
fi
rg -q "No non-nullified L1 to L2 message found" "$RUN_DIR/replay-rejection.log" || {
  echo "replay failed for an unexpected reason" >&2; exit 1;
}
if cast send "$portal_address" 'authorize(bytes32,bytes32)' "$(printf '0x%064x' 0x4242)" \
  "$secret_hash" --private-key "$PORTAL_PRIVATE_KEY" --rpc-url "$RPC_URL" \
  >"$RUN_DIR/duplicate-portal-rejection.log" 2>&1; then
  echo "duplicate portal authorization unexpectedly succeeded" >&2
  exit 1
fi
rg -q "authorization already accepted" "$RUN_DIR/duplicate-portal-rejection.log" || {
  echo "duplicate portal authorization failed for an unexpected reason" >&2; exit 1;
}

AZTEC_51_HOME="$AZTEC_51_HOME" RECIPIENT="$consumer_address" PORTAL="$portal_address" \
  DIRECT_SENDER="$DIRECT_SENDER" CONTENT="$CONTENT" SECRET_HASH="$secret_hash" \
  PORTAL_INDEX="$portal_index" PORTAL_LEAF="$portal_leaf" \
  DIRECT_INDEX="$direct_index" DIRECT_LEAF="$direct_leaf" \
  node "$SPIKE_DIR/scripts/verify-canonical-leaf.mjs" >"$RUN_DIR/canonical-leaves.log"

cat <<RESULT

GATE A PASS
run directory:          $RUN_DIR
consumer:               $consumer_address
consumer deploy tx:     $consumer_deploy_tx
portal:                 $portal_address
portal deploy tx:       $portal_deploy_tx
portal Inbox tx:        $portal_l1_tx
portal leaf/index:      $portal_leaf / $portal_index
direct Inbox tx:        $direct_l1_tx
direct leaf/index:      $direct_leaf / $direct_index
private consumption tx: $consume_tx
RESULT
