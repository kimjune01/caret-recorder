# BEHACOM Adapter

Adapter for the BEHACOM dataset: 12 users x 55 days of desktop activity on Windows machines, captured at 1-minute resolution.

**Paper**: Canedo et al., "BEHACOM: A dataset of BEHAvior of COMputer users" (2024)

## What BEHACOM Captures

Each CSV row represents one minute of aggregated activity:

- **Active application** — `current_app`, `penultimate_app`
- **Window title** — `current_window`, `penultimate_window`
- **Keyboard** — per-key press/release counts, special key usage, typing speed metrics
- **Mouse** — click counts, movement distance, scroll events, drag operations
- **Temporal** — timestamp, day of week, hour of day
- **System** — CPU/memory usage, network activity

Total: ~12,000+ columns per row (most are per-key counters).

## Mapping to PerceptionEvent

| BEHACOM Column(s)               | PerceptionEvent Field | Notes                                    |
|----------------------------------|-----------------------|------------------------------------------|
| `timestamp`                      | `timestamp_ms`        | Parsed and converted to Unix epoch ms    |
| `current_app`                    | `app_name`            |                                          |
| `current_window`                 | `window_title`        |                                          |
| `current_app` (when changed)     | `event_type`          | → `app_switch` (synthetic)               |
| (every row)                      | `event_type`          | → `activity_summary`                     |
| Keyboard aggregate columns       | `metadata.keyboard`   | `total_keys`, `special_keys`             |
| Mouse aggregate columns          | `metadata.mouse`      | `clicks`, `distance_px`, `scrolls`       |
| `penultimate_app`                | `metadata`            | Previous app for transition analysis     |

## Columns Extracted

The adapter reads ~70 columns from the 12K+ available:

- `timestamp`, `day_of_week`, `hour`
- `current_app`, `current_window`, `penultimate_app`, `penultimate_window`
- `total_keys_pressed`, `total_keys_released`
- `special_keys_pressed` (Shift, Ctrl, Alt, etc.)
- `mouse_clicks_left`, `mouse_clicks_right`, `mouse_clicks_middle`
- `mouse_distance`, `mouse_scrolls`
- `cpu_usage`, `memory_usage`

All other columns (per-individual-key counters, etc.) are ignored.

## Limitations

| Aspect              | Caret                        | BEHACOM                      |
|---------------------|------------------------------|------------------------------|
| Resolution          | ~1 second                    | 1 minute                     |
| Accessibility tree  | Full tree per traversal      | None                         |
| Element focus       | Role, value, frame           | None                         |
| App context         | Name, PID, bundle ID         | Name only                    |
| Window title        | From traversal               | Separate column              |
| Input detail        | None (no keylogging)         | Per-key aggregates           |
| Mouse detail        | None                         | Clicks, distance, scrolls    |
| Platform            | macOS                        | Windows                      |
| Users               | 1 (self)                     | 12                           |
| Duration            | Ongoing                      | 55 days (fixed)              |
| Encoding            | UTF-8 JSONL                  | ISO-8859-1 CSV               |

## Running

```bash
# Single user
npx tsx pipeline/adapters/behacom.ts /path/to/User_1_BEHACOM.csv

# Multiple users (pipe through cat)
cat /path/to/User_*_BEHACOM.csv | npx tsx pipeline/adapters/behacom.ts --stdin
```

## Data Access

BEHACOM is available on Zenodo. The adapter expects individual user CSV files (e.g., `User_1_BEHACOM.csv`). Files are ISO-8859-1 encoded.
