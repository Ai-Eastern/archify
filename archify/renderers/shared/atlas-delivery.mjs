import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { freezeAtlas, byteReceipt, validateAtlasRelations } from './atlas-manifest.mjs';
import { validateSchema } from './validator.mjs';
import { isDeepStrictEqual } from 'node:util';
import { resolveOutputPath } from './output-path.mjs';
import { throwDiagnosticError } from './diagnostics.mjs';
import { compileDeveloperGuides, validateGuidedViews, validateRelationshipIds } from './cli.mjs';
import { validateEngineeringProfile } from './engineering-profiles.mjs';
import { verifyRepositoryEvidence } from './repository-evidence.mjs';
import { prepareDiagramBrandMarks } from './brand-marks.mjs';
import {
  applyTemplate,
  DEVELOPER_GUIDE_ATLAS_BYTES,
  findDeveloperGuideBudgetContributor,
  findHtmlScriptsById,
  parseDeveloperGuidePayload,
  renderCards,
} from './utils.mjs';
import { renderArchitecture } from '../architecture/render-architecture.mjs';
import { renderAtlasShell } from './atlas-shell.mjs';
import { readAtlasBundle } from './atlas-bundle.mjs';
import { decodeAtlasPayload } from './atlas-envelope.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const deliveryFixes = {
    'member-check': 'repair the reported member artifact violations and deliver the atlas again',
    'bundle-data': 'rebuild the atlas payload from its local manifest with deliver atlas',
    'bundle-members': 'restore the manifest member inventory and rebuild the complete atlas',
    'bundle-receipt': 'rebuild member byte and checker receipts from the actual compiled members',
    'bundle-digest': 'restore the unchanged compiled member or rebuild its artifact and receipt together',
    'bundle-node-inventory': 'rebuild the member node inventory from its compiled SVG',
    'bundle-relation-inventory': 'rebuild the member relationship inventory from its compiled SVG paths',
    'bundle-view-inventory': 'rebuild the chapter inventory from the member guided-view data',
    'bundle-parent-context': 'rebuild the parent summary from the owner node and its authored parent relationships',
    'bundle-context': 'rebuild the member bridge context from the validated atlas references',
    'bundle-guide-data': 'restore the single compiled developer guide payload and rebuild the member',
    'bundle-guide-inventory': 'rebuild guide node and section inventories from the member payload',
    'bundle-guide-receipt': 'recompute developer guide counts and byte receipts from the actual member payload',
    'bundle-evidence': 'rebuild source evidence metadata from the verified member document',
};

function reject(code, message, subject, evidence) {
  throwDiagnosticError(message, [{ code: `atlas/${code}`, message, subject, evidence,
    supportedFixes: [deliveryFixes[code]] }]);
}

// Only the entities emitted by the renderer need decoding; do this once so
// literal entity-looking author text (for example "&amp;") stays literal.
function compiledAttributes(tag) {
  const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((attr) =>
    [attr[1], attr[2].replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => entities[entity])]));
}

