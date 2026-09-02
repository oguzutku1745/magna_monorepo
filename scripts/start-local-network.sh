#!/usr/bin/env bash
#
# Thin wrapper around `aztec start --local-network`.
#
# Aztec 5.1's AutomineSequencer places each rapidly-built local checkpoint on a
# fresh Aztec slot. Its debug warp methods do the same. With Aztec's production
# defaults (72s Aztec / 12s Ethereum), a test suite can therefore manufacture an
# hour of future chain time in only a few recovery/funding attempts.
#
# This project pins a local-only fast timing profile that was booted against the
# actual 5.1.0 local network and exercised through its real L1 deployment and L2
# setup blocks. Recovery/Fee-Juice checkpoint helpers additionally wait for wall
# time before requesting the next slot, so repeated Inbox tests cannot accumulate
# unbounded future drift. These values affect only the disposable chain-31337
# developer network; testnet/mainnet timing is not changed.

set -euo pipefail

readonly expected_eth_slot=4
readonly expected_aztec_slot=8
readonly expected_block_ms=1000

function require_local_timing_value() {
  local name="$1"
  local expected="$2"
  local existing="${!name:-}"
  if [[ -n "$existing" && "$existing" != "$expected" ]]; then
    echo "Refusing conflicting $name=$existing; Magna local profile requires $expected." >&2
    exit 1
  fi
  export "$name=$expected"
}

require_local_timing_value ETHEREUM_SLOT_DURATION "$expected_eth_slot"
require_local_timing_value AZTEC_SLOT_DURATION "$expected_aztec_slot"
require_local_timing_value SEQ_BLOCK_DURATION_MS "$expected_block_ms"

echo "[magna-localnet] timing profile: Ethereum ${expected_eth_slot}s / Aztec ${expected_aztec_slot}s / block ${expected_block_ms}ms"

exec aztec start --local-network "$@"
