package uk.joseffsmith.whist;

import android.os.Build;
import android.os.CancellationSignal;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CreatePublicKeyCredentialResponse;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPublicKeyCredentialOption;
import androidx.credentials.PublicKeyCredential;
import androidx.credentials.exceptions.CreateCredentialCancellationException;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Passkeys for the web app (src/lib/nativeAuth.ts), through Android's
 * Credential Manager. The WebView's page (https://localhost) can't use the
 * joseffsmith.uk passkeys, but the app can: the site's assetlinks.json names
 * this app's signing certificate. Credential Manager takes the server's
 * WebAuthn options JSON and answers with the JSON a browser would send; its
 * clientDataJSON origin is "android:apk-key-hash:...", which the server
 * accepts (ANDROID_CERT_SHA256). Sign in with Apple isn't offered on Android.
 */
@CapacitorPlugin(name = "WhistAuth")
public class WhistAuthPlugin extends Plugin {

    // Passkeys through Credential Manager need Android 9 (with Play services).
    private static boolean passkeysSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("passkeys", passkeysSupported());
        result.put("apple", false);
        call.resolve(result);
    }

    @PluginMethod
    public void createPasskey(PluginCall call) {
        JSObject options = call.getObject("options");
        if (!passkeysSupported() || options == null) {
            call.reject("Passkeys aren't available here.", "unsupported");
            return;
        }
        CreatePublicKeyCredentialRequest request = new CreatePublicKeyCredentialRequest(options.toString());
        manager().createCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                @Override
                public void onResult(CreateCredentialResponse response) {
                    if (!(response instanceof CreatePublicKeyCredentialResponse)) {
                        call.reject("Unexpected answer.", "failed");
                        return;
                    }
                    resolveJson(call, ((CreatePublicKeyCredentialResponse) response).getRegistrationResponseJson());
                }

                @Override
                public void onError(@NonNull CreateCredentialException e) {
                    if (e instanceof CreateCredentialCancellationException) {
                        call.reject("Cancelled.", "cancelled", e);
                    } else {
                        call.reject(String.valueOf(e.getMessage()), "failed", e);
                    }
                }
            }
        );
    }

    @PluginMethod
    public void getPasskey(PluginCall call) {
        JSObject options = call.getObject("options");
        if (!passkeysSupported() || options == null) {
            call.reject("Passkeys aren't available here.", "unsupported");
            return;
        }
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(new GetPublicKeyCredentialOption(options.toString()))
            .build();
        manager().getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential credential = response.getCredential();
                    if (!(credential instanceof PublicKeyCredential)) {
                        call.reject("Unexpected answer.", "failed");
                        return;
                    }
                    resolveJson(call, ((PublicKeyCredential) credential).getAuthenticationResponseJson());
                }

                @Override
                public void onError(@NonNull GetCredentialException e) {
                    if (e instanceof GetCredentialCancellationException) {
                        call.reject("Cancelled.", "cancelled", e);
                    } else if (e instanceof NoCredentialException) {
                        call.reject("There's no passkey for Whist on this phone.", "no_passkey", e);
                    } else {
                        call.reject(String.valueOf(e.getMessage()), "failed", e);
                    }
                }
            }
        );
    }

    @PluginMethod
    public void signInWithApple(PluginCall call) {
        call.reject("Sign in with Apple isn't available on Android.", "unsupported");
    }

    private CredentialManager manager() {
        return CredentialManager.create(getContext());
    }

    private static void resolveJson(PluginCall call, String json) {
        try {
            call.resolve(new JSObject(new JSONObject(json).toString()));
        } catch (JSONException e) {
            call.reject("Unexpected answer.", "failed", e);
        }
    }
}
