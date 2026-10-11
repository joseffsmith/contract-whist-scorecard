import { useBackClose } from "../../lib/backStack";
import { alpha, t } from "../../theme/tokens";

// Bottom sheet with a dimmed backdrop.
export const Sheet = ({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) => {
  useBackClose(onClose); // the Android back button closes it
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: alpha(t.shade, 0.6),
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          background: t.feltDk,
          borderTop: `1px solid ${alpha(t.gold, 0.33)}`,
          borderRadius: "16px 16px 0 0",
          padding: "18px 16px calc(18px + env(safe-area-inset-bottom))",
          boxShadow: `0 -10px 30px ${alpha(t.shade, 0.5)}`,
        }}
      >
        {children}
      </div>
    </div>
  );
};
