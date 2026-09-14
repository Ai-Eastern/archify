import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { checkAtlas, unpackAtlas, deliverAtlas } from '../renderers/shared/atlas-delivery.mjs';
import { compileDeveloperGuides } from '../renderers/shared/cli.mjs';
import { byteReceipt } from '../renderers/shared/atlas-manifest.mjs';
import { renderAtlasShell } from '../renderers/shared/atlas-shell.mjs';
import { decodeAtlasPayload, serializeAtlasPayload } from '../renderers/shared/atlas-envelope.mjs';
import { serializeChunkedScriptJson, serializeScriptJson } from '../renderers/shared/utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-atlas-delivery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'examples/atlas'), directory, { recursive: true });
  return { directory, input: path.join(directory, 'project.atlas.json'), output: path.join(directory, 'output.html') };
}
function deliver(f, extra = []) {
  const result = spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'atlas', f.input, f.output, '--json', ...extra], { encoding: 'utf8' });
  return { ...result, receipt: JSON.parse(result.stdout) };
}

function guideFixture(t) {
  const f = fixture(t);
  const repository = path.join(f.directory, 'repository'); fs.mkdirSync(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Archify Tests'); git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'https://github.com/example/atlas-guide');
  fs.writeFileSync(path.join(repository, 'controller.js'), 'export function handle() { return 1; }\n');
  git('add', '.'); git('commit', '-m', 'guide evidence');
  const filename = path.join(f.directory, 'system.architecture.json');
  const diagram = JSON.parse(fs.readFileSync(filename, 'utf8'));
  diagram.meta.repository = { url: 'https://github.com/example/atlas-guide', revision: git('rev-parse', 'HEAD'), link_mode: 'local-only' };
  const node = diagram.components.find(node => node.id === 'controller');
  node.sources = [{ id: 'entry', path: 'controller.js', line: 1, role: 'export' }];
  node.developer_guide = { implementation_scope: 'repository', summary: { text: 'guide-only-sentinel', source_refs: ['entry'] },
    sections: [{ kind: 'interfaces', items: [{ id: 'handle', title: 'handle', text: 'Returns one.', direction: 'provided', source_refs: ['entry'] }] }] };
  fs.writeFileSync(filename, JSON.stringify(diagram));
  const result = deliver(f, ['--repo-root', repository]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return { ...f, result, html: fs.readFileSync(f.output, 'utf8') };
}

const ATLAS_GUIDE_BYTES_LIMIT = 128 * 1024;

function aggregateGuide(nodeBytes = 3600) {
  let sequence = 0;
  const items = (kind, count) => Array.from({ length: count }, () => {
    sequence += 1;
    return {
      id: `item-${sequence}`,
      title: 'T',
      text: 'x',
      source_refs: ['entry'],
      ...(kind === 'interfaces' ? { direction: 'provided' } : {}),
    };
  });
  const authored = {
    implementation_scope: 'repository',
    summary: { text: 'x', source_refs: ['entry'] },
    sections: [
      { kind: 'flow', items: items('flow', 3) },
      { kind: 'interfaces', items: items('interfaces', 1) },
      { kind: 'state', items: items('state', 5) },
      { kind: 'constraints', items: items('constraints', 5) },
      { kind: 'change_points', items: items('change_points', 5) },
    ],
  };
  const compiled = guide => ({
    implementationScope: guide.implementation_scope,
    summary: { text: guide.summary.text, sourceRefs: [...guide.summary.source_refs] },
    sections: guide.sections.map(section => ({
      kind: section.kind,
      items: section.items.map(item => ({
        id: item.id,
        title: item.title,
        ...(item.direction ? { direction: item.direction } : {}),
        text: item.text,
        sourceRefs: [...item.source_refs],
      })),
    })),
  });
  let remaining = nodeBytes - Buffer.byteLength(serializeScriptJson(compiled(authored)));
  for (const slot of [authored.summary, ...authored.sections.flatMap(section => section.items)]) {
    const maximum = slot === authored.summary ? 240 : 280;
    const addition = Math.min(remaining, maximum - slot.text.length);
    slot.text += 'x'.repeat(addition);
    remaining -= addition;
  }
  assert.equal(remaining, 0, 'aggregate guide fixture must reach its requested node byte size');
  assert.equal(Buffer.byteLength(serializeScriptJson(compiled(authored))), nodeBytes);
  return authored;
}

function aggregateGuideFixture(t) {
  const f = fixture(t);
  const repository = path.join(f.directory, 'aggregate-repository');
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'https://github.com/example/atlas-aggregate-guide');
  fs.writeFileSync(path.join(repository, 'entry.js'), 'export function entry() { return true; }\n');
  git('add', '.');
  git('commit', '-m', 'aggregate guide evidence');
  const revision = git('rev-parse', 'HEAD');
  const referenceOccurrences = new Set(['payment/redis', 'orders/redis']);
  const diagrams = new Map();

  for (const id of ['system', 'payment', 'worker', 'orders']) {
    const filename = path.join(f.directory, `${id}.architecture.json`);
    const diagram = JSON.parse(fs.readFileSync(filename, 'utf8'));
    diagram.meta.repository = {
      url: 'https://github.com/example/atlas-aggregate-guide',
      revision,
      link_mode: 'local-only',
    };
    for (const component of diagram.components) {
      if (referenceOccurrences.has(`${id}/${component.id}`)) continue;
      component.sources = [{ id: 'entry', role: 'export', path: 'entry.js', line: 1 }];
      component.developer_guide = aggregateGuide();
    }
    fs.writeFileSync(filename, JSON.stringify(diagram));
    diagrams.set(id, diagram);
  }

  let priorBytes = 0;
  let contributor = null;
  for (const [diagramId, diagram] of diagrams) {
    const full = compileDeveloperGuides('architecture', diagram);
    if (priorBytes + full.receipt.bytes > ATLAS_GUIDE_BYTES_LIMIT) {
      for (const [componentIndex, component] of diagram.components.entries()) {
        if (!component.developer_guide) continue;
        const prefix = compileDeveloperGuides('architecture', {
          ...diagram,
          components: diagram.components.slice(0, componentIndex + 1),
        });
        if (priorBytes + prefix.receipt.bytes > ATLAS_GUIDE_BYTES_LIMIT) {
          contributor = { diagramId, componentIndex, componentId: component.id };
          break;
        }
      }
      break;
    }
    priorBytes += full.receipt.bytes;
  }
  assert.ok(contributor, 'aggregate fixture must cross the Atlas guide budget');
  return { ...f, repository, contributor };
}

const guidePattern = /(<script id="archify-developer-guide-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
function changeGuide(member, transform) {
  member.html = member.html.replace(guidePattern, (_, open, encoded, close) => open + transform(encoded) + close);
  member.receipts.artifact = byteReceipt(member.html);
}

test('Atlas rechecks the guide inventory and exact receipt from its sole inert member payload', t => {
  const f = guideFixture(t);
  const bundle = unpackAtlas(f.html);
  const member = bundle.members.system;
  const encoded = member.html.match(guidePattern)[2];
  const data = JSON.parse(JSON.parse(encoded).join(''));
  assert.deepEqual(member.guideNodes, { controller: ['interfaces'] });
  assert.deepEqual(member.receipts.developerGuide, { schemaVersion: 1, nodeCount: 1, itemCount: 1, ...byteReceipt(encoded) });
  assert.deepEqual(f.result.receipt.members.system.developerGuide, member.receipts.developerGuide);
  assert.equal(data.nodes.controller.summary.text, 'guide-only-sentinel');
  assert.ok(!JSON.stringify(f.result.receipt).includes('guide-only-sentinel'));
  assert.equal(bundle.members.worker.receipts.developerGuide, undefined);
  assert.equal(bundle.members.worker.guideNodes, undefined);
  assert.deepEqual(checkAtlas(f.html).artifact, byteReceipt(f.html));
  const extendedReceipt = structuredClone(bundle);
  extendedReceipt.members.system.receipts.generator = { schemaVersion: 2, status: 'pass' };
  assert.doesNotThrow(() => checkAtlas(renderAtlasShell(extendedReceipt)));
  for (const [code, mutate] of [
    ['bundle-guide-inventory', b => { b.members.system.guideNodes.controller = ['state']; }],
    ['bundle-guide-inventory', b => { delete b.members.system.guideNodes; delete b.members.system.receipts.developerGuide; }],
    ['bundle-guide-receipt', b => { b.members.system.receipts.developerGuide.bytes++; }],
    ['bundle-guide-receipt', b => { b.members.system.receipts.developerGuide.sha256 = '0'.repeat(64); }],
    ['bundle-guide-receipt', b => { b.members.system.receipts.developerGuide.itemCount++; }],
    ['bundle-guide-receipt', b => { changeGuide(b.members.system, value => value.replace('guide-only-sentinel', 'body-was-modified')); }],
    ['bundle-guide-data', b => { const m = b.members.system; m.html += m.html.match(guidePattern)[0]; m.receipts.artifact = byteReceipt(m.html); }],
    ['bundle-guide-data', b => { changeGuide(b.members.system, () => '[7]'); }],
    ['bundle-guide-data', b => { const m = b.members.system; m.html = m.html.replace(guidePattern, (_, open, encoded, close) => open.replace('application/json', 'text/plain') + encoded + close); m.receipts.artifact = byteReceipt(m.html); }],
    ['bundle-guide-data', b => { changeGuide(b.members.system, () => serializeChunkedScriptJson({ ...data, schemaVersion: 2 })); }],
    ['bundle-guide-data', b => { changeGuide(b.members.system, () => serializeChunkedScriptJson({ schemaVersion: 1, nodes: { controller: { ...data.nodes.controller, sections: [...data.nodes.controller.sections, ...data.nodes.controller.sections] } } })); }],
    ['bundle-guide-inventory', b => { const m = b.members.system; m.html = m.html.replace(guidePattern, ''); m.receipts.artifact = byteReceipt(m.html); }],
    ['bundle-data', b => { b.members.system.receipts.guideCopy = { summary: data.nodes.controller.summary }; }],
    ['bundle-data', b => { b.members.system.evidence.guideBody = { summary: data.nodes.controller.summary }; }],
    ['bundle-evidence', b => { b.members.system.evidence.referenceCount++; }],
    ['reference-guide', b => {
      const m = b.members.payment;
      const copied = serializeChunkedScriptJson({ schemaVersion: 1, nodes: { redis: data.nodes.controller } });
      m.html += `<script id="archify-developer-guide-data" type="application/json">${copied}</script>`;
      m.guideNodes = { redis: ['interfaces'] };
      m.receipts.developerGuide = { schemaVersion: 1, nodeCount: 1, itemCount: 1, ...byteReceipt(copied) };
      m.receipts.artifact = byteReceipt(m.html);
    }],
  ]) {
    const changed = structuredClone(bundle); mutate(changed);
    assert.throws(() => unpackAtlas(renderAtlasShell(changed)), error => {
      assert.equal(error.archifyDiagnostics?.[0]?.code, `atlas/${code}`); return true;
    });
  }
});

test('Atlas guide aggregate budget identifies the component that crosses 128 KiB', (t) => {
  const f = aggregateGuideFixture(t);
  const result = deliver(f, ['--repo-root', f.repository]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const diagnostic = result.receipt.diagnostics.find(entry => entry.code === 'developer-guide/atlas-budget');
  assert.ok(diagnostic, JSON.stringify(result.receipt.diagnostics, null, 2));
  assert.equal(diagnostic.subject.diagram, f.contributor.diagramId);
  assert.equal(diagnostic.subject.componentId, f.contributor.componentId);
  assert.equal(diagnostic.subject.path, `/components/${f.contributor.componentIndex}/developer_guide`);
  assert.ok(diagnostic.evidence.bytes > ATLAS_GUIDE_BYTES_LIMIT);
  assert.equal(diagnostic.evidence.limit, ATLAS_GUIDE_BYTES_LIMIT);
  assert.equal(fs.existsSync(f.output), false);
});

test('v2 delivery preserves canonical v1 checks and rejects actual packed corruption', t => {
  const f = fixture(t);
  assert.equal(deliver(f).status, 0);
  const html = fs.readFileSync(f.output, 'utf8');
  const pattern = /(<script id="archify-atlas-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
  const payload = decodeAtlasPayload(html.match(pattern)[2]).payload;
  assert.equal(payload.bundle_version, 2);
  const replace = (value, options) => html.replace(pattern, (_, a, b, c) => a + serializeAtlasPayload(value, options) + c);
  const canonical = unpackAtlas(html);
  assert.deepEqual(checkAtlas(replace(canonical, { compressed: false })).diagramIds, canonical.diagramIds);
  for (const [code, mutate] of [
    ['bundle-digest', p => { p.resources[0][0] += 'tampered'; }],
    ['bundle-data', p => { p.documents.system = [p.resources.length]; }],
    ['bundle-data', p => { p.bundle_version = 3; }],
  ]) {
    const bad = structuredClone(payload); mutate(bad);
    assert.throws(() => checkAtlas(replace(bad)), error => error.archifyDiagnostics?.[0]?.code === `atlas/${code}`);
  }
});

test('atlas accepts atlas as a diagram ID without colliding with staging files', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.input, JSON.stringify({ atlas_version: 1, entry: 'atlas',
    meta: { title: 'Atlas', locale: 'zh-CN' },
    diagrams: { atlas: { source: 'system.architecture.json' } } }));
  const result = deliver(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(checkAtlas(fs.readFileSync(f.output, 'utf8')).diagramIds, ['atlas']);
});

test('atlas checks chapter and parent summaries against the embedded member semantics', (t) => {
  const f = fixture(t);
  const source = path.join(f.directory, 'system.architecture.json');
  const diagram = JSON.parse(fs.readFileSync(source, 'utf8'));
  diagram.components.find((node) => node.id === 'controller').label = 'A<&"\'';
  diagram.connections.find((edge) => edge.to === 'controller' && !edge.id).label = '&amp; <';
  fs.writeFileSync(source, JSON.stringify(diagram));
  const result = deliver(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const bundle = unpackAtlas(fs.readFileSync(f.output, 'utf8'));
  const mutations = [
    ['bundle-view-inventory', (b) => { b.members.payment.views.push('invented'); }],
    ['bundle-view-inventory', (b) => { b.members.payment.views.pop(); }],
    ['bundle-view-inventory', (b) => { b.members.payment.views.push(b.members.payment.views[0]); }],
    ['bundle-parent-context', (b) => { b.members.payment.parentContext[0].id = 'api-sql'; }],
    ['bundle-parent-context', (b) => { b.members.payment.parentContext[0].label = 'invented'; }],
    ['bundle-parent-context', (b) => { b.members.payment.parentContext[0].fromLabel = 'invented'; }],
    ['bundle-parent-context', (b) => { const edge = b.members.payment.parentContext[0]; [edge.fromLabel, edge.toLabel] = [edge.toLabel, edge.fromLabel]; }],
    ['bundle-parent-context', (b) => { b.members.payment.parentContext.pop(); }],
    ['bundle-parent-context', (b) => { b.members.system.parentContext.push(b.members.payment.parentContext[0]); }],
  ];
  for (const [code, mutate] of mutations) {
    const changed = structuredClone(bundle);
    mutate(changed);
    assert.throws(() => checkAtlas(renderAtlasShell(changed)), (error) => {
      const diagnostic = error.archifyDiagnostics?.[0];
      assert.equal(diagnostic?.code, `atlas/${code}`);
      assert.ok(Object.keys(diagnostic.evidence).length);
      assert.ok(diagnostic.supportedFixes.length);
      return true;
    });
  }
});

test('deliver atlas compiles every member and rechecks the actual inert Unicode payload', (t) => {
  const f = fixture(t);
  const result = deliver(f, ['--quality', 'showcase']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = fs.readFileSync(f.output, 'utf8');
  const bundle = unpackAtlas(html);
  assert.equal(bundle.diagramIds.length, 4);
  assert.ok(bundle.members.worker.title.includes('</script>'));
  assert.ok(!html.includes(f.directory));
  assert.equal((html.match(/<script id="archify-atlas-data"/g) || []).length, 1);
  for (const id of bundle.diagramIds) {
    assert.deepEqual(byteReceipt(bundle.members[id].html), result.receipt.members[id].artifact);
    assert.ok(bundle.members[id].html.includes('archify-atlas-context'));
  }
  assert.match(bundle.members.payment.html, /data-atlas-reference-diagram="system" data-atlas-reference-node="redis"/);
  assert.match(bundle.members.payment.html, /data-atlas-context-mark/);
  assert.match(bundle.members.system.html, /data-atlas-detail-diagram="payment"/);
  assert.match(bundle.members.system.html, /data-atlas-detail-mark/);
  assert.ok(!html.includes('<header>'), 'Atlas navigation belongs to the themed member, not a second outer toolbar');
  assert.deepEqual(checkAtlas(html).artifact, result.receipt.artifact);
  assert.throws(() => unpackAtlas('<html></html>'), (error) => {
    assert.deepEqual(error.archifyDiagnostics[0].evidence, { expected: 1, actual: 0 });
    assert.ok(error.archifyDiagnostics[0].supportedFixes[0].includes('deliver atlas'));
    return true;
  });
  assert.throws(() => unpackAtlas('<script id="archify-atlas-data" type="application/json">{</script>'), (error) => {
    assert.ok(error.archifyDiagnostics[0].evidence.parseError);
    return true;
  });
  const badBytes = structuredClone(bundle);
  badBytes.members.worker.html += 'tampered';
  assert.throws(() => checkAtlas(renderAtlasShell(badBytes)), (error) => {
    assert.equal(error.archifyDiagnostics[0].code, 'atlas/bundle-digest');
    assert.deepEqual(error.archifyDiagnostics[0].evidence.actual, byteReceipt(badBytes.members.worker.html));
    assert.deepEqual(error.archifyDiagnostics[0].evidence.expected, bundle.members.worker.receipts.artifact);
    return true;
  });
  const missing = structuredClone(bundle);
  delete missing.members.worker;
  assert.throws(() => checkAtlas(renderAtlasShell(missing)), /inventory/);
  const invalid = structuredClone(bundle);
  invalid.members.worker.html = '<html><body>no SVG</body></html>';
  invalid.members.worker.receipts.artifact = byteReceipt(invalid.members.worker.html);
  assert.throws(() => checkAtlas(renderAtlasShell(invalid)), /node inventory differs/);
  const badReceipt = structuredClone(bundle);
  badReceipt.members.worker.check.composition.status = 'invented';
  assert.throws(() => checkAtlas(renderAtlasShell(badReceipt)), /checker receipt differs/);
  const badTree = structuredClone(bundle);
  badTree.details[1].to = 'missing';
  assert.throws(() => checkAtlas(renderAtlasShell(badTree)), /context does not match atlas relations/);
});

test('failed atlas delivery preserves inputs and existing output and cleans staging', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.output, 'trusted output');
  const input = JSON.parse(fs.readFileSync(f.input, 'utf8'));
  input.references[0].target.node = 'missing';
  fs.writeFileSync(f.input, JSON.stringify(input));
  const before = new Map(fs.readdirSync(f.directory).map((name) => [name, fs.readFileSync(path.join(f.directory, name))]));
  const result = deliver(f);
  assert.notEqual(result.status, 0);
  assert.equal(result.receipt.diagnostics[0].code, 'atlas/unknown-node');
  for (const [name, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(f.directory, name)), bytes);
  assert.deepEqual(fs.readdirSync(f.directory).sort(), [...before.keys()].sort());
});

for (const alias of ['same', 'symlink', 'hardlink']) test(`atlas protects source ${alias} aliases`, (t) => {
  const f = fixture(t);
  const source = path.join(f.directory, 'worker.architecture.json');
  const bytes = fs.readFileSync(source);
  if (alias === 'same') f.output = source;
  if (alias === 'symlink') fs.symlinkSync(source, f.output);
  if (alias === 'hardlink') fs.linkSync(source, f.output);
  const result = deliver(f);
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(source), bytes);
});

for (const extra of [['--bogus'], ['unexpected-positional'], ['--quality', 'invalid']]) test(`atlas CLI rejects ${extra.join(' ')}`, (t) => {
  const f = fixture(t);
  const result = deliver(f, extra);
  assert.equal(result.status, 2);
  assert.equal(result.receipt.stage, 'arguments');
  assert.ok(!fs.existsSync(f.output));
});

test('atlas default output belongs beside its manifest, independent of member output hints', (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'atlas', f.input, '--json'], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).output, path.join(f.directory, 'project.atlas.html'));
});

