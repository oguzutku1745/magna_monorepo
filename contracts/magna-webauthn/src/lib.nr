mod base64url;
mod generated_fixtures;
pub mod envelope;
mod test;
mod verify;

pub use base64url::base64url_encode_32;
pub use verify::{
    compute_webauthn_message_hash, verify_webauthn_get_assertion, WebAuthnEnvelope,
};
pub use envelope::{
    assert_authenticator_flags, assert_no_cross_origin_true, assert_origin_at,
    assert_rp_id_hash, assert_type_and_challenge,
};
