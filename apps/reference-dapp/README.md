# Magna Reference dApp

This app demonstrates the minimal "Login with Magna" integration flow.

## 3 steps to integrate

1. Request policy in your dApp backend/UI:
   - Example: passport credential with `age >= 18` and `country != USA`.
   - Or request an Instagram ownership credential bound to a specific `handle_hash`.
2. Call `magna-client.loginWithMagna(...)` in user session:
   - user proof is generated in PXE private execution.
   - Instagram integrations should use `loginWithInstagram(...)` or the linked/company-sponsor variants.
3. Gate state transition on transaction receipt:
   - success -> allow protected action
   - failure -> deny

## UI assets

Primary visual references are kept under `Diagrams/magna-button-look.html`.
