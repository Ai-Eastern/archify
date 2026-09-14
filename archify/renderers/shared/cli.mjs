import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  applyTemplate,
  DEVELOPER_GUIDE_MEMBER_BYTES,
  DEVELOPER_GUIDE_NODE_BYTES,
  findDeveloperGuideBudgetContributor,
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
const GUIDE_DIRECTIONS = {
  provided: new Set(['export', 'registration']),
  required: new Set(['callsite', 'registration']),
  observed: new Set(['callsite', 'registration']),
};

function guideDiagnostic(code, message, component, path, evidence, supportedFixes) {
  return {
    code: `developer-guide/${code}`,
    severity: 'error',
    message,
    subject: { diagramType: 'architecture', componentId: component.id, path },
    evidence,
    supportedFixes,
  };
}

function compiledGuide(guide) {
  return {
    implementationScope: guide.implementation_scope,
    summary: { text: guide.summary.text, sourceRefs: [...guide.summary.source_refs] },
    sections: guide.sections.map((section) => ({
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

export function compileDeveloperGuides(diagramType, diagram) {
  if (diagramType !== 'architecture') return null;
  const components = Array.isArray(diagram?.components) ? diagram.components : [];
  const withGuide = components.filter((component) => component?.developer_guide);
  const diagnostics = [];
  const nodes = Object.create(null);
  let itemCount = 0;
  const sourceOwners = new Map();
  const sourceMaps = new Map();
  const componentIds = new Set();

  for (const [componentIndex, component] of components.entries()) {
    if (componentIds.has(component.id)) {
      diagnostics.push(guideDiagnostic('duplicate-component-id', `Component id ${JSON.stringify(component.id)} is duplicated and cannot index developer guide data safely.`, component, `/components/${componentIndex}/id`, { componentId: component.id }, ['give every architecture component a unique id']));
    }
    componentIds.add(component.id);
    const sourceById = new Map();
    for (const [sourceIndex, source] of (component?.sources || []).entries()) {
      if (!source?.id) continue;
      if (sourceById.has(source.id)) {
        diagnostics.push(guideDiagnostic('duplicate-source-id', `Source id ${JSON.stringify(source.id)} is duplicated in component ${component.id}.`, component, `/components/${componentIndex}/sources/${sourceIndex}/id`, { sourceId: source.id }, ['give every source in this component a unique id']));
      } else sourceById.set(source.id, source);
      const owners = sourceOwners.get(source.id) || new Set();
      owners.add(component.id);
      sourceOwners.set(source.id, owners);
    }
    sourceMaps.set(component, sourceById);
  }

  if (!withGuide.length) {
    if (diagnostics.length) throwDiagnosticError(`Developer guide validation failed:\n${diagnostics.map((item) => `- ${item.message}`).join('\n')}`, diagnostics);
    return null;
  }

  if (!diagram.meta?.repository) {
    diagnostics.push(guideDiagnostic('repository-required', 'Developer guides require /meta/repository pinned to one source revision.', withGuide[0], '/meta/repository', {}, ['add pinned repository metadata or remove developer_guide']));
  }

  for (const [componentIndex, component] of components.entries()) {
    const guide = component?.developer_guide;
    if (!guide) continue;
    const componentPath = `/components/${componentIndex}`;
    const sources = Array.isArray(component.sources) ? component.sources : [];
    const sourceById = sourceMaps.get(component);

    const sectionKinds = new Set();
    const itemIds = new Set();
    function checkRefs(refs, path, direction) {
      const seen = new Set();
      const resolved = [];
      let referencesValid = true;
      refs.forEach((sourceId, refIndex) => {
        if (seen.has(sourceId)) {
          referencesValid = false;
          diagnostics.push(guideDiagnostic('duplicate-source-ref', `Source ref ${JSON.stringify(sourceId)} is repeated.`, component, `${path}/${refIndex}`, { sourceId }, ['keep each source ref once per guide item']));
          return;
        }
        seen.add(sourceId);
        const source = sourceById.get(sourceId);
        if (!source) {
          referencesValid = false;
          const otherOwners = [...(sourceOwners.get(sourceId) || [])].filter((owner) => owner !== component.id);
          diagnostics.push(guideDiagnostic(
            otherOwners.length ? 'cross-node-source-ref' : 'unknown-source-ref',
            otherOwners.length
              ? `Source ref ${JSON.stringify(sourceId)} belongs to another component and cannot support ${component.id}.`
              : `Source ref ${JSON.stringify(sourceId)} does not resolve inside component ${component.id}.`,
            component,
            `${path}/${refIndex}`,
            { sourceId, available: [...sourceById.keys()], ...(otherOwners.length ? { otherOwners } : {}) },
            ['reference a source id declared on the same component'],
          ));
          return;
        }
        if (!source.role) {
          referencesValid = false;
          diagnostics.push(guideDiagnostic('source-role-required', `Referenced source ${JSON.stringify(sourceId)} requires a role.`, component, `${componentPath}/sources/${sources.indexOf(source)}/role`, { sourceId }, ['add the source role required by the guide fact']));
          return;
        }
        resolved.push({ id: sourceId, role: source.role });
      });
      if (!direction || !referencesValid) return;
      if (direction === 'bidirectional') {
        const supported = resolved.some((provided) => (
          GUIDE_DIRECTIONS.provided.has(provided.role)
          && resolved.some((required) => (
            required.id !== provided.id && GUIDE_DIRECTIONS.required.has(required.role)
          ))
        ));
        if (!supported) diagnostics.push(guideDiagnostic('direction-evidence', 'A bidirectional interface requires distinct provided and required/observed source evidence.', component, path.replace(/\/source_refs$/, '/direction'), { direction, roles: resolved.map((source) => source.role) }, ['reference one export or registration source and one distinct callsite or registration source']));
      } else if (!resolved.some((source) => GUIDE_DIRECTIONS[direction]?.has(source.role))) {
        diagnostics.push(guideDiagnostic('direction-evidence', `Interface direction ${JSON.stringify(direction)} is not supported by its source roles.`, component, path.replace(/\/source_refs$/, '/direction'), { direction, roles: resolved.map((source) => source.role) }, [direction === 'provided' ? 'reference an export or registration source' : 'reference a callsite or registration source']));
      }
    }

    checkRefs(guide.summary.source_refs, `${componentPath}/developer_guide/summary/source_refs`);
    guide.sections.forEach((section, sectionIndex) => {
      const sectionPath = `${componentPath}/developer_guide/sections/${sectionIndex}`;
      if (sectionKinds.has(section.kind)) diagnostics.push(guideDiagnostic('duplicate-section', `Section ${JSON.stringify(section.kind)} is duplicated.`, component, `${sectionPath}/kind`, { kind: section.kind }, ['keep at most one section of each fixed kind']));
      sectionKinds.add(section.kind);
      section.items.forEach((item, itemIndex) => {
        itemCount += 1;
        const itemPath = `${sectionPath}/items/${itemIndex}`;
        if (itemIds.has(item.id)) diagnostics.push(guideDiagnostic('duplicate-item-id', `Guide item id ${JSON.stringify(item.id)} is duplicated in component ${component.id}.`, component, `${itemPath}/id`, { itemId: item.id }, ['give every guide item in this component a unique id']));
        itemIds.add(item.id);
        checkRefs(item.source_refs, `${itemPath}/source_refs`, section.kind === 'interfaces' ? item.direction : null);
      });
    });

    const compiled = compiledGuide(guide);
    const nodeBytes = Buffer.byteLength(serializeScriptJson(compiled));
    if (nodeBytes > DEVELOPER_GUIDE_NODE_BYTES) diagnostics.push(guideDiagnostic('node-budget', `Developer guide for component ${component.id} is ${nodeBytes} bytes; the limit is ${DEVELOPER_GUIDE_NODE_BYTES}.`, component, `${componentPath}/developer_guide`, { bytes: nodeBytes, limit: DEVELOPER_GUIDE_NODE_BYTES }, ['remove lower-value guide text or items until the safe serialized guide fits']));
    nodes[component.id] = compiled;
  }

  const data = { schemaVersion: 1, nodes };
  const encoded = serializeChunkedScriptJson(data);
  const bytes = Buffer.byteLength(encoded);
  if (bytes > DEVELOPER_GUIDE_MEMBER_BYTES) {
    const contributor = findDeveloperGuideBudgetContributor(components, nodes, {
      limit: DEVELOPER_GUIDE_MEMBER_BYTES,
    });
    const component = contributor?.component || withGuide.at(-1);
    const componentIndex = contributor?.componentIndex ?? components.indexOf(component);
    diagnostics.push(guideDiagnostic('member-budget', `Architecture developer guide payload is ${bytes} bytes; the limit is ${DEVELOPER_GUIDE_MEMBER_BYTES}.`, component, `/components/${componentIndex}/developer_guide`, { bytes, limit: DEVELOPER_GUIDE_MEMBER_BYTES }, ['reduce the member developer guides until the emitted payload fits']));
  }
  if (diagnostics.length) throwDiagnosticError(`Developer guide validation failed:\n${diagnostics.map((item) => `- ${item.message}`).join('\n')}`, diagnostics);
  return {
    data,
    encoded,
    receipt: {
      schemaVersion: 1,
      nodeCount: withGuide.length,
      itemCount,
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
  const developerGuide = compileDeveloperGuides(diagramType, diagram);
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
  return { diagram, template, outPath, sourceEvidence, developerGuide };
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
export function writeDiagram({ outPath, template, diagramType, meta, svg, cards, sourceEvidence = null, developerGuide = null }) {
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
    developerGuide,
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
