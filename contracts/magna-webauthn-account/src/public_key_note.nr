use aztec::{
    macros::notes::note,
    protocol::traits::Packable,
    utils::conversion::{bytes_from_fields, bytes_to_fields},
};

/// P-256 public key + WebAuthn RP context controlling this account.
/// origin is the ASCII origin string (e.g. "https://wallet.magna.xyz"),
/// zero-padded to 64 bytes with origin_len giving the true length.
///
/// Private notes are capped at MAX_NOTE_PACKED_LEN = 8 packed fields (limited
/// by private-log size; aztec-nr/aztec/src/messages/logs/note.nr). The 161
/// content bytes are therefore packed at 31 bytes per field via
/// bytes_to_fields -> 6 fields. Byte buffer layout (186 = 6 * 31, big-endian
/// within each field):
///   [0..32)    x
///   [32..64)   y
///   [64..96)   rp_id_hash
///   [96..160)  origin
///   [160]      origin_len
///   [161..186) zero padding
#[note]
#[derive(Eq)]
pub struct WebAuthnPublicKeyNote {
    pub x: [u8; 32],
    pub y: [u8; 32],
    pub rp_id_hash: [u8; 32],
    pub origin: [u8; 64],
    pub origin_len: u32,
}

impl Packable for WebAuthnPublicKeyNote {
    let N: u32 = 6;

    fn pack(self) -> [Field; Self::N] {
        // origin_len must survive the single-byte slot at index 160.
        assert(self.origin_len <= 64, "origin_len out of range");
        let mut bytes: [u8; 186] = [0; 186];
        for i in 0..32 {
            bytes[i] = self.x[i];
            bytes[32 + i] = self.y[i];
            bytes[64 + i] = self.rp_id_hash[i];
        }
        for i in 0..64 {
            bytes[96 + i] = self.origin[i];
        }
        bytes[160] = self.origin_len as u8;
        bytes_to_fields(bytes)
    }

    fn unpack(packed: [Field; Self::N]) -> Self {
        // bytes_from_fields constrains each field to <= 248 bits, so a
        // non-canonical packed array cannot alias two byte decodings.
        let bytes = bytes_from_fields(BoundedVec::<Field, 6>::from_array(packed));
        let mut x: [u8; 32] = [0; 32];
        let mut y: [u8; 32] = [0; 32];
        let mut rp_id_hash: [u8; 32] = [0; 32];
        let mut origin: [u8; 64] = [0; 64];
        for i in 0..32 {
            x[i] = bytes.get(i);
            y[i] = bytes.get(32 + i);
            rp_id_hash[i] = bytes.get(64 + i);
        }
        for i in 0..64 {
            origin[i] = bytes.get(96 + i);
        }
        Self { x, y, rp_id_hash, origin, origin_len: bytes.get(160) as u32 }
    }
}

mod tests {
    use super::WebAuthnPublicKeyNote;
    use aztec::protocol::traits::Packable;

    fn fixture_note() -> WebAuthnPublicKeyNote {
        let mut x: [u8; 32] = [0; 32];
        let mut y: [u8; 32] = [0; 32];
        let mut rp_id_hash: [u8; 32] = [0; 32];
        let mut origin: [u8; 64] = [0; 64];
        // Non-symmetric values so any index swap in pack/unpack is caught,
        // with non-zero bytes at every boundary (x[31], origin[63], ...).
        for i in 0..32 {
            x[i] = i as u8 + 1;
            y[i] = i as u8 + 101;
            rp_id_hash[i] = 255 - i as u8;
        }
        for i in 0..64 {
            origin[i] = i as u8 + 31;
        }
        WebAuthnPublicKeyNote { x, y, rp_id_hash, origin, origin_len: 64 }
    }

    #[test]
    fn test_pack_unpack_roundtrip() {
        let note = fixture_note();
        let packed = note.pack();
        assert(packed.len() == 6); // must stay <= MAX_NOTE_PACKED_LEN (8)
        let unpacked = WebAuthnPublicKeyNote::unpack(packed);
        assert(unpacked == note);
    }

    #[test]
    fn test_pack_unpack_roundtrip_short_origin() {
        let mut note = fixture_note();
        let mut origin: [u8; 64] = [0; 64];
        let origin_str = "http://localhost:5184".as_bytes();
        for i in 0..21 {
            origin[i] = origin_str[i];
        }
        note.origin = origin;
        note.origin_len = 21;
        let unpacked = WebAuthnPublicKeyNote::unpack(note.pack());
        assert(unpacked == note);
    }

    #[test(should_fail)]
    fn test_pack_rejects_oversized_origin_len() {
        let mut note = fixture_note();
        note.origin_len = 65;
        let _ = note.pack();
    }
}
