#!/usr/bin/env bash
#
# Thin wrapper around `aztec start --local-network`.
#
# IMPORTANT — what this does NOT do
# ---------------------------------
# It does NOT fix the "Tx dropped by P2P node" clock-drift problem. That drift is
# driven by the local-network's TestDateProvider (aztec/dest/local-network/
# local-network.js), which bumps its clock offset forward during block production
# and epoch settlement, unbounded and much faster than real time. AZTEC_SLOT_DURATION
# does not control it (an earlier attempt to "fix" drift via slot durations was
# wrong and is intentionally NOT present here). Once the chain clock runs far enough
# ahead of wall-clock, valid txs that simulate fine still get dropped at inclusion,
# and the only recovery is a restart (anvil timestamps are monotonic, so a drifted
# chain cannot be realigned in place).
#
# Practical workflow:
#   * Run `npm run localnet:drift` before/after a session to see how far the chain
#     clock has run ahead. When it is large, restart the network before testing.
#   * Restart = re-run this + re-bootstrap contracts.

set -euo pipefail

exec aztec start --local-network "$@"
