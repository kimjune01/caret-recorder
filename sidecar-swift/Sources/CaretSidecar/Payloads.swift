import Foundation

// MARK: - Payload types emitted as JSON

struct FrontmostAppPayload: Codable {
    let name: String
    let pid: Int32
    let bundleId: String?
    let windows: [String]
}

struct ElementFocusPayload: Codable {
    let role: String
    let description: String
    let value: String?
    let frame: FramePayload?
}

struct FramePayload: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct WindowUpdatePayload: Codable {
    let title: String
    let frame: FramePayload
}

struct TraversalCompletedPayload: Codable {
    let appName: String
    let windowTitle: String
    let elements: [TraversedElement]
    let startTime: Date
    let endTime: Date
}

struct TraversedElement: Codable {
    let role: String
    let title: String?
    let value: String?
    let depth: Int
}

struct SystemEventPayload: Codable {
    let internalId: String
}
