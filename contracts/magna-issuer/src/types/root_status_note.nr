use aztec::{
    macros::notes::note,
    protocol::traits::{Deserialize, Packable, Serialize},
};

#[derive(Eq, Serialize, Deserialize, Packable)]
#[note]
pub struct RootStatusNote {
    pub root_commitment: Field,
    pub revocation_secret: Field,
}
