import Capacitor
import UIKit

// The WebView's controller, with the app's own plugins (ones that aren't npm
// packages, so `cap sync` doesn't know about them) registered.
class WhistBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WhistAuthPlugin())
    }
}
