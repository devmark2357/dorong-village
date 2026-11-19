// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3"),
        .package(name: "CapacitorCommunityAdmob", path: "../../../node_modules/@capacitor-community/admob"),
        .package(name: "CapacitorFirebaseAnalytics", path: "../../../node_modules/@capacitor-firebase/analytics"),
        .package(name: "CapacitorFirebaseMessaging", path: "../../../node_modules/@capacitor-firebase/messaging"),
        .package(name: "CapacitorFilesystem", path: "../../../node_modules/@capacitor/filesystem"),
        .package(name: "CapgoCapacitorSocialLogin", path: "../../../node_modules/@capgo/capacitor-social-login"),
        .package(name: "CapgoCapacitorUpdater", path: "../../../node_modules/@capgo/capacitor-updater"),
        .package(name: "CapgoNativePurchases", path: "../../../node_modules/@capgo/native-purchases"),
        .package(name: "DorongFbEvents", path: "../../../plugins/fb-events")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunityAdmob", package: "CapacitorCommunityAdmob"),
                .product(name: "CapacitorFirebaseAnalytics", package: "CapacitorFirebaseAnalytics"),
                .product(name: "CapacitorFirebaseMessaging", package: "CapacitorFirebaseMessaging"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapgoCapacitorSocialLogin", package: "CapgoCapacitorSocialLogin"),
                .product(name: "CapgoCapacitorUpdater", package: "CapgoCapacitorUpdater"),
                .product(name: "CapgoNativePurchases", package: "CapgoNativePurchases"),
                .product(name: "DorongFbEvents", package: "DorongFbEvents")
            ]
        )
    ]
)
