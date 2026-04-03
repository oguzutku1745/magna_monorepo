use aztec::{
    macros::notes::note,
    protocol::traits::{Deserialize, Packable, Serialize},
};

#[derive(Eq, Serialize, Deserialize, Packable)]
#[note]
pub struct RootAuthorityNote {
    pub root_commitment: Field,
    pub claims_hash: Field,
    pub authority_expiry_ts: u64,
    pub revocation_secret: Field,
}
