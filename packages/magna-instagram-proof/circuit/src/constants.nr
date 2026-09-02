pub global MAX_EMAIL_HEADER_LENGTH: u32 = 1024;
// The supported Instagram recovery email repeats the account handle in its
// signed footer. Starting partial SHA at that footer leaves at most 1024 bytes
// for the circuit in the captured, DKIM-valid template.
pub global MAX_PARTIAL_EMAIL_BODY_LENGTH: u32 = 1024;
pub global INSTAGRAM_SCHEMA_VERSION: Field = 2;
pub global INSTAGRAM_CREDENTIAL_TYPE: Field = 3;
pub global MAGNA_CLAIMS_DS: Field = 0x4D414743;
pub global MAGNA_INSTAGRAM_HANDLE_DS: Field = 0x4D414948;
pub global MAGNA_INSTAGRAM_HANDLE_COMMITMENT_DS: Field = 0x4D414943;
pub global MAX_INSTAGRAM_HANDLE_LENGTH: u32 = 30;

pub global TEMPLATE_ENGLISH: u8 = 1;

pub global PERIOD: u8 = 46;
pub global ZERO: u8 = 0;

pub global INSTAGRAM_FROM_EMAIL: [u8; 27] = "security@mail.instagram.com".as_bytes();
