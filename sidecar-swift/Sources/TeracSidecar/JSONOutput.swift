import Foundation

// MARK: - Event types matching the Electron SidecarEventType enum

enum EventType: Int {
    case frontmostApp = 0
    case elementFocus = 1
    case windowUpdate = 2
    case traversalCompleted = 3
    case systemEvent = 7
}

// MARK: - JSON Line output

/// Writes a single JSON Line to stdout: {"event":<type>,"payload":<json>}
func emit(_ eventType: EventType, payload: some Encodable) {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .millisecondsSince1970

    guard let payloadData = try? encoder.encode(payload),
          let payloadString = String(data: payloadData, encoding: .utf8)
    else { return }

    let line = "{\"event\":\(eventType.rawValue),\"payload\":\(payloadString)}\n"
    if let data = line.data(using: .utf8) {
        FileHandle.standardOutput.write(data)
    }
}
