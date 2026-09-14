import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileDeveloperGuides } from '../renderers/shared/cli.mjs';
import { serializeChunkedScriptJson } from '../renderers/shared/utils.mjs';
import { validateSchema } from '../renderers/shared/validator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const NODE_BYTES_LIMIT = 4 * 1024;
const MEMBER_BYTES_LIMIT = 64 * 1024;

function source(id = 'source', role = 'registration') {
  return { id, role, path: 'src/module.js' };
}

function interfaceItem(overrides = {}) {
  return {
    id: 'public-interface',
    title: 'run',
    code: 'run(input)',
    direction: 'provided',
    text: 'Accepts one request and returns its result.',
    source_refs: ['source'],
    ...overrides,
  };
}

function guide(overrides = {}) {
  return {
    implementation_scope: 'repository',
    summary: {
      text: 'Owns the bounded request lifecycle.',
      source_refs: ['source'],
    },
    sections: [{ kind: 'interfaces', items: [interfaceItem()] }],
    ...overrides,
  };
}

function component(id = 'agentLoop', overrides = {}) {
  return {
    id,
    type: 'backend',
    label: 'Agent Loop',
    sources: [source()],
    developer_guide: guide(),
    ...overrides,
  };
}

function diagram(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Developer guide contract',
      repository: {
        url: 'https://github.com/example/developer-guide-fixture',
        revision: 'a'.repeat(40),
      },
    },
    components: [component()],
    ...overrides,
  };
}

function diagnosticsFrom(callback) {
  try {
    callback();
  } catch (error) {
    assert.ok(Array.isArray(error.archifyDiagnostics), error.stack || error.message);
    return error.archifyDiagnostics;
  }
  assert.fail('expected the operation to fail with Archify diagnostics');
}

function expectGuideFailure(document, code, pathValue) {
  const diagnostics = diagnosticsFrom(() => compileDeveloperGuides('architecture', document));
  const diagnostic = diagnostics.find((entry) => entry.code === `developer-guide/${code}`);
  assert.ok(diagnostic, `missing developer-guide/${code}: ${JSON.stringify(diagnostics, null, 2)}`);
  if (pathValue) assert.equal(diagnostic.subject.path, pathValue);
  assert.equal(diagnostic.subject.diagramType, 'architecture');
  assert.ok(diagnostic.subject.componentId);
  assert.ok(diagnostic.supportedFixes.length > 0);
  return diagnostic;
}

function expectSchemaFailure(document, expected) {
  const diagnostics = diagnosticsFrom(() => validateSchema('architecture', document));
  const diagnostic = diagnostics.find((entry) => (
    entry.code === `schema/${expected.keyword}`
      && entry.subject.path === expected.path
      && (expected.property === undefined || entry.evidence.additionalProperty === expected.property)
      && (expected.missing === undefined || entry.evidence.missingProperty === expected.missing)
  ));
  assert.ok(diagnostic, `missing schema failure ${JSON.stringify(expected)}: ${JSON.stringify(diagnostics, null, 2)}`);
  return diagnostic;
}

function compiledShape(authored) {
  return {
    implementationScope: authored.implementation_scope,
    summary: {
      text: authored.summary.text,
      sourceRefs: [...authored.summary.source_refs],
    },
    sections: authored.sections.map((section) => ({
      kind: section.kind,
      items: section.items.map((item) => ({
        id: item.id,
        title: item.title,
        ...(item.code !== undefined ? { code: item.code } : {}),
        ...(item.direction !== undefined ? { direction: item.direction } : {}),
        text: item.text,
        sourceRefs: [...item.source_refs],
      })),
    })),
  };
}

function safeJsonBytes(value) {
  const json = JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
  return Buffer.byteLength(json);
}

function sizeableGuide() {
  let sequence = 0;
  const items = (kind, count) => Array.from({ length: count }, () => {
    sequence += 1;
    const item = {
      id: `item-${sequence}`,
      title: 'T',
      text: 'x',
      source_refs: ['source'],
    };
    if (kind === 'interfaces') item.direction = 'provided';
    return item;
  });
  return {
    implementation_scope: 'repository',
    summary: { text: 'x', source_refs: ['source'] },
    sections: [
      { kind: 'flow', items: items('flow', 3) },
      { kind: 'interfaces', items: items('interfaces', 1) },
      { kind: 'state', items: items('state', 5) },
      { kind: 'constraints', items: items('constraints', 5) },
      { kind: 'change_points', items: items('change_points', 5) },
    ],
  };
}

