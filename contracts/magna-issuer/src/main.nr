mod internal;
mod test;
pub mod types;

use aztec::macros::aztec;

#[aztec]
pub contract MagnaIssuer {
    use aztec::{
        hash::compute_secret_hash,
        history::nullifier::assert_nullifier_did_not_exist_by,
        macros::{functions::{external, initializer, internal, only_self, view}, storage::storage},
        messages::delivery::MessageDelivery,
        note::{
            ConfirmedNote,
            HintedNote,
            note_getter_options::NoteGetterOptions,
            note_interface::NoteHash,
            note_interface::NoteProperties,
            utils::compute_confirmed_note_hash_for_nullification,
        },
        oracle::random::random,
        protocol::{
            address::{AztecAddress, EthAddress},
            hash::{compute_siloed_nullifier, poseidon2_hash_with_separator},
            traits::ToField,
        },
        state_vars::{DelayedPublicMutable, Map, Owned, PrivateSet, PublicImmutable, PublicMutable},
        utils::comparison::Comparator,
    };
    use crate::internal::{
        claims::{
            compute_instagram_claims_hash,
            compute_instagram_handle_commitment,
            compute_passport_claims_hash,
            compute_passport_claims_hash_v2,
            compute_passport_expiry_commitment,
            compute_passport_nationality_commitment,
        },
        constants::{
            MAGNA_CLAIMS_DS,
            MAGNA_INSTAGRAM_HANDLE_COMMITMENT_DS,
            MAGNA_PASSPORT_ISSUANCE_DS,
            MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS,
            MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS,
            MAGNA_REVOCATION_DS,
            MAGNA_ROOT_AUTHORITY_REVOCATION_DS,
            MAGNA_ROOT_AUTHORITY_REFRESH_AUTH_DS,
            MAGNA_ROOT_REVOCATION_DS,
            MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS,
            MAGNA_SPONSOR_POLICY_DELAY_SECONDS,
            MAGNA_SPONSOR_GATEWAY_DELAY_SECONDS,
            MAGNA_SPONSOR_RL_DS,
            MAGNA_SPONSOR_RL_MAX_SLOTS_PER_WINDOW,
            MAGNA_SPONSOR_RL_WINDOW_SECONDS,
            SCHEMA_VERSION_V1,
            SCHEMA_VERSION_V2,
        },
        errors::{assert_orchestrator_sender, assert_owners_match_sender},
        issuance::compute_passport_issuance_nullifier,
        metering::increment_counter,
        rate_limit::compute_sponsor_rate_limit_nullifier,
        revocation::{
            compute_revocation_nullifier,
            compute_root_authority_revocation_nullifier,
            compute_root_revocation_nullifier,
        },
    };
    use magna_recovery_v3_protocol::{
        compute_recovery_authorization,
        compute_recovery_intent,
    };
    use magna_verify_meter_hook::MagnaVerifyMeterHook;

    use magna_lib::{
        InstagramClaims,
        InstagramCommittedClaimsWitness,
        PassportCommittedClaimsWitness,
        PassportClaims,
        Policy,
        require_policy_matches_instagram,
        require_policy_matches_passport,
    };
    use crate::types::{
        credential_note::CredentialNote,
        linked_credential_note::LinkedCredentialNote,
        linked_recovery_note::LinkedRecoveryNote,
        linked_status_note::LinkedStatusNote,
        recovery_note::RecoveryNote,
        root_authority_note::RootAuthorityNote,
        root_recovery_note::RootRecoveryNote,
        root_status_note::RootStatusNote,
        status_note::StatusNote,
    };

    // v1 uses immutable orchestrator allowlist (single address).
    #[storage]
    struct Storage<Context> {
        orchestrator: PublicImmutable<AztecAddress, Context>,
        verify_meter_hook: PublicImmutable<AztecAddress, Context>,
        company_sponsor_gateways: Map<
            AztecAddress,
            PublicImmutable<bool, Context>,
            Context,
        >,
        disabled_company_sponsor_gateways: Map<
            AztecAddress,
            DelayedPublicMutable<bool, MAGNA_SPONSOR_GATEWAY_DELAY_SECONDS, Context>,
            Context,
        >,
        consumer_gateways: Map<
            AztecAddress,
            DelayedPublicMutable<bool, MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS, Context>,
            Context,
        >,
        disabled_consumer_gateways: Map<
            AztecAddress,
            DelayedPublicMutable<bool, MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS, Context>,
            Context,
        >,
        // Sponsorship policy that is readable in private.
        // - sponsored_credential_type_mask: bitmask of supported credential types
        sponsored_credential_type_mask: DelayedPublicMutable<u64, MAGNA_SPONSOR_POLICY_DELAY_SECONDS, Context>,
        verify_meter_count: PublicMutable<u64, Context>,
        root_authority_refresh_authorizations: Map<Field, PublicImmutable<bool, Context>, Context>,
        recovery_portal: PublicImmutable<EthAddress, Context>,
        credential_notes: Owned<PrivateSet<CredentialNote, Context>, Context>,
        status_notes: Owned<PrivateSet<StatusNote, Context>, Context>,
        recovery_notes: Owned<PrivateSet<RecoveryNote, Context>, Context>,
        root_status_notes: Owned<PrivateSet<RootStatusNote, Context>, Context>,
        root_recovery_notes: Owned<PrivateSet<RootRecoveryNote, Context>, Context>,
        root_authority_notes: Owned<PrivateSet<RootAuthorityNote, Context>, Context>,
        linked_credential_notes: Owned<PrivateSet<LinkedCredentialNote, Context>, Context>,
        linked_status_notes: Owned<PrivateSet<LinkedStatusNote, Context>, Context>,
        linked_recovery_notes: Owned<PrivateSet<LinkedRecoveryNote, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(orchestrator_address: AztecAddress, verify_meter_hook_address: AztecAddress) {
        self.storage.orchestrator.initialize(orchestrator_address);
        self.storage.verify_meter_hook.initialize(verify_meter_hook_address);
        self.storage.sponsored_credential_type_mask.schedule_value_change(0);
        self.storage.verify_meter_count.write(0);
    }

    #[external("public")]
    fn initialize_recovery_portal(recovery_portal: EthAddress) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        assert(!recovery_portal.is_zero(), "recovery portal must be non-zero");
        self.storage.recovery_portal.initialize(recovery_portal);
    }

    #[external("public")]
    fn schedule_sponsored_credential_type_mask(new_mask: u64) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        self.storage.sponsored_credential_type_mask.schedule_value_change(new_mask);
    }

    #[external("public")]
    fn add_company_sponsor_gateway(gateway: AztecAddress) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        assert(gateway != AztecAddress::zero(), "gateway must be non-zero");
        self.storage.company_sponsor_gateways.at(gateway).initialize(true);
    }

    #[external("public")]
    fn remove_company_sponsor_gateway(gateway: AztecAddress) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        assert(gateway != AztecAddress::zero(), "gateway must be non-zero");
        assert(self.storage.company_sponsor_gateways.at(gateway).read(), "gateway not allowlisted");
        self.storage.disabled_company_sponsor_gateways.at(gateway).schedule_value_change(true);
    }

    #[external("public")]
    fn add_consumer_gateway(gateway: AztecAddress) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        assert(gateway != AztecAddress::zero(), "gateway must be non-zero");
        self.storage.consumer_gateways.at(gateway).schedule_value_change(true);
    }

    #[external("public")]
    fn remove_consumer_gateway(gateway: AztecAddress) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        assert(gateway != AztecAddress::zero(), "gateway must be non-zero");
        self.storage.consumer_gateways.at(gateway).schedule_value_change(false);
        self.storage.disabled_consumer_gateways.at(gateway).schedule_value_change(true);
    }

    #[external("public")]
    fn authorize_root_authority_refresh(
        active_owner: AztecAddress,
        ghost_owner: AztecAddress,
        root_commitment: Field,
        claims_hash: Field,
        authority_expiry_ts: u64,
    ) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        assert(active_owner != AztecAddress::zero(), "refresh owner required");
        assert(ghost_owner != AztecAddress::zero(), "refresh ghost required");
        let authorization = poseidon2_hash_with_separator(
            [
                active_owner.to_field(),
                ghost_owner.to_field(),
                root_commitment,
                claims_hash,
                authority_expiry_ts as Field,
            ],
            MAGNA_ROOT_AUTHORITY_REFRESH_AUTH_DS,
        );
        self.storage.root_authority_refresh_authorizations.at(authorization).initialize(true);
    }

    #[external("public")]
    #[view]
    fn get_sponsored_credential_type_mask() -> u64 {
        self.storage.sponsored_credential_type_mask.get_current_value()
    }

    #[external("public")]
    #[view]
    fn is_company_sponsor_gateway(gateway: AztecAddress) -> bool {
        self.storage.company_sponsor_gateways.at(gateway).read() &
            !self.storage.disabled_company_sponsor_gateways.at(gateway).get_current_value()
    }

    #[external("public")]
    #[view]
    fn is_consumer_gateway(gateway: AztecAddress) -> bool {
        self.storage.consumer_gateways.at(gateway).get_current_value() &
            !self.storage.disabled_consumer_gateways.at(gateway).get_current_value()
    }

    #[external("utility")]
    unconstrained fn get_verify_meter_count() -> u64 {
        self.storage.verify_meter_count.read()
    }

    #[external("private")]
    fn register_credential(
        active_owner: AztecAddress,
        ghost_owner: AztecAddress,
        claims_hash: Field,
        credential_type: u8,
        expiry_ts: u64,
    ) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let revocation_secret = unsafe { random() };

        let credential_note = CredentialNote {
            claims_hash,
            credential_type,
            expiry_ts,
        };
        self.storage.credential_notes.at(active_owner).insert(credential_note).deliver(
            MessageDelivery::onchain_unconstrained(),
        );

        let status_note = StatusNote {
            revocation_secret,
            claims_hash,
            credential_type,
        };
        self.storage.status_notes.at(active_owner).insert(status_note).deliver(
            MessageDelivery::onchain_unconstrained(),
        );

        let recovery_note = RecoveryNote {
            revocation_secret,
            claims_hash,
            credential_type,
            expiry_ts,
        };
        self.storage.recovery_notes.at(ghost_owner).insert(recovery_note).deliver(
            MessageDelivery::onchain_unconstrained(),
        );
    }

    #[external("private")]
    fn register_credential_v2(
        active_owner: AztecAddress,
        ghost_owner: AztecAddress,
        claims_hash: Field,
        credential_type: u8,
        credential_valid_until: u64,
    ) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let revocation_secret = unsafe { random() };

        let credential_note = CredentialNote {
            claims_hash,
            credential_type,
            expiry_ts: credential_valid_until,
        };
        self.storage.credential_notes.at(active_owner).insert(credential_note).deliver(
            MessageDelivery::onchain_unconstrained(),
        );

        let status_note = StatusNote {
            revocation_secret,
            claims_hash,
            credential_type,
        };
        self.storage.status_notes.at(active_owner).insert(status_note).deliver(
            MessageDelivery::onchain_unconstrained(),
        );

        let recovery_note = RecoveryNote {
            revocation_secret,
            claims_hash,
            credential_type,
            expiry_ts: credential_valid_until,
        };
        self.storage.recovery_notes.at(ghost_owner).insert(recovery_note).deliver(
            MessageDelivery::onchain_unconstrained(),
        );
    }

    #[external("private")]
    fn register_root(active_owner: AztecAddress, ghost_owner: AztecAddress, root_commitment: Field) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        assert(root_commitment != 0, "root commitment required");

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let revocation_secret = unsafe { random() };
        self.internal.mint_root_notes(active_owner, ghost_owner, root_commitment, revocation_secret);
    }

    #[external("private")]
    fn register_root_authority(
        active_owner: AztecAddress,
        root_commitment: Field,
        claims_hash: Field,
        authority_expiry_ts: u64,
    ) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        assert(root_commitment != 0, "root commitment required");
        assert(claims_hash != 0, "authority claims hash required");

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let revocation_secret = unsafe { random() };
        self.internal.mint_root_authority_note(
            active_owner,
            root_commitment,
            claims_hash,
            authority_expiry_ts,
            revocation_secret,
        );
    }

    #[external("private")]
    fn register_rooted_passport(
        active_owner: AztecAddress,
        ghost_owner: AztecAddress,
        root_commitment: Field,
        claims_hash: Field,
        expiry_ts: u64,
    ) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        assert(root_commitment != 0, "root commitment required");
        assert(claims_hash != 0, "authority claims hash required");

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let root_revocation_secret = unsafe { random() };
        self.internal.mint_root_notes(
            active_owner,
            ghost_owner,
            root_commitment,
            root_revocation_secret,
        );

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let authority_revocation_secret = unsafe { random() };
        self.internal.mint_root_authority_note(
            active_owner,
            root_commitment,
            claims_hash,
            expiry_ts,
            authority_revocation_secret,
        );

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let linked_revocation_secret = unsafe { random() };
        self.internal.mint_linked_credential_notes(
            active_owner,
            ghost_owner,
            root_commitment,
            claims_hash,
            1,
            expiry_ts,
            linked_revocation_secret,
        );
    }

    #[external("private")]
    fn register_rooted_passport_v2(
        active_owner: AztecAddress,
        ghost_owner: AztecAddress,
        root_commitment: Field,
        claims_hash: Field,
        credential_valid_until: u64,
    ) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        assert(root_commitment != 0, "root commitment required");
        assert(claims_hash != 0, "authority claims hash required");

        // A2 binds root_commitment to the authenticated zkPassport scoped
        // nullifier. Creating this contract-siloed nullifier makes initial
        // rooted Passport issuance single-use for that stable identity.
        // Recovery and renewal preserve the existing lineage and deliberately
        // do not emit this initial-issuance nullifier again.
        let issuance_nullifier = compute_passport_issuance_nullifier(
            root_commitment,
            SCHEMA_VERSION_V2,
            1,
            MAGNA_PASSPORT_ISSUANCE_DS,
        );
        let siloed_issuance_nullifier = compute_siloed_nullifier(self.address, issuance_nullifier);
        let header = self.context.get_anchor_block_header();
        assert_nullifier_did_not_exist_by(header, siloed_issuance_nullifier);
        self.context.push_nullifier_unsafe(issuance_nullifier);

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let root_revocation_secret = unsafe { random() };
        self.internal.mint_root_notes(
            active_owner,
            ghost_owner,
            root_commitment,
            root_revocation_secret,
        );

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let authority_revocation_secret = unsafe { random() };
        self.internal.mint_root_authority_note(
            active_owner,
            root_commitment,
            claims_hash,
            credential_valid_until,
            authority_revocation_secret,
        );

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let linked_revocation_secret = unsafe { random() };
        self.internal.mint_linked_credential_notes(
            active_owner,
            ghost_owner,
            root_commitment,
            claims_hash,
            1,
            credential_valid_until,
            linked_revocation_secret,
        );
    }

    #[external("private")]
    fn register_linked_credential(
        active_owner: AztecAddress,
        ghost_owner: AztecAddress,
        root_commitment: Field,
        claims_hash: Field,
        credential_type: u8,
        expiry_ts: u64,
    ) {
        assert_orchestrator_sender(self.msg_sender(), self.storage.orchestrator.read());
        assert(root_commitment != 0, "root commitment required");

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let revocation_secret = unsafe { random() };
        self.internal.mint_linked_credential_notes(
            active_owner,
            ghost_owner,
            root_commitment,
            claims_hash,
            credential_type,
            expiry_ts,
            revocation_secret,
        );
    }

    #[external("private")]
    fn verify(
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        min_age_proven: u8,
        nationality_alpha3_packed: Field,
        sponsor_slot: u8,
    ) {
        self.internal.verify_for_caller(
            self.msg_sender(),
            policy,
            hinted_credential,
            hinted_status,
            min_age_proven,
            nationality_alpha3_packed,
            sponsor_slot,
            false,
        );
    }

    #[external("private")]
    fn verify_v2(
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        self.internal.verify_for_caller_v2(
            self.msg_sender(),
            policy,
            hinted_credential,
            hinted_status,
            claims_witness,
            sponsor_slot,
            false,
        );
    }

    #[external("private")]
    fn verify_instagram(
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        claims_witness: InstagramCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        self.internal.verify_instagram_for_caller(
            self.msg_sender(),
            policy,
            hinted_credential,
            hinted_status,
            claims_witness,
            sponsor_slot,
            false,
        );
    }

    #[external("private")]
    fn verify_sponsored(
        caller: AztecAddress,
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        min_age_proven: u8,
        nationality_alpha3_packed: Field,
        sponsor_slot: u8,
    ) {
        assert(caller != AztecAddress::zero(), "caller must be non-zero");
        let sender = self.msg_sender();
        let allowlisted = self.storage.company_sponsor_gateways.at(sender).read();
        let disabled = self.storage.disabled_company_sponsor_gateways.at(sender).get_current_value();
        assert(allowlisted & !disabled, "company sponsor only");
        self.internal.verify_for_caller(
            caller,
            policy,
            hinted_credential,
            hinted_status,
            min_age_proven,
            nationality_alpha3_packed,
            sponsor_slot,
            true,
        );
    }

    #[external("private")]
    fn verify_sponsored_v2(
        caller: AztecAddress,
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        assert(caller != AztecAddress::zero(), "caller must be non-zero");
        let sender = self.msg_sender();
        let allowlisted = self.storage.company_sponsor_gateways.at(sender).read();
        let disabled = self.storage.disabled_company_sponsor_gateways.at(sender).get_current_value();
        assert(allowlisted & !disabled, "company sponsor only");
        self.internal.verify_for_caller_v2(
            caller,
            policy,
            hinted_credential,
            hinted_status,
            claims_witness,
            sponsor_slot,
            true,
        );
    }

    #[external("private")]
    fn verify_sponsored_instagram(
        caller: AztecAddress,
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        claims_witness: InstagramCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        assert(caller != AztecAddress::zero(), "caller must be non-zero");
        let sender = self.msg_sender();
        let allowlisted = self.storage.company_sponsor_gateways.at(sender).read();
        let disabled = self.storage.disabled_company_sponsor_gateways.at(sender).get_current_value();
        assert(allowlisted & !disabled, "company sponsor only");
        self.internal.verify_instagram_for_caller(
            caller,
            policy,
            hinted_credential,
            hinted_status,
            claims_witness,
            sponsor_slot,
            true,
        );
    }

    #[external("private")]
    fn verify_consumer(
        caller: AztecAddress,
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        min_age_proven: u8,
        nationality_alpha3_packed: Field,
        sponsor_slot: u8,
    ) {
        assert(caller != AztecAddress::zero(), "caller must be non-zero");
        let sender = self.msg_sender();
        let allowlisted = self.storage.consumer_gateways.at(sender).get_current_value();
        let disabled = self.storage.disabled_consumer_gateways.at(sender).get_current_value();
        assert(allowlisted & !disabled, "consumer only");
        self.internal.verify_for_caller(
            caller,
            policy,
            hinted_credential,
            hinted_status,
            min_age_proven,
            nationality_alpha3_packed,
            sponsor_slot,
            false,
        );
    }

    #[external("private")]
    fn verify_consumer_v2(
        caller: AztecAddress,
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        assert(caller != AztecAddress::zero(), "caller must be non-zero");
        let sender = self.msg_sender();
        let allowlisted = self.storage.consumer_gateways.at(sender).get_current_value();
        let disabled = self.storage.disabled_consumer_gateways.at(sender).get_current_value();
        assert(allowlisted & !disabled, "consumer only");
        self.internal.verify_for_caller_v2(
            caller,
            policy,
            hinted_credential,
            hinted_status,
            claims_witness,
            sponsor_slot,
            false,
        );
    }

    #[external("private")]
    fn verify_linked_consumer(
        caller: AztecAddress,
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        min_age_proven: u8,
        nationality_alpha3_packed: Field,
        sponsor_slot: u8,
    ) {
        assert(caller != AztecAddress::zero(), "caller must be non-zero");
        let sender = self.msg_sender();
        let allowlisted = self.storage.consumer_gateways.at(sender).get_current_value();
        let disabled = self.storage.disabled_consumer_gateways.at(sender).get_current_value();
        assert(allowlisted & !disabled, "consumer only");
        self.internal.verify_linked_for_caller(
            caller,
            policy,
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            min_age_proven,
            nationality_alpha3_packed,
            sponsor_slot,
            false,
        );
    }

    #[external("private")]
    fn verify_linked_consumer_v2(
        caller: AztecAddress,
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        assert(caller != AztecAddress::zero(), "caller must be non-zero");
        let sender = self.msg_sender();
        let allowlisted = self.storage.consumer_gateways.at(sender).get_current_value();
        let disabled = self.storage.disabled_consumer_gateways.at(sender).get_current_value();
        assert(allowlisted & !disabled, "consumer only");
        self.internal.verify_linked_for_caller_v2(
            caller,
            policy,
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            claims_witness,
            sponsor_slot,
            false,
        );
    }

    #[external("private")]
    fn verify_linked(
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        min_age_proven: u8,
        nationality_alpha3_packed: Field,
        sponsor_slot: u8,
    ) {
        self.internal.verify_linked_for_caller(
            self.msg_sender(),
            policy,
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            min_age_proven,
            nationality_alpha3_packed,
            sponsor_slot,
            false,
        );
    }

    #[external("private")]
    fn verify_linked_v2(
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        self.internal.verify_linked_for_caller_v2(
            self.msg_sender(),
            policy,
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            claims_witness,
            sponsor_slot,
            false,
        );
    }

    #[external("private")]
    fn verify_linked_instagram(
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        claims_witness: InstagramCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        self.internal.verify_linked_instagram_for_caller(
            self.msg_sender(),
            policy,
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            claims_witness,
            sponsor_slot,
            false,
        );
    }

    #[external("private")]
    fn verify_linked_sponsored(
        caller: AztecAddress,
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        min_age_proven: u8,
        nationality_alpha3_packed: Field,
        sponsor_slot: u8,
    ) {
        assert(caller != AztecAddress::zero(), "caller must be non-zero");
        let sender = self.msg_sender();
        let allowlisted = self.storage.company_sponsor_gateways.at(sender).read();
        let disabled = self.storage.disabled_company_sponsor_gateways.at(sender).get_current_value();
        assert(allowlisted & !disabled, "company sponsor only");
        self.internal.verify_linked_for_caller(
            caller,
            policy,
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            min_age_proven,
            nationality_alpha3_packed,
            sponsor_slot,
            true,
        );
    }

    #[external("private")]
    fn verify_linked_sponsored_v2(
        caller: AztecAddress,
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        assert(caller != AztecAddress::zero(), "caller must be non-zero");
        let sender = self.msg_sender();
        let allowlisted = self.storage.company_sponsor_gateways.at(sender).read();
        let disabled = self.storage.disabled_company_sponsor_gateways.at(sender).get_current_value();
        assert(allowlisted & !disabled, "company sponsor only");
        self.internal.verify_linked_for_caller_v2(
            caller,
            policy,
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            claims_witness,
            sponsor_slot,
            true,
        );
    }

    #[external("private")]
    fn verify_linked_sponsored_instagram(
        caller: AztecAddress,
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        claims_witness: InstagramCommittedClaimsWitness,
        sponsor_slot: u8,
    ) {
        assert(caller != AztecAddress::zero(), "caller must be non-zero");
        let sender = self.msg_sender();
        let allowlisted = self.storage.company_sponsor_gateways.at(sender).read();
        let disabled = self.storage.disabled_company_sponsor_gateways.at(sender).get_current_value();
        assert(allowlisted & !disabled, "company sponsor only");
        self.internal.verify_linked_instagram_for_caller(
            caller,
            policy,
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            claims_witness,
            sponsor_slot,
            true,
        );
    }

    #[external("private")]
    fn get_credential_hinted(owner: AztecAddress, claims_hash: Field) -> HintedNote<CredentialNote> {
        assert(owner == self.msg_sender(), "owner mismatch");
        let options = NoteGetterOptions::new()
            .select(CredentialNote::properties().claims_hash, Comparator.EQ, claims_hash)
            .set_limit(1);
        let notes = self.storage.credential_notes.at(owner).get_notes(options);
        assert(notes.len() == 1, "credential note not found");
        let confirmed: ConfirmedNote<CredentialNote> = notes.get_unchecked(0);
        HintedNote {
            note: confirmed.note,
            contract_address: confirmed.contract_address,
            owner: confirmed.owner,
            randomness: confirmed.randomness,
            storage_slot: confirmed.storage_slot,
            metadata: confirmed.metadata,
        }
    }

    #[external("private")]
    fn get_status_hinted(owner: AztecAddress, claims_hash: Field) -> HintedNote<StatusNote> {
        assert(owner == self.msg_sender(), "owner mismatch");
        let options = NoteGetterOptions::new()
            .select(StatusNote::properties().claims_hash, Comparator.EQ, claims_hash)
            .set_limit(1);
        let notes = self.storage.status_notes.at(owner).get_notes(options);
        assert(notes.len() == 1, "status note not found");
        let confirmed: ConfirmedNote<StatusNote> = notes.get_unchecked(0);
        HintedNote {
            note: confirmed.note,
            contract_address: confirmed.contract_address,
            owner: confirmed.owner,
            randomness: confirmed.randomness,
            storage_slot: confirmed.storage_slot,
            metadata: confirmed.metadata,
        }
    }

    #[external("private")]
    fn get_recovery_hinted(owner: AztecAddress, claims_hash: Field) -> HintedNote<RecoveryNote> {
        assert(owner == self.msg_sender(), "owner mismatch");
        let options = NoteGetterOptions::new()
            .select(RecoveryNote::properties().claims_hash, Comparator.EQ, claims_hash)
            .set_limit(1);
        let notes = self.storage.recovery_notes.at(owner).get_notes(options);
        assert(notes.len() == 1, "recovery note not found");
        let confirmed: ConfirmedNote<RecoveryNote> = notes.get_unchecked(0);
        HintedNote {
            note: confirmed.note,
            contract_address: confirmed.contract_address,
            owner: confirmed.owner,
            randomness: confirmed.randomness,
            storage_slot: confirmed.storage_slot,
            metadata: confirmed.metadata,
        }
    }

    #[external("private")]
    fn get_root_status_hinted(owner: AztecAddress, root_commitment: Field) -> HintedNote<RootStatusNote> {
        assert(owner == self.msg_sender(), "owner mismatch");
        let options = NoteGetterOptions::new()
            .select(RootStatusNote::properties().root_commitment, Comparator.EQ, root_commitment)
            .set_limit(1);
        let notes = self.storage.root_status_notes.at(owner).get_notes(options);
        assert(notes.len() == 1, "root status note not found");
        let confirmed: ConfirmedNote<RootStatusNote> = notes.get_unchecked(0);
        HintedNote {
            note: confirmed.note,
            contract_address: confirmed.contract_address,
            owner: confirmed.owner,
            randomness: confirmed.randomness,
            storage_slot: confirmed.storage_slot,
            metadata: confirmed.metadata,
        }
    }

    #[external("private")]
    fn get_root_recovery_hinted(owner: AztecAddress, root_commitment: Field) -> HintedNote<RootRecoveryNote> {
        assert(owner == self.msg_sender(), "owner mismatch");
        let options = NoteGetterOptions::new()
            .select(RootRecoveryNote::properties().root_commitment, Comparator.EQ, root_commitment)
            .set_limit(1);
        let notes = self.storage.root_recovery_notes.at(owner).get_notes(options);
        assert(notes.len() == 1, "root recovery note not found");
        let confirmed: ConfirmedNote<RootRecoveryNote> = notes.get_unchecked(0);
        HintedNote {
            note: confirmed.note,
            contract_address: confirmed.contract_address,
            owner: confirmed.owner,
            randomness: confirmed.randomness,
            storage_slot: confirmed.storage_slot,
            metadata: confirmed.metadata,
        }
    }

    #[external("private")]
    fn get_root_authority_hinted(
        owner: AztecAddress,
        root_commitment: Field,
        claims_hash: Field,
    ) -> HintedNote<RootAuthorityNote> {
        assert(owner == self.msg_sender(), "owner mismatch");
        let options = NoteGetterOptions::new()
            .select(RootAuthorityNote::properties().root_commitment, Comparator.EQ, root_commitment)
            .select(RootAuthorityNote::properties().claims_hash, Comparator.EQ, claims_hash)
            .set_limit(1);
        let notes = self.storage.root_authority_notes.at(owner).get_notes(options);
        assert(notes.len() == 1, "root authority note not found");
        let confirmed: ConfirmedNote<RootAuthorityNote> = notes.get_unchecked(0);
        HintedNote {
            note: confirmed.note,
            contract_address: confirmed.contract_address,
            owner: confirmed.owner,
            randomness: confirmed.randomness,
            storage_slot: confirmed.storage_slot,
            metadata: confirmed.metadata,
        }
    }

    #[external("private")]
    fn get_linked_credential_hinted(
        owner: AztecAddress,
        root_commitment: Field,
        claims_hash: Field,
    ) -> HintedNote<LinkedCredentialNote> {
        assert(owner == self.msg_sender(), "owner mismatch");
        let options = NoteGetterOptions::new()
            .select(LinkedCredentialNote::properties().root_commitment, Comparator.EQ, root_commitment)
            .select(LinkedCredentialNote::properties().claims_hash, Comparator.EQ, claims_hash)
            .set_limit(1);
        let notes = self.storage.linked_credential_notes.at(owner).get_notes(options);
        assert(notes.len() == 1, "linked credential note not found");
        let confirmed: ConfirmedNote<LinkedCredentialNote> = notes.get_unchecked(0);
        HintedNote {
            note: confirmed.note,
            contract_address: confirmed.contract_address,
            owner: confirmed.owner,
            randomness: confirmed.randomness,
            storage_slot: confirmed.storage_slot,
            metadata: confirmed.metadata,
        }
    }

    #[external("private")]
    fn get_linked_status_hinted(
        owner: AztecAddress,
        root_commitment: Field,
        claims_hash: Field,
    ) -> HintedNote<LinkedStatusNote> {
        assert(owner == self.msg_sender(), "owner mismatch");
        let options = NoteGetterOptions::new()
            .select(LinkedStatusNote::properties().root_commitment, Comparator.EQ, root_commitment)
            .select(LinkedStatusNote::properties().claims_hash, Comparator.EQ, claims_hash)
            .set_limit(1);
        let notes = self.storage.linked_status_notes.at(owner).get_notes(options);
        assert(notes.len() == 1, "linked status note not found");
        let confirmed: ConfirmedNote<LinkedStatusNote> = notes.get_unchecked(0);
        HintedNote {
            note: confirmed.note,
            contract_address: confirmed.contract_address,
            owner: confirmed.owner,
            randomness: confirmed.randomness,
            storage_slot: confirmed.storage_slot,
            metadata: confirmed.metadata,
        }
    }

    #[external("private")]
    fn get_linked_recovery_hinted(
        owner: AztecAddress,
        root_commitment: Field,
        claims_hash: Field,
    ) -> HintedNote<LinkedRecoveryNote> {
        assert(owner == self.msg_sender(), "owner mismatch");
        let options = NoteGetterOptions::new()
            .select(LinkedRecoveryNote::properties().root_commitment, Comparator.EQ, root_commitment)
            .select(LinkedRecoveryNote::properties().claims_hash, Comparator.EQ, claims_hash)
            .set_limit(1);
        let notes = self.storage.linked_recovery_notes.at(owner).get_notes(options);
        assert(notes.len() == 1, "linked recovery note not found");
        let confirmed: ConfirmedNote<LinkedRecoveryNote> = notes.get_unchecked(0);
        HintedNote {
            note: confirmed.note,
            contract_address: confirmed.contract_address,
            owner: confirmed.owner,
            randomness: confirmed.randomness,
            storage_slot: confirmed.storage_slot,
            metadata: confirmed.metadata,
        }
    }

    #[external("private")]
    fn recover_root_v3(
        hinted_root_recovery: HintedNote<RootRecoveryNote>,
        destination: AztecAddress,
        recovery_nonce: Field,
        claims_hash: Field,
        credential_valid_until: u64,
        message_secret: Field,
        message_leaf_index: Field,
    ) {
        let ghost_owner = self.msg_sender();
        assert(destination != AztecAddress::zero(), "recovery destination required");
        assert(recovery_nonce != 0, "recovery nonce required");
        assert(claims_hash != 0, "recovery claims hash required");
        assert(message_secret != 0, "recovery message secret required");
        let header = self.context.get_anchor_block_header();
        let anchor_ts = header.global_variables.timestamp;
        assert(credential_valid_until > anchor_ts, "recovered credential is expired");

        let recovery_portal = self.storage.recovery_portal.read();
        let message_secret_hash = compute_secret_hash([message_secret]);
        let recovery_intent = compute_recovery_intent(
            header.global_variables.chain_id,
            recovery_portal.to_field(),
            header.global_variables.version,
            header.global_variables.chain_id,
            self.address.to_field(),
            destination.to_field(),
            recovery_nonce,
            message_secret_hash,
        );
        let recovery_authorization = compute_recovery_authorization(
            recovery_intent,
            hinted_root_recovery.note.root_commitment,
            claims_hash,
            credential_valid_until,
        );

        self.context.consume_l1_to_l2_message(
            recovery_authorization,
            [message_secret],
            recovery_portal,
            message_leaf_index,
        );

        self.internal.recover_root_for_caller(
            ghost_owner,
            hinted_root_recovery,
            destination,
        );

        // The root rotation helper intentionally handles only the shared root
        // status/recovery pair. V3 completes the same rooted passport note set
        // as issuance in this transaction, eliminating recovery_pending.
        // SAFETY: sampled privately and only committed into the
        // destination-owned authority note.
        let authority_revocation_secret = unsafe { random() };
        self.internal.mint_root_authority_note(
            destination,
            hinted_root_recovery.note.root_commitment,
            claims_hash,
            credential_valid_until,
            authority_revocation_secret,
        );
        // SAFETY: sampled privately and only committed into the
        // destination-owned linked status/recovery notes.
        let linked_revocation_secret = unsafe { random() };
        self.internal.mint_linked_credential_notes(
            destination,
            ghost_owner,
            hinted_root_recovery.note.root_commitment,
            claims_hash,
            1,
            credential_valid_until,
            linked_revocation_secret,
        );
    }

    #[external("private")]
    fn refresh_root_authority(
        ghost_owner: AztecAddress,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        claims_hash: Field,
        authority_expiry_ts: u64,
    ) {
        self.internal.refresh_root_authority_for_caller(
            self.msg_sender(),
            false,
            ghost_owner,
            hinted_root_status,
            hinted_root_authority,
            claims_hash,
            authority_expiry_ts,
        );
    }

    #[external("private")]
    fn refresh_root_authority_authorized(
        ghost_owner: AztecAddress,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        claims_hash: Field,
        authority_expiry_ts: u64,
    ) {
        self.internal.refresh_root_authority_for_caller(
            self.msg_sender(),
            true,
            ghost_owner,
            hinted_root_status,
            hinted_root_authority,
            claims_hash,
            authority_expiry_ts,
        );
    }

    #[external("private")]
    fn revoke_linked_credential(hinted_recovery: HintedNote<LinkedRecoveryNote>) {
        self.internal.revoke_linked_credential_for_caller(
            self.msg_sender(),
            hinted_recovery,
        );
    }

    #[internal("private")]
    fn verify_for_caller(
        caller: AztecAddress,
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        min_age_proven: u8,
        nationality_alpha3_packed: Field,
        sponsor_slot: u8,
        force_sponsored: bool,
    ) {
        // Caller must own the active notes used for proof generation.
        assert_owners_match_sender(hinted_credential.owner, hinted_status.owner, caller);

        let header = self.context.get_anchor_block_header();
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_credential);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_status);

        assert(
            hinted_credential.note.credential_type == hinted_status.note.credential_type,
            "credential/status type mismatch",
        );
        assert(hinted_credential.note.claims_hash == hinted_status.note.claims_hash, "claims mismatch");

        let claims_hash = compute_passport_claims_hash(
            SCHEMA_VERSION_V1,
            hinted_credential.note.credential_type,
            nationality_alpha3_packed,
            min_age_proven,
            hinted_credential.note.expiry_ts,
            MAGNA_CLAIMS_DS,
        );
        assert(claims_hash == hinted_credential.note.claims_hash, "claims hash mismatch");

        let claims = PassportClaims {
            min_age_proven,
            nationality_alpha3_packed,
            expiry_ts: hinted_credential.note.expiry_ts,
        };
        require_policy_matches_passport(policy, hinted_credential.note.credential_type, claims);

        // Inclusion guard: tx cannot be included after credential expiry.
        // If sponsorship policy is enabled, also require inclusion before the end of the current rate-limit window.
        let verify_meter_hook = self.storage.verify_meter_hook.read();
        let sponsored_mode = force_sponsored | (verify_meter_hook != AztecAddress::zero());
        let mut inclusion_deadline = hinted_credential.note.expiry_ts;
        if sponsored_mode {
            // Sponsorship eligibility must be checked in private so invalid sponsored attempts don't produce txs.
            // For backwards-compatibility during rollout, a mask of 0 means "no gating" (allow all credential types).
            let mask = self.storage.sponsored_credential_type_mask.get_current_value();
            if mask != 0 {
                let bit = 1 as u64 << (hinted_credential.note.credential_type as u64);
                assert((mask & bit) == bit, "credential type not sponsored");
            }

            assert(sponsor_slot < MAGNA_SPONSOR_RL_MAX_SLOTS_PER_WINDOW, "invalid sponsor slot");
            let anchor_ts = header.global_variables.timestamp;
            let window_id = anchor_ts / MAGNA_SPONSOR_RL_WINDOW_SECONDS;

            // Rate-limit: emit a deterministic nullifier once per (credential, window).
            // This uses only private note material + public window id, preserving privacy.
            let rl_nullifier = compute_sponsor_rate_limit_nullifier(
                hinted_status.note.revocation_secret,
                hinted_status.note.credential_type,
                hinted_status.note.claims_hash,
                window_id,
                sponsor_slot,
                MAGNA_SPONSOR_RL_DS,
            );
            self.context.push_nullifier_unsafe(rl_nullifier);

            // Also bind inclusion to the current rate-limit window end.
            let window_end = (window_id + 1) * MAGNA_SPONSOR_RL_WINDOW_SECONDS;
            if window_end < hinted_credential.note.expiry_ts {
                inclusion_deadline = window_end;
            }
        }
        self.context.set_expiration_timestamp(inclusion_deadline);

        let revocation_nullifier = compute_revocation_nullifier(
            hinted_status.note.revocation_secret,
            hinted_status.note.credential_type,
            hinted_status.note.claims_hash,
            MAGNA_REVOCATION_DS,
        );
        let siloed_revocation_nullifier = compute_siloed_nullifier(self.address, revocation_nullifier);
        assert_nullifier_did_not_exist_by(header, siloed_revocation_nullifier);

        // Metering is public so dApps can account for verify usage without exposing private note payloads.
        self.enqueue_self._meter_verify();

        // Optional verify meter hook wiring: if configured, enforce sponsored credential-type policy and meter there too.
        if verify_meter_hook != AztecAddress::zero() {
            MagnaVerifyMeterHook::at(verify_meter_hook)
                .meter_verify_or_revert(hinted_credential.note.credential_type)
                .enqueue(self.context);
        }
    }

    #[internal("private")]
    fn claims_from_committed_passport_witness(
        credential_type: u8,
        expected_claims_hash: Field,
        claims_witness: PassportCommittedClaimsWitness,
    ) -> PassportClaims {
        let nationality_commitment = compute_passport_nationality_commitment(
            claims_witness.nationality_alpha3_packed,
            claims_witness.nationality_blind,
            MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS,
        );
        let expiry_commitment = compute_passport_expiry_commitment(
            claims_witness.expiry_ts,
            claims_witness.expiry_blind,
            MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS,
        );
        let claims_hash = compute_passport_claims_hash_v2(
            SCHEMA_VERSION_V2,
            credential_type,
            nationality_commitment,
            claims_witness.min_age_proven,
            expiry_commitment,
            MAGNA_CLAIMS_DS,
        );
        assert(claims_hash == expected_claims_hash, "claims hash mismatch");

        PassportClaims {
            min_age_proven: claims_witness.min_age_proven,
            nationality_alpha3_packed: claims_witness.nationality_alpha3_packed,
            expiry_ts: claims_witness.expiry_ts,
        }
    }

    #[internal("private")]
    fn verify_for_caller_v2(
        caller: AztecAddress,
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
        force_sponsored: bool,
    ) {
        assert_owners_match_sender(hinted_credential.owner, hinted_status.owner, caller);

        let header = self.context.get_anchor_block_header();
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_credential);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_status);

        assert(
            hinted_credential.note.credential_type == hinted_status.note.credential_type,
            "credential/status type mismatch",
        );
        assert(hinted_credential.note.claims_hash == hinted_status.note.claims_hash, "claims mismatch");

        let claims = self.internal.claims_from_committed_passport_witness(
            hinted_credential.note.credential_type,
            hinted_credential.note.claims_hash,
            claims_witness,
        );
        require_policy_matches_passport(policy, hinted_credential.note.credential_type, claims);

        let verify_meter_hook = self.storage.verify_meter_hook.read();
        let sponsored_mode = force_sponsored | (verify_meter_hook != AztecAddress::zero());
        let mut inclusion_deadline = hinted_credential.note.expiry_ts;
        if sponsored_mode {
            let mask = self.storage.sponsored_credential_type_mask.get_current_value();
            if mask != 0 {
                let bit = 1 as u64 << (hinted_credential.note.credential_type as u64);
                assert((mask & bit) == bit, "credential type not sponsored");
            }

            assert(sponsor_slot < MAGNA_SPONSOR_RL_MAX_SLOTS_PER_WINDOW, "invalid sponsor slot");
            let anchor_ts = header.global_variables.timestamp;
            let window_id = anchor_ts / MAGNA_SPONSOR_RL_WINDOW_SECONDS;

            let rl_nullifier = compute_sponsor_rate_limit_nullifier(
                hinted_status.note.revocation_secret,
                hinted_status.note.credential_type,
                hinted_status.note.claims_hash,
                window_id,
                sponsor_slot,
                MAGNA_SPONSOR_RL_DS,
            );
            self.context.push_nullifier_unsafe(rl_nullifier);

            let window_end = (window_id + 1) * MAGNA_SPONSOR_RL_WINDOW_SECONDS;
            if window_end < hinted_credential.note.expiry_ts {
                inclusion_deadline = window_end;
            }
        }
        self.context.set_expiration_timestamp(inclusion_deadline);

        let revocation_nullifier = compute_revocation_nullifier(
            hinted_status.note.revocation_secret,
            hinted_status.note.credential_type,
            hinted_status.note.claims_hash,
            MAGNA_REVOCATION_DS,
        );
        let siloed_revocation_nullifier = compute_siloed_nullifier(self.address, revocation_nullifier);
        assert_nullifier_did_not_exist_by(header, siloed_revocation_nullifier);

        self.enqueue_self._meter_verify();

        if verify_meter_hook != AztecAddress::zero() {
            MagnaVerifyMeterHook::at(verify_meter_hook)
                .meter_verify_or_revert(hinted_credential.note.credential_type)
                .enqueue(self.context);
        }
    }

    #[internal("private")]
    fn verify_instagram_for_caller(
        caller: AztecAddress,
        policy: Policy,
        hinted_credential: HintedNote<CredentialNote>,
        hinted_status: HintedNote<StatusNote>,
        claims_witness: InstagramCommittedClaimsWitness,
        sponsor_slot: u8,
        force_sponsored: bool,
    ) {
        assert_owners_match_sender(hinted_credential.owner, hinted_status.owner, caller);

        let header = self.context.get_anchor_block_header();
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_credential);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_status);

        assert(
            hinted_credential.note.credential_type == hinted_status.note.credential_type,
            "credential/status type mismatch",
        );
        assert(hinted_credential.note.claims_hash == hinted_status.note.claims_hash, "claims mismatch");

        let handle_commitment = compute_instagram_handle_commitment(
            claims_witness.handle_hash,
            claims_witness.handle_blind,
            MAGNA_INSTAGRAM_HANDLE_COMMITMENT_DS,
        );
        let claims_hash = compute_instagram_claims_hash(
            SCHEMA_VERSION_V2,
            hinted_credential.note.credential_type,
            handle_commitment,
            hinted_credential.note.expiry_ts,
            MAGNA_CLAIMS_DS,
        );
        assert(claims_hash == hinted_credential.note.claims_hash, "claims hash mismatch");

        let claims = InstagramClaims {
            handle_hash: claims_witness.handle_hash,
            expiry_ts: hinted_credential.note.expiry_ts,
        };
        require_policy_matches_instagram(policy, hinted_credential.note.credential_type, claims);

        let verify_meter_hook = self.storage.verify_meter_hook.read();
        let sponsored_mode = force_sponsored | (verify_meter_hook != AztecAddress::zero());
        let mut inclusion_deadline = hinted_credential.note.expiry_ts;
        if sponsored_mode {
            let mask = self.storage.sponsored_credential_type_mask.get_current_value();
            if mask != 0 {
                let bit = 1 as u64 << (hinted_credential.note.credential_type as u64);
                assert((mask & bit) == bit, "credential type not sponsored");
            }

            assert(sponsor_slot < MAGNA_SPONSOR_RL_MAX_SLOTS_PER_WINDOW, "invalid sponsor slot");
            let anchor_ts = header.global_variables.timestamp;
            let window_id = anchor_ts / MAGNA_SPONSOR_RL_WINDOW_SECONDS;
            let rl_nullifier = compute_sponsor_rate_limit_nullifier(
                hinted_status.note.revocation_secret,
                hinted_status.note.credential_type,
                hinted_status.note.claims_hash,
                window_id,
                sponsor_slot,
                MAGNA_SPONSOR_RL_DS,
            );
            self.context.push_nullifier_unsafe(rl_nullifier);

            let window_end = (window_id + 1) * MAGNA_SPONSOR_RL_WINDOW_SECONDS;
            if window_end < hinted_credential.note.expiry_ts {
                inclusion_deadline = window_end;
            }
        }
        self.context.set_expiration_timestamp(inclusion_deadline);

        let revocation_nullifier = compute_revocation_nullifier(
            hinted_status.note.revocation_secret,
            hinted_status.note.credential_type,
            hinted_status.note.claims_hash,
            MAGNA_REVOCATION_DS,
        );
        let siloed_revocation_nullifier = compute_siloed_nullifier(self.address, revocation_nullifier);
        assert_nullifier_did_not_exist_by(header, siloed_revocation_nullifier);

        self.enqueue_self._meter_verify();

        if verify_meter_hook != AztecAddress::zero() {
            MagnaVerifyMeterHook::at(verify_meter_hook)
                .meter_verify_or_revert(hinted_credential.note.credential_type)
                .enqueue(self.context);
        }
    }

    #[internal("private")]
    fn verify_linked_for_caller(
        caller: AztecAddress,
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        min_age_proven: u8,
        nationality_alpha3_packed: Field,
        sponsor_slot: u8,
        force_sponsored: bool,
    ) {
        assert(hinted_root_status.owner == caller, "root status owner mismatch");
        assert(hinted_root_authority.owner == caller, "root authority owner mismatch");
        assert(hinted_credential.owner == caller, "linked credential owner mismatch");
        assert(hinted_status.owner == caller, "linked status owner mismatch");

        let header = self.context.get_anchor_block_header();
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_root_status);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_root_authority);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_credential);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_status);

        assert(
            hinted_credential.note.root_commitment == hinted_status.note.root_commitment,
            "linked root mismatch",
        );
        assert(
            hinted_credential.note.root_commitment == hinted_root_status.note.root_commitment,
            "root status mismatch",
        );
        assert(
            hinted_root_authority.note.root_commitment == hinted_root_status.note.root_commitment,
            "root authority mismatch",
        );
        assert(
            hinted_credential.note.credential_type == hinted_status.note.credential_type,
            "linked credential/status type mismatch",
        );
        assert(hinted_credential.note.claims_hash == hinted_status.note.claims_hash, "linked claims mismatch");
        assert(
            hinted_root_authority.note.claims_hash == hinted_credential.note.claims_hash,
            "root authority claims mismatch",
        );

        let claims_hash = compute_passport_claims_hash(
            SCHEMA_VERSION_V1,
            hinted_credential.note.credential_type,
            nationality_alpha3_packed,
            min_age_proven,
            hinted_credential.note.expiry_ts,
            MAGNA_CLAIMS_DS,
        );
        assert(claims_hash == hinted_credential.note.claims_hash, "claims hash mismatch");

        let claims = PassportClaims {
            min_age_proven,
            nationality_alpha3_packed,
            expiry_ts: hinted_credential.note.expiry_ts,
        };
        require_policy_matches_passport(policy, hinted_credential.note.credential_type, claims);

        let verify_meter_hook = self.storage.verify_meter_hook.read();
        let sponsored_mode = force_sponsored | (verify_meter_hook != AztecAddress::zero());
        let mut inclusion_deadline = hinted_credential.note.expiry_ts;
        if hinted_root_authority.note.authority_expiry_ts < inclusion_deadline {
            inclusion_deadline = hinted_root_authority.note.authority_expiry_ts;
        }
        if sponsored_mode {
            let mask = self.storage.sponsored_credential_type_mask.get_current_value();
            if mask != 0 {
                let bit = 1 as u64 << (hinted_credential.note.credential_type as u64);
                assert((mask & bit) == bit, "credential type not sponsored");
            }

            assert(sponsor_slot < MAGNA_SPONSOR_RL_MAX_SLOTS_PER_WINDOW, "invalid sponsor slot");
            let anchor_ts = header.global_variables.timestamp;
            let window_id = anchor_ts / MAGNA_SPONSOR_RL_WINDOW_SECONDS;
            let rl_nullifier = compute_sponsor_rate_limit_nullifier(
                hinted_status.note.revocation_secret,
                hinted_status.note.credential_type,
                hinted_status.note.claims_hash,
                window_id,
                sponsor_slot,
                MAGNA_SPONSOR_RL_DS,
            );
            self.context.push_nullifier_unsafe(rl_nullifier);

            let window_end = (window_id + 1) * MAGNA_SPONSOR_RL_WINDOW_SECONDS;
            if window_end < hinted_credential.note.expiry_ts {
                inclusion_deadline = window_end;
            }
        }
        self.context.set_expiration_timestamp(inclusion_deadline);

        let linked_revocation_nullifier = compute_revocation_nullifier(
            hinted_status.note.revocation_secret,
            hinted_status.note.credential_type,
            hinted_status.note.claims_hash,
            MAGNA_REVOCATION_DS,
        );
        let siloed_linked_revocation_nullifier = compute_siloed_nullifier(
            self.address,
            linked_revocation_nullifier,
        );
        assert_nullifier_did_not_exist_by(header, siloed_linked_revocation_nullifier);

        let root_revocation_nullifier = compute_root_revocation_nullifier(
            hinted_root_status.note.revocation_secret,
            hinted_root_status.note.root_commitment,
            MAGNA_ROOT_REVOCATION_DS,
        );
        let siloed_root_revocation_nullifier = compute_siloed_nullifier(
            self.address,
            root_revocation_nullifier,
        );
        assert_nullifier_did_not_exist_by(header, siloed_root_revocation_nullifier);

        let root_authority_revocation_nullifier = compute_root_authority_revocation_nullifier(
            hinted_root_authority.note.revocation_secret,
            hinted_root_authority.note.root_commitment,
            hinted_root_authority.note.claims_hash,
            MAGNA_ROOT_AUTHORITY_REVOCATION_DS,
        );
        let siloed_root_authority_revocation_nullifier = compute_siloed_nullifier(
            self.address,
            root_authority_revocation_nullifier,
        );
        assert_nullifier_did_not_exist_by(header, siloed_root_authority_revocation_nullifier);

        self.enqueue_self._meter_verify();

        if verify_meter_hook != AztecAddress::zero() {
            MagnaVerifyMeterHook::at(verify_meter_hook)
                .meter_verify_or_revert(hinted_credential.note.credential_type)
                .enqueue(self.context);
        }
    }

    #[internal("private")]
    fn verify_linked_for_caller_v2(
        caller: AztecAddress,
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        claims_witness: PassportCommittedClaimsWitness,
        sponsor_slot: u8,
        force_sponsored: bool,
    ) {
        assert(hinted_root_status.owner == caller, "root status owner mismatch");
        assert(hinted_root_authority.owner == caller, "root authority owner mismatch");
        assert(hinted_credential.owner == caller, "linked credential owner mismatch");
        assert(hinted_status.owner == caller, "linked status owner mismatch");

        let header = self.context.get_anchor_block_header();
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_root_status);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_root_authority);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_credential);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_status);

        assert(
            hinted_credential.note.root_commitment == hinted_status.note.root_commitment,
            "linked root mismatch",
        );
        assert(
            hinted_credential.note.root_commitment == hinted_root_status.note.root_commitment,
            "root status mismatch",
        );
        assert(
            hinted_root_authority.note.root_commitment == hinted_root_status.note.root_commitment,
            "root authority mismatch",
        );
        assert(
            hinted_credential.note.credential_type == hinted_status.note.credential_type,
            "linked credential/status type mismatch",
        );
        assert(hinted_credential.note.claims_hash == hinted_status.note.claims_hash, "linked claims mismatch");
        assert(
            hinted_root_authority.note.claims_hash == hinted_credential.note.claims_hash,
            "root authority claims mismatch",
        );

        let claims = self.internal.claims_from_committed_passport_witness(
            hinted_credential.note.credential_type,
            hinted_credential.note.claims_hash,
            claims_witness,
        );
        require_policy_matches_passport(policy, hinted_credential.note.credential_type, claims);

        let verify_meter_hook = self.storage.verify_meter_hook.read();
        let sponsored_mode = force_sponsored | (verify_meter_hook != AztecAddress::zero());
        let mut inclusion_deadline = hinted_credential.note.expiry_ts;
        if hinted_root_authority.note.authority_expiry_ts < inclusion_deadline {
            inclusion_deadline = hinted_root_authority.note.authority_expiry_ts;
        }
        if sponsored_mode {
            let mask = self.storage.sponsored_credential_type_mask.get_current_value();
            if mask != 0 {
                let bit = 1 as u64 << (hinted_credential.note.credential_type as u64);
                assert((mask & bit) == bit, "credential type not sponsored");
            }

            assert(sponsor_slot < MAGNA_SPONSOR_RL_MAX_SLOTS_PER_WINDOW, "invalid sponsor slot");
            let anchor_ts = header.global_variables.timestamp;
            let window_id = anchor_ts / MAGNA_SPONSOR_RL_WINDOW_SECONDS;
            let rl_nullifier = compute_sponsor_rate_limit_nullifier(
                hinted_status.note.revocation_secret,
                hinted_status.note.credential_type,
                hinted_status.note.claims_hash,
                window_id,
                sponsor_slot,
                MAGNA_SPONSOR_RL_DS,
            );
            self.context.push_nullifier_unsafe(rl_nullifier);

            let window_end = (window_id + 1) * MAGNA_SPONSOR_RL_WINDOW_SECONDS;
            if window_end < hinted_credential.note.expiry_ts {
                inclusion_deadline = window_end;
            }
        }
        self.context.set_expiration_timestamp(inclusion_deadline);

        let linked_revocation_nullifier = compute_revocation_nullifier(
            hinted_status.note.revocation_secret,
            hinted_status.note.credential_type,
            hinted_status.note.claims_hash,
            MAGNA_REVOCATION_DS,
        );
        let siloed_linked_revocation_nullifier = compute_siloed_nullifier(
            self.address,
            linked_revocation_nullifier,
        );
        assert_nullifier_did_not_exist_by(header, siloed_linked_revocation_nullifier);

        let root_revocation_nullifier = compute_root_revocation_nullifier(
            hinted_root_status.note.revocation_secret,
            hinted_root_status.note.root_commitment,
            MAGNA_ROOT_REVOCATION_DS,
        );
        let siloed_root_revocation_nullifier = compute_siloed_nullifier(
            self.address,
            root_revocation_nullifier,
        );
        assert_nullifier_did_not_exist_by(header, siloed_root_revocation_nullifier);

        let root_authority_revocation_nullifier = compute_root_authority_revocation_nullifier(
            hinted_root_authority.note.revocation_secret,
            hinted_root_authority.note.root_commitment,
            hinted_root_authority.note.claims_hash,
            MAGNA_ROOT_AUTHORITY_REVOCATION_DS,
        );
        let siloed_root_authority_revocation_nullifier = compute_siloed_nullifier(
            self.address,
            root_authority_revocation_nullifier,
        );
        assert_nullifier_did_not_exist_by(header, siloed_root_authority_revocation_nullifier);

        self.enqueue_self._meter_verify();

        if verify_meter_hook != AztecAddress::zero() {
            MagnaVerifyMeterHook::at(verify_meter_hook)
                .meter_verify_or_revert(hinted_credential.note.credential_type)
                .enqueue(self.context);
        }
    }

    #[internal("private")]
    fn verify_linked_instagram_for_caller(
        caller: AztecAddress,
        policy: Policy,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        hinted_credential: HintedNote<LinkedCredentialNote>,
        hinted_status: HintedNote<LinkedStatusNote>,
        claims_witness: InstagramCommittedClaimsWitness,
        sponsor_slot: u8,
        force_sponsored: bool,
    ) {
        assert(hinted_root_status.owner == caller, "root status owner mismatch");
        assert(hinted_root_authority.owner == caller, "root authority owner mismatch");
        assert(hinted_credential.owner == caller, "linked credential owner mismatch");
        assert(hinted_status.owner == caller, "linked status owner mismatch");

        let header = self.context.get_anchor_block_header();
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_root_status);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_root_authority);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_credential);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_status);

        assert(
            hinted_credential.note.root_commitment == hinted_status.note.root_commitment,
            "linked root mismatch",
        );
        assert(
            hinted_credential.note.root_commitment == hinted_root_status.note.root_commitment,
            "root status mismatch",
        );
        assert(
            hinted_root_authority.note.root_commitment == hinted_root_status.note.root_commitment,
            "root authority mismatch",
        );
        assert(
            hinted_credential.note.credential_type == hinted_status.note.credential_type,
            "linked credential/status type mismatch",
        );
        assert(hinted_credential.note.claims_hash == hinted_status.note.claims_hash, "linked claims mismatch");

        let handle_commitment = compute_instagram_handle_commitment(
            claims_witness.handle_hash,
            claims_witness.handle_blind,
            MAGNA_INSTAGRAM_HANDLE_COMMITMENT_DS,
        );
        let claims_hash = compute_instagram_claims_hash(
            SCHEMA_VERSION_V2,
            hinted_credential.note.credential_type,
            handle_commitment,
            hinted_credential.note.expiry_ts,
            MAGNA_CLAIMS_DS,
        );
        assert(claims_hash == hinted_credential.note.claims_hash, "claims hash mismatch");

        let claims = InstagramClaims {
            handle_hash: claims_witness.handle_hash,
            expiry_ts: hinted_credential.note.expiry_ts,
        };
        require_policy_matches_instagram(policy, hinted_credential.note.credential_type, claims);

        let verify_meter_hook = self.storage.verify_meter_hook.read();
        let sponsored_mode = force_sponsored | (verify_meter_hook != AztecAddress::zero());
        let mut inclusion_deadline = hinted_credential.note.expiry_ts;
        if hinted_root_authority.note.authority_expiry_ts < inclusion_deadline {
            inclusion_deadline = hinted_root_authority.note.authority_expiry_ts;
        }
        if sponsored_mode {
            let mask = self.storage.sponsored_credential_type_mask.get_current_value();
            if mask != 0 {
                let bit = 1 as u64 << (hinted_credential.note.credential_type as u64);
                assert((mask & bit) == bit, "credential type not sponsored");
            }

            assert(sponsor_slot < MAGNA_SPONSOR_RL_MAX_SLOTS_PER_WINDOW, "invalid sponsor slot");
            let anchor_ts = header.global_variables.timestamp;
            let window_id = anchor_ts / MAGNA_SPONSOR_RL_WINDOW_SECONDS;
            let rl_nullifier = compute_sponsor_rate_limit_nullifier(
                hinted_status.note.revocation_secret,
                hinted_status.note.credential_type,
                hinted_status.note.claims_hash,
                window_id,
                sponsor_slot,
                MAGNA_SPONSOR_RL_DS,
            );
            self.context.push_nullifier_unsafe(rl_nullifier);

            let window_end = (window_id + 1) * MAGNA_SPONSOR_RL_WINDOW_SECONDS;
            if window_end < hinted_credential.note.expiry_ts {
                inclusion_deadline = window_end;
            }
        }
        self.context.set_expiration_timestamp(inclusion_deadline);

        let linked_revocation_nullifier = compute_revocation_nullifier(
            hinted_status.note.revocation_secret,
            hinted_status.note.credential_type,
            hinted_status.note.claims_hash,
            MAGNA_REVOCATION_DS,
        );
        let siloed_linked_revocation_nullifier = compute_siloed_nullifier(
            self.address,
            linked_revocation_nullifier,
        );
        assert_nullifier_did_not_exist_by(header, siloed_linked_revocation_nullifier);

        let root_revocation_nullifier = compute_root_revocation_nullifier(
            hinted_root_status.note.revocation_secret,
            hinted_root_status.note.root_commitment,
            MAGNA_ROOT_REVOCATION_DS,
        );
        let siloed_root_revocation_nullifier = compute_siloed_nullifier(
            self.address,
            root_revocation_nullifier,
        );
        assert_nullifier_did_not_exist_by(header, siloed_root_revocation_nullifier);

        let root_authority_revocation_nullifier = compute_root_authority_revocation_nullifier(
            hinted_root_authority.note.revocation_secret,
            hinted_root_authority.note.root_commitment,
            hinted_root_authority.note.claims_hash,
            MAGNA_ROOT_AUTHORITY_REVOCATION_DS,
        );
        let siloed_root_authority_revocation_nullifier = compute_siloed_nullifier(
            self.address,
            root_authority_revocation_nullifier,
        );
        assert_nullifier_did_not_exist_by(header, siloed_root_authority_revocation_nullifier);

        self.enqueue_self._meter_verify();

        if verify_meter_hook != AztecAddress::zero() {
            MagnaVerifyMeterHook::at(verify_meter_hook)
                .meter_verify_or_revert(hinted_credential.note.credential_type)
                .enqueue(self.context);
        }
    }

    #[internal("private")]
    fn mint_root_notes(
        active_owner: AztecAddress,
        ghost_owner: AztecAddress,
        root_commitment: Field,
        revocation_secret: Field,
    ) {
        let root_status = RootStatusNote { root_commitment, revocation_secret };
        self.storage.root_status_notes.at(active_owner).insert(root_status).deliver(
            MessageDelivery::onchain_unconstrained(),
        );

        let root_recovery = RootRecoveryNote { root_commitment, revocation_secret };
        self.storage.root_recovery_notes.at(ghost_owner).insert(root_recovery).deliver(
            MessageDelivery::onchain_unconstrained(),
        );
    }

    #[internal("private")]
    fn mint_root_authority_note(
        active_owner: AztecAddress,
        root_commitment: Field,
        claims_hash: Field,
        authority_expiry_ts: u64,
        revocation_secret: Field,
    ) {
        let root_authority = RootAuthorityNote {
            root_commitment,
            claims_hash,
            authority_expiry_ts,
            revocation_secret,
        };
        self.storage.root_authority_notes.at(active_owner).insert(root_authority).deliver(
            MessageDelivery::onchain_unconstrained(),
        );
    }

    #[internal("private")]
    fn mint_linked_credential_notes(
        active_owner: AztecAddress,
        ghost_owner: AztecAddress,
        root_commitment: Field,
        claims_hash: Field,
        credential_type: u8,
        expiry_ts: u64,
        revocation_secret: Field,
    ) {
        let linked_credential = LinkedCredentialNote {
            root_commitment,
            claims_hash,
            credential_type,
            expiry_ts,
        };
        self.storage.linked_credential_notes.at(active_owner).insert(linked_credential).deliver(
            MessageDelivery::onchain_unconstrained(),
        );

        let linked_status = LinkedStatusNote {
            root_commitment,
            revocation_secret,
            claims_hash,
            credential_type,
        };
        self.storage.linked_status_notes.at(active_owner).insert(linked_status).deliver(
            MessageDelivery::onchain_unconstrained(),
        );

        let linked_recovery = LinkedRecoveryNote {
            root_commitment,
            revocation_secret,
            claims_hash,
            credential_type,
            expiry_ts,
        };
        self.storage.linked_recovery_notes.at(ghost_owner).insert(linked_recovery).deliver(
            MessageDelivery::onchain_unconstrained(),
        );
    }

    #[internal("private")]
    fn refresh_root_authority_for_caller(
        caller: AztecAddress,
        use_owner_authorization: bool,
        ghost_owner: AztecAddress,
        hinted_root_status: HintedNote<RootStatusNote>,
        hinted_root_authority: HintedNote<RootAuthorityNote>,
        claims_hash: Field,
        authority_expiry_ts: u64,
    ) {
        if use_owner_authorization {
            assert(hinted_root_status.owner == caller, "root owner required");
            let authorization = poseidon2_hash_with_separator(
                [
                    caller.to_field(),
                    ghost_owner.to_field(),
                    hinted_root_status.note.root_commitment,
                    claims_hash,
                    authority_expiry_ts as Field,
                ],
                MAGNA_ROOT_AUTHORITY_REFRESH_AUTH_DS,
            );
            assert(
                self.storage.root_authority_refresh_authorizations.at(authorization).read(),
                "root authority refresh is not authorized",
            );
            self.context.push_nullifier_unsafe(authorization);
        } else {
            assert_orchestrator_sender(caller, self.storage.orchestrator.read());
        }
        assert(claims_hash != 0, "authority claims hash required");
        assert(
            hinted_root_status.note.root_commitment == hinted_root_authority.note.root_commitment,
            "root authority mismatch",
        );

        let header = self.context.get_anchor_block_header();
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_root_status);
        let _ = aztec::history::note::assert_note_existed_by(header, hinted_root_authority);

        let root_revocation_nullifier = compute_root_revocation_nullifier(
            hinted_root_status.note.revocation_secret,
            hinted_root_status.note.root_commitment,
            MAGNA_ROOT_REVOCATION_DS,
        );
        let siloed_root_revocation_nullifier = compute_siloed_nullifier(
            self.address,
            root_revocation_nullifier,
        );
        assert_nullifier_did_not_exist_by(header, siloed_root_revocation_nullifier);

        let prior_authority_kill_switch_nullifier = compute_root_authority_revocation_nullifier(
            hinted_root_authority.note.revocation_secret,
            hinted_root_authority.note.root_commitment,
            hinted_root_authority.note.claims_hash,
            MAGNA_ROOT_AUTHORITY_REVOCATION_DS,
        );
        let prior_authority_kill_switch_siloed = compute_siloed_nullifier(
            self.address,
            prior_authority_kill_switch_nullifier,
        );
        assert_nullifier_did_not_exist_by(header, prior_authority_kill_switch_siloed);

        self.context.push_nullifier_unsafe(prior_authority_kill_switch_nullifier);

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let fresh_authority_revocation_secret = unsafe { random() };
        self.internal.mint_root_authority_note(
            hinted_root_status.owner,
            hinted_root_status.note.root_commitment,
            claims_hash,
            authority_expiry_ts,
            fresh_authority_revocation_secret,
        );

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let fresh_linked_revocation_secret = unsafe { random() };
        self.internal.mint_linked_credential_notes(
            hinted_root_status.owner,
            ghost_owner,
            hinted_root_status.note.root_commitment,
            claims_hash,
            1,
            authority_expiry_ts,
            fresh_linked_revocation_secret,
        );
    }

    #[internal("private")]
    fn recover_for_caller(
        caller: AztecAddress,
        hinted_recovery: HintedNote<RecoveryNote>,
        new_active_owner: AztecAddress,
        remint_credential: bool,
    ) {
        assert(hinted_recovery.owner == caller, "recovery owner mismatch");

        let header = self.context.get_anchor_block_header();
        let confirmed_recovery = aztec::history::note::assert_note_existed_by(header, hinted_recovery);

        // Spend the recovery note itself.
        let recovery_note_hash_for_nullification = compute_confirmed_note_hash_for_nullification(
            confirmed_recovery,
        );
        let recovery_spend_nullifier = hinted_recovery.note.compute_nullifier(
            self.context,
            hinted_recovery.owner,
            recovery_note_hash_for_nullification,
        );
        // The recovery note is proven via history (assert_note_existed_by), so it is a settled
        // note from a prior transaction, not a pending same-tx note. Use push_nullifier_unsafe;
        // push_nullifier_for_note_hash would try to squash a pending note that does not exist.
        self.context.push_nullifier_unsafe(recovery_spend_nullifier);

        // Emit kill-switch nullifier that invalidates old active-owner proofs.
        let kill_switch_nullifier = compute_revocation_nullifier(
            hinted_recovery.note.revocation_secret,
            hinted_recovery.note.credential_type,
            hinted_recovery.note.claims_hash,
            MAGNA_REVOCATION_DS,
        );
        self.context.push_nullifier_unsafe(kill_switch_nullifier);

        // Re-issue status + recovery with fresh secret while preserving claims commitment.
        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let fresh_rs = unsafe { random() };
        let fresh_status = StatusNote {
            revocation_secret: fresh_rs,
            claims_hash: hinted_recovery.note.claims_hash,
            credential_type: hinted_recovery.note.credential_type,
        };
        self.storage.status_notes.at(new_active_owner).insert(fresh_status).deliver(
            MessageDelivery::onchain_unconstrained(),
        );

        let fresh_recovery = RecoveryNote {
            revocation_secret: fresh_rs,
            claims_hash: hinted_recovery.note.claims_hash,
            credential_type: hinted_recovery.note.credential_type,
            expiry_ts: hinted_recovery.note.expiry_ts,
        };
        self.storage.recovery_notes.at(caller).insert(fresh_recovery).deliver(
            MessageDelivery::onchain_unconstrained(),
        );

        if remint_credential {
            let fresh_credential = CredentialNote {
                claims_hash: hinted_recovery.note.claims_hash,
                credential_type: hinted_recovery.note.credential_type,
                expiry_ts: hinted_recovery.note.expiry_ts,
            };
            self.storage.credential_notes.at(new_active_owner).insert(fresh_credential).deliver(
                MessageDelivery::onchain_unconstrained(),
            );
        }
    }

    #[internal("private")]
    fn recover_root_for_caller(
        caller: AztecAddress,
        hinted_root_recovery: HintedNote<RootRecoveryNote>,
        new_active_owner: AztecAddress,
    ) {
        assert(hinted_root_recovery.owner == caller, "root recovery owner mismatch");

        let header = self.context.get_anchor_block_header();
        let confirmed_root_recovery = aztec::history::note::assert_note_existed_by(
            header,
            hinted_root_recovery,
        );

        let root_recovery_note_hash_for_nullification = compute_confirmed_note_hash_for_nullification(
            confirmed_root_recovery,
        );
        let root_recovery_spend_nullifier = hinted_root_recovery.note.compute_nullifier(
            self.context,
            hinted_root_recovery.owner,
            root_recovery_note_hash_for_nullification,
        );
        // Settled note proven via history; nullify with push_nullifier_unsafe (see recover_for_caller).
        self.context.push_nullifier_unsafe(root_recovery_spend_nullifier);

        let root_kill_switch_nullifier = compute_root_revocation_nullifier(
            hinted_root_recovery.note.revocation_secret,
            hinted_root_recovery.note.root_commitment,
            MAGNA_ROOT_REVOCATION_DS,
        );
        self.context.push_nullifier_unsafe(root_kill_switch_nullifier);

        // Safety: Randomness here is only used as a note secret input and does not
        // influence consensus-critical public state branching.
        let fresh_rs = unsafe { random() };
        let fresh_root_status = RootStatusNote {
            root_commitment: hinted_root_recovery.note.root_commitment,
            revocation_secret: fresh_rs,
        };
        self.storage.root_status_notes.at(new_active_owner).insert(fresh_root_status).deliver(
            MessageDelivery::onchain_unconstrained(),
        );

        let fresh_root_recovery = RootRecoveryNote {
            root_commitment: hinted_root_recovery.note.root_commitment,
            revocation_secret: fresh_rs,
        };
        self.storage.root_recovery_notes.at(caller).insert(fresh_root_recovery).deliver(
            MessageDelivery::onchain_unconstrained(),
        );
    }

    #[internal("private")]
    fn revoke_linked_credential_for_caller(
        caller: AztecAddress,
        hinted_recovery: HintedNote<LinkedRecoveryNote>,
    ) {
        assert(hinted_recovery.owner == caller, "linked recovery owner mismatch");
        assert(hinted_recovery.note.credential_type != 1, "passport lineage must revoke root authority");

        let header = self.context.get_anchor_block_header();
        let confirmed_linked_recovery = aztec::history::note::assert_note_existed_by(
            header,
            hinted_recovery,
        );

        let linked_recovery_note_hash_for_nullification = compute_confirmed_note_hash_for_nullification(
            confirmed_linked_recovery,
        );
        let linked_recovery_spend_nullifier = hinted_recovery.note.compute_nullifier(
            self.context,
            hinted_recovery.owner,
            linked_recovery_note_hash_for_nullification,
        );
        // Settled note proven via history; nullify with push_nullifier_unsafe (see recover_for_caller).
        self.context.push_nullifier_unsafe(linked_recovery_spend_nullifier);

        let linked_kill_switch_nullifier = compute_revocation_nullifier(
            hinted_recovery.note.revocation_secret,
            hinted_recovery.note.credential_type,
            hinted_recovery.note.claims_hash,
            MAGNA_REVOCATION_DS,
        );
        self.context.push_nullifier_unsafe(linked_kill_switch_nullifier);
    }

    #[external("public")]
    #[only_self]
    fn _meter_verify() {
        let current = self.storage.verify_meter_count.read();
        self.storage.verify_meter_count.write(increment_counter(current));
    }
}
