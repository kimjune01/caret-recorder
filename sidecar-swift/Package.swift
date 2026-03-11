// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "caret-sidecar",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "caret-sidecar",
            path: "Sources/CaretSidecar"
        ),
    ]
)
