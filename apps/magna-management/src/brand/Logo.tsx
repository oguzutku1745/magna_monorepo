import { LOGO } from "./logo-data";

const SIGNAL = "#C8F031";

// Renders the mark or the wordmark from the generated cell data. `mono` drops the seal colour and uses
// currentColor, for ink-on-signal or paper-on-ink placements.
export function Logo(props: { variant?: "mark" | "wordmark"; mono?: boolean; className?: string; title?: string }) {
  const shape = props.variant === "mark" ? LOGO.mark : LOGO.wordmark;
  const c = LOGO.cell;
  return (
    <svg
      className={props.className}
      viewBox={`0 0 ${shape.w * c} ${shape.h * c}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={props.title ?? "Magna"}
    >
      {shape.cells.map(cell => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x * c}
          y={cell.y * c}
          width={c}
          height={c}
          fill={cell.seal && !props.mono ? SIGNAL : "currentColor"}
        />
      ))}
    </svg>
  );
}
