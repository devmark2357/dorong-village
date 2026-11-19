import Foundation
import UIKit
import Capacitor
import FacebookCore

/// Meta App Events bridge.
/// Policy: SDK auto-init ON, FacebookAutoLogAppEventsEnabled=false (Info.plist), FacebookAdvertiserIDCollectionEnabled=true.
/// Because automatic logging is off, we call activateApp ourselves (now if already active, and on every
/// didBecomeActive) so installs / app opens still reach Meta. No ATT prompt here.
@objc(FbEventsPlugin)
public class FbEventsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FbEventsPlugin"
    public let jsName = "FbEvents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "logEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logPurchase", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        DispatchQueue.main.async {
            ApplicationDelegate.shared.initializeSDK()
            if UIApplication.shared.applicationState == .active {
                AppEvents.shared.activateApp()
            }
        }
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(didBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil)
    }

    @objc private func didBecomeActive() {
        AppEvents.shared.activateApp()
    }

    @objc func logEvent(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), !name.isEmpty else {
            call.reject("name is required")
            return
        }
        let params = Self.parameters(call.getObject("params"))
        DispatchQueue.main.async {
            AppEvents.shared.logEvent(AppEvents.Name(name), parameters: params)
            call.resolve()
        }
    }

    @objc func logPurchase(_ call: CAPPluginCall) {
        guard let amount = call.getDouble("amount"), amount > 0,
              let currency = call.getString("currency"), !currency.isEmpty else {
            call.reject("amount (>0) and currency are required")
            return
        }
        let params = Self.parameters(call.getObject("params"))
        DispatchQueue.main.async {
            AppEvents.shared.logPurchase(amount: amount, currency: currency.uppercased(), parameters: params)
            call.resolve()
        }
    }

    private static func parameters(_ obj: JSObject?) -> [AppEvents.ParameterName: Any] {
        var out: [AppEvents.ParameterName: Any] = [:]
        guard let obj = obj else { return out }
        for (key, value) in obj {
            switch value {
            case let v as String: out[AppEvents.ParameterName(key)] = v
            case let v as NSNumber: out[AppEvents.ParameterName(key)] = v
            default: out[AppEvents.ParameterName(key)] = "\(value)"
            }
        }
        return out
    }
}
