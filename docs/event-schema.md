# Event Schema Reference

Canonical event format for the perception pipeline. All sources normalize to `PerceptionEvent`.

## PerceptionEvent

| Field          | Type                     | Description                                           |
|----------------|--------------------------|-------------------------------------------------------|
| `timestamp_ms` | `number`                 | Unix epoch milliseconds                               |
| `source`       | `"caret" \| "behacom"`   | Which adapter produced this event                     |
| `event_type`   | `string`                 | One of the types below                                |
| `app_name`     | `string \| null`         | Frontmost application name                            |
| `window_title` | `string \| null`         | Active window title                                   |
| `elements`     | `Element[] \| null`      | Accessibility tree snapshot (caret only)               |
| `metadata`     | `Record<string, unknown>`| Source-specific fields                                |

## Event Types

### `app_switch`

Application focus changed.

- **Caret source**: `SidecarEventType.FrontmostApp` (event 0)
  - `app_name` = `payload.name`
  - `metadata.pid` = `payload.pid`
  - `metadata.bundleId` = `payload.bundleId`
  - `metadata.windows` = `payload.windows`
- **BEHACOM source**: Synthetic, emitted when `current_app` changes between rows
  - `app_name` = column `current_app`
  - `metadata.penultimate_app` = column `penultimate_app`

### `focus`

A UI element received focus.

- **Caret source**: `SidecarEventType.ElementFocus` (event 1)
  - `metadata.role` = `payload.role` (e.g. "AXTextArea")
  - `metadata.description` = `payload.description`
  - `metadata.value` = `payload.value`
  - `metadata.frame` = `payload.frame`
  - `metadata.selection` = `payload.selection`
- **BEHACOM source**: Not available

### `traversal`

Full accessibility tree snapshot completed.

- **Caret source**: `SidecarEventType.TraversalCompleted` (event 3)
  - `app_name` = `payload.appName`
  - `window_title` = `payload.windowTitle`
  - `elements` = parsed element tree from `payload.results`
  - `metadata.startTime` = `payload.startTime`
  - `metadata.endTime` = `payload.endTime`
- **BEHACOM source**: Not available

### `activity_summary`

Aggregated activity over a time window. BEHACOM-only.

- **BEHACOM source**: One per CSV row (1-minute window)
  - `app_name` = `current_app`
  - `window_title` = `current_window`
  - `metadata.keyboard` = aggregated keystroke counts
  - `metadata.mouse` = aggregated mouse event counts
  - `metadata.duration_ms` = 60000

### `system`

System-level event (sleep, wake, screen lock, etc.).

- **Caret source**: `SidecarEventType.SystemEventReceived` (event 7)
  - `metadata.internalId` = `payload.internalId`
- **BEHACOM source**: Not available

## Unmapped Caret Events

These sidecar events are not mapped to `PerceptionEvent`:

| Event | Type                       | Reason                          |
|-------|----------------------------|---------------------------------|
| 2     | `WindowUpdate`             | Geometry only, no semantic info |
| 4     | `MeetingAppDetected`       | Meeting-specific, not general   |
| 5     | `MeetingStarted`           | Meeting-specific                |
| 6     | `MeetingStopped`           | Meeting-specific                |
| 8     | `AudioEnergyLevelsReceived`| Audio levels, not activity      |

## Example JSONL Lines

### Caret app_switch
```json
{"timestamp_ms":1773202688000,"source":"caret","event_type":"app_switch","app_name":"Cap","window_title":null,"elements":null,"metadata":{"pid":54840,"bundleId":"so.cap.desktop","windows":[]}}
```

### Caret traversal
```json
{"timestamp_ms":1773202688823,"source":"caret","event_type":"traversal","app_name":"iTerm2","window_title":"cd ~/Documents && npm start","elements":[{"depth":0,"role":"AXWindow","title":"..."}],"metadata":{"startTime":1773202688820,"endTime":1773202688823}}
```

### BEHACOM activity_summary
```json
{"timestamp_ms":1609459200000,"source":"behacom","event_type":"activity_summary","app_name":"Google Chrome","window_title":"Gmail - Inbox","elements":null,"metadata":{"keyboard":{"total_keys":42,"special_keys":3},"mouse":{"clicks":7,"distance_px":1200},"duration_ms":60000}}
```
