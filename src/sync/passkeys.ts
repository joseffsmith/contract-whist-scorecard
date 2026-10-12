import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { osVersion, platform } from "../lib/platform";
import { SyncError } from "./transport";

// The browser's passkey prompts (Face ID, fingerprint, ...), behind a small
// interface so tests can stand in for them.
export type PasskeyApi = {
  // Loads the browser side ahead of time, so opening a prompt needs no wait.
  preload?(): Promise<unknown>;
  // Tells the device a passkey it made isn't kept by the server, where the
  // browser supports it, so it stops offering it.
  signalUnknown?(rpId: string, credentialId: string): void;
  create(
    options: PublicKeyCredentialCreationOptionsJSON
  ): Promise<RegistrationResponseJSON>;
  get(
    options: PublicKeyCredentialRequestOptionsJSON
  ): Promise<AuthenticationResponseJSON>;
};

// Loaded on demand, so it isn't part of the main bundle. Once loaded, the
// prompts open straight from the tap with nothing to wait for: Safari only
// opens one close to the user's tap, and treats a late call as a refusal.
let library: Promise<typeof import("@simplewebauthn/browser")> | undefined;
let loaded: typeof import("@simplewebauthn/browser") | undefined;
const load = () =>
  (library ??= import("@simplewebauthn/browser").then((m) => (loaded = m)));

export const browserPasskeys: PasskeyApi = {
  preload: load,
  signalUnknown(rpId, credentialId) {
    try {
      const pkc = window.PublicKeyCredential as unknown as {
        signalUnknownCredential?: (o: object) => Promise<void>;
      };
      void pkc
        .signalUnknownCredential?.({ rpId, credentialId })
        ?.catch(() => {});
    } catch {
      /* not supported */
    }
  },
  create: (optionsJSON) =>
    loaded
      ? loaded.startRegistration({ optionsJSON })
      : load().then((m) => m.startRegistration({ optionsJSON })),
  get: (optionsJSON) =>
    loaded
      ? loaded.startAuthentication({ optionsJSON })
      : load().then((m) => m.startAuthentication({ optionsJSON })),
};

// In the native app the WebView's origin (capacitor://localhost) can't use the
// joseffsmith.uk passkeys, so the app asks the phone itself
// (src/lib/nativeAuth.ts). Loaded on first use, and only in the mobile build.
const native =
  import.meta.env.MODE === "mobile"
    ? () => import("../lib/nativeAuth")
    : undefined;

export const nativePasskeys: PasskeyApi = {
  preload: () => native!(),
  create: (options) => native!().then((m) => m.createPasskey(options)),
  get: (options) => native!().then((m) => m.getPasskey(options)),
};

// What sync uses unless a test gives it something else.
export const defaultPasskeys = native ? nativePasskeys : browserPasskeys;

// The apps can use passkeys once the site names them in its association files,
// which needs each platform's signing details on the server: .env.mobile lists
// the platforms that are set up (VITE_NATIVE_PASSKEYS=ios,android).
const nativeEnabled = () =>
  String(import.meta.env.VITE_NATIVE_PASSKEYS ?? "")
    .split(",")
    .map((p) => p.trim())
    .includes(platform());

export const passkeysSupported = () => {
  if (typeof window === "undefined") return false;
  if (import.meta.env.MODE !== "mobile") return !!window.PublicKeyCredential;
  switch (platform()) {
    case "ios":
      return nativeEnabled() && osVersion() >= 16;
    case "android":
      return nativeEnabled() && osVersion() >= 9;
    default:
      return false;
  }
};

// The person dismissed the prompt, or it timed out.
export const isCancelled = (error: unknown) =>
  error instanceof Error &&
  (error.name === "NotAllowedError" || error.name === "AbortError");

// The browser's own error messages are for developers.
export function passkeyError(error: unknown): SyncError {
  const code = (error as { code?: string } | null)?.code;
  if (code === "no_passkey") {
    return new SyncError(
      "There's no passkey for Whist on this phone.",
      "no_passkey"
    );
  }
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return new SyncError(
      "This device already has a passkey for you.",
      "passkey_exists"
    );
  }
  return new SyncError(
    "Couldn't use a passkey here. Try again.",
    "passkey_failed"
  );
}
