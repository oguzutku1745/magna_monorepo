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
        <small>Choose the wallet containing the credentials this app requests.</small>
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
            <strong>{account.displayName ?? "Unnamed Magna wallet"}</strong>
            <small>{account.address}</small>
          </span>
          <b>Open</b>
        </button>
      ))}
    </div>
  );
}