function textSlots(authored) {
  return [authored.summary, ...authored.sections.flatMap((section) => section.items)];
}

function guideAtNodeBytes(target) {
  const authored = sizeableGuide();
  let remaining = target - safeJsonBytes(compiledShape(authored));
  assert.ok(remaining >= 0, `sizeable guide starts above ${target} bytes`);
  for (const slot of textSlots(authored)) {
    const maximum = slot === authored.summary ? 240 : 280;
    const addition = Math.min(remaining, maximum - slot.text.length);
    slot.text += 'x'.repeat(addition);
    remaining -= addition;
  }
  assert.equal(remaining, 0, `sizeable guide lacks capacity to reach ${target} bytes`);
  assert.equal(safeJsonBytes(compiledShape(authored)), target);
  return authored;
}

function expectedMemberData(document) {
  return {
    schemaVersion: 1,
    nodes: Object.fromEntries(document.components
      .filter((entry) => entry.developer_guide)
      .map((entry) => [entry.id, compiledShape(entry.developer_guide)])),
  };
}

function expectedMemberBytes(document) {
  return Buffer.byteLength(serializeChunkedScriptJson(expectedMemberData(document)));
}

function memberComponent(index, nodeBytes = 3000) {
  return component(`node-${index}`, {
    label: `Node ${index}`,
    developer_guide: guideAtNodeBytes(nodeBytes),
  });
}

function nearMemberBoundary() {
  const document = diagram({ components: [] });
  let index = 0;
  while (true) {
    const candidate = structuredClone(document);
    candidate.components.push(memberComponent(index, 3000));
    if (expectedMemberBytes(candidate) > MEMBER_BYTES_LIMIT) break;
    document.components = candidate.components;
    index += 1;
    assert.ok(index < 100, 'member boundary fixture failed to converge');
  }

  for (let componentIndex = 0; componentIndex < document.components.length; componentIndex += 1) {
    let low = safeJsonBytes(compiledShape(document.components[componentIndex].developer_guide));
    let high = NODE_BYTES_LIMIT;
    let accepted = low;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = structuredClone(document);
      candidate.components[componentIndex].developer_guide = guideAtNodeBytes(middle);
      if (expectedMemberBytes(candidate) <= MEMBER_BYTES_LIMIT) {
        accepted = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    document.components[componentIndex].developer_guide = guideAtNodeBytes(accepted);
  }

  const acceptedBytes = expectedMemberBytes(document);
  assert.ok(acceptedBytes <= MEMBER_BYTES_LIMIT);
  assert.ok(MEMBER_BYTES_LIMIT - acceptedBytes < 32, `fixture stopped ${MEMBER_BYTES_LIMIT - acceptedBytes} bytes below the member limit`);

  let rejected = null;
  outer: for (let componentIndex = 0; componentIndex < document.components.length; componentIndex += 1) {
    const current = safeJsonBytes(compiledShape(document.components[componentIndex].developer_guide));
    for (let nodeBytes = current + 1; nodeBytes <= NODE_BYTES_LIMIT; nodeBytes += 1) {
      const candidate = structuredClone(document);
      candidate.components[componentIndex].developer_guide = guideAtNodeBytes(nodeBytes);
      if (expectedMemberBytes(candidate) > MEMBER_BYTES_LIMIT) {
        rejected = candidate;
        break outer;
      }
    }
  }
  if (!rejected) {
    rejected = structuredClone(document);
    rejected.components.push(memberComponent(index, 3000));
  }
  assert.ok(expectedMemberBytes(rejected) > MEMBER_BYTES_LIMIT);
  return { accepted: document, rejected, acceptedBytes, rejectedBytes: expectedMemberBytes(rejected) };
}

function temporaryDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
}

