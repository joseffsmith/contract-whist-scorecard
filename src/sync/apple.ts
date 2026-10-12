import type { AppleCredential } from "../lib/nativeAuth";
import { platform } from "../lib/platform";

// Sign in with Apple, behind a small interface so tests can stand in for it.
// Only the iOS app has it for now: the website would need an Apple Services ID.
export type AppleApi = {
  // `nonce` comes from the server and must reach Apple unchanged.
  signIn(nonce: string): Promise<AppleCredential>;
};

export const nativeApple: AppleApi | undefined =
  import.meta.env.MODE === "mobile"
    ? {
        signIn: (nonce) =>
          import("../lib/nativeAuth").then((m) => m.signInWithApple(nonce)),
      }
    : undefined;

export const appleSupported = () => platform() === "ios";
