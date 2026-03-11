import AppKit
import ApplicationServices

// MARK: - AXUIElement convenience helpers

extension AXUIElement {
    func attribute<T>(_ attr: String) -> T? {
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(self, attr as CFString, &value) == .success else {
            return nil
        }
        return value as? T
    }

    var role: String? { attribute(kAXRoleAttribute) }
    var title: String? { attribute(kAXTitleAttribute) }
    var value: String? { attribute(kAXValueAttribute) }
    var roleDescription: String? { attribute(kAXRoleDescriptionAttribute) }
    var descriptionAttr: String? { attribute(kAXDescriptionAttribute) }
    var children: [AXUIElement] { attribute(kAXChildrenAttribute) ?? [] }
    var focusedElement: AXUIElement? { attribute(kAXFocusedUIElementAttribute) }
    var mainWindow: AXUIElement? { attribute(kAXMainWindowAttribute) }
    var windows: [AXUIElement] { attribute(kAXWindowsAttribute) ?? [] }

    var position: CGPoint? {
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(self, kAXPositionAttribute as CFString, &value) == .success,
              let axValue = value else { return nil }
        var point = CGPoint.zero
        AXValueGetValue(axValue as! AXValue, .cgPoint, &point)
        return point
    }

    var size: CGSize? {
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(self, kAXSizeAttribute as CFString, &value) == .success,
              let axValue = value else { return nil }
        var size = CGSize.zero
        AXValueGetValue(axValue as! AXValue, .cgSize, &size)
        return size
    }
}

// MARK: - Depth-first a11y tree traversal

/// Traverses the accessibility tree of the given element up to `maxDepth`,
/// collecting text-bearing elements (roles that typically contain user-visible content).
func traverseAccessibilityTree(
    root: AXUIElement,
    maxDepth: Int = 8,
    maxElements: Int = 500
) -> [TraversedElement] {
    var results: [TraversedElement] = []
    var stack: [(element: AXUIElement, depth: Int)] = [(root, 0)]

    while let (element, depth) = stack.popLast() {
        guard results.count < maxElements, depth <= maxDepth else { continue }

        let role = element.role ?? "unknown"
        let title = element.title
        let value = element.value

        // Only collect elements that carry meaningful text
        let hasContent = (title != nil && !title!.isEmpty) || (value != nil && !value!.isEmpty)
        if hasContent {
            results.append(TraversedElement(
                role: role,
                title: title,
                value: value,
                depth: depth
            ))
        }

        // Push children in reverse order so left-to-right traversal is preserved
        let children = element.children
        for child in children.reversed() {
            stack.append((child, depth + 1))
        }
    }

    return results
}