function repositoryFixture(t) {
  const root = temporaryDirectory(t, 'archify-developer-guide-');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'module.js'), [
    'export function provided(input) {',
    '  return dependency(input);',
    '}',
    'export function register(name) {',
    '  return { name };',
    '}',
    '',
  ].join('\n'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'remote', 'add', 'origin', 'https://github.com/example/developer-guide-fixture.git');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'fixture');
  const revision = git(root, 'rev-parse', 'HEAD');
  const document = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'web-app.architecture.json'), 'utf8'));
  delete document.meta.output;
  document.meta.repository = {
    url: 'https://github.com/example/developer-guide-fixture',
    revision,
  };
  document.components[0].sources = [
    { id: 'exported', role: 'export', path: 'src/module.js', line: 1, symbol: 'provided' },
    { id: 'called', role: 'callsite', path: 'src/module.js', line: 2, symbol: 'dependency' },
    { id: 'registered', role: 'registration', path: 'src/module.js', line: 4, symbol: 'register' },
  ];
  document.components[0].developer_guide = guide({
    summary: { text: 'Owns the request lifecycle.', source_refs: ['registered'] },
    sections: [{
      kind: 'interfaces',
      items: [interfaceItem({ source_refs: ['exported'] })],
    }],
  });
  return { root, revision, document };
}

