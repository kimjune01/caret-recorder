import AppKit
import ApplicationServices

/// Observes the frontmost application and periodically traverses its a11y tree.
/// Emits JSON Lines to stdout for each event.
final class FrontmostAppObserver {
    private var appObserver: NSObjectProtocol?
    private var sleepObserver: NSObjectProtocol?
    private var wakeObserver: NSObjectProtocol?
    private var lockObserver: NSObjectProtocol?
    private var unlockObserver: NSObjectProtocol?
    private var periodicTimer: Timer?

    private var currentPid: pid_t = 0
    private var currentAppName: String = ""

    /// Traversal interval in seconds
    private let traversalInterval: TimeInterval = 5.0

    func start() {
        // Check accessibility permission
        if !AXIsProcessTrusted() {
            fputs("[Sidecar] Accessibility permission not granted. Requesting...\n", stderr)
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
            AXIsProcessTrustedWithOptions(options)
        }

        // Observe frontmost app changes
        appObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self?.handleAppChanged(app)
        }

        // System events
        let wsnc = NSWorkspace.shared.notificationCenter
        sleepObserver = wsnc.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { _ in
            emit(.systemEvent, payload: SystemEventPayload(internalId: "SYSTEM_WILL_SLEEP"))
        }
        wakeObserver = wsnc.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
            emit(.systemEvent, payload: SystemEventPayload(internalId: "SYSTEM_DID_WAKE_UP"))
        }

        let dnc = DistributedNotificationCenter.default()
        lockObserver = dnc.addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in
            emit(.systemEvent, payload: SystemEventPayload(internalId: "SCREEN_IS_LOCKED"))
        }
        unlockObserver = dnc.addObserver(forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main) { _ in
            emit(.systemEvent, payload: SystemEventPayload(internalId: "SCREEN_IS_UNLOCKED"))
        }

        // Emit initial state
        if let front = NSWorkspace.shared.frontmostApplication {
            handleAppChanged(front)
        }

        // Start periodic traversal
        periodicTimer = Timer.scheduledTimer(withTimeInterval: traversalInterval, repeats: true) { [weak self] _ in
            self?.traverseCurrentApp()
        }
    }

    // MARK: - App changed

    private func handleAppChanged(_ app: NSRunningApplication) {
        let name = app.localizedName ?? "Unknown"
        let pid = app.processIdentifier
        currentPid = pid
        currentAppName = name

        // Get window titles
        let axApp = AXUIElementCreateApplication(pid)
        let windowTitles = axApp.windows.compactMap { $0.title }

        emit(.frontmostApp, payload: FrontmostAppPayload(
            name: name,
            pid: pid,
            bundleId: app.bundleIdentifier,
            windows: windowTitles
        ))

        // Emit focused element
        emitFocusedElement(axApp: axApp)

        // Immediate traversal on app switch
        traverseCurrentApp()
    }

    // MARK: - Focused element

    private func emitFocusedElement(axApp: AXUIElement) {
        guard let focused = axApp.focusedElement else { return }

        var frame: FramePayload?
        if let pos = focused.position, let size = focused.size {
            frame = FramePayload(x: pos.x, y: pos.y, width: size.width, height: size.height)
        }

        emit(.elementFocus, payload: ElementFocusPayload(
            role: focused.role ?? "unknown",
            description: focused.descriptionAttr ?? focused.roleDescription ?? "",
            value: focused.value,
            frame: frame
        ))
    }

    // MARK: - Periodic traversal

    private func traverseCurrentApp() {
        guard currentPid != 0 else { return }

        let startTime = Date()
        let axApp = AXUIElementCreateApplication(currentPid)

        // Get the main window (or first window)
        guard let window = axApp.mainWindow ?? axApp.windows.first else { return }

        let windowTitle = window.title ?? ""

        // Emit window info
        if let pos = window.position, let size = window.size {
            emit(.windowUpdate, payload: WindowUpdatePayload(
                title: windowTitle,
                frame: FramePayload(x: pos.x, y: pos.y, width: size.width, height: size.height)
            ))
        }

        // Traverse the a11y tree
        let elements = traverseAccessibilityTree(root: window)

        emit(.traversalCompleted, payload: TraversalCompletedPayload(
            appName: currentAppName,
            windowTitle: windowTitle,
            elements: elements,
            startTime: startTime,
            endTime: Date()
        ))
    }
}
