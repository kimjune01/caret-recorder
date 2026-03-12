// Post-condensation moment dedup.
//
// Catches duplicate moments where the content is a substring of a previous
// moment from the same app (e.g. two terminal moments covering the same
// session because the buffer flushed twice on non-superset diffs).
//
// Also handles the superset case: if a new moment contains the previous
// moment's content, the previous is replaced (yielded moments are buffered
// per app until a different app or end of stream).
//
// Usage:
//   import { deduplicateMoments } from './moment_dedup';
//   for await (const m of deduplicateMoments(condense(...))) { ... }

import type { Moment } from './common';

/**
 * Deduplicate moments: drop subsets, replace with supersets, per app.
 */
export async function* deduplicateMoments(
  moments: AsyncIterable<Moment>,
): AsyncGenerator<Moment> {
  // Per-app: last moment seen (not yet yielded if still accumulating)
  const lastByApp = new Map<string, Moment>();
  // Track which apps have yielded their moment already
  const yielded = new Set<string>();

  for await (const moment of moments) {
    const app = moment.source_app;
    const prev = lastByApp.get(app);

    if (!prev) {
      lastByApp.set(app, moment);
      continue;
    }

    // Subset: new content is contained in previous → drop new
    if (prev.content.includes(moment.content)) {
      continue;
    }

    // Superset: new content contains previous → replace
    if (moment.content.includes(prev.content)) {
      lastByApp.set(app, moment);
      continue;
    }

    // Distinct: yield previous, buffer new
    yield prev;
    lastByApp.set(app, moment);
  }

  // Flush remaining buffered moments
  for (const moment of lastByApp.values()) {
    yield moment;
  }
}
