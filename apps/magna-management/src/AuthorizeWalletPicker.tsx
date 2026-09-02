import type { StoredWebAuthnAccount } from "@magna/wallet";

export function authorizeWalletsForOrigin(
  accounts: StoredWebAuthnAccount[],
  rpId: string,
  origin: string,
): StoredWebAuthnAccount[] {
  return accounts.filter(account => account.rpId === rpId && account.origin === origin);
}

export function AuthorizeWalletPicker(props: {
  accounts: StoredWebAuthnAccount[];
  disabled?: boolean;
  onSelect: (account: StoredWebAuthnAccount) => void;
}) {
  return (
    <div className="stored-wallet-picker authorize-wallet-picker" aria-label="Choose a Magna wallet">
      <div className="stored-wallet-picker-head">
        <span>Stored wallets</span>
        <small>The selected passkey controls which private credentials are checked.</small>
      </div>
      {props.accounts.map(account => (
        <button
          className="stored-wallet-choice"
          type="button"
          key={account.credentialId}
          disabled={props.disabled}
          onClick={() => props.onSelect(account)}
        >
          <span>
            <strong>{account.displayName ?? "Legacy unnamed Magna passkey"}</strong>
            <small>{account.address}</small>
          </span>
          <b>Open</b>
        </button>
      ))}
    </div>
  );
}
