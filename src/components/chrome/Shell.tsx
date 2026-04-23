import { ReactNode } from "react";
import { feltBg, t } from "../../theme/tokens";

export const Shell = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      color: t.cream,
      fontFamily: t.font,
      display: "flex",
      flexDirection: "column",
      ...feltBg,
    }}
  >
    {children}
  </div>
);
