import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  applyTemplate,
  findInternalStructureBudgetContributor,
  INTERNAL_STRUCTURE_MEMBER_BYTES,
  INTERNAL_STRUCTURE_NODE_BYTES,
  renderCards,
  esc,
  serializeChunkedScriptJson,
  serializeScriptJson,
} from './utils.mjs';
import { validateSchema } from './validator.mjs';
import { verifyRepositoryEvidence } from './repository-evidence.mjs';
import { installRendererDiagnosticBoundary, throwDiagnosticError, throwDiagnosticProblems } from './diagnostics.mjs';
import { validateEngineeringProfile } from './engineering-profiles.mjs';
import { resolveOutputPath } from './output-path.mjs';
import { prepareDiagramBrandMarks } from './brand-marks.mjs';
import { resolveLocale, translateMessage } from './i18n.mjs';

installRendererDiagnosticBoundary();

const outputPathGuards = new Map();
const STRUCTURE_RELATION_EVIDENCE_ROLES = new Set(['callsite', 'definition', 'guard', 'schema', 'test']);

function structureDiagnostic(code, message, component, path, evidence, supportedFixes) {
  return {
    code: `internal-structure/${code}`,
    severity: 'error',
    message,
    subject: { diagramType: 'architecture', componentId: component.id, path },
    evidence,
    supportedFixes,
  };
}

function compiledStructure(structure) {
  return {
    sources: structure.sources.map((source) => ({
      id: source.id,
      role: source.role,
      path: source.path,
      ...(source.symbol !== undefined ? { symbol: source.symbol } : {}),
      ...(source.line !== undefined ? { line: source.line } : {}),
      ...(source.end_line !== undefined ? { endLine: source.end_line } : {}),
      ...(source.label !== undefined ? { label: source.label } : {}),
    })),
    items: structure.items.map((item) => ({
      id: item.id,
      domain: item.domain,
      kind: item.kind,
      label: item.label,
      ...(item.parent !== undefined ? { parent: item.parent } : {}),
      ...(item.signature !== undefined ? { signature: item.signature } : {}),
      ...(item.value_type !== undefined ? { valueType: item.value_type } : {}),
      summary: item.summary,
      ...(item.source_refs !== undefined ? { sourceRefs: [...item.source_refs] } : {}),
    })),
    relations: structure.relations.map((relation) => ({
      id: relation.id,
      from: relation.from,
      to: relation.to,
      kind: relation.kind,
      ...(relation.label !== undefined ? { label: relation.label } : {}),
      sourceRefs: [...relation.source_refs],
    })),
  };
}

