import { registerPlugin } from "@capacitor/core";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";

// The app's own plugin: mobile/ios/App/App/WhistAuthPlugin.swift and
// mobile/android/app/src/main/java/uk/joseffsmith/whist/WhistAuthPlugin.java.
// Loaded only in the mobile build (see src/sync/passkeys.ts and apple.ts).
type WhistAuth = {
  createPasskey(o: {
    options: PublicKeyCredentialCreationOptionsJSON;
  }): Promise<RegistrationResponseJSON>;
  getPasskey(o: {
    options: PublicKeyCredentialRequestOptionsJSON;
  }): Promise<AuthenticationResponseJSON>;
  signInWithApple(o: { nonce: string }): Promise<AppleCredential>;
};

export type AppleCredential = {
  identityToken: string;
  authorizationCode?: string;
  // Only the first time someone signs in to the app, and only if they share it.
  givenName?: string;
  familyName?: string;
};

const WhistAuth = registerPlugin<WhistAuth>("WhistAuth");

// A dismissed sheet becomes the NotAllowedError a browser would throw, so
// callers treat both alike; anything else keeps the plugin's code.
const translate = (error: unknown): never => {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "cancelled") {
    const cancelled = new Error("Cancelled");
    cancelled.name = "NotAllowedError";
    throw cancelled;
  }
  throw error;
};

export const createPasskey = (options: PublicKeyCredentialCreationOptionsJSON) =>
  WhistAuth.createPasskey({ options }).catch(translate);

export const getPasskey = (options: PublicKeyCredentialRequestOptionsJSON) =>
  WhistAuth.getPasskey({ options }).catch(translate);

export const signInWithApple = (nonce: string) =>
  WhistAuth.signInWithApple({ nonce }).catch(translate);
