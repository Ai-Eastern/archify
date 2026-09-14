#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertThirdPartyNotices } from './third-party-notices-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const noticeComparisonRoot = path.resolve(
  process.env.ARCHIFY_PACKAGE_SMOKE_NOTICE_ROOT || repoRoot,
);
const defaultPackageRoot = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'archify-package', 'archify')
  : path.join(repoRoot, 'archify');
const skillRoot = path.resolve(process.argv[2] || defaultPackageRoot);
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const updateChecker = path.join(skillRoot, 'scripts', 'check-update.mjs');
const updateContract = path.join(skillRoot, 'scripts', 'update-contract.mjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-smoke-'));

function requireAbsent(relative) {
  if (fs.existsSync(path.join(skillRoot, relative))) {
    throw new Error(`packaged skill must not contain ${relative}`);
  }
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error([
      `archify ${args.join(' ')} failed with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function runExpectFailure(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status === 0) throw new Error(`archify ${args.join(' ')} unexpectedly passed`);
  return result.stdout;
}

function runGit(repository, args) {
  const result = spawnSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error([
      `git ${args.join(' ')} failed with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout.trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function developerGuidePayload(html) {
  const matches = [...html.matchAll(
    /<script id="archify-developer-guide-data" type="application\/json">([\s\S]*?)<\/script>/g,
  )];
  if (matches.length !== 1) {
    throw new Error(`packaged Architecture must contain one developer guide payload, found ${matches.length}`);
  }
  const body = matches[0][1];
  let chunks;
  let data;
  try {
    chunks = JSON.parse(body);
    if (!Array.isArray(chunks) || chunks.some((chunk) => typeof chunk !== 'string')) {
      throw new Error('outer payload is not a string-chunk array');
    }
    data = JSON.parse(chunks.join(''));
  } catch (error) {
    throw new Error(`packaged developer guide payload is not decodable: ${error.message}`);
  }
  if (data?.schemaVersion !== 1 || !data.nodes || Array.isArray(data.nodes)
    || typeof data.nodes !== 'object') {
    throw new Error('packaged developer guide payload has an invalid envelope');
  }
  return { body, data };
}

function expectedDeveloperGuideReceipt(payload) {
  const guides = Object.values(payload.data.nodes);
  return {
    schemaVersion: 1,
    nodeCount: guides.length,
    itemCount: guides.reduce((count, guide) => count + guide.sections.reduce(
      (subtotal, section) => subtotal + section.items.length,
      0,
    ), 0),
    bytes: Buffer.byteLength(payload.body),
    sha256: sha256(payload.body),
  };
}

function requireDeveloperGuideReceipt(actual, expected, context) {
  for (const field of ['schemaVersion', 'nodeCount', 'itemCount', 'bytes', 'sha256']) {
    if (actual?.[field] !== expected[field]) {
      throw new Error(`${context} developer guide receipt has invalid ${field}`);
    }
  }
}

try {
  if (!fs.existsSync(cli)) throw new Error(`packaged CLI not found at ${cli}`);
  requireAbsent('node_modules');
  requireAbsent('package-lock.json');
  requireAbsent(path.join('scripts', 'generate-validators.mjs'));
  requireAbsent(path.join('scripts', 'generate-brand-marks.mjs'));
  requireAbsent('test');
  requireAbsent('.hive');
  requireAbsent('.workbuddy');

  const packageLicensePath = path.join(skillRoot, 'LICENSE');
  if (!fs.existsSync(packageLicensePath)) {
    throw new Error('packaged skill is missing LICENSE');
  }
  const packageLicense = fs.readFileSync(packageLicensePath, 'utf8');
  const packageLicenseLines = packageLicense.split(/\r?\n/);
  if (!packageLicenseLines.includes('Copyright (c) 2025 Cocoon AI')) {
    throw new Error('packaged LICENSE is missing the exact Cocoon AI copyright line');
  }
  const repositoryLicense = fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8');
  if (packageLicense !== repositoryLicense) {
    throw new Error('packaged LICENSE must byte-match the repository LICENSE');
  }
  if (!packageLicense.includes('The above copyright notice and this permission notice shall be included in all')) {
    throw new Error('packaged LICENSE is missing the MIT notice-preservation terms');
  }

  const packageNoticesPath = path.join(skillRoot, 'THIRD_PARTY_NOTICES.md');
  if (!fs.existsSync(packageNoticesPath)) {
    throw new Error('packaged skill is missing THIRD_PARTY_NOTICES.md');
  }
  const packageNotices = fs.readFileSync(packageNoticesPath, 'utf8');
  const repositoryNotices = fs.readFileSync(path.join(noticeComparisonRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const embeddedFonts = /data:font\/woff2/.test(fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8'));
  if (embeddedFonts && !fs.existsSync(path.join(skillRoot, 'assets/JetBrainsMono-OFL.txt'))) {
    throw new Error('embedded viewer font requires assets/JetBrainsMono-OFL.txt');
  }
  assertThirdPartyNotices(repositoryNotices, 'repository THIRD_PARTY_NOTICES.md', { embeddedFonts });
  assertThirdPartyNotices(packageNotices, 'packaged THIRD_PARTY_NOTICES.md', { embeddedFonts });
  if (packageNotices !== repositoryNotices) {
    throw new Error('packaged THIRD_PARTY_NOTICES.md must byte-match the repository notice');
  }

  if (!fs.existsSync(updateChecker)) {
    throw new Error(`packaged update checker not found at ${updateChecker}`);
  }
  if (!fs.existsSync(updateContract)) {
    throw new Error(`packaged update contract not found at ${updateContract}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));
  const dependencyFields = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundledDependencies',
    'bundleDependencies',
  ];
  const declaredDependencyField = dependencyFields.find((field) => (
    Object.prototype.hasOwnProperty.call(packageJson, field)
  ));
  if (declaredDependencyField) {
    throw new Error(`packaged skill must not declare dependency metadata: ${declaredDependencyField}`);
  }

  const skillRelease = JSON.parse(fs.readFileSync(path.join(skillRoot, 'skill-release.json'), 'utf8'));
  const contract = await import(pathToFileURL(updateContract).href);
  let validatedRelease;
  try {
    validatedRelease = contract.validateLocalRelease(skillRelease);
  } catch {
    throw new Error('packaged skill-release.json violates the shared update contract');
  }
  if (validatedRelease.version !== packageJson.version) {
    throw new Error('packaged skill-release.json does not match the package release identity');
  }

  const updateCheck = spawnSync(process.execPath, [updateChecker], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  if (updateCheck.status !== 0) {
    throw new Error(`packaged update checker failed with ${updateCheck.status}\n${updateCheck.stderr}`);
  }
  let updateReceipt;
  try {
    updateReceipt = JSON.parse(updateCheck.stdout);
  } catch {
    throw new Error('packaged update checker did not return valid JSON');
  }
  if (updateReceipt.status !== 'silent' || updateReceipt.reason !== 'disabled') {
    throw new Error('packaged update checker did not honor the local disable switch');
  }

  const checker = await import(pathToFileURL(updateChecker).href);
  const versionCore = /^(\d+)\.(\d+)\.(\d+)/.exec(packageJson.version);
  if (!versionCore) throw new Error('package version cannot produce an update-check smoke candidate');
  const candidateVersion = `${versionCore[1]}.${versionCore[2]}.${BigInt(versionCore[3]) + 1n}`;
  const candidate = {
    schemaVersion: 1,
    skillId: 'archify',
    channel: 'stable',
    version: candidateVersion,
    publishedAt: '2026-08-28T00:00:00Z',
    source: {
      repository: 'https://github.com/tt-a1i/archify',
      ref: `v${candidateVersion}`,
      treeSha: 'a'.repeat(40),
    },
    artifact: { sha256: 'b'.repeat(64) },
    summary: 'Package smoke candidate.',
    releaseNotes: `https://github.com/tt-a1i/archify/releases/tag/v${candidateVersion}`,
    severity: 'normal',
  };
  const notifierCache = path.join(scratch, 'update-cache');
  const notifierReceipt = await checker.checkForUpdate({
    cacheDirectory: notifierCache,
    fetchImpl: async () => new Response(JSON.stringify(candidate), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"package-smoke"' },
    }),
    now: () => Date.parse('2026-08-28T00:00:00Z'),
    random: () => 0.5,
  });
  if (notifierReceipt.status !== 'update_available') {
    throw new Error(`packaged update checker did not return an update candidate: ${JSON.stringify(notifierReceipt)}`);
  }
  const notifierAcknowledgement = await checker.acknowledgeUpdate({
    releasePath: path.join(skillRoot, 'skill-release.json'),
    cacheDirectory: notifierCache,
    eventKey: notifierReceipt.eventKey,
    now: () => Date.parse('2026-08-28T00:00:01Z'),
  });
  if (notifierAcknowledgement.status !== 'acknowledged') {
    throw new Error('packaged update checker did not persist a visible-notice acknowledgement');
  }

  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const skillReferences = [...skill.matchAll(
    /`((?:assets|bin|examples|recipes|references|renderers|schemas|scripts)\/[^`\s]+)`/g,
  )]
    .map((match) => match[1])
    .filter((reference) => !/[<>{}*\[\]]/.test(reference));
  if (skillReferences.length === 0) {
    throw new Error('packaged SKILL.md did not expose any literal package paths');
  }
  for (const reference of new Set(skillReferences)) {
    if (!fs.existsSync(path.join(skillRoot, reference))) {
      throw new Error(`packaged SKILL.md references missing path ${reference}`);
    }
  }

  run(['--help']);
  run(['doctor']);
  const brands = JSON.parse(run(['brands', 'openai', '--json']));
  if (!brands.marks.some((mark) => mark.id === 'openai')) {
    throw new Error('packaged brand catalogue did not resolve openai');
  }
  const capturedPreset = JSON.parse(run(['brands', 'capture', 'https://github.com/', '--json']));
  if (capturedPreset.brand !== 'github' || capturedPreset.evidence.status !== 'preset') {
    throw new Error('packaged brand capture did not resolve a known domain without network capture');
  }
  run(['demo', path.join(scratch, 'demo')]);
  run(['examples']);

  const fixtures = [
    ['architecture', 'production-deployment.architecture.json'],
    ['workflow', 'agent-tool-call.workflow.json'],
    ['sequence', 'cache-miss-request.sequence.json'],
    ['dataflow', 'product-analytics.dataflow.json'],
    ['lifecycle', 'agent-run.lifecycle.json'],
  ];
  for (const [mode, fixture] of fixtures) {
    const receipt = JSON.parse(run([
      'validate', mode, path.join(skillRoot, 'examples', fixture), '--json',
    ]));
    if (!receipt.ok || receipt.type !== mode) {
      throw new Error(`${mode} package validation returned an invalid receipt`);
    }
    if (mode === 'architecture' && receipt.engineeringProfile !== 'deployment-ownership') {
      throw new Error('deployment package validation omitted the engineering profile receipt');
    }
  }

  const workflowLayout = JSON.parse(run([
    'validate', 'workflow', path.join(skillRoot, 'examples', fixtures[1][1]),
    '--layout-json', '--quality', 'showcase',
  ]));
  if (workflowLayout.contract !== 'readable-v2'
    || workflowLayout.columns?.length !== 6
    || workflowLayout.diagnostics?.length !== 0) {
    throw new Error('packaged workflow compiler did not expose a passing readable-v2 layout receipt');
  }

  const legacyWorkflow = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Package migration smoke', viewBox: [720, 400], legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'source', lane: 'main', col: 0, type: 'frontend', label: 'Source' },
      { id: 'target', lane: 'main', col: 2, type: 'backend', label: 'Target' },
    ],
    edges: [{ id: 'flow', from: 'source', to: 'target', label: 'request' }],
  };
  const legacyWorkflowPath = path.join(scratch, 'legacy.workflow.json');
  const migratedWorkflowPath = path.join(scratch, 'migrated.workflow.json');
  const migratedAgainPath = path.join(scratch, 'migrated-again.workflow.json');
  fs.writeFileSync(legacyWorkflowPath, `${JSON.stringify(legacyWorkflow, null, 2)}\n`);
  const migrationReceipt = JSON.parse(run([
    'migrate', 'workflow', legacyWorkflowPath, migratedWorkflowPath,
    '--to-schema', '2', '--json',
  ]));
  if (!migrationReceipt.ok || migrationReceipt.fromSchemaVersion !== 1
    || migrationReceipt.toSchemaVersion !== 2 || !fs.existsSync(migratedWorkflowPath)) {
    throw new Error('packaged workflow migrator did not produce a schema-v2 destination');
  }
  const idempotenceReceipt = JSON.parse(run([
    'migrate', 'workflow', migratedWorkflowPath, migratedAgainPath,
    '--to-schema', '2', '--json',
  ]));
  if (!idempotenceReceipt.ok || idempotenceReceipt.fromSchemaVersion !== 2
    || idempotenceReceipt.source?.sha256 !== idempotenceReceipt.destination?.sha256
    || !fs.readFileSync(migratedWorkflowPath).equals(fs.readFileSync(migratedAgainPath))) {
    throw new Error('packaged workflow migrator did not preserve byte-identical v2 idempotence');
  }

  const deployment = path.join(scratch, 'deployment.html');
  run(['render', 'architecture', path.join(skillRoot, 'examples', fixtures[0][1]), deployment]);
  run(['check', deployment]);

  const guideRepository = path.join(scratch, 'guide-repository');
  fs.mkdirSync(path.join(guideRepository, 'src'), { recursive: true });
  fs.writeFileSync(path.join(guideRepository, 'src', 'handler.js'), [
    'export function registerHandler(input) {',
    '  return input;',
    '}',
    '',
  ].join('\n'));
  runGit(guideRepository, ['init', '--quiet']);
  runGit(guideRepository, ['config', 'user.name', 'Archify Package Smoke']);
  runGit(guideRepository, ['config', 'user.email', 'archify@example.test']);
  runGit(guideRepository, ['config', 'commit.gpgSign', 'false']);
  const guideRepositoryUrl = 'https://github.com/example/archify-package-guide.git';
  runGit(guideRepository, ['remote', 'add', 'origin', guideRepositoryUrl]);
  runGit(guideRepository, ['add', 'src/handler.js']);
  runGit(guideRepository, ['commit', '--quiet', '-m', 'developer guide fixture']);
  const guideRevision = runGit(guideRepository, ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(guideRevision)) {
    throw new Error('package developer guide fixture did not produce a fixed Git revision');
  }

  const guideSentinel = 'package-guide-only-sentinel';
  const guideDiagram = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Package Developer Guide',
      repository: {
        url: guideRepositoryUrl,
        revision: guideRevision,
        link_mode: 'local-only',
      },
    },
    components: [{
      id: 'handler',
      type: 'backend',
      label: 'Request Handler',
      pos: [120, 120],
      size: [180, 72],
      sources: [{
        id: 'handler-export',
        role: 'export',
        path: 'src/handler.js',
        line: 1,
        end_line: 3,
        symbol: 'registerHandler',
      }],
      developer_guide: {
        implementation_scope: 'repository',
        summary: {
          text: guideSentinel,
          source_refs: ['handler-export'],
        },
        sections: [{
          kind: 'interfaces',
          items: [{
            id: 'register-handler',
            title: 'registerHandler',
            code: 'registerHandler(input)',
            direction: 'provided',
            text: 'Accepts one input and returns it to the caller.',
            source_refs: ['handler-export'],
          }],
        }],
      },
    }],
  };
  const guideInput = path.join(guideRepository, 'guide.architecture.json');
  fs.writeFileSync(guideInput, `${JSON.stringify(guideDiagram, null, 2)}\n`);
  const guideFirstOutput = path.join(scratch, 'guide-first.html');
  const guideSecondOutput = path.join(scratch, 'guide-second.html');
  const guideFirstReceipt = JSON.parse(run([
    'deliver', 'architecture', guideInput, guideFirstOutput,
    '--repo-root', guideRepository, '--json',
  ]));
  const guideSecondReceipt = JSON.parse(run([
    'deliver', 'architecture', guideInput, guideSecondOutput,
    '--repo-root', guideRepository, '--json',
  ]));
  const guideFirstHtml = fs.readFileSync(guideFirstOutput, 'utf8');
  const guideSecondHtml = fs.readFileSync(guideSecondOutput, 'utf8');
  if (sha256(guideFirstHtml) !== sha256(guideSecondHtml)) {
    throw new Error('packaged developer guide delivery is not byte-deterministic');
  }
  const guidePayload = developerGuidePayload(guideFirstHtml);
  const guideNode = guidePayload.data.nodes.handler;
  if (guideNode?.summary?.text !== guideSentinel
    || guideNode?.sections?.[0]?.items?.[0]?.id !== 'register-handler') {
    throw new Error('packaged developer guide payload did not preserve the authored node guide');
  }
  const guideReceipt = expectedDeveloperGuideReceipt(guidePayload);
  requireDeveloperGuideReceipt(guideFirstReceipt.developerGuide, guideReceipt, 'first delivery');
  requireDeveloperGuideReceipt(guideSecondReceipt.developerGuide, guideReceipt, 'second delivery');
  if (guideFirstReceipt.evidence?.revision !== guideRevision
    || guideFirstReceipt.evidence?.references !== 1) {
    throw new Error('packaged developer guide delivery omitted its fixed source evidence receipt');
  }
  const canonicalSvg = guideFirstHtml.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  if (!canonicalSvg || canonicalSvg.includes(guideSentinel)
    || canonicalSvg.includes('register-handler')) {
    throw new Error('packaged developer guide content leaked into the canonical SVG');
  }

  const guideAtlasInput = path.join(guideRepository, 'guide.atlas.json');
  fs.writeFileSync(guideAtlasInput, `${JSON.stringify({
    atlas_version: 1,
    entry: 'guide',
    meta: { title: 'Package Developer Guide Atlas' },
    diagrams: { guide: { source: 'guide.architecture.json' } },
  }, null, 2)}\n`);
  const guideAtlasFirstOutput = path.join(scratch, 'guide-atlas-first.html');
  const guideAtlasSecondOutput = path.join(scratch, 'guide-atlas-second.html');
  const guideAtlasFirstReceipt = JSON.parse(run([
    'deliver', 'atlas', guideAtlasInput, guideAtlasFirstOutput,
    '--repo-root', guideRepository, '--json',
  ]));
  run([
    'deliver', 'atlas', guideAtlasInput, guideAtlasSecondOutput,
    '--repo-root', guideRepository, '--json',
  ]);
  const guideAtlasFirstHtml = fs.readFileSync(guideAtlasFirstOutput, 'utf8');
  const guideAtlasSecondHtml = fs.readFileSync(guideAtlasSecondOutput, 'utf8');
  if (sha256(guideAtlasFirstHtml) !== sha256(guideAtlasSecondHtml)) {
    throw new Error('packaged Atlas developer guide delivery is not byte-deterministic');
  }
  requireDeveloperGuideReceipt(
    guideAtlasFirstReceipt.members?.guide?.developerGuide,
    guideReceipt,
    'first Atlas member',
  );
  const invalidGuideDiagram = JSON.parse(JSON.stringify(guideDiagram));
  invalidGuideDiagram.components[0].sources[0].symbol = 'missingHandler';
  const invalidGuideInput = path.join(guideRepository, 'invalid-guide.architecture.json');
  const preservedGuideOutput = path.join(scratch, 'preserved-guide.html');
  const preservedGuideContents = 'trusted previous package artifact\n';
  fs.writeFileSync(invalidGuideInput, `${JSON.stringify(invalidGuideDiagram, null, 2)}\n`);
  fs.writeFileSync(preservedGuideOutput, preservedGuideContents);
  const guideFailure = JSON.parse(runExpectFailure([
    'deliver', 'architecture', invalidGuideInput, preservedGuideOutput,
    '--repo-root', guideRepository, '--json',
  ]));
  if (guideFailure.ok
    || !guideFailure.diagnostics?.some((entry) => entry.code === 'repository-evidence/symbol-missing')) {
    throw new Error('packaged developer guide delivery did not reject invalid pinned symbol evidence');
  }
  if (fs.readFileSync(preservedGuideOutput, 'utf8') !== preservedGuideContents) {
    throw new Error('failed packaged developer guide delivery replaced the previous artifact');
  }

  const compareReceipt = JSON.parse(run([
    'compare', 'architecture',
    path.join(skillRoot, 'examples', 'checkout-platform.base.architecture.json'),
    path.join(skillRoot, 'examples', 'checkout-platform.head.architecture.json'),
    path.join(scratch, 'architecture-delta.html'), '--json',
  ]));
  if (!compareReceipt.ok || compareReceipt.completeness !== 'complete'
    || compareReceipt.validation?.checksPassed !== compareReceipt.validation?.checkCount) {
    throw new Error('packaged Architecture compare did not return a complete passing receipt');
  }

  const delivered = JSON.parse(run([
    'deliver', 'workflow', path.join(skillRoot, 'examples', fixtures[1][1]),
    path.join(scratch, 'workflow-delivered.html'), '--quality', 'showcase', '--json',
  ]));
  if (!delivered.ok || delivered.validation?.compositionStatus !== 'pass'
    || !/^[a-f0-9]{64}$/.test(delivered.specification?.sha256 || '')
    || !(delivered.specification?.bytes > 0)) {
    throw new Error('packaged workflow delivery did not return a passing receipt');
  }

  const visualSkipped = JSON.parse(runExpectFailure([
    'visual-check', delivered.output, '--json',
  ], {
    env: { ...process.env, ARCHIFY_CHROME: path.join(scratch, 'missing-chrome') },
  }));
  if (visualSkipped.status !== 'skipped' || visualSkipped.visualReview !== 'pending'
    || visualSkipped.chrome?.status !== 'unavailable') {
    throw new Error('packaged visual-check did not return the expected Chrome-unavailable receipt');
  }

  const emptyPath = path.join(scratch, 'empty-path');
  fs.mkdirSync(emptyPath);
  const openReceipt = JSON.parse(run([
    'deliver', 'workflow', path.join(skillRoot, 'examples', fixtures[1][1]),
    path.join(scratch, 'workflow-open-fallback.html'), '--open', '--json',
  ], { env: { ...process.env, PATH: emptyPath } }));
  if (!openReceipt.ok || openReceipt.open?.status !== 'unsupported') {
    throw new Error('packaged open fallback did not remain a successful unsupported handoff');
  }

  const invalidWorkflow = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', fixtures[1][1]), 'utf8',
  ));
  invalidWorkflow.nodes[0].colour = 'cyan';
  const invalidPath = path.join(scratch, 'invalid-workflow.json');
  fs.writeFileSync(invalidPath, JSON.stringify(invalidWorkflow));
  const failure = JSON.parse(runExpectFailure(['validate', 'workflow', invalidPath, '--json']));
  if (failure.ok || !failure.diagnostics?.some((diagnostic) => diagnostic.code === 'schema/additionalProperties')) {
    throw new Error('packaged skill did not return the expected unknown-field diagnostic');
  }

  const tangentEndpoint = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Endpoint direction smoke' },
    components: [
      { id: 'source', type: 'external', label: 'Source', pos: [300, 100], size: [100, 60] },
      { id: 'target', type: 'backend', label: 'Target', pos: [100, 240], size: [100, 60] },
    ],
    connections: [{
      id: 'tangent',
      from: 'source',
      to: 'target',
      fromSide: 'bottom',
      toSide: 'top',
      via: [[350, 200], [100, 200], [100, 240]],
    }],
  };
  const tangentPath = path.join(scratch, 'tangent-endpoint.architecture.json');
  fs.writeFileSync(tangentPath, JSON.stringify(tangentEndpoint));
  const tangentFailure = JSON.parse(runExpectFailure(['validate', 'architecture', tangentPath, '--json']));
  const tangentDiagnostic = tangentFailure.diagnostics?.find((diagnostic) => (
    diagnostic.code === 'clean-flow/endpoint-side-direction'
  ));
  if (tangentFailure.ok || tangentDiagnostic?.evidence?.authoredField !== 'toSide'
    || tangentDiagnostic?.evidence?.side !== 'top') {
    throw new Error('packaged skill did not reject a tangential target-port entry with structured repair evidence');
  }

  const inferredBridge = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Inferred endpoint bridge smoke' },
    components: [
      { id: 'workspace', type: 'frontend', label: 'Workspace UI', pos: [40, 300], size: [120, 60] },
      { id: 'runtime-server', type: 'backend', label: 'Runtime Server', pos: [220, 300], size: [120, 60] },
      { id: 'runtime-store', type: 'backend', label: 'Runtime Store', pos: [400, 300], size: [120, 60] },
      { id: 'stream-hub', type: 'messagebus', label: 'Terminal Stream Hub', pos: [700, 100], size: [120, 60] },
    ],
    connections: [{ id: 'terminal-return', from: 'stream-hub', to: 'workspace' }],
  };
  const inferredBridgePath = path.join(scratch, 'inferred-bridge.architecture.json');
  const inferredBridgeHtml = path.join(scratch, 'inferred-bridge.html');
  fs.writeFileSync(inferredBridgePath, JSON.stringify(inferredBridge));
  run(['render', 'architecture', inferredBridgePath, inferredBridgeHtml]);
  const inferredBridgeArtifact = fs.readFileSync(inferredBridgeHtml, 'utf8');
  if (!inferredBridgeArtifact.includes('data-composition-points="700,130;184,130;184,330;160,330"')) {
    throw new Error('packaged skill did not preserve inferred endpoint normals with a side-aware bridge');
  }

  process.stdout.write(`package smoke passed on ${process.platform} (${skillRoot})\n`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
