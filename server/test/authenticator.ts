import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import type { KeyObject } from "node:crypto";

// A software authenticator, so tests can make real WebAuthn registrations and
// assertions (ES256 keys, "none" attestation) and the server really checks
// the challenge, origin, RP ID and signature.

const b64 = (b: Buffer) => b.toString("base64url");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

// Just enough CBOR for an attestation object and a COSE key.
function head(major: number, n: number): Buffer {
  const m = major << 5;
  if (n < 24) return Buffer.from([m | n]);
  if (n < 256) return Buffer.from([m | 24, n]);
  return Buffer.from([m | 25, n >> 8, n & 255]);
}
const cborInt = (n: number) => (n >= 0 ? head(0, n) : head(1, -1 - n));
const cborBytes = (b: Buffer) => Buffer.concat([head(2, b.length), b]);
const cborText = (s: string) =>
  Buffer.concat([head(3, Buffer.byteLength(s)), Buffer.from(s)]);
const cborMap = (pairs: [Buffer, Buffer][]) =>
  Buffer.concat([head(5, pairs.length), ...pairs.flat()]);

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

type Credential = {
  id: Buffer;
  key: KeyObject;
  rpID: string;
  counter: number;
  userHandle: Buffer | null;
};

export type Override = {
  origin?: string; // what the "browser" reports as the page's origin
  rpID?: string;
  challenge?: string;
  credentialId?: Buffer; // register under this id (a cloned or forged id)
  userVerified?: boolean;
};

export function createAuthenticator(site: { rpID: string; origin: string }) {
  const credentials = new Map<string, Credential>();

  function clientData(type: string, challenge: string, origin: string) {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin, crossOrigin: false })
    );
  }
  function authData(
    rpID: string,
    flags: number,
    counter: number,
    attested?: Buffer
  ) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([
      sha256(rpID),
      Buffer.from([flags]),
      count,
      ...(attested ? [attested] : []),
    ]);
  }

  return {
    credentials,

    // Answers navigator.credentials.create() for the server's options.
    create(options: any, over: Override = {}) {
      const rpID = over.rpID ?? options.rp.id;
      const { publicKey, privateKey } = generateKeyPairSync("ec", {
        namedCurve: "P-256",
      });
      const jwk = publicKey.export({ format: "jwk" });
      const id = over.credentialId ?? randomBytes(32);
      const cose = cborMap([
        [cborInt(1), cborInt(2)], // kty: EC2
        [cborInt(3), cborInt(-7)], // alg: ES256
        [cborInt(-1), cborInt(1)], // crv: P-256
        [cborInt(-2), cborBytes(Buffer.from(jwk.x!, "base64url"))],
        [cborInt(-3), cborBytes(Buffer.from(jwk.y!, "base64url"))],
      ]);
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(id.length);
      const flags = UP | AT | (over.userVerified === false ? 0 : UV);
      const data = authData(
        rpID,
        flags,
        0,
        Buffer.concat([Buffer.alloc(16), idLength, id, cose])
      );
      const attestation = cborMap([
        [cborText("fmt"), cborText("none")],
        [cborText("attStmt"), cborMap([])],
        [cborText("authData"), cborBytes(data)],
      ]);
      credentials.set(b64(id), {
        id,
        key: privateKey,
        rpID,
        counter: 0,
        userHandle: Buffer.from(options.user.id, "base64url"),
      });
      return {
        id: b64(id),
        rawId: b64(id),
        type: "public-key",
        response: {
          clientDataJSON: b64(
            clientData(
              "webauthn.create",
              over.challenge ?? options.challenge,
              over.origin ?? site.origin
            )
          ),
          attestationObject: b64(attestation),
          transports: ["internal"],
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },

    // Answers navigator.credentials.get() with a discoverable credential:
    // `id` picks one, otherwise the first it holds for this RP.
    get(options: any, over: Override & { id?: string } = {}) {
      const rpID = over.rpID ?? options.rpId;
      const found = over.id
        ? credentials.get(over.id)
        : [...credentials.values()].find((c) => c.rpID === rpID);
      if (!found) throw new Error("No passkey for this site");
      found.counter += 1;
      const data = authData(
        rpID,
        UP | (over.userVerified === false ? 0 : UV),
        found.counter
      );
      const client = clientData(
        "webauthn.get",
        over.challenge ?? options.challenge,
        over.origin ?? site.origin
      );
      const signature = sign(
        "sha256",
        Buffer.concat([data, sha256(client)]),
        found.key
      );
      return {
        id: b64(found.id),
        rawId: b64(found.id),
        type: "public-key",
        response: {
          clientDataJSON: b64(client),
          authenticatorData: b64(data),
          signature: b64(signature),
          ...(found.userHandle ? { userHandle: b64(found.userHandle) } : {}),
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },

    // The next assertion for this credential reports counter + 1.
    setCounter(id: string, counter: number) {
      credentials.get(id)!.counter = counter;
    },
  };
}
export type Authenticator = ReturnType<typeof createAuthenticator>;
