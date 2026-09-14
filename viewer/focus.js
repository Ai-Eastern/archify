    /* ============================================================
       Explore — stable-ID neighborhood focus + dependency-free pan/zoom.
       Renderer IDs become deep-linkable semantic hooks without turning the
       standalone artifact into a canvas editor.
       ============================================================ */
    function fallbackCopy(value) {
      var field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (_) {}
      field.remove();
      return copied;
    }

    Archify.developerGuide = (function () {
      var html = document.documentElement;
      var payload = readPayload();
      var diagram = document.querySelector('.diagram-container');
      var guided = document.querySelector('.guided-views');
      var cards = document.querySelector('.cards');
      var chip = document.getElementById('focus-chip');
      var detail = document.getElementById('focus-detail');
      var quicklook = null;
      var guideRoot = null;
      var guideContext = null;
      var guideActions = null;
      var guideBody = null;
      var guideTitle = null;
      var guideSummary = null;
      var guideScope = null;
      var guideToc = null;
      var guideSections = null;
      var guideFeedback = null;
      var guideCopy = null;
      var guideRelations = null;
      var guideSourcesAction = null;
      var currentSurface = 'graph';
      var currentNodeId = null;
      var currentSection = null;
      var graphState = null;
      var graphScrollY = 0;
      var chipOrigin = null;
      var surfaceRevision = 0;
      var surfaceReady = Promise.resolve(true);
      var pendingOpen = null;
      var pendingGraphInformation = null;
      var standaloneSaveFrame = null;
      var standaloneSyncRevision = 0;
      var connected = false;
      var sectionKinds = ['flow', 'interfaces', 'state', 'constraints', 'change_points'];

      function readPayload() {
        var data = document.getElementById('archify-developer-guide-data');
        if (!data) return null;
        try {
          var chunks = JSON.parse(data.textContent || 'null');
          var parsed = Array.isArray(chunks) ? JSON.parse(chunks.join('')) : chunks;
          if (!parsed || parsed.schemaVersion !== 1 || !parsed.nodes ||
              typeof parsed.nodes !== 'object' || Array.isArray(parsed.nodes)) return null;
          return parsed;
        } catch (_) { return null; }
      }

      function own(object, key) {
        return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
      }

      function node(id) {
        if (typeof id !== 'string' || !payload || !own(payload.nodes, id)) return null;
        var value = payload.nodes[id];
        return value && typeof value === 'object' ? value : null;
      }

      function guideNodes() {
        return payload ? Object.keys(payload.nodes) : [];
      }

      function textElement(name, className, parent, value) {
        var element = document.createElement(name);
        if (className) element.className = className;
        if (value != null) element.textContent = String(value);
        if (parent) parent.appendChild(element);
        return element;
      }

      function labelFor(id) {
        var match = null;
        Array.prototype.some.call(document.querySelectorAll('[data-node-id]'), function (candidate) {
          if (candidate.getAttribute('data-node-id') !== id) return false;
          match = candidate;
          return true;
        });
        if (!match) return id || viewerText('viewer.developerGuide.overview');
        return match.getAttribute('data-node-label') ||
          (match.getAttribute('aria-label') || id).replace(/^Focus\s+/, '');
      }

      function diagramHasNode(id) {
        var found = false;
        Array.prototype.some.call(document.querySelectorAll('[data-node-id]'), function (candidate) {
          if (candidate.getAttribute('data-node-id') !== id) return false;
          found = true;
          return true;
        });
        return found;
      }

      function sectionLabel(kind) {
        var suffix = kind === 'change_points' ? 'changePoints' : kind;
        return viewerText('viewer.developerGuide.section.' + suffix);
      }

      function scopeLabel(scope) {
        return viewerText('viewer.developerGuide.implementationScope.' + scope);
      }

      function directionLabel(direction) {
        return viewerText('viewer.developerGuide.direction.' + direction);
      }

      function sourceFor(id, reference) {
        var sources = Archify.sourceEvidence && typeof Archify.sourceEvidence.node === 'function'
          ? Archify.sourceEvidence.node(id) : [];
        for (var index = 0; index < sources.length; index += 1) {
          if (sources[index] && sources[index].id === reference) return sources[index];
        }
        return null;
      }

      function sourceLocation(source) {
        if (!source) return '';
        var range = source.line
          ? ':L' + source.line + (source.endLine && source.endLine !== source.line ? '-L' + source.endLine : '')
          : '';
        var location = (source.path || source.label || '') + range;
        return source.symbol ? location + ' · ' + source.symbol : location;
      }

      function activateSource(id, reference) {
        var sourceTab = document.getElementById('atlas-tab-sources');
        if (sourceTab && typeof sourceTab.click === 'function') sourceTab.click();
        var target = null;
        Array.prototype.some.call(document.querySelectorAll('[data-source-id]'), function (candidate) {
          if (candidate.getAttribute('data-source-id') !== reference) return false;
          target = candidate;
          return true;
        });
        if (!target) return false;
        if (!target.hasAttribute('tabindex') && target.tagName !== 'A') target.tabIndex = -1;
        target.scrollIntoView({ block: 'nearest' });
        try { target.focus({ preventScroll: true }); }
        catch (_) { try { target.focus(); } catch (_) {} }
        return true;
      }

      function appendSourceAction(parent, id, reference) {
        var source = sourceFor(id, reference);
        if (!source) return null;
        var roleLabel = source.role
          ? viewerText('viewer.developerGuide.sourceRole.' + source.role)
          : viewerText('viewer.developerGuide.evidenceLink');
        var label = roleLabel + ' · ' + sourceLocation(source);
        var action;
        if (source.href) {
          action = textElement('a', 'node-guide-source', parent, label);
          action.href = source.href;
          action.target = '_blank';
          action.rel = 'noopener noreferrer';
          action.referrerPolicy = 'no-referrer';
        } else {
          action = textElement('button', 'node-guide-source', parent, label);
          action.type = 'button';
          action.addEventListener('click', function () { activateSource(id, reference); });
        }
        action.setAttribute('data-guide-source-ref', reference);
        return action;
      }

      function installStyles() {
        if (document.querySelector('style[data-developer-guide-style]')) return;
        var style = document.createElement('style');
        style.setAttribute('data-developer-guide-style', '');
        style.textContent = [
          '.node-quicklook[hidden],.node-quicklook-interfaces[hidden],.node-developer-guide[hidden],.node-guide-body[hidden],.node-guide-actions button[hidden]{display:none!important}',
          '.node-quicklook{display:grid;gap:.55rem;margin-top:.65rem;padding-top:.65rem;border-top:1px solid var(--toolbar-border);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
          '.node-quicklook-heading,.node-quicklook-label{margin:0;color:var(--text-muted);font-size:.58rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}',
          '.node-quicklook-scope{display:grid;gap:.18rem;margin:0}.node-quicklook-scope strong{color:var(--text);font-size:.7rem;line-height:1.45}',
          '.node-quicklook-interfaces{display:grid;gap:.42rem}.node-quicklook-list{display:grid;gap:.42rem;margin:0;padding:0;list-style:none}',
          '.node-quicklook-interface{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.12rem .42rem;padding-top:.42rem;border-top:1px solid color-mix(in srgb,var(--toolbar-border) 72%,transparent)}',
          '.node-quicklook-interface:first-child{padding-top:0;border-top:0}.node-quicklook-direction{grid-row:1/3;align-self:start;padding:.12rem .3rem;border:1px solid var(--toolbar-border);border-radius:999px;color:var(--frontend-stroke);font-size:.52rem;line-height:1.35}',
          '.node-quicklook-interface strong{min-width:0;color:var(--text);font-size:.68rem;line-height:1.4;overflow-wrap:anywhere}.node-quicklook-interface small{grid-column:2;color:var(--text-muted);font-size:.62rem;line-height:1.5;overflow-wrap:anywhere}',
          '.node-quicklook-interface .node-guide-source{grid-column:2;justify-self:start}',
          '.node-guide-open,.node-guide-actions button,.node-guide-source{border:0;background:none;color:color-mix(in srgb,var(--frontend-stroke) 80%,var(--text));font:inherit;cursor:pointer;text-align:left}',
          '.node-guide-source{user-select:text;-webkit-user-select:text}',
          '.node-guide-open{justify-self:start;min-height:2rem;padding:.25rem 0;font-size:.68rem;font-weight:700}.node-guide-feedback{min-height:0;margin:0;color:var(--security-stroke);font-size:.6rem;line-height:1.45}',
          'html[data-reader-surface="guide"] .guided-views,html[data-reader-surface="guide"] .diagram-container,html[data-reader-surface="guide"] .cards{display:none!important}',
          '.node-developer-guide{box-sizing:border-box;width:100%;max-width:var(--archify-reader-width,1440px);margin:0 auto;padding:1.5rem 0 3rem;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
          'html[data-atlas-layout="rail"] .node-developer-guide{margin-left:var(--atlas-reader-offset);margin-right:0}',
          '.node-guide-workspace{display:grid;grid-template-columns:minmax(0,22rem) minmax(0,1fr);gap:clamp(1.5rem,4vw,4rem);align-items:start;min-width:0}',
          '.node-guide-context:empty{display:none}.node-guide-context:empty+.node-guide-document{grid-column:1/-1}',
          '.node-guide-context>.focus-chip{position:sticky;top:1rem;left:auto;width:100%;max-width:none;max-height:none;overflow:visible;transform:none!important}',
          '.node-guide-context>.focus-chip .relationship-lens-list{display:none!important}',
          '.node-guide-document{width:min(100%,70rem);min-width:0;margin:0 auto}',
          '.node-guide-actions{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;align-items:center;margin-bottom:1.3rem}.node-guide-actions button{min-height:2.25rem;padding:.35rem 0;font-size:.78rem;font-weight:650}',
          '.node-guide-lead{max-width:48rem;padding-bottom:1.35rem;border-bottom:1px solid var(--toolbar-border)}',
          '.node-guide-eyebrow{margin:0 0 .35rem;color:color-mix(in srgb,var(--frontend-stroke) 80%,var(--text));font-size:.68rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}',
          '.node-guide-title{margin:0;color:var(--text);font-size:clamp(1.5rem,3vw,2.4rem);line-height:1.15;letter-spacing:-.025em;overflow-wrap:anywhere}',
          '.node-guide-summary{margin:.9rem 0 0;color:var(--text-muted);font-size:1rem;line-height:1.72;overflow-wrap:anywhere}',
          '.node-guide-scope{display:flex;flex-wrap:wrap;gap:.3rem .65rem;align-items:baseline;margin:.85rem 0 0;color:var(--text-muted);font-size:.75rem}.node-guide-scope strong{color:var(--text)}',
          '.node-guide-body{display:grid;grid-template-columns:minmax(10rem,13rem) minmax(0,46rem);gap:clamp(1.5rem,4vw,4rem);align-items:start;margin-top:1.5rem}',
          '.node-guide-toc{position:sticky;top:1rem}.node-guide-toc ol{display:grid;gap:.25rem;margin:0;padding:0;list-style:none}.node-guide-toc a{display:block;padding:.42rem .55rem;border-left:2px solid transparent;color:var(--text-muted);font-size:.76rem;line-height:1.45;text-decoration:none}.node-guide-toc a[aria-current="location"]{border-left-color:var(--frontend-stroke);color:var(--text);font-weight:700}',
          '.node-guide-sections{display:grid;gap:2.5rem;min-width:0}.node-guide-section{scroll-margin-top:1rem}.node-guide-section>h2{display:flex;align-items:center;gap:.75rem;margin:0 0 1rem;color:color-mix(in srgb,var(--frontend-stroke) 82%,var(--text));font-size:.72rem;font-weight:750;line-height:1.4;letter-spacing:.1em}.node-guide-section>h2::after{content:"";flex:1;height:1px;background:var(--toolbar-border)}',
          '.node-guide-items{display:grid;gap:1.25rem;margin:0;padding:0;list-style:none}.node-guide-item{display:grid;gap:.38rem;min-width:0;padding-top:1.05rem;border-top:1px solid var(--toolbar-border)}',
          '.node-guide-item:first-child{padding-top:0;border-top:0}.node-guide-item h3{margin:0;color:var(--text);font-size:.98rem;font-weight:680;line-height:1.45;overflow-wrap:anywhere}.node-guide-item p{margin:0;color:var(--text-muted);font-size:.84rem;line-height:1.68;overflow-wrap:anywhere}',
          '.node-guide-item code{display:block;max-width:100%;padding:.5rem .6rem;border:1px solid var(--toolbar-border);border-radius:.4rem;background:color-mix(in srgb,var(--panel) 72%,transparent);color:var(--text);font:.72rem/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}',
          '.node-guide-direction{justify-self:start;padding:.15rem .38rem;border:1px solid var(--toolbar-border);border-radius:999px;color:color-mix(in srgb,var(--frontend-stroke) 80%,var(--text));font-size:.62rem;line-height:1.35}',
          '.node-guide-sources{display:flex;flex-wrap:wrap;gap:.35rem .75rem;margin-top:.18rem}.node-guide-source{min-height:1.8rem;padding:.15rem 0;font-size:.69rem;line-height:1.45;text-decoration:none;overflow-wrap:anywhere}',
          '.node-guide-status{margin:.75rem 0 0;color:var(--security-stroke);font-size:.76rem;line-height:1.55}',
          '.node-guide-open:focus-visible,.node-guide-actions button:focus-visible,.node-guide-source:focus-visible,.node-guide-toc a:focus-visible,.node-guide-title:focus-visible,.node-guide-section>h2:focus-visible{outline:2px solid var(--frontend-stroke);outline-offset:3px}',
          '@media(max-width:1023px){.node-developer-guide{padding-top:1rem}.node-guide-workspace,.node-guide-body{grid-template-columns:minmax(0,1fr)}.node-guide-context>.focus-chip{position:static}.node-guide-toc{position:static}.node-guide-toc ol{display:flex;flex-wrap:wrap;gap:.3rem}.node-guide-toc a{border-left:0;border-bottom:2px solid transparent}.node-guide-toc a[aria-current="location"]{border-bottom-color:var(--frontend-stroke)}}',
          '@media(max-width:720px){.node-developer-guide{padding:1rem 0 2rem}.node-guide-actions button,.node-guide-open,.node-guide-source,.node-guide-toc a{min-width:44px;min-height:44px}.node-guide-source{display:inline-flex;align-items:center}.node-guide-title{font-size:1.55rem}.node-guide-summary{font-size:.92rem}.node-guide-sections{gap:2rem}}',
          '@media print{.node-developer-guide{display:none!important}}'
        ].join('');
        document.head.appendChild(style);
      }

      function ensureQuicklook() {
        if (quicklook || !detail || !payload || !guideNodes().length) return quicklook;
        installStyles();
        quicklook = textElement('section', 'node-quicklook', null);
        quicklook.id = 'focus-developer-quicklook';
        quicklook.hidden = true;
        quicklook.setAttribute('aria-labelledby', 'focus-developer-quicklook-heading');
        var heading = textElement('h3', 'node-quicklook-heading', quicklook, viewerText('viewer.developerGuide.overview'));
        heading.id = 'focus-developer-quicklook-heading';
        var scope = textElement('p', 'node-quicklook-scope', quicklook);
        textElement('span', 'node-quicklook-label', scope, viewerText('viewer.developerGuide.implementationScope'));
        var scopeValue = textElement('strong', '', scope);
        scopeValue.id = 'focus-implementation-scope';
        var interfaces = textElement('div', 'node-quicklook-interfaces', quicklook);
        interfaces.id = 'focus-interface-summary';
        var interfacesHeading = textElement('p', 'node-quicklook-label', interfaces, sectionLabel('interfaces'));
        interfacesHeading.id = 'focus-interface-heading';
        var list = textElement('ul', 'node-quicklook-list', interfaces);
        list.id = 'focus-interface-list';
        var openButton = textElement('button', 'node-guide-open', quicklook, viewerText('viewer.developerGuide.open'));
        openButton.id = 'btn-open-developer-guide';
        openButton.type = 'button';
        openButton.addEventListener('click', function () {
          var active = Archify.focus && Archify.focus.active();
          if (typeof active === 'string') open(active);
        });
        var feedback = textElement('p', 'node-guide-feedback', quicklook);
        feedback.id = 'focus-guide-feedback';
        feedback.setAttribute('role', 'status');
        detail.after(quicklook);
        return quicklook;
      }

      function clearQuicklook() {
        if (!quicklook) return;
        quicklook.hidden = true;
        var scope = document.getElementById('focus-implementation-scope');
        var list = document.getElementById('focus-interface-list');
        var interfaces = document.getElementById('focus-interface-summary');
        var feedback = document.getElementById('focus-guide-feedback');
        if (scope) scope.textContent = '';
        if (list) list.textContent = '';
        if (interfaces) interfaces.hidden = true;
        if (feedback) feedback.textContent = '';
      }

      function renderQuicklook(id) {
        var guide = node(id);
        var root = ensureQuicklook();
        if (!root || !guide) {
          clearQuicklook();
          return false;
        }
        var scope = document.getElementById('focus-implementation-scope');
        var list = document.getElementById('focus-interface-list');
        var interfaces = document.getElementById('focus-interface-summary');
        var feedback = document.getElementById('focus-guide-feedback');
        scope.textContent = scopeLabel(guide.implementationScope);
        list.textContent = '';
        var interfaceSection = (guide.sections || []).filter(function (section) {
          return section && section.kind === 'interfaces' && Array.isArray(section.items);
        })[0];
        var items = interfaceSection ? interfaceSection.items.slice(0, 3) : [];
        items.forEach(function (item) {
          var row = textElement('li', 'node-quicklook-interface', list);
          textElement('span', 'node-quicklook-direction', row, directionLabel(item.direction));
          textElement('strong', '', row, item.title);
          textElement('small', '', row, item.text);
          if (Array.isArray(item.sourceRefs) && item.sourceRefs.length) appendSourceAction(row, id, item.sourceRefs[0]);
        });
        interfaces.hidden = !items.length;
        feedback.textContent = '';
        root.hidden = false;
        return true;
      }

      function ensureGuideRoot() {
        if (guideRoot) return guideRoot;
        installStyles();
        var shell = document.querySelector('.container');
        if (!shell) return null;
        guideRoot = textElement('main', 'node-developer-guide no-print', null);
        guideRoot.id = 'node-developer-guide';
        guideRoot.hidden = true;
        guideRoot.inert = true;
        guideRoot.setAttribute('inert', '');
        guideRoot.setAttribute('aria-hidden', 'true');
        var workspace = textElement('div', 'node-guide-workspace', guideRoot);
        guideContext = textElement('aside', 'node-guide-context', workspace);
        guideContext.id = 'node-guide-context';
        var guideDocument = textElement('div', 'node-guide-document', workspace);
        guideActions = textElement('div', 'node-guide-actions', guideDocument);
        var back = textElement('button', '', guideActions, viewerText('viewer.developerGuide.backToDiagram'));
        back.id = 'node-guide-back';
        back.type = 'button';
        back.addEventListener('click', function () { close({ restoreFocus: true }); });
        guideCopy = textElement('button', '', guideActions, viewerText('viewer.developerGuide.copyLink'));
        guideCopy.id = 'node-guide-copy';
        guideCopy.type = 'button';
        guideCopy.addEventListener('click', copyLink);
        guideRelations = textElement('button', '', guideActions, viewerText('viewer.passport.relations'));
        guideRelations.id = 'node-guide-relations';
        guideRelations.type = 'button';
        guideRelations.addEventListener('click', function () { showNodeInformation('relationships'); });
        guideSourcesAction = textElement('button', '', guideActions, viewerText('viewer.developerGuide.evidenceLink'));
        guideSourcesAction.id = 'node-guide-sources';
        guideSourcesAction.type = 'button';
        guideSourcesAction.addEventListener('click', function () { showNodeInformation('sources'); });
        var lead = textElement('header', 'node-guide-lead', guideDocument);
        textElement('p', 'node-guide-eyebrow', lead, viewerText('viewer.developerGuide.overview'));
        guideTitle = textElement('h2', 'node-guide-title', lead);
        guideTitle.id = 'node-guide-title';
        guideTitle.tabIndex = -1;
        guideSummary = textElement('p', 'node-guide-summary', lead);
        var scopeRow = textElement('p', 'node-guide-scope', lead);
        textElement('span', '', scopeRow, viewerText('viewer.developerGuide.implementationScope'));
        guideScope = textElement('strong', '', scopeRow);
        guideFeedback = textElement('p', 'node-guide-status', lead);
        guideFeedback.id = 'node-guide-feedback';
        guideFeedback.setAttribute('role', 'status');
        guideBody = textElement('div', 'node-guide-body', guideDocument);
        guideToc = textElement('nav', 'node-guide-toc', guideBody);
        guideToc.setAttribute('aria-label', viewerText('viewer.developerGuide.overview'));
        textElement('ol', '', guideToc).id = 'node-guide-toc';
        guideSections = textElement('div', 'node-guide-sections', guideBody);
        guideSections.id = 'node-guide-sections';
        guideRoot.setAttribute('aria-labelledby', guideTitle.id);
        shell.after(guideRoot);
        return guideRoot;
      }

      function appendSources(parent, id, references) {
        if (!Array.isArray(references) || !references.length) return;
        var sources = textElement('div', 'node-guide-sources', parent);
        references.forEach(function (reference) { appendSourceAction(sources, id, reference); });
        if (!sources.children.length) sources.remove();
      }

      function renderItem(parent, id, item, kind) {
        var article = textElement('article', 'node-guide-item', parent);
        article.id = 'node-guide-item-' + item.id;
        textElement('h3', '', article, item.title);
        if (kind === 'interfaces' && item.direction) {
          textElement('span', 'node-guide-direction', article, directionLabel(item.direction));
        }
        if (kind === 'interfaces' && item.code) textElement('code', '', article, item.code);
        textElement('p', '', article, item.text);
        appendSources(article, id, item.sourceRefs);
      }

      function validSections(guide) {
        return Array.isArray(guide && guide.sections) ? guide.sections.filter(function (section) {
          return section && sectionKinds.indexOf(section.kind) !== -1 && Array.isArray(section.items) && section.items.length;
        }) : [];
      }

      function guideHash(id, section) {
        var current = new URLSearchParams(ArchifyAddress.location.hash.replace(/^#/, ''));
        var next = new URLSearchParams();
        if (current.get('diagram')) next.set('diagram', current.get('diagram'));
        next.set('focus', id);
        next.set('inspect', 'guide');
        if (section) next.set('section', section);
        return '#' + next.toString();
      }

      function graphHash(id) {
        var current = new URLSearchParams(ArchifyAddress.location.hash.replace(/^#/, ''));
        var next = new URLSearchParams();
        if (current.get('diagram')) next.set('diagram', current.get('diagram'));
        if (id) next.set('focus', id);
        return '#' + next.toString();
      }

      function standaloneHistoryState(base, surface, href, nodeId, graphHref, reading) {
        var state = base && typeof base === 'object' && !Array.isArray(base)
          ? Object.assign({}, base) : {};
        state.archifyDeveloperGuide = {
          surface: surface,
          href: href,
          nodeId: nodeId,
          graphHref: graphHref || null,
          reading: reading
        };
        return state;
      }

      function storedStandaloneReading(state, href) {
        var record = state && state.archifyDeveloperGuide;
        if (!record || (record.surface !== 'graph' && record.surface !== 'guide') ||
            record.href !== href || !record.reading || record.reading.surface !== record.surface) return null;
        return record.reading;
      }

      function replaceStandaloneReading(url) {
        if (ArchifyAddress.context || pendingOpen) return false;
        var record = history.state && history.state.archifyDeveloperGuide;
        if (!record || record.surface !== currentSurface ||
            (currentSurface === 'guide' && record.nodeId !== currentNodeId)) return false;
        var href;
        try { href = new URL(url || location.href, location.href).href; }
        catch (_) { return false; }
        var reading = snapshot();
        var next = standaloneHistoryState(history.state, currentSurface, href,
          currentSurface === 'guide' ? currentNodeId : reading.nodeId,
          record.graphHref, reading);
        history.replaceState(next, '', url || location.href);
        return true;
      }

      function scheduleStandaloneReadingSave() {
        if (ArchifyAddress.context || standaloneSaveFrame !== null) return;
        standaloneSaveFrame = requestAnimationFrame(function () {
          standaloneSaveFrame = null;
          var record = history.state && history.state.archifyDeveloperGuide;
          if (!record || record.href !== location.href || record.surface !== currentSurface) return;
          replaceStandaloneReading(location.href);
        });
      }

      function updateToc(section) {
        if (!guideToc) return;
        Array.prototype.forEach.call(guideToc.querySelectorAll('[data-guide-section]'), function (link) {
          if (link.getAttribute('data-guide-section') === section) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      }

      function showSection(section, options) {
        options = options || {};
        if (!guideRoot || currentSurface !== 'guide') return false;
        var target = null;
        Array.prototype.some.call(guideSections.querySelectorAll('[data-guide-section]'), function (candidate) {
          if (candidate.getAttribute('data-guide-section') !== section) return false;
          target = candidate;
          return true;
        });
        if (!target) return false;
        currentSection = section;
        updateToc(section);
        guideRoot.setAttribute('data-guide-section', section);
        if (options.scroll !== false) target.scrollIntoView({ block: 'start', behavior: 'auto' });
        if (options.updateUrl !== false && !pendingOpen) {
          var url = ArchifyAddress.location.pathname + ArchifyAddress.location.search + guideHash(currentNodeId, section);
          if (ArchifyAddress.context) {
            ArchifyAddress.replaceState(history.state, '', url);
            ArchifyAddress.settled();
          } else replaceStandaloneReading(url);
        }
        return true;
      }

      function renderGuide(id, requestedSection) {
        var root = ensureGuideRoot();
        var guide = node(id);
        if (!root || !guide) return false;
        var sections = validSections(guide);
        if (!sections.length) return false;
        guideTitle.textContent = labelFor(id);
        guideSummary.textContent = guide.summary && guide.summary.text ? guide.summary.text : '';
        guideScope.textContent = scopeLabel(guide.implementationScope);
        guideFeedback.textContent = '';
        guideCopy.hidden = false;
        guideRelations.hidden = false;
        guideSourcesAction.hidden = false;
        guideBody.hidden = false;
        var previousSummarySources = guideSummary.parentNode.querySelector('[data-guide-summary-sources]');
        if (previousSummarySources) previousSummarySources.remove();
        var list = document.getElementById('node-guide-toc');
        list.textContent = '';
        guideSections.textContent = '';
        sections.forEach(function (section) {
          var item = textElement('li', '', list);
          var link = textElement('a', '', item, sectionLabel(section.kind));
          link.href = guideHash(id, section.kind);
          link.setAttribute('data-guide-section', section.kind);
          link.addEventListener('click', function (event) {
            event.preventDefault();
            if (showSection(section.kind) && event.detail === 0) {
              var heading = document.getElementById('node-guide-heading-' + section.kind);
              if (heading) {
                try { heading.focus({ preventScroll: true }); }
                catch (_) { try { heading.focus(); } catch (_) {} }
              }
            }
          });
          var sectionRoot = textElement('section', 'node-guide-section', guideSections);
          sectionRoot.id = 'node-guide-section-' + section.kind;
          sectionRoot.setAttribute('data-guide-section', section.kind);
          var heading = textElement('h2', '', sectionRoot, sectionLabel(section.kind));
          heading.id = 'node-guide-heading-' + section.kind;
          heading.tabIndex = -1;
          var items = textElement(section.kind === 'flow' ? 'ol' : 'div', 'node-guide-items', sectionRoot);
          section.items.forEach(function (guideItem) {
            if (section.kind === 'flow') {
              var listItem = textElement('li', '', items);
              renderItem(listItem, id, guideItem, section.kind);
            } else renderItem(items, id, guideItem, section.kind);
          });
        });
        var summarySources = textElement('div', 'node-guide-sources', guideSummary.parentNode);
        summarySources.setAttribute('data-guide-summary-sources', '');
        (guide.summary && Array.isArray(guide.summary.sourceRefs) ? guide.summary.sourceRefs : []).forEach(function (reference) {
          appendSourceAction(summarySources, id, reference);
        });
        if (!summarySources.children.length) summarySources.remove();
        currentSection = sections.some(function (section) { return section.kind === requestedSection; })
          ? requestedSection : sections[0].kind;
        root.setAttribute('data-node-id', id);
        root.setAttribute('data-guide-state', 'ready');
        updateToc(currentSection);
        root.setAttribute('data-guide-section', currentSection);
        return true;
      }

      function showNodeInformation(kind) {
        if (ArchifyAddress.context) {
          ArchifyAddress.send('guide-return', { information: kind });
          return;
        }
        pendingGraphInformation = kind;
        close({ restoreFocus: false });
        if (currentSurface === 'graph') applyGraphInformation();
      }

      function applyGraphInformation() {
        var kind = pendingGraphInformation;
        if (!kind || currentSurface !== 'graph') return false;
        pendingGraphInformation = null;
        var tab = document.getElementById('atlas-tab-' + kind);
        if (tab && typeof tab.click === 'function') {
          tab.click();
          var inspector = document.querySelector('.atlas-inspector');
          if (inspector) inspector.scrollIntoView({ block: 'start' });
          return true;
        }
        if (kind === 'relationships') {
          var relations = document.getElementById('btn-focus-relations');
          if (relations && relations.getAttribute('aria-expanded') !== 'true') relations.click();
          if (chip) chip.scrollIntoView({ block: 'nearest' });
        } else {
          var evidence = document.getElementById('focus-evidence');
          if (evidence && !evidence.hidden) evidence.scrollIntoView({ block: 'nearest' });
        }
        return true;
      }

      function renderError(id, key, state) {
        var root = ensureGuideRoot();
        if (!root) return false;
        guideTitle.textContent = labelFor(id);
        guideSummary.textContent = viewerText(key || 'viewer.developerGuide.error');
        guideScope.textContent = '';
        guideFeedback.textContent = '';
        guideCopy.hidden = true;
        guideRelations.hidden = state !== 'empty';
        guideSourcesAction.hidden = state !== 'empty';
        guideBody.hidden = true;
        var summarySources = guideSummary.parentNode.querySelector('[data-guide-summary-sources]');
        if (summarySources) summarySources.remove();
        document.getElementById('node-guide-toc').textContent = '';
        guideSections.textContent = '';
        guideRoot.setAttribute('data-node-id', id || 'unknown');
        guideRoot.setAttribute('data-guide-state', state || 'error');
        guideRoot.removeAttribute('data-guide-section');
        currentSection = null;
        return true;
      }

      function rememberElement(element) {
        return element ? {
          element: element,
          hidden: element.hidden,
          inert: element.hasAttribute('inert'),
          ariaHidden: element.getAttribute('aria-hidden')
        } : null;
      }

      function hideElement(state) {
        if (!state) return;
        state.element.hidden = true;
        state.element.inert = true;
        state.element.setAttribute('aria-hidden', 'true');
      }

      function restoreElement(state) {
        if (!state) return;
        state.element.hidden = state.hidden;
        state.element.inert = state.inert;
        if (state.ariaHidden == null) state.element.removeAttribute('aria-hidden');
        else state.element.setAttribute('aria-hidden', state.ariaHidden);
      }

      function dispatchReady(nodeId, section) {
        window.dispatchEvent(new CustomEvent('archify:guide-ready', {
          detail: { nodeId: nodeId, section: section, surface: 'guide' }
        }));
      }

      function settled(nodeId, section, emitReady, emitError) {
        var revision = ++surfaceRevision;
        return Promise.resolve().then(function () {
          if (Archify.readerLayout && typeof Archify.readerLayout.schedule === 'function') Archify.readerLayout.schedule();
          return Archify.readerLayout && typeof Archify.readerLayout.whenStable === 'function'
            ? Archify.readerLayout.whenStable() : null;
        }).then(function () {
          if (revision !== surfaceRevision || currentSurface !== 'guide' || currentNodeId !== nodeId) return;
          if (emitReady !== false) dispatchReady(nodeId, section);
          if (ArchifyAddress.context) ArchifyAddress.settled();
        }).catch(function (error) {
          if (revision !== surfaceRevision || currentSurface !== 'guide' || currentNodeId !== nodeId) return;
          if (emitError !== false) {
            window.dispatchEvent(new CustomEvent('archify:guide-error', {
              detail: { nodeId: nodeId, message: error && error.message ? error.message : String(error) }
            }));
          }
          throw error;
        });
      }

      function activateGuide(id, section, options) {
        options = options || {};
        if (!guideRoot) return false;
        if (currentSurface === 'guide' && currentNodeId === id) {
          if (section && section !== currentSection) showSection(section, { updateUrl: false, scroll: options.scroll !== false });
          if (options.forceSettle) surfaceReady = settled(id, currentSection, options.emitReady, options.emitError);
          return true;
        }
        if (currentSurface === 'guide') {
          currentNodeId = id;
          currentSection = section;
          updateToc(currentSection);
          if (options.scroll !== false) window.scrollTo(0, 0);
          if (options.focus !== false) guideTitle.focus({ preventScroll: true });
          surfaceReady = settled(id, currentSection, options.emitReady, options.emitError);
          return true;
        }
        graphScrollY = window.scrollY;
        graphState = [rememberElement(guided), rememberElement(diagram), rememberElement(cards)];
        chipOrigin = null;
        if (chip && diagram && diagram.contains(chip)) {
          chipOrigin = { parent: chip.parentNode, next: chip.nextSibling };
          guideContext.appendChild(chip);
        }
        graphState.forEach(hideElement);
        currentSurface = 'guide';
        currentNodeId = id;
        html.setAttribute('data-reader-surface', 'guide');
        guideRoot.hidden = false;
        guideRoot.inert = false;
        guideRoot.removeAttribute('inert');
        guideRoot.removeAttribute('aria-hidden');
        if (section) currentSection = section;
        updateToc(currentSection);
        if (options.scroll !== false) window.scrollTo(0, 0);
        if (options.focus !== false) guideTitle.focus({ preventScroll: true });
        surfaceReady = settled(id, currentSection, options.emitReady, options.emitError);
        return true;
      }

      function deactivateGuide(options) {
        options = options || {};
        if (currentSurface !== 'guide') return false;
        surfaceRevision += 1;
        pendingOpen = null;
        guideRoot.hidden = true;
        guideRoot.inert = true;
        guideRoot.setAttribute('inert', '');
        guideRoot.setAttribute('aria-hidden', 'true');
        if (chipOrigin && guideContext && guideContext.contains(chip)) {
          var next = chipOrigin.next && chipOrigin.next.parentNode === chipOrigin.parent ? chipOrigin.next : null;
          chipOrigin.parent.insertBefore(chip, next);
        }
        (graphState || []).forEach(restoreElement);
        graphState = null;
        chipOrigin = null;
        currentSurface = 'graph';
        currentNodeId = null;
        currentSection = null;
        html.setAttribute('data-reader-surface', 'graph');
        if (Archify.readerLayout && typeof Archify.readerLayout.schedule === 'function') Archify.readerLayout.schedule();
        if (options.restoreScroll !== false) requestAnimationFrame(function () { window.scrollTo(0, graphScrollY); });
        if (options.restoreFocus) {
          var id = Archify.focus && Archify.focus.active();
          var target = null;
          Array.prototype.some.call(document.querySelectorAll('[data-node-id]'), function (candidate) {
            if (candidate.getAttribute('data-node-id') !== id) return false;
            target = candidate;
            return true;
          });
          if (target) target.focus({ preventScroll: true });
        }
        return true;
      }

      function userError(id, error) {
        var feedback = document.getElementById('focus-guide-feedback');
        if (feedback) feedback.textContent = viewerText('viewer.developerGuide.error');
        window.dispatchEvent(new CustomEvent('archify:guide-error', {
          detail: { nodeId: id, message: error && error.message ? error.message : String(error) }
        }));
      }

      function addressError(id, message) {
        var error = new Error(message);
        window.dispatchEvent(new CustomEvent('archify:guide-error', {
          detail: { nodeId: id || null, message: message }
        }));
        return surfaceReady.then(function () { throw error; });
      }

      function open(id, options) {
        options = options || {};
        var guide = node(id);
        if (!guide) return Promise.resolve(false);
        var sections = validSections(guide);
        if (!sections.length) return Promise.resolve(false);
        var requested = options.section || (currentSurface === 'guide' && currentNodeId === id ? currentSection : null);
        var section = sections.some(function (candidate) { return candidate.kind === requested; })
          ? requested : sections[0].kind;
        if (currentSurface === 'guide' && currentNodeId === id) {
          if (section !== currentSection) showSection(section);
          if (pendingOpen) {
            return surfaceReady.then(function () {
              return currentSurface === 'guide' && currentNodeId === id;
            }).catch(function () { return false; });
          }
          return Promise.resolve(true);
        }
        if (ArchifyAddress.context) {
          ArchifyAddress.send('navigate', { focus: id, inspect: 'guide', section: section });
          return Promise.resolve(true);
        }
        var trigger = pendingOpen ? pendingOpen.trigger : document.activeElement;
        var originalState = history.state;
        var graphHref = location.href;
        var graphReading = snapshot();
        var graphEntryCommitted = false;
        try {
          if (!renderGuide(id, section)) throw new Error('Developer guide could not be rendered.');
          var url = location.pathname + location.search + guideHash(id, section);
          if (!activateGuide(id, section, { emitReady: false, emitError: false })) {
            throw new Error('Developer guide surface could not be activated.');
          }
          var expectedRevision = surfaceRevision;
          pendingOpen = { revision: expectedRevision, trigger: trigger };
          return surfaceReady.then(function () {
            if (!pendingOpen || pendingOpen.revision !== expectedRevision ||
                expectedRevision !== surfaceRevision || currentSurface !== 'guide' || currentNodeId !== id) return false;
            url = location.pathname + location.search + guideHash(id, currentSection);
            var guideHref = new URL(url, location.href).href;
            var graphEntry = standaloneHistoryState(originalState, 'graph', graphHref, id, null, graphReading);
            var guideEntry = standaloneHistoryState(originalState, 'guide', guideHref, id, graphHref, snapshot());
            history.replaceState(graphEntry, '', graphHref);
            graphEntryCommitted = true;
            history.pushState(guideEntry, '', url);
            pendingOpen = null;
            dispatchReady(id, currentSection);
            return true;
          }).catch(function (error) {
            if (expectedRevision !== surfaceRevision || currentSurface !== 'guide' || currentNodeId !== id) return false;
            if (graphEntryCommitted) {
              try { history.replaceState(originalState, '', graphHref); } catch (_) {}
            }
            deactivateGuide({ restoreFocus: false, restoreScroll: true });
            if (trigger && trigger.isConnected && typeof trigger.focus === 'function') {
              try { trigger.focus({ preventScroll: true }); } catch (_) { try { trigger.focus(); } catch (_) {} }
            }
            userError(id, error);
            return false;
          });
        } catch (error) {
          if (currentSurface === 'guide' && currentNodeId === id) {
            deactivateGuide({ restoreFocus: false, restoreScroll: false });
          }
          userError(id, error);
          return Promise.resolve(false);
        }
      }

      function close(options) {
        options = options || {};
        if (currentSurface !== 'guide') return false;
        var id = currentNodeId;
        if (ArchifyAddress.context) {
          ArchifyAddress.send('guide-return');
          return true;
        }
        if (pendingOpen) {
          var trigger = pendingOpen.trigger;
          deactivateGuide({ restoreFocus: false });
          if (options.restoreFocus !== false && trigger && trigger.isConnected && typeof trigger.focus === 'function') {
            try { trigger.focus({ preventScroll: true }); } catch (_) { try { trigger.focus(); } catch (_) {} }
          }
          return true;
        }
        var provenance = history.state && history.state.archifyDeveloperGuide;
        if (provenance && provenance.nodeId === id && provenance.graphHref) {
          replaceStandaloneReading(location.href);
          history.back();
          return true;
        }
        var url = location.pathname + location.search + graphHash(id);
        history.replaceState(history.state, '', url);
        deactivateGuide({ restoreFocus: options.restoreFocus !== false });
        return true;
      }

      function copyLink() {
        if (!currentNodeId || !guideCopy) return Promise.resolve(false);
        var value = ArchifyAddress.share(guideHash(currentNodeId, currentSection));
        var copy = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
          ? navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return fallbackCopy(value); })
          : Promise.resolve(fallbackCopy(value));
        return copy.then(function (copied) {
          guideCopy.textContent = viewerText(copied ? 'viewer.developerGuide.copySuccess' : 'viewer.developerGuide.copyFailed');
          guideFeedback.textContent = copied ? '' : viewerText('viewer.developerGuide.copyFailed');
          window.setTimeout(function () {
            if (guideCopy) guideCopy.textContent = viewerText('viewer.developerGuide.copyLink');
          }, 1600);
          return copied;
        });
      }

      function syncAddress() {
        var params;
        try { params = new URLSearchParams(ArchifyAddress.location.hash.replace(/^#/, '')); }
        catch (error) { return Promise.reject(error); }
        var inspect = params.get('inspect');
        var id = params.get('focus');
        var requestedSection = params.get('section');
        if ((inspect && inspect !== 'guide') || (!inspect && requestedSection)) {
          renderError(id, 'viewer.developerGuide.error');
          activateGuide(id || '', null, { focus: false, emitReady: false });
          return addressError(id, 'Invalid developer guide address.');
        }
        if (inspect !== 'guide') {
          if (currentSurface === 'guide') deactivateGuide({ restoreFocus: false });
          return Promise.resolve({ surface: 'graph', nodeId: null, section: null });
        }
        if (!id) {
          renderError('', 'viewer.developerGuide.error');
          activateGuide('', null, { focus: false, emitReady: false });
          return addressError('', 'Developer guide requires a focused node.');
        }
        if (!diagramHasNode(id)) {
          renderError(id, 'viewer.developerGuide.error');
          activateGuide(id, null, { focus: false, emitReady: false });
          return addressError(id, 'Unknown developer guide node ' + id + '.');
        }
        var guide = node(id);
        if (!guide) {
          renderError(id, 'viewer.developerGuide.empty', 'empty');
          activateGuide(id, null, { focus: false, emitReady: true });
          return surfaceReady.then(function () {
            return { surface: 'guide', nodeId: id, section: null, empty: true };
          });
        }
        var sections = validSections(guide);
        if (requestedSection && !sections.some(function (section) { return section.kind === requestedSection; })) {
          renderError(id, 'viewer.developerGuide.error');
          activateGuide(id, null, { focus: false, emitReady: false });
          return addressError(id, 'Unknown developer guide section ' + requestedSection + '.');
        }
        var section = requestedSection || sections[0].kind;
        if (currentSurface === 'guide' && currentNodeId === id && guideRoot &&
            guideRoot.getAttribute('data-guide-state') === 'ready') {
          if (section !== currentSection) showSection(section, { updateUrl: false });
          return surfaceReady.then(function () {
            return { surface: 'guide', nodeId: id, section: currentSection };
          });
        }
        var replacingError = currentSurface === 'guide' && currentNodeId === id;
        if (!renderGuide(id, section)) return Promise.reject(new Error('Developer guide could not be rendered.'));
        activateGuide(id, section, { focus: false, forceSettle: replacingError });
        return surfaceReady.then(function () {
          return { surface: 'guide', nodeId: id, section: currentSection };
        });
      }

      function focusGuide(descriptor) {
        if (currentSurface !== 'guide' || !guideTitle) return false;
        var target = descriptor && descriptor.id ? document.getElementById(descriptor.id) : null;
        if (!target && descriptor && descriptor.section && guideRoot) {
          Array.prototype.some.call(guideRoot.querySelectorAll('[data-guide-section]'), function (candidate) {
            if (candidate.getAttribute('data-guide-section') !== descriptor.section) return false;
            target = candidate;
            return true;
          });
        }
        if (!target || target.closest('[hidden]')) target = guideTitle;
        try { target.focus({ preventScroll: true }); }
        catch (_) { try { target.focus(); } catch (_) { return false; } }
        return true;
      }

      function snapshot() {
        var active = document.activeElement;
        var focus = active && active.id ? { id: active.id } : null;
        if (!focus && active && active.getAttribute && active.getAttribute('data-guide-section')) {
          focus = { section: active.getAttribute('data-guide-section') };
        }
        var selected = Archify.focus && Archify.focus.active();
        var result = {
          surface: currentSurface,
          nodeId: currentSurface === 'guide' ? currentNodeId : (typeof selected === 'string' ? selected : null),
          section: currentSection,
          scrollTop: window.scrollY,
          focus: focus
        };
        if (!ArchifyAddress.context) {
          result.scrollLeft = window.scrollX;
          result.camera = Archify.view && typeof Archify.view.snapshot === 'function' ? Archify.view.snapshot() : null;
          var selectedTab = document.querySelector('[data-atlas-tab][aria-selected="true"]');
          result.tabId = selectedTab && selectedTab.id ? selectedTab.id : null;
          result.panelScroll = {};
          Array.prototype.forEach.call(document.querySelectorAll('.atlas-inspector-panel[id]'), function (panel) {
            result.panelScroll[panel.id] = panel.scrollTop;
          });
        }
        return result;
      }

      function restoreStandaloneReading(state, options) {
        if (ArchifyAddress.context) return;
        if (state.surface === 'graph' && typeof state.nodeId === 'string' && Archify.focus &&
            Archify.focus.active() !== state.nodeId) {
          Archify.focus.set(state.nodeId, { updateUrl: false, toggle: false });
        }
        if (state.tabId) {
          var tab = document.getElementById(state.tabId);
          if (tab && tab.getAttribute('aria-selected') !== 'true' && typeof tab.click === 'function') tab.click();
        }
        if (state.camera && Archify.view && typeof Archify.view.restore === 'function') Archify.view.restore(state.camera);
        if (state.panelScroll) {
          Object.keys(state.panelScroll).forEach(function (id) {
            var panel = document.getElementById(id);
            if (panel && Number.isFinite(state.panelScroll[id])) panel.scrollTop = state.panelScroll[id];
          });
        }
        window.scrollTo(Number.isFinite(state.scrollLeft) ? state.scrollLeft : 0,
          Number.isFinite(state.scrollTop) ? state.scrollTop : 0);
        if (options.focus === false || !state.focus) return;
        if (state.surface === 'guide') {
          focusGuide(state.focus);
          return;
        }
        if (!state.focus.id) return;
        var target = document.getElementById(state.focus.id);
        if (target && !target.closest('[hidden]')) {
          try { target.focus({ preventScroll: true }); }
          catch (_) { try { target.focus(); } catch (_) {} }
        }
      }

      function restore(state, options) {
        options = options || {};
        if (!state || (state.surface !== 'guide' && state.surface !== 'graph')) return Promise.resolve(false);
        if (state.surface === 'graph') {
          if (currentSurface === 'guide') deactivateGuide({ restoreFocus: false, restoreScroll: false });
          requestAnimationFrame(function () {
            if (!ArchifyAddress.context) {
              restoreStandaloneReading(state, options);
              return;
            }
            if (Number.isFinite(state.scrollTop)) window.scrollTo(0, state.scrollTop);
            if (options.focus === false || !state.focus || !state.focus.id) return;
            var graphTarget = document.getElementById(state.focus.id);
            if (graphTarget && !graphTarget.closest('[hidden]')) graphTarget.focus({ preventScroll: true });
          });
          return Promise.resolve(true);
        }
        if (!node(state.nodeId)) return Promise.resolve(false);
        if (!renderGuide(state.nodeId, state.section)) return Promise.resolve(false);
        activateGuide(state.nodeId, state.section, { focus: false, scroll: false });
        requestAnimationFrame(function () {
          if (!ArchifyAddress.context) {
            restoreStandaloneReading(state, options);
            return;
          }
          if (Number.isFinite(state.scrollTop)) window.scrollTo(0, state.scrollTop);
          if (options.focus === false || !state.focus) return;
          var target = state.focus.id ? document.getElementById(state.focus.id) : null;
          if (!target && state.focus.section) {
            Array.prototype.some.call(guideRoot.querySelectorAll('[data-guide-section]'), function (candidate) {
              if (candidate.getAttribute('data-guide-section') !== state.focus.section) return false;
              target = candidate;
              return true;
            });
          }
          if (target && !target.closest('[hidden]')) target.focus({ preventScroll: true });
        });
        return surfaceReady.then(function () { return true; });
      }

      function connect() {
        if (connected) return;
        connected = true;
        if (payload && guideNodes().length) {
          installStyles();
          ensureQuicklook();
          html.setAttribute('data-reader-surface', 'graph');
        }
        function syncWithoutUnhandledRejection() {
          if (!ArchifyAddress.context) {
            syncStandaloneHistoryWithoutUnhandledRejection();
            return;
          }
          syncAddress().catch(function () {});
        }
        function syncStandaloneHistoryWithoutUnhandledRejection() {
          if (standaloneSaveFrame !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(standaloneSaveFrame);
            standaloneSaveFrame = null;
          }
          var expectedRevision = ++standaloneSyncRevision;
          var expectedHref = location.href;
          var reading = ArchifyAddress.context ? null : storedStandaloneReading(history.state, expectedHref);
          syncAddress().then(function () {
            if (expectedRevision !== standaloneSyncRevision || location.href !== expectedHref) return null;
            return reading ? restore(reading, { focus: true }) : null;
          }).then(function () {
            if (expectedRevision === standaloneSyncRevision && location.href === expectedHref) applyGraphInformation();
          }).catch(function () {});
        }
        window.addEventListener('hashchange', syncWithoutUnhandledRejection);
        window.addEventListener('popstate', syncStandaloneHistoryWithoutUnhandledRejection);
        if (!ArchifyAddress.context) {
          window.addEventListener('scroll', scheduleStandaloneReadingSave, { passive: true });
          document.addEventListener('scroll', scheduleStandaloneReadingSave, true);
          document.addEventListener('focusin', scheduleStandaloneReadingSave, true);
          document.addEventListener('pointerup', scheduleStandaloneReadingSave, true);
          document.addEventListener('wheel', scheduleStandaloneReadingSave, { capture: true, passive: true });
        }
        document.addEventListener('keydown', function (event) {
          if (event.key !== 'Escape' || currentSurface !== 'guide') return;
          event.preventDefault();
          event.stopImmediatePropagation();
          close({ restoreFocus: true });
        });
        syncStandaloneHistoryWithoutUnhandledRejection();
      }

      return {
        available: function () { return Boolean(payload && guideNodes().length); },
        node: node,
        guideNodes: guideNodes,
        renderQuicklook: renderQuicklook,
        clearQuicklook: clearQuicklook,
        open: open,
        close: close,
        surface: function () { return currentSurface; },
        section: function () { return currentSection; },
        syncAddress: syncAddress,
        snapshot: snapshot,
        restore: restore,
        focus: focusGuide,
        connect: connect
      };
    })();

    Archify.focus = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector('svg');
      var chip = document.getElementById('focus-chip');
      var label = document.getElementById('focus-label');
      var detail = document.getElementById('focus-detail');
      var kind = document.getElementById('focus-kind');
      var context = document.getElementById('focus-context');
      var tag = document.getElementById('focus-tag');
      var semanticId = document.getElementById('focus-id');
      var evidence = document.getElementById('focus-evidence');
      var repositoryLink = document.getElementById('focus-repository');
      var evidenceLinks = document.getElementById('focus-evidence-links');
      var summary = document.getElementById('focus-summary');
      var reachSection = document.getElementById('focus-reach');
      var reachStatus = document.getElementById('focus-reach-status');
      var upstreamBtn = document.getElementById('btn-reach-upstream');
      var downstreamBtn = document.getElementById('btn-reach-downstream');
      var upstreamCount = document.getElementById('focus-reach-upstream-count');
      var downstreamCount = document.getElementById('focus-reach-downstream-count');
      var relationshipList = document.getElementById('relationship-lens-list');
      var copyBtn = document.getElementById('btn-focus-copy');
      var relationsBtn = document.getElementById('btn-focus-relations');
      var clearBtn = document.getElementById('btn-focus-clear');
      var activeIds = [];
      var hoveredRelationship = null;
      var focusedRelationship = null;
      var pinnedRelationship = null;
      var pinnedRelationshipKey = null;
      var activeRelationshipPreview = null;
      var relationshipHitOverlay = null;
      var relationshipHitTargets = [];
      var directPreviewTimer = null;
      var reachabilityMode = null;
      var activeReachability = null;
      var svgNamespace = 'http://www.w3.org/2000/svg';
      var reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      var finePointerQuery = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;

      function atlasInspection() {
        return Boolean(ArchifyAddress.context);
      }

      function nodes() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
      }
      function edges() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'));
      }
      function nodeLabel(node, fallback) {
        return node.getAttribute('data-node-label') || (node.getAttribute('aria-label') || fallback).replace(/^Focus\s+/, '');
      }
      function reachabilityRelationships() {
        var seen = Object.create(null);
        var relationships = [];
        edges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var key = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + (edge.getAttribute('data-edge-label') || ''));
          if (!from || !to || seen[key]) return;
          seen[key] = true;
          relationships.push({ key: key, from: from, to: to });
        });
        return relationships;
      }
      function computeReachability(originId, direction, relationships) {
        if (typeof originId !== 'string' || !originId ||
            (direction !== 'upstream' && direction !== 'downstream') ||
            !Array.isArray(relationships)) return null;
        var records = [];
        var seenKeys = Object.create(null);
        relationships.forEach(function (relationship, index) {
          if (!relationship || typeof relationship.from !== 'string' || !relationship.from ||
              typeof relationship.to !== 'string' || !relationship.to) return;
          var key = typeof relationship.key === 'string' && relationship.key
            ? relationship.key : String(index);
          if (seenKeys[key]) return;
          seenKeys[key] = true;
          records.push({ key: key, from: relationship.from, to: relationship.to });
        });

        var depths = Object.create(null);
        var order = [];
        var queue = [originId];
        depths[originId] = 0;
        for (var cursor = 0; cursor < queue.length; cursor += 1) {
          var current = queue[cursor];
          records.forEach(function (relationship) {
            var next = null;
            if (direction === 'downstream' && relationship.from === current) next = relationship.to;
            else if (direction === 'upstream' && relationship.to === current) next = relationship.from;
            if (next == null || Object.prototype.hasOwnProperty.call(depths, next)) return;
            depths[next] = depths[current] + 1;
            queue.push(next);
          });
        }
        queue.forEach(function (id) { order.push(id); });

        var edgeKeys = [];
        records.forEach(function (relationship) {
          if (Object.prototype.hasOwnProperty.call(depths, relationship.from) &&
              Object.prototype.hasOwnProperty.call(depths, relationship.to)) edgeKeys.push(relationship.key);
        });
        var maxDepth = order.reduce(function (maximum, id) {
          return Math.max(maximum, depths[id]);
        }, 0);
        return {
          direction: direction,
          originId: originId,
          nodeIds: order,
          edgeKeys: edgeKeys,
          depths: depths,
          maxDepth: maxDepth
        };
      }
      function reachabilityFor(id, direction) {
        return computeReachability(id, direction, reachabilityRelationships());
      }
      function resetReachabilityButtons() {
        upstreamBtn.setAttribute('aria-pressed', 'false');
        downstreamBtn.setAttribute('aria-pressed', 'false');
      }
      function clearReachability(options) {
        options = options || {};
        reachabilityMode = null;
        activeReachability = null;
        svg.removeAttribute('data-reach-active');
        chip.removeAttribute('data-reach-mode');
        nodes().forEach(function (node) {
          node.removeAttribute('data-reach-match');
          node.removeAttribute('data-reach-origin');
          node.removeAttribute('data-reach-depth');
        });
        edges().forEach(function (edge) {
          edge.removeAttribute('data-reach-match');
          edge.removeAttribute('data-reach-depth');
        });
        resetReachabilityButtons();
        reachStatus.textContent = '';
        reachStatus.hidden = true;
        if (Archify.exportMenu && typeof Archify.exportMenu.syncReachShare === 'function') {
          Archify.exportMenu.syncReachShare();
        }
        if (options.updateUrl === true && activeIds.length === 1) {
          try {
            ArchifyAddress.replaceState(null, '', ArchifyAddress.location.pathname + ArchifyAddress.location.search + '#focus=' + encodeURIComponent(activeIds[0]));
          } catch (_) {}
        }
      }
      function renderReachabilityControls(id) {
        var upstream = reachabilityFor(id, 'upstream');
        var downstream = reachabilityFor(id, 'downstream');
        var upstreamReach = upstream ? Math.max(0, upstream.nodeIds.length - 1) : 0;
        var downstreamReach = downstream ? Math.max(0, downstream.nodeIds.length - 1) : 0;
        upstreamCount.textContent = String(upstreamReach);
        downstreamCount.textContent = String(downstreamReach);
        upstreamBtn.disabled = upstreamReach === 0;
        downstreamBtn.disabled = downstreamReach === 0;
        upstreamBtn.setAttribute('aria-label', upstreamReach
          ? viewerCount('viewer.passport.reach.upstream', upstreamReach)
          : viewerText('viewer.passport.reach.noUpstream'));
        downstreamBtn.setAttribute('aria-label', downstreamReach
          ? viewerCount('viewer.passport.reach.downstream', downstreamReach)
          : viewerText('viewer.passport.reach.noDownstream'));
        reachSection.hidden = false;
      }
      function applyReachability(direction, options) {
        options = options || {};
        if (activeIds.length !== 1 || (direction !== 'upstream' && direction !== 'downstream')) return false;
        if (reachabilityMode === direction && options.toggle !== false) {
          clearReachability({ updateUrl: options.updateUrl !== false });
          return true;
        }
        var result = reachabilityFor(activeIds[0], direction);
        if (!result || result.nodeIds.length <= 1) return false;
        if (Archify.guidedViews && typeof Archify.guidedViews.showAll === 'function') {
          Archify.guidedViews.showAll({ clearFocus: false, updateUrl: false, resetView: false });
        }
        clearRelationshipPreview({ clearPin: true });
        clearReachability({ updateUrl: false });
        reachabilityMode = direction;
        activeReachability = result;
        var edgeKeySet = Object.create(null);
        result.edgeKeys.forEach(function (key) { edgeKeySet[key] = true; });
        svg.setAttribute('data-reach-active', direction);
        chip.setAttribute('data-reach-mode', direction);
        nodes().forEach(function (node) {
          var id = node.getAttribute('data-node-id');
          if (!Object.prototype.hasOwnProperty.call(result.depths, id)) return;
          node.setAttribute('data-reach-match', '');
          node.setAttribute('data-reach-depth', String(result.depths[id]));
          if (id === result.originId) node.setAttribute('data-reach-origin', '');
        });
        edges().forEach(function (edge) {
          var key = edge.getAttribute('data-edge-key') || (
            edge.getAttribute('data-edge-from') + '\u0000' +
            edge.getAttribute('data-edge-to') + '\u0000' +
            (edge.getAttribute('data-edge-label') || '')
          );
          if (!edgeKeySet[key]) return;
          edge.setAttribute('data-reach-match', '');
          var fromDepth = result.depths[edge.getAttribute('data-edge-from')];
          var toDepth = result.depths[edge.getAttribute('data-edge-to')];
          edge.setAttribute('data-reach-depth', String(Math.max(fromDepth || 0, toDepth || 0)));
        });
        resetReachabilityButtons();
        var activeButton = direction === 'upstream' ? upstreamBtn : downstreamBtn;
        activeButton.setAttribute('aria-pressed', 'true');
        var reachableCount = result.nodeIds.length - 1;
        var directionLabel = viewerText(direction === 'upstream'
          ? 'viewer.passport.upstream'
          : 'viewer.passport.downstream');
        reachStatus.textContent = viewerText('viewer.passport.reach.status', {
          direction: directionLabel,
          nodes: reachableCount,
          links: result.edgeKeys.length,
          hops: result.maxDepth
        });
        reachStatus.hidden = false;
        if (Archify.exportMenu && typeof Archify.exportMenu.syncReachShare === 'function') {
          Archify.exportMenu.syncReachShare();
        }
        if (options.updateUrl !== false) {
          try {
            ArchifyAddress.replaceState(null, '', ArchifyAddress.location.pathname + ArchifyAddress.location.search + '#focus=' +
              encodeURIComponent(activeIds[0]) + '&reach=' + direction);
          } catch (_) {}
        }
        if (options.reveal !== false && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal(result.nodeIds, { includeNeighbors: false, reason: 'reachability' });
        }
        requestLensPlacement();
        return true;
      }
      function reachabilitySnapshot() {
        if (!activeReachability || activeIds.length !== 1 ||
            (reachabilityMode !== 'upstream' && reachabilityMode !== 'downstream') ||
            activeReachability.direction !== reachabilityMode ||
            activeReachability.originId !== activeIds[0] ||
            svg.getAttribute('data-reach-active') !== reachabilityMode) return null;

        var originId = activeReachability.originId;
        var nodeIds = activeReachability.nodeIds.slice();
        var edgeKeys = activeReachability.edgeKeys.slice();
        if (nodeIds.length < 2 || nodeIds[0] !== originId || !edgeKeys.length ||
            !activeReachability.depths || !Number.isInteger(activeReachability.maxDepth) ||
            activeReachability.maxDepth < 1) return null;

        var allNodes = nodes();
        var allEdges = edges();
        var seenNodeIds = Object.create(null);
        var seenEdgeKeys = Object.create(null);
        var nodeIdSet = Object.create(null);
        var depths = Object.create(null);
        var originNode = null;
        var measuredMaxDepth = 0;

        if (nodeIds.some(function (id) {
          var depth = activeReachability.depths[id];
          var matches = allNodes.filter(function (node) {
            return node.getAttribute('data-node-id') === id;
          });
          if (typeof id !== 'string' || !id || seenNodeIds[id] || matches.length !== 1 ||
              !matches[0].hasAttribute('data-reach-match') ||
              !Number.isInteger(depth) || depth < 0 || depth > activeReachability.maxDepth ||
              (id === originId
                ? (!matches[0].hasAttribute('data-reach-origin') || depth !== 0)
                : depth < 1)) return true;
          seenNodeIds[id] = true;
          nodeIdSet[id] = true;
          depths[id] = depth;
          measuredMaxDepth = Math.max(measuredMaxDepth, depth);
          if (id === originId) originNode = matches[0];
          return false;
        }) || !originNode || measuredMaxDepth !== activeReachability.maxDepth ||
            allNodes.filter(function (node) { return node.hasAttribute('data-reach-match'); }).length !== nodeIds.length) return null;

        var edgeRecords = [];
        if (edgeKeys.some(function (key) {
          if (typeof key !== 'string' || !key || seenEdgeKeys[key]) return true;
          var fragments = allEdges.filter(function (edge) {
            return edge.getAttribute('data-edge-key') === key;
          });
          var drawableFragments = fragments.filter(hasDrawableGeometry);
          if (!fragments.length || drawableFragments.length !== 1 ||
              !fragments.every(function (fragment) { return fragment.hasAttribute('data-reach-match'); })) return true;
          var first = fragments[0];
          var from = first.getAttribute('data-edge-from');
          var to = first.getAttribute('data-edge-to');
          var id = first.getAttribute('data-edge-id') || '';
          var labelValue = first.getAttribute('data-edge-label') || '';
          if (!nodeIdSet[from] || !nodeIdSet[to] || !fragments.every(function (fragment) {
            return fragment.getAttribute('data-edge-from') === from &&
              fragment.getAttribute('data-edge-to') === to &&
              (fragment.getAttribute('data-edge-id') || '') === id;
          })) return true;
          seenEdgeKeys[key] = true;
          edgeRecords.push({
            key: key,
            id: id,
            from: from,
            to: to,
            label: labelValue,
            depth: Math.max(depths[from], depths[to])
          });
          return false;
        })) return null;

        var liveEdgeKeys = Object.create(null);
        if (allEdges.some(function (edge) {
          if (!edge.hasAttribute('data-reach-match')) return false;
          var key = edge.getAttribute('data-edge-key');
          if (!key || !seenEdgeKeys[key]) return true;
          liveEdgeKeys[key] = true;
          return false;
        }) || Object.keys(liveEdgeKeys).length !== edgeKeys.length) return null;

        return {
          direction: reachabilityMode,
          origin: { id: originId, label: nodeLabel(originNode, originId) },
          nodeIds: nodeIds,
          depths: depths,
          maxDepth: activeReachability.maxDepth,
          edges: edgeRecords
        };
      }
      function setPassportValue(element, value) {
        var normalized = value == null ? '' : String(value).trim();
        element.textContent = normalized;
        element.hidden = !normalized;
      }
      function renderSourceEvidence(id) {
        evidenceLinks.textContent = '';
        repositoryLink.removeAttribute('href');
        repositoryLink.removeAttribute('aria-label');
        repositoryLink.textContent = '';
        var sources = Archify.sourceEvidence.node(id);
        var repository = Archify.sourceEvidence.repository();
        if (!repository || !sources.length) {
          evidence.hidden = true;
          return;
        }
        repositoryLink.textContent = repository.label + ' @ ' + repository.shortRevision;
        if (repository.href) {
          repositoryLink.href = repository.href;
          repositoryLink.setAttribute('aria-label', viewerText('viewer.passport.repository.open', { revision: repository.revision }));
        }
        evidence.title = viewerText('viewer.passport.verificationScope');
        sources.forEach(function (source) {
          var link = document.createElement(source.href ? 'a' : 'div');
          link.className = 'semantic-passport-source';
          if (source.href) {
            link.href = source.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.referrerPolicy = 'no-referrer';
            link.setAttribute('aria-label', viewerText('viewer.passport.source.open', { path: source.path, revision: repository.shortRevision }));
          }
          if (source.id) link.setAttribute('data-source-id', source.id);
          var name = document.createElement('strong');
          name.textContent = source.label || source.path.split('/').pop() || source.path;
          var location = document.createElement('code');
          location.textContent = source.line
            ? 'L' + source.line + (source.endLine && source.endLine !== source.line ? '–' + source.endLine : '') + (source.href ? ' ↗' : '')
            : source.href ? viewerText('viewer.passport.source.openLink') : '';
          var sourcePath = document.createElement('small');
          sourcePath.textContent = source.path;
          link.appendChild(name);
          link.appendChild(location);
          link.appendChild(sourcePath);
          evidenceLinks.appendChild(link);
        });
        evidence.hidden = false;
      }
      function renderPassport(id, node) {
        setPassportValue(detail, node.getAttribute('data-node-sublabel'));
        Archify.developerGuide.renderQuicklook(id);
        setPassportValue(kind, viewerKindLabel(node.getAttribute('data-node-kind') || 'node'));
        setPassportValue(context, node.getAttribute('data-node-context'));
        setPassportValue(tag, node.getAttribute('data-node-tag'));
        setPassportValue(document.getElementById('focus-brand'), node.getAttribute('data-node-brand'));
        semanticId.textContent = id;
        semanticId.hidden = false;
        renderSourceEvidence(id);
      }
      function relationshipsFor(id, byId) {
        var seen = {};
        var relationships = [];
        edges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          if (from !== id && to !== id) return;
          var edgeLabel = edge.getAttribute('data-edge-label') || '';
          var edgeKey = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + edgeLabel);
          var edgeId = edge.getAttribute('data-edge-id') || '';
          if (seen[edgeKey]) return;
          seen[edgeKey] = true;
          var direction = from === id && to === id ? 'loop' : (from === id ? 'out' : 'in');
          var neighborId = direction === 'in' ? from : to;
          var neighbor = byId[neighborId];
          relationships.push({
            key: edgeKey,
            id: edgeId,
            from: from,
            to: to,
            direction: direction,
            neighborId: neighborId,
            neighborLabel: neighbor ? nodeLabel(neighbor, neighborId) : neighborId,
            label: edgeLabel || viewerText(direction === 'loop'
              ? 'viewer.passport.relationship.loopsBack'
              : direction === 'out'
                ? 'viewer.passport.relationship.connectsTo'
                : 'viewer.passport.relationship.connectsFrom')
          });
        });
        return relationships;
      }
      function relationshipEdgeShapes(edge) {
        if (!edge) return [];
        if (/^(path|line|polyline)$/i.test(edge.tagName || '')) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }
      function relationshipHitRecords() {
        var recordsByKey = {};
        var recordsById = {};
        var byId = {};
        nodes().forEach(function (node) { byId[node.getAttribute('data-node-id')] = node; });
        var records = [];
        edges().forEach(function (edge) {
          var shapes = relationshipEdgeShapes(edge);
          if (!shapes.length) return;
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var labelValue = edge.getAttribute('data-edge-label') || '';
          var edgeId = edge.getAttribute('data-edge-id') || '';
          var key = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + labelValue);
          var existing = recordsByKey[key];
          if (existing) {
            if (existing.from !== from || existing.to !== to || existing.labelValue !== labelValue || existing.id !== edgeId) {
              existing.invalid = true;
              return;
            }
            shapes.forEach(function (shape) {
              if (existing.shapes.indexOf(shape) === -1) existing.shapes.push(shape);
            });
            return;
          }
          var record = {
            key: key,
            id: edgeId,
            from: from,
            to: to,
            fromLabel: byId[from] ? nodeLabel(byId[from], from) : from,
            toLabel: byId[to] ? nodeLabel(byId[to], to) : to,
            labelValue: labelValue,
            label: labelValue || viewerText(from === to
              ? 'viewer.passport.relationship.loopsBack'
              : 'viewer.passport.relationship.connectsTo'),
            edge: edge,
            shapes: shapes,
            invalid: false
          };
          recordsByKey[key] = record;
          if (edgeId) {
            if (recordsById[edgeId]) {
              recordsById[edgeId].invalid = true;
              record.invalid = true;
            } else {
              recordsById[edgeId] = record;
            }
          }
          records.push(record);
        });
        return records.filter(function (record) { return !record.invalid && record.from && record.to; });
      }
      function relationshipRecordForKey(key) {
        return relationshipHitRecords().find(function (record) { return record.key === key; }) || null;
      }
      function pinnedRelationshipRecord() {
        return pinnedRelationshipKey ? relationshipRecordForKey(pinnedRelationshipKey) : null;
      }
      function renderRelationshipCopyAction() {
        var record = pinnedRelationshipRecord();
        if (record && record.id) {
          copyBtn.textContent = viewerText('viewer.passport.copyRelation');
          copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copyPinned'));
        } else if (pinnedRelationshipKey) {
          copyBtn.textContent = viewerText('viewer.passport.copyNode');
          copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copySource'));
        } else {
          copyBtn.textContent = viewerText('viewer.passport.copy');
          copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copy.focus'));
        }
      }
      function relationshipHitGeometry(shape, className) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('filter');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('tabindex');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-labelledby');
        clone.removeAttribute('aria-hidden');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.setAttribute('class', className || 'relationship-hit-rail');
        return clone;
      }
      function removeRelationshipPulse() {
        Array.prototype.forEach.call(svg.querySelectorAll('[data-relationship-pulse-overlay]'), function (element) {
          element.remove();
        });
      }
      function relationshipPulseGeometry(shape) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('transform');
        clone.removeAttribute('filter');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('tabindex');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-hidden');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.removeAttribute('data-focus-match');
        clone.removeAttribute('data-relationship-preview');
        clone.setAttribute('class', 'relationship-flow-pulse');
        clone.setAttribute('pathLength', '1');
        return clone;
      }
      function relationshipTokenKind(edge) {
        var shapes = relationshipEdgeShapes(edge);
        var classEvidence = [edge.getAttribute('class') || ''].concat(shapes.map(function (shape) {
          return shape.getAttribute('class') || '';
        })).join(' ');
        var from = edge.getAttribute('data-edge-from') || '';
        var to = edge.getAttribute('data-edge-to') || '';
        var source = nodes().find(function (node) { return node.getAttribute('data-node-id') === from; });
        var target = nodes().find(function (node) { return node.getAttribute('data-node-id') === to; });
        var sourceKind = source ? source.getAttribute('data-node-kind') || 'neutral' : 'neutral';
        var targetKind = target ? target.getAttribute('data-node-kind') || 'neutral' : 'neutral';
        if (/\ba-security\b/.test(classEvidence) || sourceKind === 'security' || targetKind === 'security' || targetKind === 'failure') return 'security';
        if (/\ba-dashed\b/.test(classEvidence) || sourceKind === 'messagebus' || targetKind === 'messagebus') return 'event';
        if (sourceKind === 'database' || targetKind === 'database') return 'data';
        if (targetKind === 'waiting' || targetKind === 'success') return 'state';
        return 'call';
      }
      function relationshipTokenPath(shape) {
        if (!shape) return '';
        var tagName = String(shape.tagName || '').toLowerCase();
        if (tagName === 'path') return shape.getAttribute('d') || '';
        if (tagName === 'line') {
          return 'M ' + shape.getAttribute('x1') + ' ' + shape.getAttribute('y1') +
            ' L ' + shape.getAttribute('x2') + ' ' + shape.getAttribute('y2');
        }
        if (tagName === 'polyline' && shape.points && shape.points.numberOfItems > 1) {
          var commands = [];
          for (var i = 0; i < shape.points.numberOfItems; i += 1) {
            var point = shape.points.getItem(i);
            commands.push((i === 0 ? 'M ' : 'L ') + point.x + ' ' + point.y);
          }
          return commands.join(' ');
        }
        return '';
      }
      function relationshipTokenPart(tagName, className, attrs) {
        var part = document.createElementNS(svgNamespace, tagName);
        part.setAttribute('class', className);
        Object.keys(attrs || {}).forEach(function (name) { part.setAttribute(name, attrs[name]); });
        return part;
      }
      function relationshipTokenGeometry(shape, kind, key, options) {
        options = options || {};
        var pathData = relationshipTokenPath(shape);
        if (!pathData) return null;
        var token = document.createElementNS(svgNamespace, 'g');
        token.setAttribute('class', 'semantic-flow-token ' + (options.className || 'relationship-flow-token'));
        token.setAttribute('data-token-kind', kind);
        token.setAttribute('data-token-edge-key', key);
        token.setAttribute('aria-hidden', 'true');
        token.appendChild(relationshipTokenPart('circle', 'semantic-flow-token-halo', { cx: '0', cy: '0', r: '7' }));
        if (kind === 'data') {
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '-5', y: '-4', width: '10', height: '8', rx: '2' }));
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-ink', { d: 'M -2.8 -1.2 h 5.6 M -2.8 1.4 h 3.8' }));
        } else if (kind === 'event') {
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '-7', y: '-3', width: '4', height: '6', rx: '1' }));
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '-2', y: '-3', width: '4', height: '6', rx: '1' }));
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '3', y: '-3', width: '4', height: '6', rx: '1' }));
        } else if (kind === 'security') {
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-shape', { d: 'M 0 -5 L 4 -3.4 V 0 c 0 3 -1.6 4.5 -4 5.5 C -2.4 4.5 -4 3 -4 0 v -3.4 Z' }));
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-ink', { d: 'm -2 .2 1.4 1.4 L 2 -1.4' }));
        } else if (kind === 'state') {
          token.appendChild(relationshipTokenPart('circle', 'relationship-flow-token-shape', { cx: '0', cy: '0', r: '5' }));
          token.appendChild(relationshipTokenPart('circle', 'relationship-flow-token-dot', { cx: '0', cy: '0', r: '1.35' }));
        } else {
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-ink', { d: 'M -5 -3 L -1 0 L -5 3 M 0 -3 L 4 0 L 0 3' }));
        }
        var motion = document.createElementNS(svgNamespace, 'animateMotion');
        motion.setAttribute('path', pathData);
        motion.setAttribute('dur', options.duration || '1.2s');
        motion.setAttribute('begin', '0s');
        motion.setAttribute('fill', 'freeze');
        motion.setAttribute('rotate', 'auto');
        motion.setAttribute('calcMode', 'spline');
        motion.setAttribute('keyTimes', '0;1');
        motion.setAttribute('keySplines', '.2 0 .2 1');
        token.appendChild(motion);
        return token;
      }
      function createSemanticFlowToken(edge, shape, options) {
        if (!edge || !shape) return null;
        var key = edge.getAttribute('data-edge-key') || (
          edge.getAttribute('data-edge-from') + '\u0000' +
          edge.getAttribute('data-edge-to') + '\u0000' +
          (edge.getAttribute('data-edge-label') || '')
        );
        return relationshipTokenGeometry(shape, relationshipTokenKind(edge), key, options);
      }
      Archify.flowTokens = {
        create: createSemanticFlowToken,
        kind: function (edge) { return relationshipTokenKind(edge); },
        path: relationshipTokenPath
      };
      function renderRelationshipPulse(key) {
        removeRelationshipPulse();
        if (!key || document.documentElement.getAttribute('data-embed') === 'true') return false;
        if (document.hidden || (Archify.motionGovernor && Archify.motionGovernor.isPaused())) return false;
        if (reducedMotionQuery && reducedMotionQuery.matches) return false;
        var matchingEdges = edges().filter(function (edge) {
          return edge.getAttribute('data-edge-key') === key;
        });
        if (!matchingEdges.length) return false;
        var overlay = document.createElementNS(svgNamespace, 'g');
        overlay.setAttribute('class', 'relationship-pulse-overlay');
        overlay.setAttribute('data-relationship-pulse-overlay', '');
        overlay.setAttribute('data-relationship-pulse-key', key);
        overlay.setAttribute('aria-hidden', 'true');
        var tokenAdded = false;
        matchingEdges.forEach(function (edge) {
          var wrapper = document.createElementNS(svgNamespace, 'g');
          if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
          var shapes = relationshipEdgeShapes(edge);
          shapes.forEach(function (shape) {
            wrapper.appendChild(relationshipPulseGeometry(shape));
          });
          if (!tokenAdded && shapes.length) {
            var tokenKind = relationshipTokenKind(edge);
            var token = relationshipTokenGeometry(shapes[0], tokenKind, key);
            if (token) {
              wrapper.appendChild(token);
              overlay.setAttribute('data-relationship-token-kind', tokenKind);
              tokenAdded = true;
            }
          }
          if (wrapper.childNodes.length) overlay.appendChild(wrapper);
        });
        if (!overlay.childNodes.length) return false;
        var finishPulse = function () {
          if (overlay.parentNode) overlay.remove();
        };
        overlay.addEventListener('animationend', finishPulse, { once: true });
        overlay.addEventListener('animationcancel', finishPulse, { once: true });
        var firstNode = svg.querySelector('[data-node-id]');
        if (firstNode) svg.insertBefore(overlay, firstNode);
        else svg.appendChild(overlay);
        return true;
      }
      function clearRelationshipPreview(options) {
        options = options || {};
        if (directPreviewTimer) window.clearTimeout(directPreviewTimer);
        directPreviewTimer = null;
        removeRelationshipPulse();
        activeRelationshipPreview = null;
        svg.removeAttribute('data-relationship-preview-active');
        svg.removeAttribute('data-relationship-direct-active');
        if (options.clearPin === true) {
          pinnedRelationship = null;
          pinnedRelationshipKey = null;
          svg.removeAttribute('data-relationship-pin-active');
        }
        chip.removeAttribute('data-relationship-previewing');
        edges().forEach(function (edge) { edge.removeAttribute('data-relationship-preview'); });
        nodes().forEach(function (node) {
          node.removeAttribute('data-relationship-preview-node');
          node.removeAttribute('data-relationship-preview-source');
          node.removeAttribute('data-relationship-preview-target');
        });
        Array.prototype.forEach.call(relationshipList.querySelectorAll('[data-preview-active]'), function (button) {
          button.removeAttribute('data-preview-active');
        });
        relationshipHitTargets.forEach(function (target) {
          target.setAttribute('aria-pressed', pinnedRelationshipKey && target.getAttribute('data-relationship-key') === pinnedRelationshipKey ? 'true' : 'false');
          target.removeAttribute('data-preview-active');
        });
        renderRelationshipCopyAction();
        requestLensPlacement();
      }
      function previewRelationship(button, options) {
        options = options || {};
        if (pinnedRelationshipKey && pinnedRelationship && button !== pinnedRelationship) return;
        clearRelationshipPreview();
        if (!button) return;
        var key = button.getAttribute('data-relationship-key');
        var from = button.getAttribute('data-relationship-from');
        var to = button.getAttribute('data-relationship-to');
        if (!key || !from || !to) return;
        svg.setAttribute('data-relationship-preview-active', key);
        if (options.direct === true) svg.setAttribute('data-relationship-direct-active', key);
        edges().forEach(function (edge) {
          if (edge.getAttribute('data-edge-key') === key) edge.setAttribute('data-relationship-preview', '');
        });
        nodes().forEach(function (node) {
          var id = node.getAttribute('data-node-id');
          if (id !== from && id !== to) return;
          node.setAttribute('data-relationship-preview-node', '');
          if (id === from) node.setAttribute('data-relationship-preview-source', '');
          if (id === to) node.setAttribute('data-relationship-preview-target', '');
        });
        button.setAttribute('data-preview-active', 'true');
        if (!chip.hidden && options.direct !== true) chip.setAttribute('data-relationship-previewing', 'true');
        activeRelationshipPreview = button;
        renderRelationshipPulse(key);
        requestLensPlacement();
      }
      function syncRelationshipPreview() {
        var next = pinnedRelationship || focusedRelationship || hoveredRelationship;
        if (next === activeRelationshipPreview) return;
        previewRelationship(next, { direct: !!(next && next.hasAttribute('data-relationship-hit-key')) });
      }
      function directRelationshipBlocked() {
        return html.getAttribute('data-embed') === 'true' ||
          html.getAttribute('data-guide-open') === 'true' ||
          container.classList.contains('is-panning') ||
          (activeIds.length > 0 && !pinnedRelationshipKey) ||
          svg.hasAttribute('data-story-active') ||
          svg.hasAttribute('data-route-picking') ||
          svg.hasAttribute('data-route-active') ||
          svg.hasAttribute('data-lens-active') ||
          svg.hasAttribute('data-chapter-preview');
      }
      function scheduleDirectRelationshipPreview(target) {
        if (directPreviewTimer) window.clearTimeout(directPreviewTimer);
        if (pinnedRelationshipKey) return;
        directPreviewTimer = window.setTimeout(function () {
          directPreviewTimer = null;
          if (pinnedRelationshipKey || hoveredRelationship !== target || directRelationshipBlocked()) return;
          previewRelationship(target, { direct: true });
        }, reducedMotionQuery && reducedMotionQuery.matches ? 0 : 90);
      }
      function relationshipHitTarget(key) {
        return relationshipHitTargets.find(function (target) {
          return target.getAttribute('data-relationship-key') === key;
        }) || null;
      }
      function revealPinnedRelationship(record) {
        function reveal() {
          if (!record || pinnedRelationshipKey !== record.key) return true;
          if (!Archify.view || typeof Archify.view.reveal !== 'function') return false;
          Archify.view.reveal([record.from, record.to], { reason: 'relationship-direct' });
          return true;
        }
        if (!reveal()) requestAnimationFrame(reveal);
      }
      function inspectRelationship(key, options) {
        options = options || {};
        if (html.getAttribute('data-embed') === 'true') return false;
        if (directPreviewTimer) window.clearTimeout(directPreviewTimer);
        directPreviewTimer = null;
        hoveredRelationship = null;
        focusedRelationship = null;
        if (pinnedRelationshipKey === key) {
          if (options.toggle === false) return true;
          clear({ updateUrl: options.updateUrl !== false });
          return true;
        }
        var record = relationshipRecordForKey(key);
        if (!record) return false;
        if (Archify.guidedViews && typeof Archify.guidedViews.showAll === 'function') {
          Archify.guidedViews.showAll({ clearFocus: false, updateUrl: false });
        }
        set(record.from, { toggle: false, updateUrl: false });
        var row = Array.prototype.slice.call(relationshipList.querySelectorAll('[data-relationship-key]')).find(function (candidate) {
          return candidate.getAttribute('data-relationship-key') === key;
        });
        if (!row) return false;
        previewRelationship(row);
        pinnedRelationship = row;
        pinnedRelationshipKey = key;
        svg.setAttribute('data-relationship-pin-active', key);
        var target = relationshipHitTarget(key);
        if (target) target.setAttribute('aria-pressed', 'true');
        renderRelationshipCopyAction();
        summary.textContent = viewerText('viewer.passport.relationship.pinned', {
          from: record.fromLabel,
          to: record.toLabel,
          label: record.label
        });
        revealPinnedRelationship(record);
        if (options.updateUrl !== false && record.id) {
          try { ArchifyAddress.replaceState(null, '', ArchifyAddress.location.pathname + ArchifyAddress.location.search + '#relation=' + encodeURIComponent(record.id)); } catch (_) {}
        }
        return true;
      }
      function inspectRelationshipById(id, options) {
        var record = relationshipHitRecords().find(function (item) { return item.id === id; });
        return record ? inspectRelationship(record.key, options) : false;
      }
      function installRelationshipHitTargets() {
        if (html.getAttribute('data-embed') === 'true') return 0;
        var records = relationshipHitRecords();
        if (!records.length) return 0;
        relationshipHitOverlay = document.createElementNS(svgNamespace, 'g');
        relationshipHitOverlay.setAttribute('class', 'relationship-hit-overlay');
        relationshipHitOverlay.setAttribute('data-relationship-hit-overlay', '');
        relationshipHitOverlay.setAttribute('role', 'group');
        relationshipHitOverlay.setAttribute('aria-label', viewerText('viewer.passport.relationship.explorer'));
        var relationshipHelp = document.createElementNS(svgNamespace, 'desc');
        relationshipHelp.id = 'archify-relationship-help';
        relationshipHelp.textContent = viewerText('viewer.passport.relationship.help');
        relationshipHitOverlay.appendChild(relationshipHelp);
        records.forEach(function (record, index) {
          var target = document.createElementNS(svgNamespace, 'g');
          target.setAttribute('class', 'relationship-hit-target');
          target.setAttribute('data-relationship-hit-key', record.key);
          target.setAttribute('data-relationship-key', record.key);
          target.setAttribute('data-relationship-from', record.from);
          target.setAttribute('data-relationship-to', record.to);
          if (record.id) target.setAttribute('data-relationship-id', record.id);
          target.setAttribute('role', 'button');
          target.setAttribute('tabindex', index === 0 ? '0' : '-1');
          target.setAttribute('aria-pressed', 'false');
          target.setAttribute('aria-describedby', relationshipHelp.id);
          var description = viewerText('viewer.passport.relationship.inspect', {
            index: index + 1,
            total: records.length,
            from: record.fromLabel,
            to: record.toLabel,
            label: record.label
          });
          target.setAttribute('aria-label', description);
          var title = document.createElementNS(svgNamespace, 'title');
          title.textContent = record.fromLabel + ' \u2192 ' + record.toLabel + ' \u00b7 ' + record.label;
          target.appendChild(title);
          record.shapes.forEach(function (shape) {
            target.appendChild(relationshipHitGeometry(shape));
            target.appendChild(relationshipHitGeometry(shape, 'relationship-focus-rail'));
          });
          if (target.childNodes.length > 1) {
            relationshipHitTargets.push(target);
            relationshipHitOverlay.appendChild(target);
          }
        });
        if (!relationshipHitTargets.length) return 0;
        var firstNode = svg.querySelector('[data-node-id]');
        var nodeLayer = firstNode;
        while (nodeLayer && nodeLayer.parentNode && nodeLayer.parentNode !== svg) nodeLayer = nodeLayer.parentNode;
        if (nodeLayer && nodeLayer.parentNode === svg) svg.insertBefore(relationshipHitOverlay, nodeLayer);
        else svg.appendChild(relationshipHitOverlay);

        relationshipHitOverlay.addEventListener('pointerdown', function (event) {
          if (event.target.closest('[data-relationship-hit-key]')) event.stopPropagation();
        });
        relationshipHitOverlay.addEventListener('pointerover', function (event) {
          if (event.pointerType === 'touch') return;
          if (finePointerQuery && !finePointerQuery.matches) return;
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || directRelationshipBlocked() || pinnedRelationshipKey) return;
          if (event.relatedTarget && target.contains(event.relatedTarget)) return;
          hoveredRelationship = target;
          scheduleDirectRelationshipPreview(target);
        });
        relationshipHitOverlay.addEventListener('pointerout', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || (event.relatedTarget && target.contains(event.relatedTarget))) return;
          if (hoveredRelationship === target) hoveredRelationship = null;
          syncRelationshipPreview();
        });
        relationshipHitOverlay.addEventListener('focusin', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || directRelationshipBlocked()) return;
          focusedRelationship = target;
          if (!pinnedRelationshipKey) previewRelationship(target, { direct: true });
        });
        relationshipHitOverlay.addEventListener('focusout', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || (event.relatedTarget && target.contains(event.relatedTarget))) return;
          if (focusedRelationship === target) focusedRelationship = null;
          syncRelationshipPreview();
        });
        relationshipHitOverlay.addEventListener('click', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || directRelationshipBlocked()) return;
          event.preventDefault();
          event.stopPropagation();
          focusedRelationship = null;
          hoveredRelationship = null;
          inspectRelationship(target.getAttribute('data-relationship-key'));
        });
        relationshipHitOverlay.addEventListener('keydown', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target) return;
          if (event.key === 'Escape' && pinnedRelationshipKey) {
            event.preventDefault();
            clear({ updateUrl: false });
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            focusedRelationship = null;
            hoveredRelationship = null;
            inspectRelationship(target.getAttribute('data-relationship-key'));
            return;
          }
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
          var index = relationshipHitTargets.indexOf(target);
          if (event.key === 'Home') index = 0;
          else if (event.key === 'End') index = relationshipHitTargets.length - 1;
          else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % relationshipHitTargets.length;
          else index = (index - 1 + relationshipHitTargets.length) % relationshipHitTargets.length;
          event.preventDefault();
          relationshipHitTargets.forEach(function (item, itemIndex) { item.setAttribute('tabindex', itemIndex === index ? '0' : '-1'); });
          try { relationshipHitTargets[index].focus({ preventScroll: true }); }
          catch (_) { try { relationshipHitTargets[index].focus(); } catch (_) {} }
        });
        return relationshipHitTargets.length;
      }
      function renderRelationshipLens(id, byId) {
        hoveredRelationship = null;
        focusedRelationship = null;
        clearRelationshipPreview({ clearPin: true });
        renderPassport(id, byId[id]);
        var relationships = relationshipsFor(id, byId);
        chip.removeAttribute('data-relations-expanded');
        relationsBtn.setAttribute('aria-expanded', 'false');
        relationsBtn.textContent = viewerCount('viewer.passport.relationship.count', relationships.length);
        relationsBtn.setAttribute('aria-label', viewerCount('viewer.passport.relationship.show', relationships.length));
        var counts = { out: 0, in: 0, loop: 0 };
        relationships.forEach(function (relationship) { counts[relationship.direction] += 1; });
        summary.textContent = viewerText('viewer.passport.relationship.summary', {
          out: counts.out,
          in: counts.in,
          loops: counts.loop ? viewerText('viewer.passport.relationship.loops', { count: counts.loop }) : ''
        });
        renderReachabilityControls(id);
        relationshipList.textContent = '';
        if (!relationships.length) {
          var empty = document.createElement('p');
          empty.className = 'relationship-lens-empty';
          empty.textContent = viewerText('viewer.passport.relationship.none');
          relationshipList.appendChild(empty);
          return;
        }

        [
          { id: 'out', label: viewerText('viewer.passport.relationship.group.out') },
          { id: 'in', label: viewerText('viewer.passport.relationship.group.in') },
          { id: 'loop', label: viewerText('viewer.passport.relationship.group.loop') }
        ].forEach(function (group) {
          var items = relationships.filter(function (relationship) { return relationship.direction === group.id; });
          if (!items.length) return;
          var section = document.createElement('div');
          section.className = 'relationship-lens-group';
          var heading = document.createElement('span');
          heading.className = 'relationship-lens-group-title';
          heading.textContent = group.label + ' · ' + items.length;
          section.appendChild(heading);
          items.forEach(function (relationship) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'relationship-lens-row';
            button.setAttribute('data-direction', relationship.direction);
            button.setAttribute('data-relationship-target', relationship.neighborId);
            button.setAttribute('data-relationship-key', relationship.key);
            button.setAttribute('data-relationship-from', relationship.from);
            button.setAttribute('data-relationship-to', relationship.to);
            if (relationship.id) button.setAttribute('data-relationship-id', relationship.id);
            button.setAttribute('aria-label', viewerText('viewer.passport.relationship.row', {
              group: group.label,
              relationship: relationship.label,
              neighbor: relationship.neighborLabel
            }));
            var direction = document.createElement('span');
            direction.className = 'relationship-lens-direction';
            direction.setAttribute('aria-hidden', 'true');
            direction.textContent = viewerText(relationship.direction === 'out'
              ? 'viewer.passport.relationship.direction.out'
              : relationship.direction === 'in'
                ? 'viewer.passport.relationship.direction.in'
                : 'viewer.passport.relationship.direction.loop');
            var target = document.createElement('strong');
            target.textContent = relationship.neighborLabel;
            var relation = document.createElement('small');
            relation.textContent = relationship.label;
            button.appendChild(direction);
            button.appendChild(target);
            button.appendChild(relation);
            section.appendChild(button);
          });
          relationshipList.appendChild(section);
        });
      }
      var lensFrame = 0;
      function placeRelationshipLens() {
        lensFrame = 0;
        if (chip.hidden || activeIds.length !== 1 || !container.contains(chip)) return;
        var node = svg.querySelector('[data-node-id="' + activeIds[0] + '"]');
        if (!node) return;
        var containerRect = container.getBoundingClientRect();
        var nodeRect = node.getBoundingClientRect();
        if (containerRect.bottom <= 0 || containerRect.top >= window.innerHeight) return;
        var padding = window.innerWidth <= 720 ? 8 : 16;
        var visibleTop = Math.max(padding, -containerRect.top + padding);
        var visibleBottom = Math.min(containerRect.height - padding, window.innerHeight - containerRect.top - padding);
        var maxTop = Math.max(padding, visibleBottom - chip.offsetHeight);
        var minTop = Math.min(visibleTop, maxTop);
        var nodeCenter = nodeRect.top - containerRect.top + nodeRect.height / 2;
        var mobile = window.innerWidth <= 720;
        var previewingOnMobile = mobile && chip.getAttribute('data-relationship-previewing') === 'true';
        var compactOnMobile = mobile && chip.getAttribute('data-relations-expanded') !== 'true';
        var preferred;
        if (compactOnMobile) {
          var nodeTop = nodeRect.top - containerRect.top;
          var nodeBottom = nodeRect.bottom - containerRect.top;
          var gap = 10;
          var above = nodeTop - chip.offsetHeight - gap;
          var below = nodeBottom + gap;
          if (above >= visibleTop) preferred = above;
          else if (below + chip.offsetHeight <= visibleBottom - 56) preferred = below;
          else preferred = nodeCenter < (visibleTop + visibleBottom) / 2
            ? Math.max(minTop, visibleBottom - chip.offsetHeight - 56)
            : visibleTop;
        } else if (previewingOnMobile) {
          var pinnedTop = visibleTop;
          var pinnedBottom = Math.max(minTop, visibleBottom - chip.offsetHeight - 56);
          preferred = nodeCenter < (visibleTop + visibleBottom) / 2 ? pinnedBottom : pinnedTop;
        } else {
          preferred = nodeCenter - chip.offsetHeight / 2;
        }
        var top = Math.max(minTop, Math.min(maxTop, preferred));
        var chipRect = chip.getBoundingClientRect();
        var safeGap = 10;
        var protectViewerChrome = !mobile || compactOnMobile || previewingOnMobile;
        var protectedRects = (protectViewerChrome
          ? [svg.querySelector('[data-legend]'), container.querySelector('.diagram-nav')]
          : [])
          .filter(function (element) {
            if (!element || element.hidden) return false;
            var style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map(function (element) { return element.getBoundingClientRect(); })
          .filter(function (rect) {
            return rect.width > 0 && rect.height > 0 &&
              chipRect.left < rect.right + safeGap && chipRect.right > rect.left - safeGap;
          });
        if (protectedRects.length) {
          var candidates = [top, minTop, maxTop];
          protectedRects.forEach(function (rect) {
            candidates.push(
              rect.top - containerRect.top - chip.offsetHeight - safeGap,
              rect.bottom - containerRect.top + safeGap
            );
          });
          var valid = candidates.map(function (candidate) {
            return Math.max(minTop, Math.min(maxTop, candidate));
          }).filter(function (candidate, index, all) {
            if (all.indexOf(candidate) !== index) return false;
            var candidateTop = containerRect.top + candidate;
            var candidateBottom = candidateTop + chip.offsetHeight;
            return protectedRects.every(function (rect) {
              return candidateBottom <= rect.top - safeGap || candidateTop >= rect.bottom + safeGap;
            });
          });
          valid.sort(function (first, second) {
            return Math.abs(first - preferred) - Math.abs(second - preferred);
          });
          if (valid.length) top = valid[0];
        }
        chip.style.top = Math.round(top) + 'px';
        if (Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
      }
      function requestLensPlacement() {
        if (lensFrame) return;
        lensFrame = requestAnimationFrame(placeRelationshipLens);
      }
      function clear(options) {
        options = options || {};
        var restoreNode = options.restoreFocus === true && activeIds.length === 1
          ? svg.querySelector('[data-node-id="' + activeIds[0] + '"]')
          : null;
        clearReachability({ updateUrl: false });
        if (Archify.intentTrace && typeof Archify.intentTrace.clear === 'function') {
          Archify.intentTrace.clear({ announce: false });
        }
        hoveredRelationship = null;
        focusedRelationship = null;
        clearRelationshipPreview({ clearPin: true });
        activeIds = [];
        svg.removeAttribute('data-focus-active');
        nodes().forEach(function (node) {
          node.removeAttribute('data-focus-match');
          node.removeAttribute('data-focus-selected');
          node.setAttribute('aria-pressed', 'false');
        });
        edges().forEach(function (edge) { edge.removeAttribute('data-focus-match'); });
        chip.hidden = true;
        label.textContent = '';
        detail.textContent = '';
        detail.hidden = true;
        Archify.developerGuide.clearQuicklook();
        kind.textContent = '';
        kind.hidden = true;
        context.textContent = '';
        context.hidden = true;
        tag.textContent = '';
        tag.hidden = true;
        semanticId.textContent = '';
        semanticId.hidden = true;
        evidence.hidden = true;
        evidenceLinks.textContent = '';
        repositoryLink.removeAttribute('href');
        repositoryLink.textContent = '';
        summary.textContent = '';
        reachSection.hidden = true;
        upstreamCount.textContent = '0';
        downstreamCount.textContent = '0';
        upstreamBtn.disabled = true;
        downstreamBtn.disabled = true;
        relationshipList.textContent = '';
        copyBtn.textContent = viewerText('viewer.passport.copy');
        copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copy.focus'));
        relationsBtn.textContent = viewerText('viewer.passport.relations');
        relationsBtn.setAttribute('aria-label', viewerText('viewer.passport.relations.show'));
        relationsBtn.setAttribute('aria-expanded', 'false');
        chip.removeAttribute('data-relations-expanded');
        chip.style.removeProperty('top');
        if (options.preserveView !== true && atlasInspection() && Archify.view) Archify.view.hold();
        if (options.preserveView !== true && !atlasInspection() && Archify.view && typeof Archify.view.reset === 'function') {
          Archify.view.reset({ automatic: true });
        }
        if (options.updateUrl !== false) {
          try { ArchifyAddress.replaceState(null, '', ArchifyAddress.location.pathname + ArchifyAddress.location.search); } catch (_) {}
          Archify.developerGuide.syncAddress().catch(function () {});
        }
        if (restoreNode) {
          try { restoreNode.focus({ preventScroll: true }); }
          catch (_) { try { restoreNode.focus(); } catch (_) {} }
        }
      }

      function setMany(ids, options) {
        options = options || {};
        if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (Archify.semanticLens && Archify.semanticLens.active()) {
          Archify.semanticLens.clear({ updateUrl: false, preserveView: true, closePanel: true });
        }
        if (options.preserveRoute !== true && Archify.routeProbe && typeof Archify.routeProbe.clear === 'function') {
          Archify.routeProbe.clear({ updateUrl: false, restoreFocus: false });
        }
        var nodeList = nodes();
        var byId = {};
        nodeList.forEach(function (node) { byId[node.getAttribute('data-node-id')] = node; });
        var normalized = [];
        (ids || []).forEach(function (id) {
          if (byId[id] && normalized.indexOf(id) === -1) normalized.push(id);
        });
        if (!normalized.length) return false;
        if (normalized.length === activeIds.length && normalized.every(function (id, index) { return activeIds[index] === id; }) && options.toggle !== false) {
          clear();
          return true;
        }

        clear({ updateUrl: false, preserveView: true });
        activeIds = normalized;
        var selected = {};
        var related = {};
        var seenEdges = {};
        var matchedEdges = 0;
        normalized.forEach(function (id) { selected[id] = true; related[id] = true; });
        var selectionMode = options.mode === 'selection' || normalized.length > 1;

        edges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var match = selectionMode ? selected[from] && selected[to] : selected[from] || selected[to];
          if (!match) return;
          edge.setAttribute('data-focus-match', '');
          if (!selectionMode) { related[from] = true; related[to] = true; }
          var edgeKey = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + (edge.getAttribute('data-edge-label') || ''));
          if (!seenEdges[edgeKey]) { seenEdges[edgeKey] = true; matchedEdges += 1; }
        });
        nodeList.forEach(function (node) {
          var nodeId = node.getAttribute('data-node-id');
          if (related[nodeId]) node.setAttribute('data-focus-match', '');
          if (selected[nodeId]) {
            node.setAttribute('data-focus-selected', '');
            node.setAttribute('aria-pressed', 'true');
          }
        });
        svg.setAttribute('data-focus-active', normalized.join(' '));
        var defaultLabel = normalized.length === 1
          ? nodeLabel(byId[normalized[0]], normalized[0])
          : viewerText('viewer.guided.chapter.selectedNodes', { count: normalized.length });
        label.textContent = options.label || defaultLabel;
        chip.hidden = options.hideChip === true || normalized.length !== 1 || selectionMode;
        if (!chip.hidden) {
          renderRelationshipLens(normalized[0], byId);
          requestLensPlacement();
        }
        if (options.updateUrl !== false) {
          var key = options.urlKey || 'focus';
          var value = options.urlValue || normalized[0];
          try { ArchifyAddress.replaceState(null, '', ArchifyAddress.location.pathname + ArchifyAddress.location.search + '#' + key + '=' + encodeURIComponent(value)); } catch (_) {}
          Archify.developerGuide.syncAddress().catch(function () {});
        }
        return true;
      }

      function set(id, options) {
        options = options || {};
        options.mode = 'neighborhood';
        return setMany([id], options);
      }

      function copyFocusLink() {
        if (activeIds.length !== 1) return Promise.resolve(false);
        var record = pinnedRelationshipRecord();
        var relationId = record && record.id;
        var value = ArchifyAddress.share(relationId
          ? '#relation=' + encodeURIComponent(relationId)
          : '#focus=' + encodeURIComponent(activeIds[0]) + (reachabilityMode ? '&reach=' + reachabilityMode : ''));
        var copy = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
          ? navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return fallbackCopy(value); })
          : Promise.resolve(fallbackCopy(value));
        return copy.then(function (copied) {
          copyBtn.textContent = viewerText(copied ? 'viewer.common.copied' : 'viewer.common.copyFailed');
          copyBtn.setAttribute('aria-label', copied
            ? viewerText(relationId ? 'viewer.passport.copy.pinned.success' : 'viewer.passport.copy.focused.success')
            : viewerText(relationId ? 'viewer.passport.copy.pinned.failed' : 'viewer.passport.copy.focused.failed'));
          window.setTimeout(function () {
            renderRelationshipCopyAction();
          }, 1600);
          return copied;
        });
      }

      svg.addEventListener('click', function (event) {
        if (container.getAttribute('data-just-panned') === 'true') return;
        var node = event.target.closest('[data-node-id]');
        if (node) {
          var id = node.getAttribute('data-node-id');
          if (atlasInspection() && Archify.view) Archify.view.hold();
          set(id);
          if (!atlasInspection() && activeIds.indexOf(id) !== -1 && Archify.view && typeof Archify.view.reveal === 'function') {
            Archify.view.reveal([id], { includeNeighbors: true, reason: 'focus' });
          }
        }
        else if (activeIds.length) clear();
      });
      svg.addEventListener('keydown', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        var id = node.getAttribute('data-node-id');
        if (atlasInspection() && Archify.view) Archify.view.hold();
        set(id);
        if (!atlasInspection() && activeIds.indexOf(id) !== -1 && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'focus' });
        }
      });
      clearBtn.addEventListener('click', function () { clear({ restoreFocus: true }); });
      copyBtn.addEventListener('click', copyFocusLink);
      upstreamBtn.addEventListener('click', function () { applyReachability('upstream'); });
      downstreamBtn.addEventListener('click', function () { applyReachability('downstream'); });
      relationsBtn.addEventListener('click', function () {
        var expanded = chip.getAttribute('data-relations-expanded') === 'true';
        if (expanded) chip.removeAttribute('data-relations-expanded');
        else chip.setAttribute('data-relations-expanded', 'true');
        relationsBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        relationsBtn.setAttribute('aria-label', viewerText(expanded
          ? 'viewer.passport.relations.show'
          : 'viewer.passport.relations.hide'));
        requestLensPlacement();
      });
      relationshipList.addEventListener('click', function (event) {
        var button = event.target.closest('[data-relationship-target]');
        if (!button) return;
        var id = button.getAttribute('data-relationship-target');
        var relationshipKey = button.getAttribute('data-relationship-key');
        if (atlasInspection() && Archify.view) Archify.view.hold();
        if (Archify.guidedViews && typeof Archify.guidedViews.showAll === 'function') {
          Archify.guidedViews.showAll({ clearFocus: false, updateUrl: false, resetView: !atlasInspection() });
        }
        set(id, { toggle: false });
        if (!atlasInspection() && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'relationship' });
        }
        var nextFocus = atlasInspection()
          ? Array.prototype.filter.call(relationshipList.querySelectorAll('[data-relationship-key]'), function (row) {
            return row.getAttribute('data-relationship-key') === relationshipKey;
          })[0] || relationsBtn
          : svg.querySelector('[data-node-id="' + id + '"]');
        if (nextFocus) {
          try { nextFocus.focus({ preventScroll: true }); } catch (_) { try { nextFocus.focus(); } catch (_) {} }
        }
      });
      relationshipList.addEventListener('pointerover', function (event) {
        if (event.pointerType === 'touch') return;
        if (finePointerQuery && !finePointerQuery.matches) return;
        var button = event.target.closest('[data-relationship-key]');
        if (!button || !relationshipList.contains(button)) return;
        if (event.relatedTarget && button.contains(event.relatedTarget)) return;
        hoveredRelationship = button;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('pointerout', function (event) {
        var button = event.target.closest('[data-relationship-key]');
        if (!button || (event.relatedTarget && button.contains(event.relatedTarget))) return;
        if (hoveredRelationship === button) hoveredRelationship = null;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('focusin', function (event) {
        var button = event.target.closest('[data-relationship-key]');
        if (!button) return;
        focusedRelationship = button;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('focusout', function (event) {
        var button = event.target.closest('[data-relationship-key]');
        if (!button || (event.relatedTarget && button.contains(event.relatedTarget))) return;
        if (focusedRelationship === button) focusedRelationship = null;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
        var buttons = Array.prototype.slice.call(relationshipList.querySelectorAll('[data-relationship-target]'));
        if (!buttons.length) return;
        var index = buttons.indexOf(document.activeElement);
        if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = buttons.length - 1;
        else if (event.key === 'ArrowDown') index = Math.min(buttons.length - 1, Math.max(0, index + 1));
        else index = Math.max(0, index < 0 ? 0 : index - 1);
        event.preventDefault();
        buttons[index].focus();
      });
      document.addEventListener('click', function (event) {
        var target = event.target;
        if (Archify.developerGuide.surface() === 'guide') return;
        if (chip.hidden || !target || typeof target.closest !== 'function' || chip.contains(target)) return;
        if (container.getAttribute('data-just-panned') === 'true') return;
        if (target.closest('[data-node-id], [data-relationship-hit-key], .overview-map, .atlas-navigation, .atlas-compact-navigation, .atlas-directory, .atlas-breadcrumb, .atlas-parent-context, .atlas-rail, .atlas-inspector, .atlas-directory-section')) return;
        clear();
      }, true);
      window.addEventListener('scroll', requestLensPlacement, { passive: true });
      window.addEventListener('resize', requestLensPlacement);
      container.addEventListener('scroll', requestLensPlacement, { passive: true });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) removeRelationshipPulse();
      });
      function syncRelationshipMotionPreference(event) {
        if (event.matches) removeRelationshipPulse();
      }
      if (reducedMotionQuery) {
        if (typeof reducedMotionQuery.addEventListener === 'function') {
          reducedMotionQuery.addEventListener('change', syncRelationshipMotionPreference);
        } else if (typeof reducedMotionQuery.addListener === 'function') {
          reducedMotionQuery.addListener(syncRelationshipMotionPreference);
        }
      }

      installRelationshipHitTargets();

      function syncFocusFromHash() {
        try {
          var params = new URLSearchParams(ArchifyAddress.location.hash.replace(/^#/, ''));
          var relation = params.get('relation');
          var initial = params.get('focus');
          var reach = params.get('reach');
          if (relation) {
            if (html.getAttribute('data-embed') === 'true' ||
                !inspectRelationshipById(relation, { updateUrl: false, toggle: false })) clear({ updateUrl: false });
          }
          else if (initial) {
            if (set(initial, { updateUrl: false, toggle: false }) &&
                (reach === 'upstream' || reach === 'downstream')) {
              applyReachability(reach, { updateUrl: false, toggle: false, reveal: false });
            }
          }
          else if (!params.get('view')) clear({ updateUrl: false });
        } catch (_) {}
      }

      window.addEventListener('hashchange', syncFocusFromHash);
      syncFocusFromHash();

      return {
        set: set,
        setMany: setMany,
        clear: clear,
        copyLink: copyFocusLink,
        reach: applyReachability,
        clearReach: clearReachability,
        reachabilitySnapshot: reachabilitySnapshot,
        inspectRelationship: inspectRelationship,
        inspectRelationshipById: inspectRelationshipById,
        reposition: requestLensPlacement,
        relationship: function () {
          var record = pinnedRelationshipRecord();
          return record ? { id: record.id || null, key: record.key, from: record.from, to: record.to, label: record.label } : null;
        },
        reachability: function () {
          return activeReachability ? {
            direction: activeReachability.direction,
            originId: activeReachability.originId,
            nodeIds: activeReachability.nodeIds.slice(),
            edgeKeys: activeReachability.edgeKeys.slice(),
            maxDepth: activeReachability.maxDepth
          } : null;
        },
        active: function () { return activeIds.length === 0 ? null : (activeIds.length === 1 ? activeIds[0] : activeIds.slice()); }
      };
    })();
    Archify.developerGuide.connect();
