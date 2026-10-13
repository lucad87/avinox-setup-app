# Contributing

Thanks for wanting to help. This is a small, opinionated project: a free, independent
companion for DJI Avinox riders. A few rules keep it maintainable — and keep you out of
review loops.

## The basics

1. **Fork** the repo, then branch **from `master`**: `git checkout -b feat/<short-name> master`.
2. **One feature per PR**, small diffs. If your fork has other changes, keep them out:
   only what this PR is about.
3. `npm test` must be **green** before you open the PR. Add tests for new logic
   (`node:test`, no extra dependencies — and add your test file to the `npm test`
   script in `package.json`).
4. Open the PR from your branch to `master`. **The maintainer merges** — `master`
   requires a pull request and direct pushes are blocked for everyone.

If you are about to build something big, open an issue or ask first: five minutes now
beat a week of review rounds later.

## Running it

```bash
npm install
npm start        # dev server on http://127.0.0.1:3080/
npm test         # the whole test suite
```

## Code, the house style

- **No new dependencies** without discussing it first. The browser modules are plain
  JavaScript with no build step — see `public/route-file.js` and
  `public/surface-osm.js` for the pattern: a small UMD wrapper, zero deps, pure
  helpers that are testable under Node.
- Comments explain **why**, not what.
- UI: reuse the existing classes and components (`btn`, `btn-ghost`, `.card`, …). If it
  looks different from the rest of the app, the review will ask why.

## Privacy is not negotiable

Everything runs **on the device**. Files are never uploaded.

- No analytics, no tracking, no phone-home calls.
- If a feature must use the network, it happens **only after a click**, and the UI says
  exactly what leaves the device and why — the **Read the surface from OpenStreetMap**
  button is the reference example.
- A feature that exports data produces a **local file download**: that is fine, and
  encouraged.

## A good PR

- The description says **why** (not just what), plus what you tested it with.
- UI changes get a **screenshot**.
- Tested with real files (`.gpx` / `.kml` / `.proto`), not only synthetic ones.

If you're working with an AI assistant: point it at this file and at the relevant spec
in `docs/` before it writes code — it saves everyone a review round.
