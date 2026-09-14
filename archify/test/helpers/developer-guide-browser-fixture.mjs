import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const hostileGuideText = 'GUIDE_ONLY_SENTINEL 中文 🧭 "quotes" \\ path <>& </script><img id="guide-injected" src="https://guide-injection.invalid/x" onerror="window.guideInjection=1">';
export const guideSections = ['flow', 'interfaces', 'state', 'constraints', 'change_points'];
const hash = value => createHash('sha256').update(value).digest('hex');

// Actual fixed Git evidence is compiled by the public CLI. No test script
// injects developer-guide DOM or substitutes a renderer-owned payload.
export function makeDeveloperGuideFixture(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const repository = path.join(directory, 'repository');
  fs.mkdirSync(path.join(repository, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repository, 'src/runtime.mjs'), [
    'export const state = new Map();',
    'export function accept(key, value) { state.set(key, value); return value; }',
    'export function lookup(key) { return state.get(key); }',
    'export function forget(key) { return state.delete(key); }',
    'export function current() { return state.size; }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(repository, 'src/caller.mjs'), [
    "import { accept, lookup } from './runtime.mjs';",
    'export function submit(key, value) { accept(key, value); return lookup(key); }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(repository, 'src/runtime.test.mjs'), [
    "import assert from 'node:assert/strict';",
    "import { accept, lookup, forget, current } from './runtime.mjs';",
    "accept('sample', 42); assert.equal(lookup('sample'), 42);",
    "assert.equal(current(), 1); forget('sample'); assert.equal(current(), 0);",
    '',
  ].join('\n'));
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' },
  }).trim();
  git('init'); git('config', 'user.name', 'Archify Tests'); git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'https://github.com/example/developer-guide-fixture');
  git('add', 'src'); git('commit', '-m', 'Fixed developer guide browser evidence');
  const revision = git('rev-parse', 'HEAD');
  const sourceRecords = [
    { id: 'runtime-export', role: 'export', symbol: 'accept', path: 'src/runtime.mjs', line: 1, end_line: 5, label: 'Runtime entry points' },
    { id: 'runtime-call', role: 'callsite', symbol: 'submit', path: 'src/caller.mjs', line: 1, end_line: 2, label: 'Caller observation' },
    { id: 'runtime-test', role: 'test', symbol: 'current', path: 'src/runtime.test.mjs', line: 1, end_line: 4, label: 'Runtime validation' },
  ];
  const item = (id, title, text, source = 'runtime-export') => ({ id, title, text, source_refs: [source] });
  const guide = scope => ({
    implementation_scope: scope,
    summary: { text: 'Stores keyed values through explicit runtime entry points.', source_refs: ['runtime-export'] },
    sections: [
      { kind: 'flow', items: [
        item('accept-value', 'Accept value', 'The caller submits a key and value.', 'runtime-call'),
        item('store-value', 'Store value', 'accept writes the value into the in-memory map.'),
        item('read-value', 'Read value', 'lookup reads the value for the supplied key.'),
      ] },
      { kind: 'interfaces', items: [
        ['accept', 'accept(key, value)', 'Writes and returns the supplied value.'],
        ['lookup', 'lookup(key)', 'Reads the value for the supplied key.'],
        ['forget', 'forget(key)', 'Deletes the entry for the supplied key.'],
        ['current', 'current()', 'Returns the number of stored entries.'],
      ].map(([name, code, text]) => ({ ...item(`${name}-interface`, name, text), direction: 'provided', code })) },
      { kind: 'state', items: [item('map-state', 'Map state', 'The exported map holds values in memory.')] },
      { kind: 'constraints', items: [item('delete-contract', 'Deletion result', 'The fixture checks that deletion removes the stored entry.', 'runtime-test')] },
      { kind: 'change_points', items: [item('validate-entry', 'Validate entry points', 'Edit the runtime entry points and run src/runtime.test.mjs.', 'runtime-test')] },
    ],
  });
  const outputs = {};
  const receipts = {};
  const inputs = [];
  for (const locale of ['en', 'zh-CN']) {
    const localeDirectory = path.join(directory, locale);
    fs.mkdirSync(localeDirectory);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'examples/atlas/project.atlas.json'), 'utf8'));
    manifest.meta.locale = locale;
    for (const [diagram, member] of Object.entries(manifest.diagrams)) {
      const spec = JSON.parse(fs.readFileSync(path.join(root, 'examples/atlas', member.source), 'utf8'));
      spec.meta.locale = locale;
      spec.meta.repository = { url: 'https://github.com/example/developer-guide-fixture', revision, link_mode: 'local-only' };
      for (const node of spec.components) {
        if (node.id === 'controller' || (diagram === 'system' && ['redis', 'db', 'users'].includes(node.id))) {
          node.sources = structuredClone(sourceRecords);
          node.developer_guide = guide('repository');
        }
        if (diagram === 'system' && node.id === 'users') {
          node.developer_guide = {
            implementation_scope: 'external',
            summary: { text: 'This repository calls the dependency through submit.', source_refs: ['runtime-call'] },
            sections: [{ kind: 'interfaces', items: [{ ...item('submit-observation', 'submit', 'The local caller writes then reads the supplied value.', 'runtime-call'), direction: 'observed', code: 'submit(key, value)' }] }],
          };
        }
        if (diagram === 'system' && node.id === 'redis') node.developer_guide.summary.text = hostileGuideText;
      }
      const input = path.join(localeDirectory, member.source);
      fs.writeFileSync(input, `${JSON.stringify(spec, null, 2)}\n`);
      inputs.push(input);
    }
    const atlasInput = path.join(localeDirectory, 'project.atlas.json');
    fs.writeFileSync(atlasInput, `${JSON.stringify(manifest, null, 2)}\n`);
    inputs.push(atlasInput);
    outputs[locale] = {};
    for (const mode of ['architecture', 'atlas']) {
      const input = mode === 'atlas' ? atlasInput : path.join(localeDirectory, 'system.architecture.json');
      const output = path.join(localeDirectory, `${mode}.html`);
      const args = [path.join(root, 'bin/archify.mjs'), 'deliver', mode, input, output, '--repo-root', repository, '--json'];
      const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
      assert.equal(result.status, 0, `Real CLI ${locale}/${mode} failed:\n${result.stderr}\n${result.stdout}`);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.ok, true, JSON.stringify(receipt));
      outputs[locale][mode] = output;
      receipts[`${locale}/${mode}`] = { args, receipt, sha256: hash(fs.readFileSync(output)) };
    }
  }
  const sourceFiles = [
    'bin/archify.mjs', 'assets/template.html', 'renderers/architecture/render-architecture.mjs',
    'schemas/architecture.schema.json', 'test/developer-guide-browser.test.mjs',
    'test/helpers/developer-guide-browser-fixture.mjs',
    ...fs.readdirSync(path.join(root,'renderers/shared')).filter(file=>file.endsWith('.mjs')).sort().map(file=>`renderers/shared/${file}`),
  ];
  const tracked = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(directory, 'provenance.json'), `${JSON.stringify({
    cli: path.join(root, 'bin/archify.mjs'), head: tracked, revision, receipts,
    sources: Object.fromEntries(sourceFiles.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])),
    inputs: Object.fromEntries(inputs.map(file => [path.relative(directory, file), hash(fs.readFileSync(file))])),
    evidence: sourceRecords,
  }, null, 2)}\n`);
  return { directory, repository, revision, outputs, sourceRecords };
}