export function compileInternalStructures(diagramType, diagram) {
  if (diagramType !== 'architecture') return null;
  const components = Array.isArray(diagram?.components) ? diagram.components : [];
  const withStructure = components.filter((component) => component?.internal_structure);
  const diagnostics = [];
  const nodes = Object.create(null);
  let itemCount = 0;
  let relationCount = 0;
  let sourceCount = 0;
  const componentIds = new Set();

  for (const [componentIndex, component] of components.entries()) {
    if (componentIds.has(component.id)) {
      diagnostics.push(structureDiagnostic('duplicate-component-id', `Component id ${JSON.stringify(component.id)} is duplicated and cannot index internal structure safely.`, component, `/components/${componentIndex}/id`, { componentId: component.id }, ['give every architecture component a unique id']));
    }
    componentIds.add(component.id);
  }

  if (!withStructure.length) {
    if (diagnostics.length) throwDiagnosticError(`Internal structure validation failed:\n${diagnostics.map((item) => `- ${item.message}`).join('\n')}`, diagnostics);
    return null;
  }

  if (!diagram.meta?.repository) {
    diagnostics.push(structureDiagnostic('repository-required', 'Internal structure requires /meta/repository pinned to one source revision.', withStructure[0], '/meta/repository', {}, ['add pinned repository metadata or remove internal_structure']));
  }

  for (const [componentIndex, component] of components.entries()) {
    const structure = component?.internal_structure;
    if (!structure) continue;
    const basePath = `/components/${componentIndex}/internal_structure`;
    const sourceById = new Map();
    for (const [sourceIndex, source] of structure.sources.entries()) {
      sourceCount += 1;
      if (sourceById.has(source.id)) diagnostics.push(structureDiagnostic('duplicate-source-id', `Source id ${JSON.stringify(source.id)} is duplicated in the internal structure for component ${component.id}.`, component, `${basePath}/sources/${sourceIndex}/id`, { sourceId: source.id }, ['give every source in this internal_structure a unique id']));
      else sourceById.set(source.id, source);
    }
    const itemIds = new Set();
    const itemById = new Map();
    for (const [itemIndex, item] of structure.items.entries()) {
      itemCount += 1;
      const itemPath = `${basePath}/items/${itemIndex}`;
      if (itemIds.has(item.id)) diagnostics.push(structureDiagnostic('duplicate-item-id', `Internal structure item id ${JSON.stringify(item.id)} is duplicated in component ${component.id}.`, component, `${itemPath}/id`, { itemId: item.id }, ['give every internal structure item a unique id']));
      else {
        itemIds.add(item.id);
        itemById.set(item.id, { item, itemIndex });
      }
    }

    function checkRefs(refs, path, relationKind) {
      const seen = new Set();
      const roles = [];
      (refs || []).forEach((sourceId, refIndex) => {
        if (seen.has(sourceId)) {
          diagnostics.push(structureDiagnostic('duplicate-source-ref', `Source ref ${JSON.stringify(sourceId)} is repeated.`, component, `${path}/${refIndex}`, { sourceId }, ['keep each source ref once per item or relation']));
          return;
        }
        seen.add(sourceId);
        const source = sourceById.get(sourceId);
        if (!source) {
          diagnostics.push(structureDiagnostic('unknown-source-ref', `Source ref ${JSON.stringify(sourceId)} does not resolve inside component ${component.id}.`, component, `${path}/${refIndex}`, { sourceId, available: [...sourceById.keys()] }, ['reference a source id declared in this internal_structure']));
          return;
        }
        roles.push(source.role);
      });
      if (['calls', 'reads', 'writes', 'creates'].includes(relationKind) && roles.length &&
          !roles.some((role) => STRUCTURE_RELATION_EVIDENCE_ROLES.has(role))) {
        diagnostics.push(structureDiagnostic('relation-evidence', `Relation ${JSON.stringify(relationKind)} is not supported by its source roles.`, component, path, { kind: relationKind, roles }, ['reference a callsite, definition, guard, schema, or test source']));
      }
    }

    for (const [itemIndex, item] of structure.items.entries()) {
      const itemPath = `${basePath}/items/${itemIndex}`;
      if (item.parent !== undefined) {
        const parent = itemById.get(item.parent)?.item;
        if (!parent) diagnostics.push(structureDiagnostic('unknown-parent', `Parent ${JSON.stringify(item.parent)} does not resolve inside component ${component.id}.`, component, `${itemPath}/parent`, { parent: item.parent }, ['reference an item in this internal_structure']));
        else if (parent.domain !== item.domain) diagnostics.push(structureDiagnostic('cross-domain-parent', 'Internal structure parent and child must use the same domain.', component, `${itemPath}/parent`, { parent: parent.id, parentDomain: parent.domain, domain: item.domain }, ['move the item under a parent in the same domain']));
      }
      const container = item.kind === 'directory' || item.kind === 'group';
      if (!container && (!Array.isArray(item.source_refs) || !item.source_refs.length)) diagnostics.push(structureDiagnostic('source-required', `Internal structure item ${JSON.stringify(item.id)} requires source_refs.`, component, `${itemPath}/source_refs`, { itemId: item.id }, ['add one to three local source references']));
      checkRefs(item.source_refs, `${itemPath}/source_refs`);
    }

    for (const [itemIndex, item] of structure.items.entries()) {
      const seen = new Set([item.id]);
      let cursor = item;
      let depth = 0;
      let cycle = false;
      while (cursor.parent !== undefined) {
        if (seen.has(cursor.parent)) {
          diagnostics.push(structureDiagnostic('parent-cycle', `Internal structure item ${JSON.stringify(item.id)} participates in a parent cycle.`, component, `${basePath}/items/${itemIndex}/parent`, { itemId: item.id, parent: cursor.parent }, ['remove the parent cycle']));
          cycle = true;
          break;
        }
        seen.add(cursor.parent);
        depth += 1;
        const parent = itemById.get(cursor.parent)?.item;
        if (!parent || parent.domain !== item.domain) break;
        cursor = parent;
      }
      if (!cycle && depth > 8) diagnostics.push(structureDiagnostic('tree-depth', `Internal structure item ${JSON.stringify(item.id)} exceeds depth 8.`, component, `${basePath}/items/${itemIndex}/parent`, { itemId: item.id, depth }, ['flatten the structure tree to eight levels or fewer']));
    }

    for (const domain of ['code', 'state']) {
      const domainItems = structure.items.filter((item) => item.domain === domain);
      if (domainItems.length && !domainItems.some((item) => item.parent === undefined)) diagnostics.push(structureDiagnostic('root-required', `Internal structure domain ${domain} requires at least one root.`, component, `${basePath}/items`, { domain }, ['remove a parent from at least one item in this domain']));
    }

    const relationIds = new Set();
    for (const [relationIndex, relation] of structure.relations.entries()) {
      relationCount += 1;
      const relationPath = `${basePath}/relations/${relationIndex}`;
      if (relationIds.has(relation.id)) diagnostics.push(structureDiagnostic('duplicate-relation-id', `Internal structure relation id ${JSON.stringify(relation.id)} is duplicated.`, component, `${relationPath}/id`, { relationId: relation.id }, ['give every relation a unique id']));
      relationIds.add(relation.id);
      for (const endpoint of ['from', 'to']) {
        if (!itemById.has(relation[endpoint])) diagnostics.push(structureDiagnostic('unknown-relation-endpoint', `Relation ${JSON.stringify(relation.id)} has unknown ${endpoint} item ${JSON.stringify(relation[endpoint])}.`, component, `${relationPath}/${endpoint}`, { relationId: relation.id, endpoint: relation[endpoint] }, ['reference an item in this internal_structure']));
      }
      const from = itemById.get(relation.from)?.item;
      const to = itemById.get(relation.to)?.item;
      if (from && to) {
        const validDomains = ['reads', 'writes'].includes(relation.kind)
          ? from.domain === 'code' && to.domain === 'state'
          : from.domain === 'code' && to.domain === 'code';
        if (!validDomains) diagnostics.push(structureDiagnostic('relation-domain', `Relation ${JSON.stringify(relation.id)} kind ${JSON.stringify(relation.kind)} has invalid ${from.domain} → ${to.domain} endpoints.`, component, `${relationPath}/kind`, { relationId: relation.id, kind: relation.kind, fromDomain: from.domain, toDomain: to.domain }, ['use reads or writes for code-to-state relations; keep other relations between code items']));
      }
      checkRefs(relation.source_refs, `${relationPath}/source_refs`, relation.kind);
    }

    const compiled = compiledStructure(structure);
    const nodeBytes = Buffer.byteLength(serializeScriptJson(compiled));
    if (nodeBytes > INTERNAL_STRUCTURE_NODE_BYTES) diagnostics.push(structureDiagnostic('node-budget', `Internal structure for component ${component.id} is ${nodeBytes} bytes; the limit is ${INTERNAL_STRUCTURE_NODE_BYTES}.`, component, basePath, { bytes: nodeBytes, limit: INTERNAL_STRUCTURE_NODE_BYTES }, ['remove lower-value structure items or evidence until the safe serialized structure fits']));
    nodes[component.id] = compiled;
  }

  const data = { schemaVersion: 1, nodes };
  const encoded = serializeChunkedScriptJson(data);
  const bytes = Buffer.byteLength(encoded);
  if (bytes > INTERNAL_STRUCTURE_MEMBER_BYTES) {
    const contributor = findInternalStructureBudgetContributor(components, nodes, { limit: INTERNAL_STRUCTURE_MEMBER_BYTES });
    const component = contributor?.component || withStructure.at(-1);
    const componentIndex = contributor?.componentIndex ?? components.indexOf(component);
    diagnostics.push(structureDiagnostic('member-budget', `Architecture internal structure payload is ${bytes} bytes; the limit is ${INTERNAL_STRUCTURE_MEMBER_BYTES}.`, component, `/components/${componentIndex}/internal_structure`, { bytes, limit: INTERNAL_STRUCTURE_MEMBER_BYTES }, ['reduce internal structure content until the emitted payload fits']));
  }
  if (diagnostics.length) throwDiagnosticError(`Internal structure validation failed:\n${diagnostics.map((item) => `- ${item.message}`).join('\n')}`, diagnostics);
  return {
    data,
    encoded,
    receipt: {
      schemaVersion: 1,
      nodeCount: withStructure.length,
      itemCount,
      relationCount,
      sourceCount,
      bytes,
      sha256: createHash('sha256').update(encoded).digest('hex'),
    },
  };
}