function checkMember(html, directory, id) {
  const filename = path.join(directory, `${id}.html`);
  fs.writeFileSync(filename, html);
  const result = spawnSync(process.execPath, [path.join(skillRoot, 'scripts/check-render-output.mjs'), filename], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  let receipt;
  try { receipt = JSON.parse(result.stdout); }
  catch { reject('member-check', result.error?.message || result.stderr || 'Invalid member checker receipt.', { diagram: id }, { status: result.status, stderr: result.stderr, reason: result.error?.message || 'checker stdout is not JSON' }); }
  if (result.status !== 0 || !receipt.ok) reject('member-check', `Member ${id} failed artifact checks: ${JSON.stringify(receipt.checks?.filter((item) => !item.ok))}`, { diagram: id }, { status: result.status, failedChecks: receipt.checks?.filter((item) => !item.ok) || [] });
  // The checker operates on staging paths; browser payloads must not expose them.
  receipt.file = id;
  return receipt;
}

function checkSourceEvidence(member, id) {
  const scripts = findHtmlScriptsById(member.html, 'archify-source-evidence-data');
  if (scripts.length > 1 || (scripts.length && (
    String(scripts[0].attributes.type || '').trim().toLowerCase() !== 'application/json' || !scripts[0].closed
  ))) reject('bundle-evidence', `Member ${id} must contain at most one inert source evidence payload.`, { diagram: id }, { count: scripts.length });
  let actual;
  if (scripts.length) {
    try { actual = JSON.parse(scripts[0].content); }
    catch (error) { reject('bundle-evidence', `Member ${id} source evidence data is invalid.`, { diagram: id }, { reason: error.message }); }
  }
  if (!isDeepStrictEqual(actual, member.evidence)) reject('bundle-evidence', `Member ${id} source evidence metadata differs from its document.`, { diagram: id }, { expected: actual || null, actual: member.evidence || null });
}

function checkDeveloperGuide(member, id) {
  const scripts = findHtmlScriptsById(member.html, 'archify-developer-guide-data');
  if (scripts.length > 1 || (scripts.length && (
    String(scripts[0].attributes.type || '').trim().toLowerCase() !== 'application/json' || !scripts[0].closed
  ))) {
    reject('bundle-guide-data', `Member ${id} must contain one inert developer guide payload.`, { diagram: id }, { count: scripts.length });
  }
  let data;
  let parsed;
  if (scripts.length) {
    try {
      parsed = parseDeveloperGuidePayload(scripts[0].content);
      data = parsed.payload;
    } catch (error) { reject('bundle-guide-data', `Member ${id} developer guide data is invalid.`, { diagram: id }, { reason: error.message }); }
  }
  const inventory = Object.create(null);
  let itemCount = 0;
  for (const [node, guide] of Object.entries(data?.nodes || {})) {
    const sections = guide?.sections;
    if (!Array.isArray(sections) || !sections.length || sections.length > 5 ||
        new Set(sections.map(section => section?.kind)).size !== sections.length || sections.some(section =>
          !['flow', 'interfaces', 'state', 'constraints', 'change_points'].includes(section?.kind) || !Array.isArray(section.items) || !section.items.length)) {
      reject('bundle-guide-data', `Member ${id} developer guide sections are invalid.`, { diagram: id, node }, { path: `nodes.${node}.sections` });
    }
    inventory[node] = sections.map(section => section.kind);
    itemCount += sections.reduce((count, section) => count + section.items.length, 0);
  }
  if (!isDeepStrictEqual({ ...inventory }, member.guideNodes || {})) reject('bundle-guide-inventory', `Member ${id} developer guide inventory differs from its payload.`, { diagram: id }, { expected: inventory, actual: member.guideNodes || {} });
  if (!scripts.length) return;
  const receipt = { schemaVersion: 1, nodeCount: parsed.nodeCount, itemCount, ...byteReceipt(scripts[0].content) };
  if (!isDeepStrictEqual(receipt, member.receipts?.developerGuide)) reject('bundle-guide-receipt', `Member ${id} developer guide receipt differs from its payload.`, { diagram: id }, { expected: receipt, actual: member.receipts?.developerGuide || null });
}

export function unpackAtlas(html) {
  const scripts = [...html.matchAll(/<script id="archify-atlas-data" type="application\/json">([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) reject('bundle-data', 'Expected exactly one inert atlas payload.', {}, { expected: 1, actual: scripts.length });
  let bundle;
  try {
    const reader = readAtlasBundle(decodeAtlasPayload(scripts[0][1]).payload);
    bundle = { ...reader.bundle, members: Object.fromEntries(reader.bundle.diagramIds.map(id =>
      [id, { ...reader.bundle.members[id], html: reader.memberHtml(id) }])) };
  } catch (error) {
    reject(error.atlasBundleCode || 'bundle-data', error.atlasBundleCode ? error.message : 'Atlas payload is not valid JSON.', {},
      error.atlasBundleEvidence || { parseError: error.message });
  }
  for (const id of bundle.diagramIds) {
    const member = bundle.members[id];
    for (const name of ['source', 'effectiveInput', 'artifact']) {
      const receipt = member.receipts?.[name];
      if (!/^[a-f0-9]{64}$/.test(receipt?.sha256 || '') || !Number.isSafeInteger(receipt?.bytes) || receipt.bytes <= 0) {
        reject('bundle-receipt', `Invalid ${name} byte receipt for ${id}.`, { diagram: id }, { field: name, actual: receipt || null, expected: 'SHA-256 digest and positive safe-integer byte length' });
      }
    }
    const actual = byteReceipt(member.html);
    if (actual.sha256 !== member.receipts?.artifact?.sha256 || actual.bytes !== member.receipts?.artifact?.bytes) {
      reject('bundle-digest', `Embedded member ${id} does not match its receipt.`, { diagram: id }, { expected: member.receipts.artifact, actual });
    }
    if (!member.check?.ok) reject('bundle-receipt', `Missing successful checker receipt for ${id}.`, { diagram: id }, { expected: { ok: true }, actual: member.check || null });
    checkSourceEvidence(member, id);
    checkDeveloperGuide(member, id);
  }
  const manifest = {
    atlas_version: 1, entry: bundle.entry, meta: bundle.meta,
    diagrams: Object.fromEntries(bundle.diagramIds.map((id) => [id, { source: id }])),
    details: bundle.details, references: bundle.references,
  };
  validateSchema('atlas', manifest);
  const members = new Map();
  for (const id of bundle.diagramIds) {
    const member = bundle.members[id];
    const nodes = new Map();
    for (const match of member.html.matchAll(/<g\b([^>]*)>/g)) {
      const attrs = compiledAttributes(match[1]);
      if (attrs['data-node-id']) nodes.set(attrs['data-node-id'], { type: attrs['data-node-kind'], label: attrs['data-node-label'],
        ...(Object.hasOwn(member.guideNodes || {}, attrs['data-node-id']) ? { developer_guide: true } : {}) });
    }
    if (!isDeepStrictEqual([...nodes.keys()], member.nodes)) reject('bundle-node-inventory', `Member ${id} node inventory differs from its SVG.`, { diagram: id }, { expected: [...nodes.keys()], actual: member.nodes });
    const edges = [...member.html.matchAll(/<path\b([^>]*)>/g)].map((match) => compiledAttributes(match[1]))
      .filter((attrs) => attrs['data-edge-from'] && attrs['data-edge-to'])
      .map((attrs) => ({ from: attrs['data-edge-from'], to: attrs['data-edge-to'],
        ...(attrs['data-edge-id'] ? { id: attrs['data-edge-id'] } : {}), label: attrs['data-edge-label'] || '' }));
    const relations = edges.map((edge) => edge.id).filter(Boolean);
    if (!isDeepStrictEqual(relations, member.relations)) reject('bundle-relation-inventory', `Member ${id} relation inventory differs from its SVG.`, { diagram: id }, { expected: relations, actual: member.relations });
    const viewsMatch = member.html.match(/<script id="archify-guided-views-data" type="application\/json">([\s\S]*?)<\/script>/);
    let views;
    try { views = JSON.parse(viewsMatch?.[1]); } catch (error) { reject('bundle-view-inventory', `Member ${id} guided-view data is invalid.`, { diagram: id }, { scriptPresent: Boolean(viewsMatch), parseError: error.message }); }
    const viewIds = Array.isArray(views) ? views.map((view) => view?.id) : null;
    if (!isDeepStrictEqual(viewIds, member.views)) reject('bundle-view-inventory', `Member ${id} chapter inventory differs from its guided-view data.`, { diagram: id }, { expected: viewIds, actual: member.views });
    members.set(id, { nodes, edges, diagram: { components: [...nodes.values()] } });
    const match = member.html.match(/<script id="archify-atlas-context" type="application\/json">([\s\S]*?)<\/script>/);
    let context;
    try { context = JSON.parse(match?.[1]); } catch (error) { reject('bundle-context', `Missing atlas context for ${id}.`, { diagram: id }, { scriptPresent: Boolean(match), parseError: error.message }); }
    const references = Object.fromEntries(bundle.references.filter((ref) => ref.occurrence.diagram === id).map((ref) => [ref.occurrence.node, ref.target]));
    const details = Object.fromEntries(bundle.details.filter(detail => detail.from.diagram === id).map(detail => [detail.from.node, detail.to]));
    if (!isDeepStrictEqual(context, { diagram: id, references, details })) reject('bundle-context', `Member ${id} context does not match atlas relations.`, { diagram: id }, { expected: { diagram: id, references, details }, actual: context });
  }
  const { parent } = validateAtlasRelations(manifest, members);
  for (const id of bundle.diagramIds) {
    const owner = parent.get(id);
    const parentMember = owner && members.get(owner.diagram);
    const expected = parentMember ? parentMember.edges
      .filter((edge) => edge.from === owner.node || edge.to === owner.node)
      .map((edge) => ({ ...(edge.id ? { id: edge.id } : {}), label: edge.label,
        fromLabel: parentMember.nodes.get(edge.from)?.label, toLabel: parentMember.nodes.get(edge.to)?.label })) : [];
    if (!isDeepStrictEqual(expected, bundle.members[id].parentContext)) reject('bundle-parent-context',
      `Member ${id} parent summary differs from its parent SVG relationships.`, { diagram: id },
      { owner: owner || null, expected, actual: bundle.members[id].parentContext });
  }
  return bundle;
}

export function checkAtlas(html) {
  const bundle = unpackAtlas(html);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-atlas-check-'));
  try {
    const members = Object.fromEntries(bundle.diagramIds.map((id) => {
      const actual = checkMember(bundle.members[id].html, directory, id);
      if (!isDeepStrictEqual(actual, bundle.members[id].check)) reject('bundle-receipt', `Member ${id} checker receipt differs from its actual checks.`, { diagram: id }, { expected: actual, actual: bundle.members[id].check });
      return [id, actual];
    }));
    return { ok: true, artifact: byteReceipt(html), diagramIds: bundle.diagramIds, members };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

export async function deliverAtlas({ input, requestedOutput, quality, repoRoot }) {
  let stage = 'input';
  let staging;
  try {
    const frozen = freezeAtlas(input);
    stage = 'prepare';
    const outputRequest = {
      requestedOutput,
      defaultOutput: path.join(path.dirname(frozen.inputPath), `${path.basename(frozen.inputPath, path.extname(frozen.inputPath))}.html`),
      inputPaths: frozen.inputPaths,
    };
    const { outputPath } = resolveOutputPath(outputRequest);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    staging = fs.mkdtempSync(path.join(path.dirname(outputPath), '.archify-atlas-'));
    const memberDirectory = path.join(staging, 'members');
    fs.mkdirSync(memberDirectory);
    const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
    const bundle = {
      bundle_version: 1, entry: frozen.manifest.entry, meta: frozen.meta,
      diagramIds: [...frozen.members.keys()], details: frozen.manifest.details || [],
      references: frozen.manifest.references || [], members: Object.create(null),
    };
    let atlasDeveloperGuideBytes = 0;
    for (const [id, member] of frozen.members) {
      stage = 'render';
      try {
        const diagram = member.diagram;
        const effectiveQuality = quality || process.env.ARCHIFY_QUALITY_PROFILE || diagram.meta.quality_profile;
        if (effectiveQuality) diagram.meta.quality_profile = effectiveQuality;
        validateSchema('architecture', diagram);
        const effectiveBytes = Buffer.from(JSON.stringify(diagram));
        validateGuidedViews('architecture', diagram);
        validateRelationshipIds('architecture', diagram);
        validateEngineeringProfile('architecture', diagram);
        const developerGuide = compileDeveloperGuides('architecture', diagram);
        const previousAtlasDeveloperGuideBytes = atlasDeveloperGuideBytes;
        atlasDeveloperGuideBytes += developerGuide?.receipt.bytes || 0;
        if (atlasDeveloperGuideBytes > DEVELOPER_GUIDE_ATLAS_BYTES) {
          const contributor = findDeveloperGuideBudgetContributor(
            diagram.components,
            developerGuide?.data.nodes,
            {
              baseBytes: previousAtlasDeveloperGuideBytes,
              limit: DEVELOPER_GUIDE_ATLAS_BYTES,
            },
          );
          const componentIndex = contributor?.componentIndex
            ?? diagram.components.findLastIndex(component => component?.developer_guide);
          const component = diagram.components[componentIndex];
          throwDiagnosticError(`Atlas developer guide payload exceeds ${DEVELOPER_GUIDE_ATLAS_BYTES} bytes.`, [{
            code: 'developer-guide/atlas-budget',
            severity: 'error',
            message: `Atlas developer guide payload is ${atlasDeveloperGuideBytes} bytes; the limit is ${DEVELOPER_GUIDE_ATLAS_BYTES}.`,
            subject: {
              diagram: id,
              componentId: component.id,
              path: `/components/${componentIndex}/developer_guide`,
            },
            evidence: { bytes: atlasDeveloperGuideBytes, limit: DEVELOPER_GUIDE_ATLAS_BYTES },
            supportedFixes: ['reduce lower-value member guide content until the Atlas payload fits'],
          }]);
        }
        const evidence = verifyRepositoryEvidence('architecture', diagram, repoRoot || process.env.ARCHIFY_REPO_ROOT);
        await prepareDiagramBrandMarks('architecture', diagram);
        const references = Object.fromEntries(bundle.references.filter((ref) => ref.occurrence.diagram === id).map((ref) => [ref.occurrence.node, ref.target]));
        const details = Object.fromEntries(bundle.details.filter(detail => detail.from.diagram === id).map(detail => [detail.from.node, detail.to]));
        const atlasContext = { diagram: id, references, details };
        const html = applyTemplate(template, {
          title: diagram.meta.title, subtitle: diagram.meta.subtitle,
          svg: renderArchitecture(diagram, { atlasContext }), cards: renderCards(diagram.cards),
          locale: diagram.meta.locale, visualPreset: diagram.meta.visual_preset,
          guidedViews: diagram.meta.views || [], sourceEvidence: evidence, developerGuide, atlasContext,
        });
        stage = 'check';
        const check = checkMember(html, memberDirectory, id);
        const owner = frozen.parent.get(id);
        const parent = owner ? frozen.members.get(owner.diagram) : null;
        const parentContext = parent ? (parent.diagram.connections || [])
          .filter((edge) => edge.from === owner.node || edge.to === owner.node)
          .map((edge) => ({ ...(edge.id ? { id: edge.id } : {}), label: edge.label || '',
            fromLabel: parent.nodes.get(edge.from).label, toLabel: parent.nodes.get(edge.to).label })) : [];
        bundle.members[id] = {
          title: diagram.meta.title, nodes: [...member.nodes.keys()],
          relations: (diagram.connections || []).map((edge) => edge.id).filter(Boolean),
          views: (diagram.meta.views || []).map((view) => view.id), parentContext, html, check,
          ...(developerGuide ? { guideNodes: Object.fromEntries(Object.entries(developerGuide.data.nodes)
            .map(([nodeId, guide]) => [nodeId, guide.sections.map((section) => section.kind)])) } : {}),
          receipts: { source: member.receipts.source, effectiveInput: byteReceipt(effectiveBytes), artifact: byteReceipt(html), ...(developerGuide ? { developerGuide: developerGuide.receipt } : {}) },
          ...(evidence ? { evidence } : {}),
        };
      } catch (error) {
        if (error.archifyDiagnostics) error.archifyDiagnostics = error.archifyDiagnostics.map((item) => ({ ...item, subject: { ...item.subject, diagram: id } }));
        throw error;
      }
    }
    stage = 'bundle';
    const html = renderAtlasShell(bundle);
    const candidate = path.join(staging, 'atlas.html');
    fs.writeFileSync(candidate, html, { flag: 'wx' });
    const checked = checkAtlas(fs.readFileSync(candidate, 'utf8'));
    stage = 'commit';
    resolveOutputPath(outputRequest);
    fs.renameSync(candidate, outputPath);
    return {
      schemaVersion: 1, ok: true, command: 'deliver', type: 'atlas', input: frozen.inputPath, output: outputPath,
      specification: frozen.manifestReceipt, artifact: checked.artifact,
      members: Object.fromEntries(bundle.diagramIds.map((id) => [id, {
        ...bundle.members[id].receipts, validation: bundle.members[id].check,
        ...(bundle.members[id].evidence ? { evidence: bundle.members[id].evidence } : {}),
      }])), validation: { ok: true, diagramIds: bundle.diagramIds },
    };
  } catch (error) {
    error.atlasStage = stage;
    throw error;
  } finally { if (staging) fs.rmSync(staging, { recursive: true, force: true }); }
}
