import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useAuth, useConnectionStatus, useSyncView } from "./react";

// Hooks read the engine's singleton, which hasn't been started here.
describe("hooks", () => {
  it("render the engine's initial state", () => {
    function Probe() {
      const { view, isLoading } = useSyncView();
      const { isLoading: authLoading, user } = useAuth();
      const status = useConnectionStatus();
      return createElement(
        "p",
        null,
        `${isLoading} ${authLoading} ${user} ${status} ${view.games.size}`
      );
    }
    expect(renderToString(createElement(Probe))).toContain(
      "true true null connecting 0"
    );
  });
});