// Common CLI head: node render-<type>.mjs [input.json] [output.html]
// Keep this synchronous because callers also use it to establish the guarded
// output path before testing a last-moment filesystem alias change.
export function loadDiagram({ rendererDir, diagramType, defaultExample, argv = process.argv }) {
  const skillRoot = path.resolve(rendererDir, '../..');
  const inputPath = path.resolve(argv[2] || path.join(skillRoot, 'examples', defaultExample));
  const diagram = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  validateSchema(diagramType, diagram);
  validateGuidedViews(diagramType, diagram);
  validateRelationshipIds(diagramType, diagram);
  validateEngineeringProfile(diagramType, diagram);
  const internalStructure = compileInternalStructures(diagramType, diagram);
  const sourceEvidence = verifyRepositoryEvidence(diagramType, diagram, process.env.ARCHIFY_REPO_ROOT);
  const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  const outputRequest = {
    requestedOutput: argv[3],
    authoredOutput: diagram.meta?.output,
    defaultOutput: `${diagramType}.html`,
    inputPaths: [inputPath],
    cwd: process.cwd(),
  };
  const { outputPath: outPath } = resolveOutputPath(outputRequest);
  outputPathGuards.set(outPath, outputRequest);
  return { diagram, template, outPath, sourceEvidence, internalStructure };
}

