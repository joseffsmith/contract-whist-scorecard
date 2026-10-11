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
  create(
    options: PublicKeyCredentialCreationOptionsJSON
  ): Promise<RegistrationResponseJSON>;
  get(
    options: PublicKeyCredentialRequestOptionsJSON
  ): Promise<AuthenticationResponseJSON>;
};

// Loaded when first used, so it isn't part of the main bundle.
export const browserPasskeys: PasskeyApi = {
  async create(optionsJSON) {
    const { startRegistration } = await import("@simplewebauthn/browser");
    return startRegistration({ optionsJSON });
  },
  async get(optionsJSON) {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    return startAuthentication({ optionsJSON });
  },
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
