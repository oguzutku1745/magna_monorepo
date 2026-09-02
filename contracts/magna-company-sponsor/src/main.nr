mod test;

use aztec::macros::aztec;

#[aztec]
pub contract MagnaCompanySponsor {
    use aztec::{
        macros::{
            functions::{allow_phase_change, external, initializer, internal, only_self, view},
            storage::storage,
        },
        note::HintedNote,
        protocol::address::AztecAddress,
        state_vars::{PublicImmutable, PublicMutable},
    };
    use magna_issuer::{
        MagnaIssuer,
        types::{
            linked_credential_note::LinkedCredentialNote,
            linked_status_note::LinkedStatusNote,
            root_authority_note::RootAuthorityNote,
            root_status_note::RootStatusNote,
            credential_note::CredentialNote,
            status_note::StatusNote,
        },
    };
    use magna_company_rights_registry::MagnaCompanyRightsRegistry;
    use magna_lib::{InstagramCommittedClaimsWitness, PassportCommittedClaimsWitness, Policy};

    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
        issuer: PublicImmutable<AztecAddress, Context>,
        rights_registry: PublicImmutable<AztecAddress, Context>,
        max_fee_cap: PublicImmutable<u128, Context>,
        sponsored_verify_count: PublicMutable<u64, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress, max_fee_cap: u128) {
        self.storage.admin.initialize(admin);
        self.storage.max_fee_cap.initialize(max_fee_cap);
        self.storage.sponsored_verify_count.write(0);
    }

    #[external("public")]
    fn initialize_issuer(issuer: AztecAddress) {
        assert(self.msg_sender() == self.storage.admin.read(), "admin only");
        assert(issuer != AztecAddress::zero(), "issuer must be non-zero");
        self.storage.issuer.initialize(issuer);
    }

    #[external("public")]
    fn initialize_rights_registry(rights_registry: AztecAddress) {
        assert(self.msg_sender() == self.storage.admin.read(), "admin only");
        assert(rights_registry != AztecAddress::zero(), "rights registry must be non-zero");
        self.storage.rights_registry.initialize(rights_registry);
    }

    #[external("utility")]
    unconstrained fn get_sponsored_verify_count() -> u64 {
        self.storage.sponsored_verify_count.read()
    }

    #[external("public")]
    #[view]
    fn get_issuer() -> AztecAddress {
        self.storage.issuer.read()
    }

    #[external("public")]
    #[view]
    fn get_rights_registry() -> AztecAddress {
        self.storage.rights_registry.read()
    }

    #[external("public")]
    #[view]
    fn get_max_fee_cap() -> u128 {
        self.storage.max_fee_cap.read()
    }

    #[internal("private")]
    fn assert_fee_cap() {
        let gas_settings = self.context.gas_settings();
        let max_fee_upper_bound = (gas_settings.gas_limits.l2_gas as u128 * gas_settings.max_fees_per_gas.fee_per_l2_gas)
            + (gas_settings.gas_limits.da_gas as u128 * gas_settings.max_fees_per_gas.fee_per_da_gas);
        assert(max_fee_upper_bound <= self.storage.max_fee_cap.read(), "fee cap exceeded");
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsored_verify(
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        min_age_proven: u8,
        nationality_alpha3_packed: Field,
        sponsor_slot: u8,
    ) {
        let caller = self.msg_sender();
        self.internal.assert_fee_cap();

        // This contract becomes the fee payer for the transaction before it forwards
        // the verification call into the issuer's sponsored path.
        self.context.set_as_fee_payer();
        self.context.end_setup();

        MagnaIssuer::at(self.storage.issuer.read())
            .verify_sponsored(
                caller,
                policy,
                hinted_credential,
                hinted_status,
                min_age_proven,
                nationality_alpha3_packed,
                sponsor_slot,
            )
            .call(self.context);

        MagnaCompanyRightsRegistry::at(self.storage.rights_registry.read())
            .consume_right(1 as u128)
            .enqueue(self.context);
        self.enqueue_self._meter_sponsored_verify();
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsored_verify_v2(
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        let caller = self.msg_sender();
        self.internal.assert_fee_cap();

        self.context.set_as_fee_payer();
        self.context.end_setup();

        MagnaIssuer::at(self.storage.issuer.read())
            .verify_sponsored_v2(
                caller,
                policy,
                hinted_credential,
                hinted_status,
                claims_witness,
                sponsor_slot,
            )
            .call(self.context);

        MagnaCompanyRightsRegistry::at(self.storage.rights_registry.read())
            .consume_right(1 as u128)
            .enqueue(self.context);
        self.enqueue_self._meter_sponsored_verify();
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsored_verify_instagram(
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        claims_witness: InstagramCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        let caller = self.msg_sender();
        self.internal.assert_fee_cap();

        self.context.set_as_fee_payer();
        self.context.end_setup();

        MagnaIssuer::at(self.storage.issuer.read())
            .verify_sponsored_instagram(
                caller,
                policy,
                hinted_credential,
                hinted_status,
                claims_witness,
                sponsor_slot,
            )
            .call(self.context);

        MagnaCompanyRightsRegistry::at(self.storage.rights_registry.read())
            .consume_right(1 as u128)
            .enqueue(self.context);
        self.enqueue_self._meter_sponsored_verify();
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsored_verify_linked(
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        min_age_proven: u8,
        nationality_alpha3_packed: Field,
        sponsor_slot: u8,
    ) {
        let caller = self.msg_sender();
        self.internal.assert_fee_cap();

        self.context.set_as_fee_payer();
        self.context.end_setup();

        MagnaIssuer::at(self.storage.issuer.read())
            .verify_linked_sponsored(
                caller,
                policy,
                hinted_root_status,
                hinted_root_authority,
                hinted_credential,
                hinted_status,
                min_age_proven,
                nationality_alpha3_packed,
                sponsor_slot,
            )
            .call(self.context);

        MagnaCompanyRightsRegistry::at(self.storage.rights_registry.read())
            .consume_right(1 as u128)
            .enqueue(self.context);
        self.enqueue_self._meter_sponsored_verify();
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsored_verify_linked_v2(
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        let caller = self.msg_sender();
        self.internal.assert_fee_cap();

        self.context.set_as_fee_payer();
        self.context.end_setup();

        MagnaIssuer::at(self.storage.issuer.read())
            .verify_linked_sponsored_v2(
                caller,
                policy,
                hinted_root_status,
                hinted_root_authority,
                hinted_credential,
                hinted_status,
                claims_witness,
                sponsor_slot,
            )
            .call(self.context);

        MagnaCompanyRightsRegistry::at(self.storage.rights_registry.read())
            .consume_right(1 as u128)
            .enqueue(self.context);
        self.enqueue_self._meter_sponsored_verify();
    }

    #[external("private")]
    #[allow_phase_change]
    fn sponsored_verify_linked_instagram(
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        claims_witness: InstagramCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        let caller = self.msg_sender();
        self.internal.assert_fee_cap();

        self.context.set_as_fee_payer();
        self.context.end_setup();

        MagnaIssuer::at(self.storage.issuer.read())
            .verify_linked_sponsored_instagram(
                caller,
                policy,
                hinted_root_status,
                hinted_root_authority,
                hinted_credential,
                hinted_status,
                claims_witness,
                sponsor_slot,
            )
            .call(self.context);

        MagnaCompanyRightsRegistry::at(self.storage.rights_registry.read())
            .consume_right(1 as u128)
            .enqueue(self.context);
        self.enqueue_self._meter_sponsored_verify();
    }

    #[external("public")]
    #[only_self]
    fn _meter_sponsored_verify() {
        let current = self.storage.sponsored_verify_count.read();
        self.storage.sponsored_verify_count.write(current + 1);
    }
}
