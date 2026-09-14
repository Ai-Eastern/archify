import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const focusSource = fs.readFileSync(path.resolve(skillRoot, '..', 'viewer', 'focus.js'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-passport-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function svg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all typed renderers emit details-on-demand metadata and native SVG titles', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    const diagram = svg(html);
    assert.match(diagram, /data-node-kind="[^"]+"/, mode);
    assert.match(diagram, /data-node-sublabel="[^"]+"/, mode);
    assert.match(diagram, /data-node-context="[^"]+"/, mode);
    assert.match(diagram, /<g id="node-[^"]+"[\s\S]*?<title>[^<]+ · [^<]+<\/title>/, mode);
  }
});

test('renderer-owned structure supplies truthful Semantic Passport context', () => {
  const architecture = render('architecture', CASES.architecture);
  const workflow = render('workflow', CASES.workflow);
  const sequence = render('sequence', CASES.sequence);
  const dataflow = render('dataflow', CASES.dataflow);
  const lifecycle = render('lifecycle', CASES.lifecycle);

  assert.match(architecture, /data-node-id="api"[^>]+data-node-kind="backend"[^>]+data-node-context="AWS Region: us-west-2 › sg-api :443\/:8000"/);
  assert.match(workflow, /data-node-id="approval"[^>]+data-node-kind="security"[^>]+data-node-context="Policy &amp; Recovery › Human or policy stop › Plan \+ route"/);
  assert.match(sequence, /data-node-id="redis"[^>]+data-node-kind="database"[^>]+data-node-context="Sequence participant"/);
  assert.match(dataflow, /data-node-id="warehouse"[^>]+data-node-kind="database"[^>]+data-node-context="04 \/ Store"/);
  assert.match(lifecycle, /data-node-id="executing"[^>]+data-node-kind="active"[^>]+data-node-context="Lifecycle phases"/);
});

test('Relationship Lens renders one Semantic Passport and copyable stable focus link', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /<span class="relationship-lens-eyebrow">Semantic passport<\/span>/);
  assert.match(html, /id="focus-detail" hidden/);
  assert.match(html, /id="focus-kind" data-passport="kind"/);
  assert.match(html, /id="focus-context" data-passport="context" hidden/);
  assert.match(html, /id="focus-tag" data-passport="tag" hidden/);
  assert.match(html, /id="focus-id" data-passport="id"/);
  assert.match(html, /id="btn-focus-clear"[^>]+aria-label="Close semantic passport"[^>]+title="Close">&#215;<\/button>/);
  assert.match(html, /id="btn-focus-copy"[^>]+aria-label="Copy link to focused node"/);
  assert.match(html, /id="btn-focus-relations"[^>]+aria-expanded="false"[^>]+aria-controls="relationship-lens-list"/);
  assert.match(html, /function renderPassport\(id, node\)/);
  assert.match(html, /var relationId = record && record\.id/);
  assert.match(html, /\? '#relation=' \+ encodeURIComponent\(relationId\)/);
  assert.match(html, /: '#focus=' \+ encodeURIComponent\(activeIds\[0\]\)/);
  assert.match(html, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(html, /document\.execCommand\('copy'\)/);
  assert.match(html, /copyLink: copyFocusLink/);
  assert.match(html, /compactOnMobile = mobile && chip\.getAttribute\('data-relations-expanded'\) !== 'true'/);
  assert.match(html, /nodeTop - chip\.offsetHeight - gap/);
  assert.match(html, /focus-chip:not\(\[data-relations-expanded="true"\]\) \.relationship-lens-list \{ display: none; \}/);
  assert.match(html, /clearBtn\.addEventListener\('click', function \(\) \{ clear\(\{ restoreFocus: true \}\); \}\)/);
  assert.match(html, /chip\.hidden \|\| !target \|\| typeof target\.closest !== 'function' \|\| chip\.contains\(target\)/);
  assert.match(html, /target\.closest\('\[data-node-id\], \[data-relationship-hit-key\], \.overview-map, \.atlas-navigation, \.atlas-compact-navigation, \.atlas-directory, \.atlas-breadcrumb, \.atlas-parent-context, \.atlas-rail, \.atlas-inspector, \.atlas-directory-section'\)/);
  assert.match(html, /document\.addEventListener\('click',[\s\S]+?clear\(\);\s+\}, true\);/);
  assert.match(html, /Archify\.focus\.clear\(\{ restoreFocus: true \}\)/);
});

test('Node Finder searches and presents the same passport facts', () => {
  const html = render('dataflow', CASES.dataflow);
  assert.match(html, /var authored = node\.getAttribute\('data-node-kind'\)/);
  assert.match(html, /var sublabel = node\.getAttribute\('data-node-sublabel'\) \|\| ''/);
  assert.match(html, /var context = node\.getAttribute\('data-node-context'\) \|\| ''/);
  assert.match(html, /var tag = node\.getAttribute\('data-node-tag'\) \|\| ''/);
  assert.match(html, /search: \(id \+ ' ' \+ label \+ ' ' \+ type \+ ' ' \+ sublabel \+ ' ' \+ context \+ ' ' \+ tag \+ ' ' \+ sourceSearch \+ ' ' \+ text\)\.toLowerCase\(\)/);
  assert.match(html, /\[viewerKindLabel\(item\.type\), item\.id, item\.sublabel, item\.tag\]\.filter\(Boolean\)\.join\(' \\u00b7 '\)/);
  assert.match(html, /meta\.title = \[viewerKindLabel\(item\.type\), item\.id, item\.context, item\.sublabel, item\.tag\]\.filter\(Boolean\)\.join\(' \\u00b7 '\)/);
});

