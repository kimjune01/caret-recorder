import AppKit
import ApplicationServices
import Foundation

// MARK: - Terac Sidecar
// Monitors the frontmost application using macOS Accessibility APIs.
// Outputs JSON Lines to stdout for consumption by the Electron host.

// Disable stdout buffering for real-time output
setbuf(stdout, nil)

// Emit a startup marker so the host knows we're alive
emit(.systemEvent, payload: SystemEventPayload(internalId: "SIDECAR_STARTED"))

let observer = FrontmostAppObserver()
observer.start()

// Handle signals for clean shutdown
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }

// Run the main RunLoop — NSWorkspace notifications require it
RunLoop.main.run()
