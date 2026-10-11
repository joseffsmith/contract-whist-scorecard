import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { SyncError } from "./transport";

// The browser's passkey prompts (Face ID, fingerprint, ...), behind a small
// interface so tests can stand in for them.
export type PasskeyApi = {
  // Loads the browser side ahead of time, so opening a prompt needs no wait.
  preload?(): Promise<unknown>;
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
  create: (optionsJSON) =>
    loaded
      ? loaded.startRegistration({ optionsJSON })
      : load().then((m) => m.startRegistration({ optionsJSON })),
  get: (optionsJSON) =>
    loaded
      ? loaded.startAuthentication({ optionsJSON })
      : load().then((m) => m.startAuthentication({ optionsJSON })),
};

export const passkeysSupported = () =>
  typeof window !== "undefined" && !!window.PublicKeyCredential;

// The person dismissed the prompt, or it timed out.
export const isCancelled = (error: unknown) =>
  error instanceof Error &&
  (error.name === "NotAllowedError" || error.name === "AbortError");

// The browser's own error messages are for developers.
export function passkeyError(error: unknown): SyncError {
  if (
    (error as { code?: string } | null)?.code ===
    "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
  ) {
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