test('developer guide projection is bounded, text-only, and preserves native history semantics', () => {
  assert.match(focusSource, /interfaceSection\.items\.slice\(0, 3\)/);
  assert.match(focusSource, /detail\.after\(quicklook\)/);
  assert.match(focusSource, /textElement\('h2', 'node-guide-title'/);
  assert.doesNotMatch(focusSource, /textElement\('h1'/);
  assert.doesNotMatch(focusSource, /\.innerHTML\s*=/);
  assert.match(focusSource, /history\.pushState\(guideEntry, '', url\)/);
  assert.match(focusSource, /activateGuide\(id, section, \{ emitReady: false, emitError: false \}\)[\s\S]+?return surfaceReady\.then\(function \(\) \{[\s\S]+?history\.pushState\(guideEntry, '', url\)/);
  assert.match(focusSource, /pendingOpen = \{ revision: expectedRevision, trigger: trigger \}/);
  assert.match(focusSource, /if \(pendingOpen\) \{[\s\S]+?deactivateGuide\(\{ restoreFocus: false \}\)[\s\S]+?trigger\.focus/);
  assert.match(focusSource, /deactivateGuide\(\{ restoreFocus: false, restoreScroll: true \}\)[\s\S]+?userError\(id, error\)/);
  assert.match(focusSource, /ArchifyAddress\.replaceState\(history\.state, '', url\)/);
  assert.match(focusSource, /ArchifyAddress\.send\('navigate', \{ focus: id, inspect: 'guide', section: section \}\)/);
  assert.match(focusSource, /ArchifyAddress\.send\('guide-return'\)/);
  assert.match(focusSource, /renderError\(id, 'viewer\.developerGuide\.empty', 'empty'\);[\s\S]+?empty: true/);
  assert.match(focusSource, /graphState\.forEach\(hideElement\)/);
  assert.match(focusSource, /state\.element\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(focusSource, /currentSurface === 'guide' && currentNodeId === id[\s\S]+?return Promise\.resolve\(true\)/);
});

test('standalone developer-guide entries carry exact-address reading snapshots', () => {
  const start = focusSource.indexOf('      function standaloneHistoryState(');
  const end = focusSource.indexOf('      function scheduleStandaloneReadingSave()', start);
  assert.ok(start >= 0 && end > start, 'standalone history helpers remain independently testable');
  const helpers = vm.runInNewContext(`(() => {\n${focusSource.slice(start, end)}\nreturn { standaloneHistoryState, storedStandaloneReading };\n})()`);
  const reading = { surface: 'graph', nodeId: 'controller', scrollTop: 91, focus: { id: 'btn-open-developer-guide' } };
  const state = helpers.standaloneHistoryState({ owner: 'kept' }, 'graph', 'https://example.test/map#focus=controller', 'controller', null, reading);
  assert.equal(state.owner, 'kept');
  assert.deepEqual(JSON.parse(JSON.stringify(state.archifyDeveloperGuide)), {
    surface: 'graph',
    href: 'https://example.test/map#focus=controller',
    nodeId: 'controller',
    graphHref: null,
    reading,
  });
  assert.deepEqual(
    helpers.storedStandaloneReading(state, 'https://example.test/map#focus=controller'),
    reading,
  );
  assert.equal(
    helpers.storedStandaloneReading(state, 'https://example.test/map#focus=other'),
    null,
    'a stale entry snapshot must never overwrite a different deep link',
  );
});

test('standalone developer-guide history commits only after preparation and restores traversed entries', () => {
  assert.match(focusSource,
    /return surfaceReady\.then\(function \(\) \{[\s\S]+?history\.replaceState\(graphEntry[\s\S]+?history\.pushState\(guideEntry/,
    'the prepared graph entry is snapshotted before the one guide push');
  assert.match(focusSource, /window\.addEventListener\('popstate', syncStandaloneHistoryWithoutUnhandledRejection\)/);
  assert.match(focusSource,
    /expectedRevision = \+\+standaloneSyncRevision[\s\S]+?expectedHref = location\.href[\s\S]+?storedStandaloneReading\(history\.state, expectedHref\)[\s\S]+?syncAddress\(\)[\s\S]+?expectedRevision !== standaloneSyncRevision \|\| location\.href !== expectedHref[\s\S]+?restore\(reading/,
    'a superseded history restore cannot reactivate the previous surface');
  assert.match(focusSource, /showSection[\s\S]+?replaceStandaloneReading\(url\)/);
  assert.match(focusSource, /history\.back\(\)[\s\S]+?return true/);
});

test('keyboard chapter activation transfers visible focus to the destination heading', () => {
  assert.match(focusSource, /event\.detail === 0[\s\S]+?node-guide-heading-[\s\S]+?focus\(\{ preventScroll: true \}\)/);
  assert.match(focusSource, /heading\.id = 'node-guide-heading-' \+ section\.kind[\s\S]+?heading\.tabIndex = -1/);
  assert.match(focusSource, /\.node-guide-section>h2:focus-visible/);
});

test('mobile developer guide controls keep a 44px hit target in both axes', () => {
  assert.match(
    focusSource,
    /\.node-guide-actions button,\.node-guide-open,\.node-guide-source,\.node-guide-toc a\{min-width:44px;min-height:44px\}/,
  );
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
