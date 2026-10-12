import AuthenticationServices
import Capacitor
import UIKit

// Passkeys and Sign in with Apple for the web app (src/lib/nativeAuth.ts).
// The WebView's page lives at capacitor://localhost, which can't use the
// joseffsmith.uk passkeys, so the app asks iOS itself. That works because the
// app and the site vouch for each other: the Associated Domains entitlement
// (App.entitlements) and the site's apple-app-site-association file.
//
// Passkey calls take the server's WebAuthn options JSON and answer with the
// JSON a browser would send back, so the server can't tell the difference
// (iOS reports the site's origin in clientDataJSON).
@objc(WhistAuthPlugin)
public class WhistAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WhistAuthPlugin"
    public let jsName = "WhistAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createPasskey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPasskey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise),
    ]

    // The request on screen. Kept here, as the controller doesn't retain its
    // delegate.
    private var current: AuthRequest?

    @objc func isAvailable(_ call: CAPPluginCall) {
        if #available(iOS 16.0, *) {
            call.resolve(["passkeys": true, "apple": true])
        } else {
            call.resolve(["passkeys": false, "apple": true])
        }
    }

    @objc func createPasskey(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else {
            return call.reject("Passkeys need iOS 16 or newer.", "unsupported")
        }
        guard
            let options = call.getObject("options"),
            let rp = options["rp"] as? JSObject,
            let rpId = rp["id"] as? String,
            let user = options["user"] as? JSObject,
            let userId = Data(base64URL: user["id"] as? String),
            let name = user["name"] as? String,
            let challenge = Data(base64URL: options["challenge"] as? String)
        else {
            return call.reject("Bad passkey options.", "bad_options")
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: rpId)
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge, name: name, userID: userId)
        request.userVerificationPreference = .required
        if #available(iOS 17.4, *) {
            request.excludedCredentials = credentialIds(options["excludeCredentials"])
                .map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
        }
        perform(request, call) { credential in
            guard
                let made = credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
                let attestation = made.rawAttestationObject
            else { return nil }
            let id = made.credentialID.base64URL
            return [
                "id": id,
                "rawId": id,
                "type": "public-key",
                "authenticatorAttachment": "platform",
                "clientExtensionResults": JSObject(),
                "response": [
                    "clientDataJSON": made.rawClientDataJSON.base64URL,
                    "attestationObject": attestation.base64URL,
                    "transports": ["internal", "hybrid"],
                ] as JSObject,
            ]
        }
    }

    @objc func getPasskey(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else {
            return call.reject("Passkeys need iOS 16 or newer.", "unsupported")
        }
        guard
            let options = call.getObject("options"),
            let rpId = options["rpId"] as? String,
            let challenge = Data(base64URL: options["challenge"] as? String)
        else {
            return call.reject("Bad passkey options.", "bad_options")
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: rpId)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        request.userVerificationPreference = .required
        request.allowedCredentials = credentialIds(options["allowCredentials"])
            .map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
        perform(request, call) { credential in
            guard
                let used = credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion
            else { return nil }
            let id = used.credentialID.base64URL
            return [
                "id": id,
                "rawId": id,
                "type": "public-key",
                "authenticatorAttachment": "platform",
                "clientExtensionResults": JSObject(),
                "response": [
                    "clientDataJSON": used.rawClientDataJSON.base64URL,
                    "authenticatorData": used.rawAuthenticatorData.base64URL,
                    "signature": used.signature.base64URL,
                    "userHandle": used.userID.base64URL,
                ] as JSObject,
            ]
        }
    }

    // `nonce` comes from the server and goes into the request unchanged;
    // Apple signs it into the identity token.
    @objc func signInWithApple(_ call: CAPPluginCall) {
        guard let nonce = call.getString("nonce") else {
            return call.reject("Missing nonce.", "bad_options")
        }
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.email, .fullName]
        request.nonce = nonce
        perform(request, call) { credential in
            guard
                let apple = credential as? ASAuthorizationAppleIDCredential,
                let token = apple.identityToken.flatMap({ String(data: $0, encoding: .utf8) })
            else { return nil }
            var result: JSObject = ["identityToken": token]
            if let code = apple.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }) {
                result["authorizationCode"] = code
            }
            // Only on the first sign-in with this app, and only if shared.
            if let given = apple.fullName?.givenName { result["givenName"] = given }
            if let family = apple.fullName?.familyName { result["familyName"] = family }
            return result
        }
    }

    private func credentialIds(_ list: Any?) -> [Data] {
        ((list as? [JSObject]) ?? []).compactMap { Data(base64URL: $0["id"] as? String) }
    }

    // Shows the system sheet and settles the call with what `answer` makes of
    // the result (nil: an answer we didn't expect).
    private func perform(
        _ request: ASAuthorizationRequest,
        _ call: CAPPluginCall,
        answer: @escaping (ASAuthorizationCredential) -> JSObject?
    ) {
        DispatchQueue.main.async {
            let auth = AuthRequest(
                window: self.bridge?.webView?.window
            ) { [weak self] result in
                self?.current = nil
                switch result {
                case .success(let credential):
                    if let value = answer(credential) {
                        call.resolve(value)
                    } else {
                        call.reject("Unexpected answer.", "failed")
                    }
                case .failure(let error):
                    let code = (error as? ASAuthorizationError)?.code
                    if code == .canceled {
                        call.reject("Cancelled.", "cancelled", error)
                    } else {
                        call.reject(error.localizedDescription, "failed", error)
                    }
                }
            }
            self.current = auth
            auth.start(request)
        }
    }
}

private final class AuthRequest: NSObject, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding
{
    private let window: UIWindow?
    private let done: (Result<ASAuthorizationCredential, Error>) -> Void
    private var controller: ASAuthorizationController?

    init(window: UIWindow?, done: @escaping (Result<ASAuthorizationCredential, Error>) -> Void) {
        self.window = window
        self.done = done
    }

    func start(_ request: ASAuthorizationRequest) {
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        controller.performRequests()
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        window ?? ASPresentationAnchor()
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        done(.success(authorization.credential))
    }

    func authorizationController(
        controller: ASAuthorizationController, didCompleteWithError error: Error
    ) {
        done(.failure(error))
    }
}

private extension Data {
    init?(base64URL value: String?) {
        guard var text = value?.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        else { return nil }
        text += String(repeating: "=", count: (4 - text.count % 4) % 4)
        self.init(base64Encoded: text)
    }

    var base64URL: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
