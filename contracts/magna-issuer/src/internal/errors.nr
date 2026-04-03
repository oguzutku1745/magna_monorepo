use aztec::protocol::address::AztecAddress;

pub fn assert_orchestrator_sender(sender: AztecAddress, orchestrator: AztecAddress) {
    assert(sender == orchestrator, "orchestrator required");
}

pub fn assert_owners_match_sender(
    credential_owner: AztecAddress,
    status_owner: AztecAddress,
    sender: AztecAddress,
) {
    assert(credential_owner == sender, "credential owner mismatch");
    assert(status_owner == sender, "status owner mismatch");
}
