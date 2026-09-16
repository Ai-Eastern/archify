# Delivery contract

For `deliver atlas`, use the [Architecture Atlas contract](architecture-atlas.md): inputs are a manifest plus local architecture members, and final checks cover every embedded member and the bundle. The final self-contained HTML stores the unchanged logical bundle in a deterministic, digest-checked gzip envelope with an inline offline fallback. Receipt and member checks apply to restored bytes, while the bundle receipt identifies the physical compressed file. The ordinary single-diagram contract below remains unchanged.

## Validate and deliver

Use `validate` after every candidate edit. CLI HTML output paths must end in `.html`, including after symbolic-link resolution.
Compare receipt paths must end in `.json`. Explicit CLI paths may be absolute or
outside the current working directory; authored `meta.output` remains confined
to that directory. A type mismatch fails before writing with
`output/cli-extension` or `output/cli-resolved-extension`. These checks prevent
accidental file-type overwrites; they do not sandbox explicit CLI directories
or prevent replacement of an existing artifact of the expected type.

Use final atomic delivery only after the candidate is frozen:

```bash
node bin/archify.mjs deliver <type> <candidate.json> <output.html> --quality showcase --json
```

Deliver reads the specification once, writes those exact bytes to a private same-directory candidate snapshot, renders that snapshot, runs the complete artifact checker, and only replaces the target after all artifact checks pass. The JSON receipt includes SHA-256 and byte counts for both `specification` and `artifact`. Renderer, checker, receipt, or commit failure exits non-zero, removes private state, preserves the previous trusted artifact, and never invokes an opener.

Run `visual-check` only after `deliver` exits zero for the current candidate. If
delivery fails and the output path already exists, that path still names the
previous trusted artifact; running `visual-check` then would measure and capture
stale output, not the rejected candidate. Report the delivery diagnostics and
repair the source before collecting new visual evidence.

The delivery interface exposes three separate claims:

1. `deliver` proves deterministic artifact checks and byte identity.
2. `visual-check` collects automated browser evidence from the exact artifact.
3. Perceptual visual review records a human or image-capable reviewer's judgment.

Passing one claim never implies either of the others. Never claim that the deterministic receipt includes visual review. It does not include browser evidence either.

### Internal-structure delivery evidence

An Architecture with `components[].internal_structure` emits exactly one inert
`archify-internal-structure-data` script outside the canonical SVG. Its body is
a JSON array of string chunks; joining the chunks yields a node-indexed payload
with `schemaVersion`, `sources`, `items`, and `relations`. An Architecture with
no structure emits neither the script nor an `internalStructure` receipt.

The checker validates the envelope, node IDs, local source references, item and
relation endpoints, repository evidence, byte limits, and 8192-byte payload
lines. A standalone receipt has this shape:

```json
{
  "schemaVersion": 1,
  "nodeCount": 2,
  "itemCount": 14,
  "relationCount": 3,
  "sourceCount": 8,
  "bytes": 4276,
  "sha256": "<64 lowercase hex characters>"
}
```

Byte count and digest describe the exact chunked script text. The receipt does
not copy structure content. Each compiled node is limited to 64 KiB, one member
payload to 256 KiB, and the sum across an Atlas to 512 KiB.

