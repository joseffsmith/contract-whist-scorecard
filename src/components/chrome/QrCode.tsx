import qrcode from "qrcode-generator";
import { useMemo } from "react";

// QR code as a crisp inline SVG. Always dark-on-light (whatever the theme)
// so phone cameras can read it.
export const QrCode = ({
  value,
  size = 220,
}: {
  value: string;
  size?: number;
}) => {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);
  const quiet = 3;
  return (
    <svg
      role="img"
      aria-label="QR code"
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`}
      shapeRendering="crispEdges"
      style={{ background: "#fffdf7", borderRadius: 12, display: "block" }}
    >
      <path d={path} fill="#151310" />
    </svg>
  );
};
