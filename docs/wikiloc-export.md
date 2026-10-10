# Feature spec: export for Wikiloc (GPX)

Status: **wanted** — the first PR from an external contributor targets exactly this.

## What

A button in the **Route** tab that exports the loaded track as a **GPX file**
(downloaded locally), ready to upload to Wikiloc.

- Works for both things the Route tab accepts: a **planned route** (`.gpx` / `.kml`)
  and a **recording** (`.proto`).
- Client-side only: no network calls, no accounts, no upload (see `CONTRIBUTING.md`,
  the privacy rules).

## Where

A secondary button (`btn btn-ghost btn-sm`), labelled like the rest of the UI
(English), for example **Export GPX for Wikiloc**, visible near the loaded-file
summary and only when a track is loaded. The exact placement is open to discussion in
review.

## The file

- **GPX 1.1**, one `<trk>` with `<trkseg>`/`<trkpt lat="…" lon="…">` and `<ele>` inside
  when known.
- `lat` / `lon`: 6 decimals.
- `<ele>`: from the track when available; **omit when unknown** (do not write 0).
- `<time>`: from the recording's timestamps when available (ISO 8601, UTC); omit for
  planned routes that carry none.
- **GPS gaps split the track**: a recording with missing fixes (the app draws those
  stretches **dashed**) must become **multiple `<trkseg>`** — never a straight line
  bridging a gap the bike did not ride. The maintainer can provide a recording with
  gaps (`1016`) to test with.
- `<metadata><name>` something a human recognises (file name or ride date), e.g.
  `Avinox 2026-09-27`; keep the downloaded filename in the same spirit.

## Acceptance criteria (what the review will check)

1. Load the maintainer's Komoot GPX, export, open the file in any GPX viewer/map: the
   same track comes back — points and distance match the app's numbers.
2. Load the recording with GPS gaps (`1016`), export: the GPX contains **several
   `<trkseg>`**, and no segment bridges a gap.
3. During the export there are **zero network requests** (check devtools) and it works
   offline.
4. `npm test` is green, including a new unit test for the GPX writer — a **pure
   function** that builds the XML from points, testable like `route-file.js`.
5. No new dependencies. No changes outside this feature's scope.
6. Button state is right: nothing loaded → disabled or absent; route or recording →
   present.

## Explicit non-goals (keep the PR small)

- No Wikiloc API, no upload, no login.
- No other formats (GPX only; KML/TCX can come later).
- No changes to the parsers, the analysis, the charts or the service worker.
