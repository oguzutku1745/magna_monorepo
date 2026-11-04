// Brand call to action: the label rolls to its twin on hover and the arrow cell steps forward.
// The twin is aria-hidden, so the accessible name stays the plain label.
export function Cta(props: {
  label: string;
  onClick: () => void;
  variant?: "signal" | "ink" | "outline";
  className?: string;
  disabled?: boolean;
}) {
  const variant = props.variant ?? "signal";
  return (
    <button
      className={`cta cta-${variant}${variant === "outline" ? " secondary" : ""}${props.className ? ` ${props.className}` : ""}`}
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span className="cta-roll">
        <span>{props.label}</span>
        <span aria-hidden="true">{props.label}</span>
      </span>
      <span className="cta-arrow" aria-hidden="true">
        <svg viewBox="0 0 10 10" shapeRendering="crispEdges">
          <path d="M0 4h6V2h1v1h1v1h1v2H8v1H7v1H6V6H0z" fill="currentColor" />
        </svg>
      </span>
    </button>
  );
}