// Brand URL capture is the only asynchronous authoring step. Typed renderers
// opt into it through this wrapper without changing loadDiagram's long-lived
// synchronous safety contract.
export async function loadDiagramWithBrandMarks(options) {
  const loaded = loadDiagram(options);
  await prepareDiagramBrandMarks(options.diagramType, loaded.diagram);
  return loaded;
}

const START_TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);

// Common CLI tail: fill the template and write the standalone HTML file.
export function writeDiagram({ outPath, template, diagramType, meta, svg, cards, sourceEvidence = null, internalStructure = null }) {
  if (!START_TYPES.has(diagramType)) throw new Error(`writeDiagram: unknown diagram type ${JSON.stringify(diagramType)}`);
  const outputGuard = outputPathGuards.get(outPath);
  if (outputGuard) resolveOutputPath(outputGuard);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, applyTemplate(template, {
    title: meta.title,
    subtitle: meta.subtitle,
    svg,
    cards: renderCards(cards),
    locale: meta.locale,
    visualPreset: meta.visual_preset || 'classic',
    guidedViews: meta.views || [],
    sourceEvidence,
    internalStructure,
  }));
  outputPathGuards.delete(outPath);
  console.log(outPath);
}

const SEMANTIC_COLLECTIONS = {
  architecture: 'components',
  workflow: 'nodes',
  sequence: 'participants',
  dataflow: 'nodes',
  lifecycle: 'states',
};

const RELATIONSHIP_COLLECTIONS = {
  architecture: 'connections',
  workflow: 'edges',
  sequence: 'messages',
  dataflow: 'flows',
  lifecycle: 'transitions',
};

// Relationship IDs are optional for backwards compatibility, but once an
// author supplies one it becomes the durable identity used by viewer links.
// Keep uniqueness enforcement in the shared zero-install path so every typed
// renderer fails the same way even when development dependencies are absent.
export function validateRelationshipIds(diagramType, diagram) {
  const collection = RELATIONSHIP_COLLECTIONS[diagramType];
  const relationships = collection && Array.isArray(diagram[collection]) ? diagram[collection] : [];
  const seen = new Set();
  const problems = [];

  relationships.forEach((relationship, index) => {
    if (relationship.id === undefined || relationship.id === null || relationship.id === '') return;
    if (seen.has(relationship.id)) {
      problems.push(`/${collection}/${index}/id duplicates relationship id ${JSON.stringify(relationship.id)}`);
    }
    seen.add(relationship.id);
  });

  if (problems.length) {
    throwDiagnosticProblems('Relationship identity validation failed', problems, {
      code: 'relationship/duplicate-id',
      subject: { diagramType, collection },
    });
  }
}

// JSON Schema keeps the view object bounded; this pass checks facts that span
// collections. Keeping it here makes the same contract apply to all five
// renderers, including the zero-install standalone-validator path.
export function validateGuidedViews(diagramType, diagram) {
  const views = diagram.meta?.views;
  if (!Array.isArray(views) || views.length === 0) return;
  const collection = SEMANTIC_COLLECTIONS[diagramType];
  const semanticIds = new Set((diagram[collection] || []).map((item) => item.id));
  const seen = new Set();
  const problems = [];

  views.forEach((view, index) => {
    if (seen.has(view.id)) problems.push(`/meta/views/${index}/id duplicates view id ${JSON.stringify(view.id)}`);
    seen.add(view.id);
    const seenFocus = new Set();
    (view.focus || []).forEach((id, focusIndex) => {
      if (seenFocus.has(id)) {
        problems.push(`/meta/views/${index}/focus/${focusIndex} duplicates semantic id ${JSON.stringify(id)}`);
      }
      seenFocus.add(id);
      if (!semanticIds.has(id)) {
        problems.push(`/meta/views/${index}/focus/${focusIndex} references unknown semantic id ${JSON.stringify(id)}`);
      }
    });
  });

  if (problems.length) {
    throwDiagnosticProblems('Guided view validation failed', problems, {
      code: 'guided-view/invalid',
      subject: { diagramType, collection: 'meta.views' },
    });
  }
}