test('atlas delivery uses frozen member bytes after their source files change', async (t) => {
  const f = fixture(t);
  const worker = path.join(f.directory, 'worker.architecture.json');
  const original = fs.readFileSync(worker);
  const read = fs.readFileSync;
  let changed = false;
  fs.readFileSync = function (filename, ...args) {
    const bytes = read.call(fs, filename, ...args);
    if (filename === path.join(f.directory, 'orders.architecture.json') && !changed) {
      changed = true;
      fs.writeFileSync(worker, '{"changed":"after freeze"}');
    }
    return bytes;
  };
  try {
    const receipt = await deliverAtlas({ input: f.input, requestedOutput: f.output });
    assert.ok(changed);
    assert.deepEqual(receipt.members.worker.source, byteReceipt(original));
    assert.match(unpackAtlas(read(f.output, 'utf8')).members.worker.html, /执行器/);
    assert.equal(read(worker, 'utf8'), '{"changed":"after freeze"}');
  } finally { fs.readFileSync = read; }
});

test('atlas rechecks output aliases immediately before committing its verified bundle', async (t) => {
  const f = fixture(t);
  const worker = path.join(f.directory, 'worker.architecture.json');
  const original = fs.readFileSync(worker);
  const write = fs.writeFileSync;
  let swapped = false;
  fs.writeFileSync = function (filename, ...args) {
    const result = write.call(fs, filename, ...args);
    if (!swapped && String(filename).includes('archify-atlas-check-') && path.basename(filename) === 'orders.html') {
      swapped = true;
      fs.symlinkSync(worker, f.output);
    }
    return result;
  };
  try {
    await assert.rejects(deliverAtlas({ input: f.input, requestedOutput: f.output }), (error) => error.atlasStage === 'commit' && error.archifyDiagnostics?.some((item) => item.code.startsWith('output/')));
    assert.ok(swapped);
    assert.deepEqual(fs.readFileSync(worker), original);
    assert.ok(!fs.readdirSync(f.directory).some((name) => name.startsWith('.archify-atlas-')));
  } finally { fs.writeFileSync = write; }
});

