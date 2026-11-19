// swift-tools-version: 5.9
import PackageDescription

// Local Capacitor plugin. Package/product name must equal the Capacitor CLI's fixName("@dorong/fb-events") = "DorongFbEvents",
// because the generated ios/App/CapApp-SPM/Package.swift references it by that name.
let package = Package(
    name: "DorongFbEvents",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "DorongFbEvents",
            targets: ["FbEventsPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/facebook/facebook-ios-sdk", "18.0.0"..<"19.0.0")
    ],
    targets: [
        .target(
            name: "FbEventsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "FacebookCore", package: "facebook-ios-sdk")
            ],
            path: "ios/Sources/FbEventsPlugin")
    ]
)
