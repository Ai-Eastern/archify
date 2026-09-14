import { serializeScriptJson } from './utils.mjs';

// Encoding is a delivery concern. This module's reader below is also embedded
// verbatim in the browser shell, and has no Node or module dependencies.
const encoder = new TextEncoder();
function chunks(value) {
  if (encoder.encode(serializeScriptJson(value)).length <= 8000) return [value];
  let middle = Math.floor(value.length / 2);
  if (/^[\uDC00-\uDFFF]$/.test(value[middle]) && /^[\uD800-\uDBFF]$/.test(value[middle - 1])) middle--;
  return [...chunks(value.slice(0, middle)), ...chunks(value.slice(middle))];
}

export function packAtlasBundle(bundle) {
  const resources = [], documents = Object.create(null), members = Object.create(null);
  const indices = new Map();
  for (const [id, member] of Object.entries(bundle.members)) {
    const { html, ...metadata } = member;
    members[id] = metadata;
    const parts = []; let offset = 0;
    for (const match of html.matchAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)) {
      // Member JSON data keeps its original ownership. Share executable code
      // and style blocks, using exact string equality (not names or lengths).
      const tag = match[0].slice(0, match[0].indexOf('>') + 1);
      if (/\btype\s*=\s*["']application\/json["']/i.test(tag)) continue;
      parts.push(...chunks(html.slice(offset, match.index)));
      let index = indices.get(match[0]);
      if (index === undefined) {
        index = resources.length; indices.set(match[0], index);
        resources.push(chunks(match[0]));
      }
      parts.push(index); offset = match.index + match[0].length;
    }
    parts.push(...chunks(html.slice(offset))); documents[id] = parts;
  }
  // Chunk metadata too: otherwise an allowed long title/source label can
  // recreate a giant JSON line outside the member HTML fields.
  return { bundle_version: 2, metadata: chunks(JSON.stringify({ ...bundle, members })), resources, documents };
}

export function readAtlasBundle(payload) {
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const strings = value => Array.isArray(value) && value.length > 0 && value.every(part => typeof part === 'string');
  function invalid(message, path = '') {
    const error = new Error(message);
    error.atlasBundleCode = 'bundle-data'; error.atlasBundleEvidence = { path };
    throw error;
  }
  const visitedMetadata = new WeakSet();
  function rejectGuideBodyMetadata(value, path) {
    if (!value || typeof value !== 'object') return;
    if (visitedMetadata.has(value)) return;
    visitedMetadata.add(value);
    if (record(value?.nodes) && Object.values(value.nodes).some(node =>
      record(node) && record(node.summary) && Array.isArray(node.sections))) {
      invalid('Developer guide bodies belong only to member documents.', path);
    }
    for (const [key, nested] of Object.entries(value)) {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (/guide(?:body|data|payload|copy|content|document|nodes?)$/.test(normalized)) {
        invalid('Developer guide bodies belong only to member documents.', `${path}.${key}`);
      }
      rejectGuideBodyMetadata(nested, `${path}.${key}`);
    }
  }
  if (!record(payload) || ![1, 2].includes(payload.bundle_version)) invalid('Unsupported Atlas bundle version.', 'bundle_version');
  let bundle = payload;
  if (payload.bundle_version === 2) {
    if (!strings(payload.metadata)) invalid('Invalid Atlas metadata chunks.', 'metadata');
    try { bundle = JSON.parse(payload.metadata.join('')); }
    catch { invalid('Atlas metadata is not valid JSON.', 'metadata'); }
    if (!Array.isArray(payload.resources)) invalid('Invalid Atlas resources.', 'resources');
    payload.resources.forEach((resource, index) => {
      if (!strings(resource)) invalid('Invalid Atlas resource chunks.', `resources[${index}]`);
    });
    if (!record(payload.documents)) invalid('Invalid Atlas document inventory.', 'documents');
  }
  if (!record(bundle) || bundle.bundle_version !== 1 || !record(bundle.meta) || !record(bundle.members) ||
      !Array.isArray(bundle.diagramIds) || !bundle.diagramIds.length || new Set(bundle.diagramIds).size !== bundle.diagramIds.length ||
      !bundle.diagramIds.includes(bundle.entry) || Object.keys(bundle.members).length !== bundle.diagramIds.length ||
      !Array.isArray(bundle.details) || !Array.isArray(bundle.references)) invalid('Atlas member inventory is invalid.', 'members');
  if (Object.keys(bundle).some(key => !['bundle_version', 'entry', 'meta', 'diagramIds', 'details', 'references', 'members'].includes(key))) invalid('Unexpected Atlas metadata; guide bodies belong only to member documents.', 'metadata');
  rejectGuideBodyMetadata(bundle.meta, 'meta');
  if (payload.bundle_version === 2 && Object.keys(payload.documents).length !== bundle.diagramIds.length) invalid('Atlas document inventory is invalid.', 'documents');
  let guideBytes = 0;
  for (const id of bundle.diagramIds) {
    if (typeof id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id) ||
        !Object.hasOwn(bundle.members, id) || !record(bundle.members[id])) invalid('Atlas member inventory is invalid.', `members.${id}`);
    const member = bundle.members[id];
    if (Object.keys(member).some(key => !['title', 'nodes', 'relations', 'views', 'parentContext', 'html', 'check', 'receipts', 'evidence', 'guideNodes'].includes(key))) invalid('Unexpected member metadata; guide bodies belong only to its document.', `members.${id}`);
    if (typeof member.title !== 'string' || !['nodes', 'relations', 'views', 'parentContext'].every(key => Array.isArray(member[key]))) invalid('Invalid Atlas member navigation metadata.', `members.${id}`);
    for (const key of ['check', 'receipts', 'evidence', 'parentContext']) {
      rejectGuideBodyMetadata(member[key], `members.${id}.${key}`);
    }
    const guides = member.guideNodes;
    if (guides !== undefined && (!record(guides) || Object.entries(guides).some(([node, sections]) => !member.nodes.includes(node) ||
        !Array.isArray(sections) || !sections.length || new Set(sections).size !== sections.length ||
        sections.some(kind => !['flow', 'interfaces', 'state', 'constraints', 'change_points'].includes(kind))))) invalid('Invalid developer guide node inventory.', `members.${id}.guideNodes`);
    const nodeCount = Object.keys(guides || {}).length;
    const receipt = member.receipts?.developerGuide;
    if (nodeCount) {
      if (!record(receipt) || Object.keys(receipt).length !== 5 || receipt.schemaVersion !== 1 || receipt.nodeCount !== nodeCount ||
          !Number.isSafeInteger(receipt.itemCount) || receipt.itemCount < Object.values(guides).reduce((count, sections) => count + sections.length, 0) ||
          !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0 || receipt.bytes > 64 * 1024 || !/^[a-f0-9]{64}$/.test(receipt.sha256 || '')) invalid('Invalid developer guide receipt.', `members.${id}.receipts.developerGuide`);
      guideBytes += receipt.bytes;
      if (guideBytes > 128 * 1024) invalid('Atlas developer guide payload exceeds 131072 bytes.', `members.${id}.receipts.developerGuide.bytes`);
    } else if (receipt !== undefined) invalid('Developer guide receipt has no matching guide nodes.', `members.${id}.receipts.developerGuide`);
    if (payload.bundle_version === 1) {
      if (typeof bundle.members[id].html !== 'string') invalid('Missing Atlas member HTML.', `members.${id}.html`);
    } else {
      const parts = payload.documents[id];
      if (Object.hasOwn(bundle.members[id], 'html') || !Object.hasOwn(payload.documents, id) || !Array.isArray(parts) || !parts.length) invalid('Invalid Atlas document parts.', `documents.${id}`);
      parts.forEach((part, index) => {
        if (typeof part !== 'string' && (!Number.isSafeInteger(part) || part < 0 || part >= payload.resources.length)) invalid('Invalid Atlas resource reference.', `documents.${id}[${index}]`);
      });
    }
  }
  return {
    bundle,
    memberHtml(id) {
      if (!Object.hasOwn(bundle.members, id)) invalid('Unknown Atlas member.', `members.${id}`);
      if (payload.bundle_version === 1) return bundle.members[id].html;
      return payload.documents[id].map(part => typeof part === 'string' ? part : payload.resources[part].join('')).join('');
    },
  };
}
