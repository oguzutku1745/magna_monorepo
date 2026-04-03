pub(crate) global SCHEMA_VERSION_V1: u8 = 1;
pub(crate) global MAGNA_CLAIMS_DS: u32 = 0x4D414743; // "MAGC"
pub(crate) global MAGNA_REVOCATION_DS: u32 = 0x4D415247; // "MARG"
pub(crate) global MAGNA_ROOT_REVOCATION_DS: u32 = 0x4D41524F; // "MARO"
pub(crate) global MAGNA_ROOT_AUTHORITY_REVOCATION_DS: u32 = 0x4D415241; // "MARA"
pub(crate) global MAGNA_GHOST_DS: u32 = 0x4D414748; // "MAGH"
pub(crate) global MAGNA_SPONSOR_RL_DS: u32 = 0x4D414752; // "MAGR" (Magna rate-limit)
pub(crate) global MAGNA_SPONSOR_RL_WINDOW_SECONDS: u64 = 86400;
pub(crate) global MAGNA_SPONSOR_RL_MAX_SLOTS_PER_WINDOW: u8 = 5;

// Sponsorship policy stored as DelayedPublicMutable. This delay bounds how quickly policy can change and
// determines the private-read validity horizon (via expiration_timestamp).
pub(crate) global MAGNA_SPONSOR_POLICY_DELAY_SECONDS: u64 = 3600;