function writeJson(directory, name, document) {
  const filename = path.join(directory, name);
  fs.writeFileSync(filename, JSON.stringify(document, null, 2));
  return filename;
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function guidePayloadFromHtml(html) {
  const matches = [...html.matchAll(/<script id="archify-developer-guide-data" type="application\/json">([\s\S]*?)<\/script>/g)];
  assert.equal(matches.length, 1, 'expected exactly one developer guide payload');
  const chunks = JSON.parse(matches[0][1]);
  assert.ok(Array.isArray(chunks) && chunks.every((chunk) => typeof chunk === 'string'));
  return { body: matches[0][1], data: JSON.parse(chunks.join('')) };
}

function receiptForGuidePayload(payload) {
  const guides = Object.values(payload.data.nodes);
  return {
    schemaVersion: 1,
    nodeCount: guides.length,
    itemCount: guides.reduce((count, entry) => count + entry.sections.reduce(
      (subtotal, section) => subtotal + section.items.length,
      0,
    ), 0),
    bytes: Buffer.byteLength(payload.body),
    sha256: createHash('sha256').update(payload.body).digest('hex'),
  };
}

function svgFromHtml(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('developer guide schema accepts the fixed authored shape and rejects unbounded or presentation fields', async (t) => {
  const legal = diagram();
  assert.doesNotThrow(() => validateSchema('architecture', legal));
  const maximal = diagram();
  let itemSequence = 0;
  const boundedItems = (kind, count) => Array.from({ length: count }, () => {
    itemSequence += 1;
    return {
      id: `bounded-${itemSequence}`,
      title: 'T'.repeat(80),
      ...(kind === 'interfaces' ? { code: 'c'.repeat(200), direction: 'provided' } : {}),
      text: 'x'.repeat(280),
      source_refs: ['source'],
    };
  });
  maximal.components[0].developer_guide.summary.text = 's'.repeat(240);
  maximal.components[0].developer_guide.sections = [
    { kind: 'flow', items: boundedItems('flow', 7) },
    { kind: 'interfaces', items: boundedItems('interfaces', 6) },
    { kind: 'state', items: boundedItems('state', 5) },
    { kind: 'constraints', items: boundedItems('constraints', 5) },
    { kind: 'change_points', items: boundedItems('change_points', 5) },
  ];
  assert.doesNotThrow(() => validateSchema('architecture', maximal));

  const cases = [
    {
      name: 'missing summary',
      expected: { keyword: 'required', path: '/components/0/developer_guide', missing: 'summary' },
      mutate(document) { delete document.components[0].developer_guide.summary; },
    },
    {
      name: 'unknown implementation scope',
      expected: { keyword: 'enum', path: '/components/0/developer_guide/implementation_scope' },
      mutate(document) { document.components[0].developer_guide.implementation_scope = 'workspace'; },
    },
    {
      name: 'presentation placement',
      expected: { keyword: 'additionalProperties', path: '/components/0/developer_guide', property: 'placement' },
      mutate(document) { document.components[0].developer_guide.placement = 'details-tab'; },
    },
    {
      name: 'overlong summary',
      expected: { keyword: 'maxLength', path: '/components/0/developer_guide/summary/text' },
      mutate(document) { document.components[0].developer_guide.summary.text = 'x'.repeat(241); },
    },
    {
      name: 'empty sections',
      expected: { keyword: 'minItems', path: '/components/0/developer_guide/sections' },
      mutate(document) { document.components[0].developer_guide.sections = []; },
    },
    {
      name: 'too many sections',
      expected: { keyword: 'maxItems', path: '/components/0/developer_guide/sections' },
      mutate(document) {
        document.components[0].developer_guide.sections = Array.from({ length: 6 }, (_, index) => ({
          kind: 'state',
          items: [{ id: `state-${index}`, title: 'State', text: 'State.', source_refs: ['source'] }],
        }));
      },
    },
    {
      name: 'unknown section kind',
      expected: { keyword: 'const', path: '/components/0/developer_guide/sections/0/kind' },
      mutate(document) { document.components[0].developer_guide.sections[0].kind = 'internals'; },
    },
    {
      name: 'missing interface direction',
      expected: { keyword: 'required', path: '/components/0/developer_guide/sections/0/items/0', missing: 'direction' },
      mutate(document) { delete document.components[0].developer_guide.sections[0].items[0].direction; },
    },
    {
      name: 'too-short flow',
      expected: { keyword: 'minItems', path: '/components/0/developer_guide/sections/0/items' },
      mutate(document) {
        document.components[0].developer_guide.sections = [{
          kind: 'flow',
          items: [
            { id: 'first', title: 'First', text: 'First step.', source_refs: ['source'] },
            { id: 'second', title: 'Second', text: 'Second step.', source_refs: ['source'] },
          ],
        }];
      },
    },
    {
      name: 'too-long flow',
      expected: { keyword: 'maxItems', path: '/components/0/developer_guide/sections/0/items' },
      mutate(document) {
        document.components[0].developer_guide.sections = [{
          kind: 'flow',
          items: Array.from({ length: 8 }, (_, index) => ({
            id: `flow-${index}`, title: 'Step', text: 'Step.', source_refs: ['source'],
          })),
        }];
      },
    },
    {
      name: 'empty interfaces',
      expected: { keyword: 'minItems', path: '/components/0/developer_guide/sections/0/items' },
      mutate(document) { document.components[0].developer_guide.sections[0].items = []; },
    },
    {
      name: 'too many interfaces',
      expected: { keyword: 'maxItems', path: '/components/0/developer_guide/sections/0/items' },
      mutate(document) {
        document.components[0].developer_guide.sections[0].items = Array.from({ length: 7 }, (_, index) => (
          interfaceItem({ id: `interface-${index}` })
        ));
      },
    },
    {
      name: 'interface-only field in state',
      expected: { keyword: 'additionalProperties', path: '/components/0/developer_guide/sections/0/items/0', property: 'direction' },
      mutate(document) {
        document.components[0].developer_guide.sections = [{
          kind: 'state',
          items: [{ id: 'state', title: 'State', direction: 'observed', text: 'Held for one run.', source_refs: ['source'] }],
        }];
      },
    },
    {
      name: 'interface code in state',
      expected: { keyword: 'additionalProperties', path: '/components/0/developer_guide/sections/0/items/0', property: 'code' },
      mutate(document) {
        document.components[0].developer_guide.sections = [{
          kind: 'state',
          items: [{ id: 'state', title: 'State', code: 'state()', text: 'Held for one run.', source_refs: ['source'] }],
        }];
      },
    },
    {
      name: 'overlong item title',
      expected: { keyword: 'maxLength', path: '/components/0/developer_guide/sections/0/items/0/title' },
      mutate(document) { document.components[0].developer_guide.sections[0].items[0].title = 't'.repeat(81); },
    },
    {
      name: 'overlong item text',
      expected: { keyword: 'maxLength', path: '/components/0/developer_guide/sections/0/items/0/text' },
      mutate(document) { document.components[0].developer_guide.sections[0].items[0].text = 't'.repeat(281); },
    },
    {
      name: 'overlong interface code',
      expected: { keyword: 'maxLength', path: '/components/0/developer_guide/sections/0/items/0/code' },
      mutate(document) { document.components[0].developer_guide.sections[0].items[0].code = 'c'.repeat(201); },
    },
    {
      name: 'empty source refs',
      expected: { keyword: 'minItems', path: '/components/0/developer_guide/summary/source_refs' },
      mutate(document) { document.components[0].developer_guide.summary.source_refs = []; },
    },
    {
      name: 'too many source refs',
      expected: { keyword: 'maxItems', path: '/components/0/developer_guide/summary/source_refs' },
      mutate(document) { document.components[0].developer_guide.summary.source_refs = ['source', 'second', 'third', 'fourth']; },
    },
    {
      name: 'overlong source symbol',
      expected: { keyword: 'maxLength', path: '/components/0/sources/0/symbol' },
      mutate(document) { document.components[0].sources[0].symbol = 's'.repeat(201); },
    },
    {
      name: 'source symbol with only whitespace',
      expected: { keyword: 'pattern', path: '/components/0/sources/0/symbol' },
      mutate(document) { document.components[0].sources[0].symbol = ' '; },
    },
    {
      name: 'unknown source role',
      expected: { keyword: 'enum', path: '/components/0/sources/0/role' },
      mutate(document) { document.components[0].sources[0].role = 'implementation'; },
    },
  ];

  for (const kind of ['state', 'constraints', 'change_points']) {
    cases.push({
      name: `too many ${kind} items`,
      expected: { keyword: 'maxItems', path: '/components/0/developer_guide/sections/0/items' },
      mutate(document) {
        document.components[0].developer_guide.sections = [{
          kind,
          items: Array.from({ length: 6 }, (_, index) => ({
            id: `${kind}-${index}`, title: 'Item', text: 'Fact.', source_refs: ['source'],
          })),
        }];
      },
    });
  }

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const invalid = structuredClone(legal);
      entry.mutate(invalid);
      expectSchemaFailure(invalid, entry.expected);
    });
  }
});

