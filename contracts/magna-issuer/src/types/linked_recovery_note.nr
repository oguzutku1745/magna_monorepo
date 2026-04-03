use aztec::{
    macros::notes::note,
    protocol::traits::{Deserialize, Packable, Serialize},
};

#[derive(Eq, Serialize, Deserialize, Packable)]
#[note]
pub struct LinkedRecoveryNote {
    pub root_commitment: Field,
    pub revocation_secret: Field,
    pub claims_hash: Field,
    pub credential_type: u8,
    pub expiry_ts: u64,
}