test('atlas preserves independently verified member revisions with one repository root', (t) => {
  const f = fixture(t);
  const repository = path.join(f.directory, 'repository');
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'https://github.com/example/atlas-evidence');
  fs.writeFileSync(path.join(repository, 'controller.js'), 'export const version = 1;\n');
  git('add', '.'); git('commit', '-m', 'first');
  const first = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repository, 'controller.js'), 'export const version = 2;\n');
  git('add', '.'); git('commit', '-m', 'second');
  const second = git('rev-parse', 'HEAD');
  for (const [id, revision] of [['system', first], ['payment', second]]) {
    const filename = path.join(f.directory, `${id}.architecture.json`);
    const diagram = JSON.parse(fs.readFileSync(filename, 'utf8'));
    diagram.meta.repository = { url: 'https://github.com/example/atlas-evidence', revision, link_mode: 'local-only' };
    diagram.components.find((node) => node.id === 'controller').sources = [{ path: 'controller.js', line: 1 }];
    fs.writeFileSync(filename, JSON.stringify(diagram));
  }
  const result = deliver(f, ['--repo-root', repository]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.receipt.members.system.evidence.repository.revision, first);
  assert.equal(result.receipt.members.payment.evidence.repository.revision, second);
  assert.equal(result.receipt.members.worker.evidence, undefined);
  const bundle = unpackAtlas(fs.readFileSync(f.output, 'utf8'));
  assert.equal(bundle.members.system.evidence.repository.revision, first);
  assert.equal(bundle.members.payment.evidence.repository.revision, second);
  assert.ok(!bundle.members.system.html.includes(repository));
  const failed = deliver(f);
  assert.notEqual(failed.status, 0);
  assert.equal(failed.receipt.diagnostics[0].subject.diagram, 'system');
});