test('actual architecture validate uses the generated developer guide schema', (t) => {
  const directory = temporaryDirectory(t, 'archify-developer-guide-schema-cli-');
  const invalid = diagram();
  invalid.components[0].developer_guide.placement = 'details';
  const input = writeJson(directory, 'invalid.architecture.json', invalid);
  const result = runCli(['validate', 'architecture', input, '--json']);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'render');
  const diagnostic = receipt.diagnostics.find((entry) => (
    entry.code === 'schema/additionalProperties'
      && entry.subject.path === '/components/0/developer_guide'
      && entry.evidence.additionalProperty === 'placement'
  ));
  assert.ok(diagnostic, JSON.stringify(receipt, null, 2));
});

test('compileDeveloperGuides produces one deterministic, indexed presentation payload', () => {
  const document = diagram();
  validateSchema('architecture', document);
  const authoredSnapshot = structuredClone(document);
  const first = compileDeveloperGuides('architecture', document);
  const second = compileDeveloperGuides('architecture', structuredClone(document));
  assert.deepEqual(document, authoredSnapshot, 'compilation must not rewrite authored IR');
  assert.equal(first.encoded, second.encoded);
  assert.deepEqual(first.receipt, second.receipt);
  assert.equal(first.receipt.nodeCount, 1);
  assert.equal(first.receipt.itemCount, 1);
  assert.equal(first.receipt.bytes, Buffer.byteLength(first.encoded));
  assert.match(first.receipt.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(JSON.parse(first.encoded).join('')), {
    schemaVersion: 1,
    nodes: { agentLoop: compiledShape(document.components[0].developer_guide) },
  });
  assert.deepEqual(first.data.nodes.agentLoop, compiledShape(document.components[0].developer_guide));
  assert.doesNotMatch(first.encoded, /src\/module\.js|developer-guide-fixture|"role"|"revision"/);
});

test('compiler rejects duplicate identities and source references at exact authored paths', async (t) => {
  const cases = [
    {
      name: 'component id with guide',
      code: 'duplicate-component-id',
      path: '/components/1/id',
      mutate(document) { document.components.push(component('agentLoop', { label: 'Duplicate agent loop' })); },
    },
    {
      name: 'source id',
      code: 'duplicate-source-id',
      path: '/components/0/sources/1/id',
      mutate(document) { document.components[0].sources.push(source()); },
    },
    {
      name: 'item id across sections',
      code: 'duplicate-item-id',
      path: '/components/0/developer_guide/sections/1/items/0/id',
      mutate(document) {
        document.components[0].developer_guide.sections.push({
          kind: 'state',
          items: [{ id: 'public-interface', title: 'State', text: 'State ownership.', source_refs: ['source'] }],
        });
      },
    },
    {
      name: 'section kind',
      code: 'duplicate-section',
      path: '/components/0/developer_guide/sections/1/kind',
      mutate(document) {
        document.components[0].developer_guide.sections.push({
          kind: 'interfaces',
          items: [interfaceItem({ id: 'second-interface' })],
        });
      },
    },
    {
      name: 'source ref',
      code: 'duplicate-source-ref',
      path: '/components/0/developer_guide/summary/source_refs/1',
      mutate(document) { document.components[0].developer_guide.summary.source_refs.push('source'); },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const invalid = diagram();
      entry.mutate(invalid);
      validateSchema('architecture', invalid);
      expectGuideFailure(invalid, entry.code, entry.path);
    });
  }
});

