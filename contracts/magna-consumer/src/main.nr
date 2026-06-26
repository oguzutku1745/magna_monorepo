use aztec::macros::aztec;

#[aztec]
pub contract MagnaConsumer {
    use aztec::{
        macros::{
            functions::{external, initializer, only_self},
            storage::storage,
        },
        note::HintedNote,
        protocol::address::AztecAddress,
        state_vars::{PublicImmutable, PublicMutable},
    };
    use magna_issuer::{
        MagnaIssuer,
        types::{
            credential_note::CredentialNote,
            linked_credential_note::LinkedCredentialNote,
            linked_status_note::LinkedStatusNote,
            root_authority_note::RootAuthorityNote,
            root_status_note::RootStatusNote,
            status_note::StatusNote,
        },
    };
    use magna_lib::{PassportCommittedClaimsWitness, Policy};

    #[storage]
    struct Storage<Context> {
        issuer: PublicImmutable<AztecAddress, Context>,
        gated_login_count: PublicMutable<u64, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(issuer_address: AztecAddress) {
        self.storage.issuer.initialize(issuer_address);
        self.storage.gated_login_count.write(0);
    }

    #[external("private")]
    fn login_with_magna(
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        min_age_proven: u8,
        nationality_alpha3_packed: Field,
        sponsor_slot: u8,
    ) {
        let caller = self.msg_sender();
        // Private contract calls change msg_sender to the calling contract, so forward
        // the original user explicitly and let the issuer enforce note ownership.
        MagnaIssuer::at(self.storage.issuer.read())
            .verify_consumer(
                caller,
                policy,
                hinted_credential,
                hinted_status,
                min_age_proven,
                nationality_alpha3_packed,
                sponsor_slot,
            )
            .call(self.context);
        self.enqueue_self._increment_login_count();
    }

    #[external("private")]
    fn login_with_magna_v2(
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        let caller = self.msg_sender();
        MagnaIssuer::at(self.storage.issuer.read())
            .verify_consumer_v2(
                caller,
                policy,
                hinted_credential,
                hinted_status,
                claims_witness,
                sponsor_slot,
            )
            .call(self.context);
        self.enqueue_self._increment_login_count();
    }

    #[external("private")]
    fn login_with_linked_magna(
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
        // Private contract calls change msg_sender to the calling contract, so forward
        // the original user explicitly and let the issuer enforce note ownership.
        MagnaIssuer::at(self.storage.issuer.read())
            .verify_linked_consumer(
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
        self.enqueue_self._increment_login_count();
    }

    #[external("private")]
    fn login_with_linked_magna_v2(
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        let caller = self.msg_sender();
        MagnaIssuer::at(self.storage.issuer.read())
            .verify_linked_consumer_v2(
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
        self.enqueue_self._increment_login_count();
    }

    #[external("utility")]
    unconstrained fn get_gated_login_count() -> u64 {
        self.storage.gated_login_count.read()
    }

    #[external("utility")]
    unconstrained fn get_issuer() -> AztecAddress {
        self.storage.issuer.read()
    }

    #[external("public")]
    #[only_self]
    fn _increment_login_count() {
        let current = self.storage.gated_login_count.read();
        self.storage.gated_login_count.write(current + 1);
    }
}
