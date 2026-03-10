// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "terac-sidecar",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "terac-sidecar",
            path: "Sources/TeracSidecar"
        ),
    ]
)
