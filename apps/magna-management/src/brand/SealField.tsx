import { useEffect, useRef, type MutableRefObject } from "react";
import { createSealField, type SealField as Field, type SealFieldOptions } from "./ascii-field.js";

// Mounts the brand seal field (brand/source/ascii-field.js) into a positioned div. Purely decorative.
export function SealField(props: SealFieldOptions & { className?: string; fieldRef?: MutableRefObject<Field | null> }) {
  const host = useRef<HTMLDivElement>(null);
  const { className, fieldRef, shape, progress, auto, markBox, cell } = props;
  const box = markBox ? `${markBox.x}:${markBox.y}:${markBox.size}` : "";

  useEffect(() => {
    if (!host.current) return;
    const field = createSealField(host.current, { shape, progress, auto, markBox, cell });
    if (fieldRef) fieldRef.current = field;
    return () => {
      field.destroy();
      if (fieldRef) fieldRef.current = null;
    };
    // Recreate only when the layout inputs change; progress is pushed through fieldRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, auto, box, cell]);

  return <div ref={host} className={className ? `seal-field ${className}` : "seal-field"} aria-hidden="true" />;
}