// Accessible name for the generated diagram SVG.
export function svgRootAttrs(meta, { profileIsAuthoritative = false } = {}) {
  const animation = meta.animation === 'trace' ? ' data-animation="trace"' : '';
  const preset = ` data-preset="${esc(meta.visual_preset || 'classic')}"`;
  const engineeringProfile = meta.engineering_profile
    ? ` data-engineering-profile="${esc(meta.engineering_profile)}"`
    : '';
  const requestedProfile = profileIsAuthoritative ? meta.quality_profile : process.env.ARCHIFY_QUALITY_PROFILE || meta.quality_profile;
  const qualityProfile = requestedProfile === 'showcase' ? 'showcase' : 'standard';
  const advisory = requestedProfile ? '' : ' data-quality-gates="advisory"';
  return `role="img" lang="${esc(resolveLocale(meta.locale))}" aria-labelledby="archify-diagram-title archify-diagram-description"${animation}${preset}${engineeringProfile} data-quality-profile="${esc(qualityProfile)}"${advisory}`;
}

// Keep the accessible name inside the SVG so it survives standalone SVG
// export and embedding. The fixed IDs are deterministic because an Archify
// artifact intentionally contains one primary diagram SVG.
export function svgAccessibleText(meta, kind) {
  const description = meta.subtitle || translateMessage(meta.locale, `diagram.description.${kind}`);
  return `        <title id="archify-diagram-title">${esc(meta.title)}</title>\n        <desc id="archify-diagram-description">${esc(description)}</desc>`;
}

export function animateAttr(meta, kind, step) {
  if (meta.animation !== 'trace') return '';
  // Ambient trace must finish inside the fixed six-second WebM capture. The
  // cap affects visual delay only; authored order and semantic identity stay
  // untouched in the JSON, DOM, Story, and relationship contracts.
  const safeStep = Number.isFinite(step) && step >= 0 ? Math.min(12, Math.floor(step)) : 0;
  return ` data-animate="${kind}" style="--step:${safeStep}"`;
}

// Stable semantic hooks for the standalone HTML explorer. IDs already pass
// the schema's conservative identifier pattern; escape again at the markup
// boundary so these helpers remain safe if that contract expands later.
export function focusNodeAttrs(id, label, metadata = {}, locale) {
  const optional = [
    ['data-node-kind', metadata.kind],
    ['data-node-sublabel', metadata.sublabel],
    ['data-node-tag', metadata.tag],
    ['data-node-context', metadata.context],
    ['data-node-brand', metadata.brand],
    ['data-node-brand-id', metadata.brandId],
    ['data-node-brand-status', metadata.brandStatus],
    ['data-node-brand-source', metadata.brandSource],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([name, value]) => ` ${name}="${esc(String(value))}"`)
    .join('');
  const detail = [metadata.sublabel, metadata.context, metadata.brand]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .join(', ');
  const aria = detail
    ? translateMessage(locale, 'node.focus.detail', { label, detail })
    : translateMessage(locale, 'node.focus', { label });
  return `id="node-${esc(id)}" data-node-id="${esc(id)}" data-node-label="${esc(label)}" tabindex="0" role="button" aria-label="${esc(aria)}" aria-pressed="false"${optional}`;
}

// Native SVG titles preserve a compact details-on-demand fallback when the
// canonical SVG is embedded inline outside the full Archify viewer.
export function focusNodeTitle(label, metadata = {}) {
  const parts = [label, metadata.sublabel, metadata.context, metadata.tag, metadata.brand]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return `<title>${esc(parts.join(' · '))}</title>`;
}

export function focusEdgeAttrs(from, to, label, key, id) {
  const named = label ? ` data-edge-label="${esc(label)}"` : '';
  const keyed = key !== undefined && key !== null ? ` data-edge-key="${esc(String(key))}"` : '';
  const identified = id !== undefined && id !== null && String(id).trim() !== ''
    ? ` data-edge-id="${esc(String(id))}"`
    : '';
  return `data-edge-from="${esc(from)}" data-edge-to="${esc(to)}"${named}${keyed}${identified}`;
}
