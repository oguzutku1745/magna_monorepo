mod test;

use aztec::macros::aztec;

#[aztec]
pub contract MagnaVerifyMeterHookInstant {
    use aztec::{
        macros::{
            functions::{external, initializer, view},
            storage::storage,
        },
        protocol::address::AztecAddress,
        state_vars::{PublicImmutable, PublicMutable},
    };

    // Instant policy updates for E2E-only sponsorship positive-path checks.
    // V6 delayed state has a one-hour minimum, so this helper uses public state.
    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
        // Address allowed to call `meter_verify_or_revert`. Set by admin post-deploy.
        // This should be set to the MagnaIssuer contract address in production.
        issuer: PublicMutable<AztecAddress, Context>,
        allowlist_mask: PublicMutable<u64, Context>,
        metered_verify_count: PublicMutable<u64, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress, initial_allowlist_mask: u64) {
        self.storage.admin.initialize(admin);
        self.storage.issuer.write(AztecAddress::zero());
        self.storage.allowlist_mask.write(initial_allowlist_mask);
        self.storage.metered_verify_count.write(0);
    }

    #[external("public")]
    fn set_issuer(new_issuer: AztecAddress) {
        assert(self.msg_sender() == self.storage.admin.read(), "admin only");
        self.storage.issuer.write(new_issuer);
    }

    #[external("public")]
    fn schedule_allowlist_mask(new_mask: u64) {
        assert(self.msg_sender() == self.storage.admin.read(), "admin only");
        self.storage.allowlist_mask.write(new_mask);
    }

    #[external("public")]
    #[view]
    fn get_allowlist_mask() -> u64 {
        self.storage.allowlist_mask.read()
    }

    #[external("public")]
    #[view]
    fn is_credential_type_allowed(credential_type: u8) -> bool {
        let mask = self.storage.allowlist_mask.read();
        let bit = 1 as u64 << (credential_type as u64);
        (mask & bit) == bit
    }

    #[external("utility")]
    unconstrained fn get_metered_verify_count() -> u64 {
        self.storage.metered_verify_count.read()
    }

    #[external("public")]
    fn meter_verify_or_revert(credential_type: u8) {
        let issuer = self.storage.issuer.read();
        assert(issuer != AztecAddress::zero(), "issuer not set");
        assert(self.msg_sender() == issuer, "issuer only");
        let current = self.storage.metered_verify_count.read();
        self.storage.metered_verify_count.write(current + 1);
    }
}
