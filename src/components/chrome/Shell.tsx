import { ReactNode } from "react";
import { feltBg, t } from "../../theme/tokens";

// `scroll` is for screens that aren't inside the app's panels (login, reset,
// setup): the shell itself scrolls, so long content is reachable.
export const Shell = ({
  children,
  scroll,
}: {
  children: ReactNode;
  scroll?: boolean;
}) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      color: t.cream,
      fontFamily: t.font,
      display: "flex",
      flexDirection: "column",
      ...(scroll ? { minHeight: 0, overflowY: "auto" } : {}),
      ...feltBg,
    }}
  >
    {children}
  </div>
);