test('source ids stay unique without a guide while legacy sources still compile to no payload', () => {
  const legacy = diagram();
  delete legacy.meta.repository;
  delete legacy.components[0].developer_guide;
  legacy.components[0].sources = [{ path: 'src/module.js' }, { path: 'src/module.js' }];
  validateSchema('architecture', legacy);
  assert.equal(compileDeveloperGuides('architecture', legacy), null);

  const duplicate = structuredClone(legacy);
  duplicate.components[0].sources = [source('stable'), source('stable', 'callsite')];
  validateSchema('architecture', duplicate);
  expectGuideFailure(duplicate, 'duplicate-source-id', '/components/0/sources/1/id');
});

test('source and item identity namespaces are local to each component', () => {
  const document = diagram();
  document.components.push(component('secondNode', { label: 'Second node' }));
  validateSchema('architecture', document);
  const compiled = compileDeveloperGuides('architecture', document);
  assert.deepEqual(Object.keys(compiled.data.nodes), ['agentLoop', 'secondNode']);
  assert.equal(compiled.receipt.nodeCount, 2);
  assert.equal(compiled.receipt.itemCount, 2);
  assert.equal(compiled.data.nodes.agentLoop.sections[0].items[0].id, 'public-interface');
  assert.equal(compiled.data.nodes.secondNode.sections[0].items[0].id, 'public-interface');
});

test('compiler requires repository metadata only when authored guide content is present', () => {
  const document = diagram();
  delete document.meta.repository;
  const diagnostic = expectGuideFailure(document, 'repository-required', '/meta/repository');
  assert.equal(diagnostic.subject.componentId, 'agentLoop');

  delete document.components[0].developer_guide;
  assert.equal(compileDeveloperGuides('architecture', document), null);
});

test('compiler distinguishes unknown and cross-node source refs and requires roles only for referenced sources', () => {
  const unknown = diagram();
  unknown.components[0].developer_guide.summary.source_refs = ['missing'];
  let diagnostic = expectGuideFailure(unknown, 'unknown-source-ref', '/components/0/developer_guide/summary/source_refs/0');
  assert.deepEqual(diagnostic.evidence.available, ['source']);

  const crossNode = diagram();
  crossNode.components.push(component('storage', {
    label: 'Storage',
    sources: [source('storage-source', 'definition')],
    developer_guide: undefined,
  }));
  crossNode.components[0].developer_guide.summary.source_refs = ['storage-source'];
  diagnostic = expectGuideFailure(crossNode, 'cross-node-source-ref', '/components/0/developer_guide/summary/source_refs/0');
  assert.deepEqual(diagnostic.evidence.otherOwners, ['storage']);

  const missingRole = diagram();
  delete missingRole.components[0].sources[0].role;
  diagnostic = expectGuideFailure(missingRole, 'source-role-required', '/components/0/sources/0/role');
  assert.equal(diagnostic.evidence.sourceId, 'source');

  const unusedWithoutRole = diagram();
  unusedWithoutRole.components[0].sources.push({ id: 'unused', path: 'src/unused.js' });
  validateSchema('architecture', unusedWithoutRole);
  assert.doesNotThrow(() => compileDeveloperGuides('architecture', unusedWithoutRole));
});

