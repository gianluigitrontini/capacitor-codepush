// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapCodepush",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapCodepush",
            targets: ["CodePushPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/weichsel/ZIPFoundation.git", .upToNextMinor(from: "0.9.20"))
    ],
    targets: [
        .target(
            name: "CodePushZipFoundation",
            dependencies: [
                .product(name: "ZIPFoundation", package: "ZIPFoundation")
            ],
            path: "ios/ZipFoundationSupport"
        ),
        .target(
            name: "CodePushPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                "CodePushZipFoundation"
            ],
            path: "ios/Plugin",
            publicHeadersPath: "include",
            cSettings: [
                .headerSearchPath("."),
                .headerSearchPath("Base64"),
                .headerSearchPath("JWT/Core/Algorithms/Base"),
                .headerSearchPath("JWT/Core/Algorithms/ESFamily"),
                .headerSearchPath("JWT/Core/Algorithms/HSFamily"),
                .headerSearchPath("JWT/Core/Algorithms/RSFamily"),
                .headerSearchPath("JWT/Core/Algorithms/RSFamily/RSKeys"),
                .headerSearchPath("JWT/Core/Algorithms/Holders"),
                .headerSearchPath("JWT/Core/ClaimSet"),
                .headerSearchPath("JWT/Core/Coding"),
                .headerSearchPath("JWT/Core/FrameworkSupplement"),
                .headerSearchPath("JWT/Core/Supplement")
            ],
            linkerSettings: [
                .linkedFramework("UIKit")
            ]
        )
    ]
)
