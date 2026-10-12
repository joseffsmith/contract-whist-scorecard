package uk.joseffsmith.whist;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins (not npm packages, so `cap sync` doesn't
        // know about them) are registered before the bridge starts.
        registerPlugin(WhistAuthPlugin.class);
        // Draw under the system bars on every Android version, as the web
        // layout expects (see SystemBars in capacitor.config.ts).
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