test('interface direction accepts matching roles including order-independent bidirectional evidence', () => {
  const document = diagram();
  document.components[0].sources = [
    source('registration-a', 'registration'),
    source('export-b', 'export'),
    source('registration-c', 'registration'),
  ];
  document.components[0].developer_guide.summary.source_refs = ['registration-a'];
  document.components[0].developer_guide.sections[0].items = [
    interfaceItem({ id: 'provided-interface', direction: 'provided', source_refs: ['export-b'] }),
    interfaceItem({ id: 'required-interface', direction: 'required', source_refs: ['registration-c'] }),
    interfaceItem({ id: 'observed-interface', direction: 'observed', source_refs: ['registration-a'] }),
    interfaceItem({
      id: 'bidirectional-interface',
      direction: 'bidirectional',
      source_refs: ['registration-a', 'export-b'],
    }),
    interfaceItem({
      id: 'bidirectional-reversed',
      direction: 'bidirectional',
      source_refs: ['export-b', 'registration-a'],
    }),
    interfaceItem({
      id: 'bidirectional-registrations',
      direction: 'bidirectional',
      source_refs: ['registration-a', 'registration-c'],
    }),
  ];
  validateSchema('architecture', document);
  const compiled = compileDeveloperGuides('architecture', document);
  assert.deepEqual(
    compiled.data.nodes.agentLoop.sections[0].items.map((item) => item.direction),
    ['provided', 'required', 'observed', 'bidirectional', 'bidirectional', 'bidirectional'],
  );
  assert.deepEqual(
    compiled.data.nodes.agentLoop.sections[0].items[3].sourceRefs,
    ['registration-a', 'export-b'],
    'compiler must preserve authored ref order after checking all distinct role pairs',
  );
  assert.deepEqual(
    compiled.data.nodes.agentLoop.sections[0].items[4].sourceRefs,
    ['export-b', 'registration-a'],
  );
  assert.deepEqual(
    compiled.data.nodes.agentLoop.sections[0].items[5].sourceRefs,
    ['registration-a', 'registration-c'],
  );
});

test('interface direction rejects unsupported or single-source evidence', async (t) => {
  const cases = [
    ['provided from a callsite', 'provided', ['called']],
    ['required from an export', 'required', ['exported']],
    ['observed from an export', 'observed', ['exported']],
    ['bidirectional from one registration', 'bidirectional', ['registered']],
  ];
  for (const [name, direction, refs] of cases) {
    await t.test(name, () => {
      const document = diagram();
      document.components[0].sources = [
        source('exported', 'export'),
        source('called', 'callsite'),
        source('registered', 'registration'),
      ];
      document.components[0].developer_guide.summary.source_refs = ['registered'];
      document.components[0].developer_guide.sections[0].items[0].direction = direction;
      document.components[0].developer_guide.sections[0].items[0].source_refs = refs;
      validateSchema('architecture', document);
      const diagnostic = expectGuideFailure(
        document,
        'direction-evidence',
        '/components/0/developer_guide/sections/0/items/0/direction',
      );
      assert.equal(diagnostic.evidence.direction, direction);
    });
  }
});

test('node budget accepts 4096 safe JSON bytes and rejects 4097', () => {
  const accepted = diagram();
  accepted.components[0].developer_guide = guideAtNodeBytes(NODE_BYTES_LIMIT);
  validateSchema('architecture', accepted);
  assert.equal(safeJsonBytes(compiledShape(accepted.components[0].developer_guide)), NODE_BYTES_LIMIT);
  assert.doesNotThrow(() => compileDeveloperGuides('architecture', accepted));

  const rejected = diagram();
  rejected.components[0].developer_guide = guideAtNodeBytes(NODE_BYTES_LIMIT + 1);
  validateSchema('architecture', rejected);
  const diagnostic = expectGuideFailure(rejected, 'node-budget', '/components/0/developer_guide');
  assert.deepEqual(diagnostic.evidence, { bytes: NODE_BYTES_LIMIT + 1, limit: NODE_BYTES_LIMIT });
});

test('member budget accepts the closest encodable value below 64 KiB and rejects the next value above it', () => {
  const boundary = nearMemberBoundary();
  validateSchema('architecture', boundary.accepted);
  const compiled = compileDeveloperGuides('architecture', boundary.accepted);
  assert.equal(compiled.receipt.bytes, boundary.acceptedBytes);
  assert.ok(compiled.encoded.split('\n').every((line) => Buffer.byteLength(line) <= 8000));

  validateSchema('architecture', boundary.rejected);
  const contributorIndex = boundary.rejected.components.findIndex((component, index) => (
    component.developer_guide
      && expectedMemberBytes({
        ...boundary.rejected,
        components: boundary.rejected.components.slice(0, index + 1),
      }) > MEMBER_BYTES_LIMIT
  ));
  assert.ok(contributorIndex >= 0, 'the rejected member must have one identifiable crossing contributor');
  const diagnostic = expectGuideFailure(
    boundary.rejected,
    'member-budget',
    `/components/${contributorIndex}/developer_guide`,
  );
  assert.equal(diagnostic.subject.componentId, boundary.rejected.components[contributorIndex].id);
  assert.equal(diagnostic.evidence.bytes, boundary.rejectedBytes);
  assert.equal(diagnostic.evidence.limit, MEMBER_BYTES_LIMIT);
  assert.ok(boundary.rejectedBytes - MEMBER_BYTES_LIMIT < 32);
});

