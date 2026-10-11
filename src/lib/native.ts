// The bits that only exist inside the Capacitor app (see mobile/): haptics,
// system bar style, splash screen, the Android back button. Screens call
// these unconditionally. The plugins are loaded only in the mobile build
// (`vite build --mode mobile`); on the web the condition is a constant, so
// the code and its chunk are left out and every call does nothing.
const loaded =
  import.meta.env.MODE === "mobile" ? import("./nativeImpl") : undefined;

const run = (call: (impl: typeof import("./nativeImpl")) => void) => {
  loaded?.then(call).catch(() => {});
};

export const initNative = () => run((n) => n.initNative());

// Light tick for a choice (a bid, a trick count).
export const tap = () => run((n) => n.tap());

// A round or the game finished.
export const success = () => run((n) => n.success());

// A tap on something that isn't allowed.
export const warning = () => run((n) => n.warning());