Atlas bundle metadata stores only each owning member's receipt and a compact
node/domain/item inventory. The body remains once in that member document.
Delivery and unpacking reconstruct the member and compare its actual payload,
inventory, counts, bytes, and digest. A reference occurrence cannot author or
carry another structure body. See [Canonical internal structure](architecture-atlas.md#canonical-internal-structure).

These checks prove bounded, internally consistent bytes and verified source
locations. They do not prove authored summaries, item kinds, or behavioral
relations. Apply the independent review rules in the
[authoring contract](authoring-contract.md#architecture-node-internal-structure).

Structure data stays outside canonical SVG and every graph export. The HTML is
self-contained under `file://` and local HTTP. It makes no autonomous network
request; only a user-activated source link may leave the artifact, and
`local-only` emits neither remote links nor the local repository root.

For Atlas navigation changes, static member screenshots do not establish a continuous layer switch. Record the transition in a real browser using video or consecutive frames, with commit timing, visible diagram identity and workbench-boundary measurements. Inspect representative light/dark, delayed, failed, superseded and history-restoration transitions, including resize. Bind this process evidence to the final artifact digest and report its coverage and limitations separately from `visual-check`; a ready callback or simulated DOM test is not visual evidence. Follow the execution environment's browser and URL permissions when collecting it; unavailable required evidence remains incomplete rather than passed.

For internal-structure changes, that continuous browser record must begin on the
committed graph and cover Details entry, code/state switching, item selection,
tree keyboard behavior, return, native Back/Forward, cold deep links, a node
without structure, invalid targets, reference-to-canonical navigation, resize,
reduced motion, and failed or superseded preparation. A final still cannot prove
that one usable workspace remained throughout.
Check both standalone Architecture and Atlas when their shared Viewer or the
outer shell changed. Bind the record to the delivered artifact digest, and keep
it separate from perceptual review and from the ordinary `visual-check` receipt.

## Automated browser evidence

After delivery, inspect the exact trusted HTML without rerendering or modifying
it:

```bash
node bin/archify.mjs visual-check <output.html> --json
```

The zero-dependency command uses Chrome/Chromium through the DevTools pipe. It
measures light-theme containment at 1440×900, 1600×1000, 1920×1080, and
2048×1320, then captures light/dark screenshots at 1440×900 and 2048×1320. It
writes four PNG sidecars, one relative-path HTML contact sheet, and one JSON
receipt beside the artifact. The receipt binds the source artifact SHA-256 and
byte count, identifies `evidenceKind: "automated-browser"`, records READ plus
Still runtime state, and always reports `visualReview: "pending"`; automated
browser evidence cannot claim perceptual review.

`browser_evidence` in the handoff records only the outcome of this automated command:

- `passed` maps from exit 0 and receipt `status: "pass"` only after every required measurement and capture completes and passes.
- `failed` maps from exit 1 and receipt `status: "fail"` when the inspection finds a defect, the command fails, or a runtime/capture error leaves the evidence incomplete.
- `skipped` maps only from exit 2 and receipt `status: "skipped"` when Chrome/Chromium is unavailable and the inspection does not run.

Runtime or capture failures leave incomplete evidence and must not be normalized to `skipped`. Failed or skipped capture runs remove stale
image/contact-sheet sidecars rather than presenting prior evidence as current.
They do not invalidate an already successful deterministic delivery, and they
do not turn a perceptual visual review into passed or failed. Retry an
environmental failure through the supported command in a browser-capable
execution context when practical. Keep the packaged transport unchanged unless
the failure reproduces through that seam in a capable environment.

## Optional opening

Add `--open` only when the user wants an immediate local preview. It runs after that atomic commit, uses one argument-array OS opener with a five-second bound, and records `open.status`. Keep it off for CI, unattended agents, and non-interactive environments. Failure or unsupported opening does not invalidate delivery; its status proves only whether the local opener invocation succeeded.

For an Atlas desktop handoff, return its HTML link and a PNG preview bound to the final artifact rather than automatically opening an HTML file panel. Honor an explicit opening request and the user's chosen surface; an unspecified opening request uses the browser. This agent handoff rule does not change the CLI's explicit `--open` option. Smaller output is a byte-size result, not proof of faster host-application rendering.

## Last-Good Live Preview

For an active desktop authoring loop only:

```bash
node bin/archify.mjs preview <type> <input>.json <output>.html --quality showcase
```

Preview watches one explicit input on loopback, binds each stable digest to a private snapshot, and advances only after the existing verified delivery pipeline passes. Invalid, half-written, deleted, or superseded input leaves the previous verified revision on screen and on disk. Identical bytes do not rebuild or reload.

The preview runtime ships inside the zero-dependency Skill ZIP and must work without `node_modules`.

Never start it by default. Do not use it for CI, unattended agents, remote sharing, or mobile use. `--no-open` is only for a user who will open the printed local URL or for loop testing. Stop it with Ctrl-C before handoff. Server state, port, source path, diagnostics, error text, and reload tokens must never enter the generated artifact or any export.

## Perceptual delivery gate

Automated validation and browser evidence cannot prove visual polish. After deterministic delivery, inspect the actual HTML in a capable browser or render the evidence screenshots with an image reader. Check both themes when changed, the default READ view, line crossings/corridors, label masks, node/card fit, focus/search/passport closure, and export cleanliness.

For the default standalone desktop viewer, measure 1440×900, 1600×1000, and 1920×1080. When the artifact is intended for a large desktop display, also measure 2048×1320. A first-screen pass requires `document.documentElement.scrollWidth <= window.innerWidth` and `scrollHeight <= window.innerHeight` at every checked size. At the largest checked viewport, inspect the rendered composition for a conspicuous empty lower band: the main panel and necessary conclusion cards should use the available height as a balanced whole, not collapse into a shallow strip. If a desktop viewport overflows, repair the authored composition by removing only genuinely redundant content or compacting spacing before shrinking nodes, labels, or the main panel. Do not hide overflow, clip content, introduce an internal diagram scroller, or reduce node/label typography to make the measurement pass. Narrow/mobile containment may retain vertical page scrolling.

A manual browser record is supplementary to the automated status. Reproducing the same coverage requires all four exact viewport measurements, both endpoint themes, and an artifact-bound record of the inspected SHA-256 and byte count. It never changes `browser_evidence`: when Chrome/Chromium is unavailable, that status remains `skipped` even when the manual browser record is complete and `visual_review: passed`; an automated `failed` result likewise remains `failed`. An unconstrained browser glance can support perceptual review only.

Report exactly one truthful status:

- `visual_review: passed` — only after inspecting the rendered artifact.
- `visual_review: skipped (image reader unavailable)` — when no capable visual surface exists.
- `visual_review: failed` — with the concrete visible defect.

Use `correction_rounds: 0`, `correction_rounds: 1`, or `correction_rounds: 2`; never exceed a maximum of two focused correction rounds. Never report `visual_review: passed` without inspecting the artifact.

If visual review changes the candidate, validation and delivery must run again because the prior frozen specification receipt is no longer current.

## Handoff receipt

Return:

```text
diagram_type: architecture|workflow|sequence|dataflow|lifecycle
output: /absolute/path/to/file.html
specification_sha256: <receipt value>
artifact_sha256: <receipt value>
validation: 9/9 showcase, 0 errors, 0 warnings
browser_evidence: passed|failed|skipped
visual_review: passed|skipped (image reader unavailable)|failed
correction_rounds: 0|1|2
```

Derive `browser_evidence` only from the latest artifact-bound `visual-check` receipt. Record any manual browser work separately with its artifact binding, viewport/theme scope, and observations; never use it or `visual_review` to overwrite the automated status.

When a standalone artifact has internal structure, also return its emitted
`internalStructure` object unchanged. For an Atlas, report the optional object
under each owning member; do not synthesize a top-level total receipt or an empty
receipt for members without structure.

Opening, preview status, Share Cards, and other viewer exports are not validation claims.