test('actual architecture CLI preserves safe authored text, source proof, deterministic bytes, and SVG isolation', (t) => {
  const fixture = repositoryFixture(t);
  const special = '中文😀 "quote" \\ slash\nline\rreturn\ttab </script><script>alert("x")</script> <>&';
  fixture.document.components[0].developer_guide.summary.text = special;
  fixture.document.components[0].developer_guide.sections[0].items[0].text = special;
  fixture.document.components[0].developer_guide.sections[0].items[0].code = 'provided("中文😀</script><>&")';
  const input = writeJson(fixture.root, 'guide.architecture.json', fixture.document);
  const firstOutput = path.join(fixture.root, 'guide-first.html');
  const secondOutput = path.join(fixture.root, 'guide-second.html');

  const first = runCli(['deliver', 'architecture', input, firstOutput, '--repo-root', fixture.root, '--json']);
  const second = runCli(['deliver', 'architecture', input, secondOutput, '--repo-root', fixture.root, '--json']);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const firstHtml = fs.readFileSync(firstOutput, 'utf8');
  const secondHtml = fs.readFileSync(secondOutput, 'utf8');
  assert.equal(firstHtml, secondHtml);

  const payload = guidePayloadFromHtml(firstHtml);
  assert.deepEqual(JSON.parse(first.stdout).developerGuide, receiptForGuidePayload(payload));
  assert.deepEqual(JSON.parse(second.stdout).developerGuide, receiptForGuidePayload(payload));
  assert.equal(payload.data.nodes.users.summary.text, special);
  assert.equal(payload.data.nodes.users.sections[0].items[0].text, special);
  assert.equal(payload.data.nodes.users.sections[0].items[0].code, 'provided("中文😀</script><>&")');
  assert.doesNotMatch(payload.body, /[<>&]/);
  assert.ok(payload.body.split('\n').every((line) => Buffer.byteLength(line) <= 8192));

  const plain = structuredClone(fixture.document);
  delete plain.components[0].developer_guide;
  const plainInput = writeJson(fixture.root, 'same-evidence-no-guide.architecture.json', plain);
  const plainOutput = path.join(fixture.root, 'same-evidence-no-guide.html');
  const plainResult = runCli(['deliver', 'architecture', plainInput, plainOutput, '--repo-root', fixture.root, '--json']);
  assert.equal(plainResult.status, 0, plainResult.stderr || plainResult.stdout);
  assert.equal(Object.hasOwn(JSON.parse(plainResult.stdout), 'developerGuide'), false);
  const plainHtml = fs.readFileSync(plainOutput, 'utf8');
  assert.equal(svgFromHtml(firstHtml), svgFromHtml(plainHtml));
  assert.doesNotMatch(svgFromHtml(firstHtml), /public-interface|Owns the request|中文|archify-developer-guide-data/);
});

test('actual architecture CLI rejects symbols outside their pinned source range before replacing an artifact', (t) => {
  const fixture = repositoryFixture(t);
  fixture.document.components[0].sources[0].symbol = 'dependency';
  const input = writeJson(fixture.root, 'missing-symbol.architecture.json', fixture.document);
  const output = path.join(fixture.root, 'must-stay.html');
  fs.writeFileSync(output, 'trusted previous artifact');

  const result = runCli(['deliver', 'architecture', input, output, '--repo-root', fixture.root, '--json']);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'repository-evidence/symbol-missing');
  assert.ok(diagnostic, JSON.stringify(receipt, null, 2));
  assert.equal(diagnostic.subject.path, '/components/0/sources/0/symbol');
  assert.equal(diagnostic.evidence.revision, fixture.revision);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
});

test('old Architecture v1 input renders without repository state or guide payload', (t) => {
  const directory = temporaryDirectory(t, 'archify-developer-guide-v1-');
  const document = JSON.parse(fs.readFileSync(path.join(skillRoot, 'test', 'fixtures', 'v1-baseline', 'web-app.architecture.json'), 'utf8'));
  assert.equal(compileDeveloperGuides('architecture', document), null);
  const input = writeJson(directory, 'legacy.architecture.json', document);
  const output = path.join(directory, 'legacy.html');
  const result = runCli(['render', 'architecture', input, output]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  assert.doesNotMatch(html, /id="archify-developer-guide-data"/);
  assert.ok(svgFromHtml(html));
});
