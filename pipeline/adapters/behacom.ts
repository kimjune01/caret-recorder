// BEHACOM adapter: reads CSV files and yields PerceptionEvents.
//
// Usage: npx tsx pipeline/adapters/behacom.ts <User_N_BEHACOM.csv>
//
// BEHACOM CSVs are ISO-8859-1 encoded with ~12K columns per row.
// We extract ~70 relevant columns and emit:
//   - activity_summary for every row (1-minute window)
//   - app_switch when current_app changes between rows

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { PerceptionEvent } from '../common';

// Columns we care about (case-insensitive lookup)
const RELEVANT_COLUMNS = new Set([
  'timestamp',
  'day_of_week',
  'hour',
  'current_app',
  'current_window',
  'penultimate_app',
  'penultimate_window',
  'total_keys_pressed',
  'total_keys_released',
  'special_keys_pressed',
  'mouse_clicks_left',
  'mouse_clicks_right',
  'mouse_clicks_middle',
  'mouse_distance',
  'mouse_scrolls',
  'cpu_usage',
  'memory_usage',
]);

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',' || ch === ';') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseTimestamp(value: string): number {
  if (!value) return 0;
  // Try ISO format first, then common date formats
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d.getTime();
  // Unix seconds
  const n = Number(value);
  if (!isNaN(n)) return n > 1e12 ? n : n * 1000;
  return 0;
}

function findColumnIndices(
  headers: string[],
): Map<string, number> {
  const indices = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const normalized = headers[i].trim().toLowerCase().replace(/\s+/g, '_');
    if (RELEVANT_COLUMNS.has(normalized)) {
      indices.set(normalized, i);
    }
  }
  return indices;
}

function getField(
  fields: string[],
  colMap: Map<string, number>,
  name: string,
): string {
  const idx = colMap.get(name);
  if (idx === undefined || idx >= fields.length) return '';
  return fields[idx].trim();
}

function buildActivitySummary(
  fields: string[],
  colMap: Map<string, number>,
  timestampMs: number,
): PerceptionEvent {
  const appName = getField(fields, colMap, 'current_app') || null;
  const windowTitle = getField(fields, colMap, 'current_window') || null;

  return {
    timestamp_ms: timestampMs,
    source: 'behacom',
    event_type: 'activity_summary',
    app_name: appName,
    window_title: windowTitle,
    elements: null,
    metadata: {
      penultimate_app: getField(fields, colMap, 'penultimate_app') || null,
      penultimate_window:
        getField(fields, colMap, 'penultimate_window') || null,
      keyboard: {
        total_pressed: Number(
          getField(fields, colMap, 'total_keys_pressed'),
        ) || 0,
        total_released: Number(
          getField(fields, colMap, 'total_keys_released'),
        ) || 0,
        special_keys: Number(
          getField(fields, colMap, 'special_keys_pressed'),
        ) || 0,
      },
      mouse: {
        clicks_left: Number(
          getField(fields, colMap, 'mouse_clicks_left'),
        ) || 0,
        clicks_right: Number(
          getField(fields, colMap, 'mouse_clicks_right'),
        ) || 0,
        clicks_middle: Number(
          getField(fields, colMap, 'mouse_clicks_middle'),
        ) || 0,
        distance_px: Number(getField(fields, colMap, 'mouse_distance')) || 0,
        scrolls: Number(getField(fields, colMap, 'mouse_scrolls')) || 0,
      },
      system: {
        cpu_usage: Number(getField(fields, colMap, 'cpu_usage')) || 0,
        memory_usage: Number(getField(fields, colMap, 'memory_usage')) || 0,
      },
      duration_ms: 60_000,
    },
  };
}

export async function* readBehacomEvents(
  filepath: string,
): AsyncGenerator<PerceptionEvent> {
  const rl = createInterface({
    input: createReadStream(filepath, 'latin1'),
    crlfDelay: Infinity,
  });

  let colMap: Map<string, number> | null = null;
  let prevApp: string | null = null;

  for await (const line of rl) {
    if (!line.trim()) continue;

    const fields = parseCSVLine(line);

    // First non-empty line is the header
    if (colMap === null) {
      colMap = findColumnIndices(fields);
      if (!colMap.has('timestamp')) {
        console.error(
          'Warning: no "timestamp" column found. Available columns:',
          fields.slice(0, 20).join(', '),
        );
      }
      continue;
    }

    const timestampMs = parseTimestamp(getField(fields, colMap, 'timestamp'));
    const currentApp = getField(fields, colMap, 'current_app') || null;

    // Emit synthetic app_switch when app changes
    if (currentApp && currentApp !== prevApp) {
      yield {
        timestamp_ms: timestampMs,
        source: 'behacom',
        event_type: 'app_switch',
        app_name: currentApp,
        window_title: getField(fields, colMap, 'current_window') || null,
        elements: null,
        metadata: {
          previous_app: prevApp,
        },
      };
      prevApp = currentApp;
    }

    // Emit activity_summary for every row
    yield buildActivitySummary(fields, colMap, timestampMs);
  }
}

// CLI entry point
if (
  process.argv[1] &&
  (process.argv[1].endsWith('behacom.ts') ||
    process.argv[1].endsWith('behacom.js'))
) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error(
      'Usage: npx tsx pipeline/adapters/behacom.ts <User_N_BEHACOM.csv>',
    );
    process.exit(1);
  }

  (async () => {
    for (const file of files) {
      for await (const event of readBehacomEvents(file)) {
        console.log(JSON.stringify(event));
      }
    }
  })();
}
