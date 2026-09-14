import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { findChrome } from '../bin/visual-check.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';
import { collectProcessEvidence } from './helpers/seamless-process-evidence.mjs';
import { makeDeveloperGuideFixture, guideSections, hostileGuideText } from './helpers/developer-guide-browser-fixture.mjs';

// Launch only through an explicitly opted-in, approved browser test command.
// In particular, the default Node suite must never discover/launch local Chrome.
const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chrome = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chrome) {
  throw new Error('ARCHIFY_CHROME must name an executable browser; an invalid explicit path is not a skipped acceptance run.');
}
const tab = name => `[data-atlas-tab="${name}"]`;
const enter = '#btn-open-developer-guide';
const section = kind => `#node-guide-toc [data-guide-section="${kind}"]`;
const probeSource = `(() => {
  window.__guideErrors = []; window.__guideEvents = []; window.__guideCopies = [];
  window.__guideDownloads = []; window.__guideObjectBlobs = [];
  addEventListener('error', event => __guideErrors.push(event.message));
  addEventListener('unhandledrejection', event => __guideErrors.push(String(event.reason)));
  for (const type of ['archify:guide-ready', 'archify:guide-error', 'popstate', 'hashchange']) {
    addEventListener(type, event => __guideEvents.push({type, at:performance.now(), detail:event.detail || null, href:location.href}));
  }
  Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: {writeText:async value => { __guideCopies.push(value); }} });
  const blobs = new Map(), create = URL.createObjectURL.bind(URL), click = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = blob => { const url=create(blob); blobs.set(url,blob); __guideObjectBlobs.push(blob); return url; };
  HTMLAnchorElement.prototype.click = function () {
    if(this.download) { __guideDownloads.push({name:this.download,blob:blobs.get(this.href)}); return; }
    return click.call(this);
  };
  const candidateControl = window !== top ? top.__guideCandidateControl : null;
  if (candidateControl && !candidateControl.claimed) {
    candidateControl.claimed = true;
    candidateControl.phase = 'installed';
    let archify;
    function installReaderLayoutTrap(value) {
      if (!value || typeof value !== 'object') return;
      let readerLayout = value.readerLayout;
      function wrap(next) {
        if (!next || typeof next.whenStable !== 'function' || candidateControl.wrapped) return;
        candidateControl.wrapped = true;
        const stable = next.whenStable.bind(next);
        next.whenStable = function () {
          candidateControl.calls = (candidateControl.calls || 0) + 1;
          if (candidateControl.mode === 'reject' && !candidateControl.rejected) {
            candidateControl.rejected = true;
            candidateControl.phase = 'rejected';
            return Promise.reject(new Error('Controlled developer guide preparation failure'));
          }
          if (candidateControl.mode === 'hold' && !candidateControl.released) {
            candidateControl.phase = 'held';
            return new Promise((resolve, reject) => {
              candidateControl.release = () => {
                candidateControl.released = true;
                candidateControl.phase = 'released';
                stable().then(resolve, reject);
              };
            });
          }
          return stable();
        };
      }
      Object.defineProperty(value, 'readerLayout', {
        configurable: true,
        enumerable: true,
        get: () => readerLayout,
        set: next => { readerLayout = next; wrap(next); },
      });
      wrap(readerLayout);
    }
    Object.defineProperty(window, 'Archify', {
      configurable: true,
      enumerable: true,
      get: () => archify,
      set: value => { archify = value; installReaderLayoutTrap(value); },
    });
  }
  if (window !== top) return;
  const frames = [], eventCursors = new WeakMap();
  function drainEvents() {
    const child=document.querySelector('iframe[data-atlas-state="active"]')?.contentWindow;
    return [window,child].filter(Boolean).flatMap(view=>{
      const events=view.__guideEvents || [], start=eventCursors.get(view) || 0;
      eventCursors.set(view,events.length);
      return events.slice(start).map(event=>({...event,diagram:view.ArchifyAddress?.context?.diagram || null}));
    });
  }
  function visible(element, view) {
    if (!element || !element.getBoundingClientRect().width || !element.getBoundingClientRect().height) return false;
    for (let node=element; node; node=node.parentElement) {
      const style=view.getComputedStyle(node);
      if(node.hidden || style.display==='none' || style.visibility==='hidden' || Number(style.opacity)===0) return false;
    }
    return true;
  }
  function sample() {
    const iframe=document.querySelector('iframe[data-atlas-state="active"]');
    const view=iframe ? iframe.contentWindow : window, doc=view?.document, api=view?.Archify;
    if (!api || (iframe && (!view.ArchifyAddress.active || view.ArchifyAddress.restoring))) return null;
    const graph=doc.querySelector('.diagram-container'), guide=doc.querySelector('#node-developer-guide');
    const surface=doc.documentElement.dataset.readerSurface;
    const graphVisible=visible(graph,view), guideVisible=visible(guide,view);
    const rect=graph?.getBoundingClientRect();
    const h1=[...document.querySelectorAll('h1')].filter(node=>visible(node,window)).length +
      (iframe ? [...doc.querySelectorAll('h1')].filter(node=>visible(node,view)).length : 0);
    const duplicates=[...doc.querySelectorAll('[id]')].map(node=>node.id).filter((id,index,ids)=>ids.indexOf(id)!==index);
    const outerDuplicates=[...document.querySelectorAll('[id]')].map(node=>node.id).filter((id,index,ids)=>ids.indexOf(id)!==index);
    const address=new URLSearchParams(location.hash.slice(1));
    return {at:performance.now(),href:location.href,surface,graphVisible,guideVisible,h1,
      guideNode:guide?.dataset.nodeId || null,focus:api.focus.active(),section:api.developerGuide?.section(),
      diagram:view.ArchifyAddress.context?.diagram || null,
      graphProtected:Boolean(graph?.closest('[inert]') && graph?.closest('[aria-hidden="true"]')),
      theme:doc.documentElement.getAttribute('data-theme'),outerTheme:document.documentElement.getAttribute('data-theme'),
      address:Object.fromEntries(address),errors:[...__guideErrors,...(iframe ? view.__guideErrors || [] : [])],duplicates,outerDuplicates,
      instances:doc.querySelectorAll('#node-developer-guide').length,
      activeFrames:document.querySelectorAll('iframe[data-atlas-state="active"]').length,
      graphRect:rect ? {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom} : null,
      frames:[{visible:graphVisible || guideVisible,diagram:(view.ArchifyAddress.context?.diagram || 'standalone')+':'+surface}]};
  }
  function tick(){const value=sample();if(value)frames.push(value);requestAnimationFrame(tick);}
  requestAnimationFrame(tick);
  window.__guideProbe={sample,drain:()=>({frames:frames.splice(0),events:drainEvents(),sample:sample()})};
})();`;

const graphSnapshot = `(() => {
  const graph=document.querySelector('.diagram-container'), rect=graph.getBoundingClientRect();
  return {camera:Archify.view.snapshot(),rect:{left:rect.left+scrollX,top:rect.top+scrollY,right:rect.right+scrollX,bottom:rect.bottom+scrollY},
    node:Archify.focus.active(),tab:document.querySelector('[data-atlas-tab][aria-selected="true"]')?.dataset.atlasTab || null,
    scroll:{x:scrollX,y:scrollY,panels:Object.fromEntries([...document.querySelectorAll('.atlas-inspector-panel')].map(node=>[node.id,node.scrollTop]))},
    focus:document.activeElement.id,
    svg:[...graph.querySelectorAll(':scope > svg [data-node-id]')].map(node=>({id:node.dataset.nodeId,box:node.getBBox().toJSON ? node.getBBox().toJSON() : {x:node.getBBox().x,y:node.getBBox().y,width:node.getBBox().width,height:node.getBBox().height}}))};
})()`;

function closeNumbers(actual, expected, tolerance, context) {
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(Number.isFinite(actual[key]) && Math.abs(actual[key] - value) <= tolerance,
      `${context}.${key}: expected ${value}, actual ${actual[key]}, tolerance ${tolerance}`);
  }
}

test('developer guides preserve graph reading and commit one accessible, source-linked surface', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for real CLI developer-guide browser acceptance; requires approved GUI execution.',
}, async t => {
  // Keep all acquired process frames, artifacts and provenance even on failure.
  const evidence = process.env.ARCHIFY_GUIDE_EVIDENCE_DIR
    ? path.resolve(process.env.ARCHIFY_GUIDE_EVIDENCE_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'archify-guide-browser-'));
  fs.mkdirSync(evidence, { recursive: true });
  const data = makeDeveloperGuideFixture(path.join(evidence, 'fixture'));
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const version = await browser.cdp.send('Browser.getVersion');
  const requests = [], consoleErrors = [], allowedDocuments = new Set(), caseRecords = [];
  const documentKey = value => { const url = new URL(value); return `${url.protocol}//${url.host}${url.pathname}`; };
  let wire = '', mode = 'atlas', sequence = 0;
  function receive(chunk) {
    wire += chunk;
    let boundary;
    while ((boundary=wire.indexOf('\0')) >= 0) {
      const raw=wire.slice(0,boundary); wire=wire.slice(boundary+1);
      if (!raw) continue;
      const message=JSON.parse(raw);
      if(message.method==='Network.requestWillBeSent') requests.push({url:message.params.request.url,type:message.params.type});
      if(message.method==='Runtime.consoleAPICalled' && message.params.type==='error') consoleErrors.push(message.params.args.map(arg=>arg.value || arg.description));
    }
  }
  browser.cdp.readPipe.on('data', receive);
  t.after(() => {
    browser.cdp.readPipe.off('data', receive);
    fs.writeFileSync(path.join(evidence, 'browser-receipt.json'), `${JSON.stringify({version,requests,consoleErrors,cases:caseRecords},null,2)}\n`);
  });
  await send('Network.enable');
  await browser.cdp.send('Browser.setDownloadBehavior', {behavior:'deny'});
  await send('Page.addScriptToEvaluateOnNewDocument', {source:probeSource});
  async function run(expression, outer=false) {
    const result=await send('Runtime.evaluate', {expression:outer || mode==='architecture' ? expression
      : `document.querySelector('iframe[data-atlas-state="active"]').contentWindow.eval(${JSON.stringify(expression)})`,
    returnByValue:true,awaitPromise:true});
    assert.equal(result.exceptionDetails,undefined,result.exceptionDetails?.exception?.description || result.exceptionDetails?.text);
    return result.result?.value;
  }
  async function waitFor(expression, label, outer=false) {
    await run(`new Promise((resolve,reject)=>{const deadline=performance.now()+12000;function poll(){
      try {if(${expression}){resolve();return;}}catch(error){if(performance.now()>deadline){reject(error);return;}}
      if(performance.now()>deadline){reject(new Error(${JSON.stringify(label)}));return;}requestAnimationFrame(poll);
    }poll();})`,outer);
  }
  async function stable() {
    await run(`Promise.all([Archify.readerLayout.whenStable(),Archify.viewerChromeLayout.whenStable()])`);
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  async function ready({surface='graph',diagram='system',node,chapter}={}) {
    const member=mode==='atlas' ? `document.querySelector('iframe[data-atlas-state="active"]')?.contentWindow` : 'window';
    await waitFor(`(()=>{const w=${member};return w?.Archify?.developerGuide && w.ArchifyAddress.active && !w.ArchifyAddress.restoring
      && ${mode==='atlas' ? `w.ArchifyAddress.context.diagram===${JSON.stringify(diagram)}` : 'true'}
      && w.document.documentElement.dataset.readerSurface===${JSON.stringify(surface)}
      && w.Archify.developerGuide.surface()===${JSON.stringify(surface)}
      ${node ? `&& w.Archify.focus.active()===${JSON.stringify(node)}` : ''}
      ${chapter ? `&& w.Archify.developerGuide.section()===${JSON.stringify(chapter)}` : ''};})()`,
    `Reader did not become ${surface}: ${diagram}/${node || ''}/${chapter || ''}`,true);
    await stable();
  }
  async function open({kind='atlas',locale='en',width=1440,height=900,theme='light',hash='',base,reduced=false}={}) {
    mode=kind;
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});
    const url=`${base || pathToFileURL(data.outputs[locale][kind]).href}?theme=${theme}${hash || (kind==='atlas'?'#diagram=system':'')}`;
    allowedDocuments.add(documentKey(url));
    await send('Page.navigate',{url:'about:blank'});
    await send('Page.navigate',{url});
    const params=new URLSearchParams(new URL(url).hash.slice(1));
    await ready({surface:params.get('inspect')==='guide'?'guide':'graph',diagram:params.get('diagram') || 'system',node:params.get('focus') || undefined,chapter:params.get('section') || undefined});
    // Scenarios share one browser target, but not reading visits. Chromium
    // prunes old entries at its per-tab limit; a full suite must not make a
    // correct graph→guide push appear to have a zero history-length delta.
    // Reset only the independent scenario baseline, never a Back/Forward path.
    await send('Page.resetNavigationHistory');
    assert.equal(await run('history.length',true),1,'An independently opened scenario starts with one history entry');
    return url;
  }
  async function click(selector,outer=false) {
    await run(`(()=>{const target=document.querySelector(${JSON.stringify(selector)});if(!target)throw new Error('Missing action '+${JSON.stringify(selector)});target.scrollIntoView({block:'nearest',inline:'nearest'});})()`,outer);
    await stable();
    const point=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();
      if(!r.width || !r.height || e.closest('[inert],[hidden]'))throw new Error('Action is not interactive: '+${JSON.stringify(selector)});
      return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,outer);
    if(mode==='atlas' && !outer) {
      const offset=await run(`(()=>{const r=document.querySelector('iframe[data-atlas-state="active"]').getBoundingClientRect();return{x:r.x,y:r.y};})()`,true);
      point.x+=offset.x; point.y+=offset.y;
    }
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    await stable();
  }
  async function key(key,code,windowsVirtualKeyCode) {
    await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,text:key==='Enter'?'\r':key===' '?' ':undefined});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});
  }
  const address=()=>run('Object.fromEntries(new URLSearchParams(location.hash.slice(1)))',true);
  const historyLength=()=>run('history.length',true);
  async function exported(format) {
    return run(`(async()=>{
      const format=${JSON.stringify(format)};
      __guideDownloads.length=0;__guideObjectBlobs.length=0;
      await Archify.exportMenu.run(format);
      const file=__guideDownloads.at(-1);
      if(!file?.blob)throw new Error('No '+format+' download');
      const blob=file.blob,bytes=new Uint8Array(await blob.arrayBuffer());
      const sourceBlob=__guideObjectBlobs.filter(value=>value.type.startsWith('image/svg+xml')).at(-1);
      const sourceSvg=sourceBlob ? await sourceBlob.text() : '';
      let width=0,height=0;
      if(format==='svg') {
        const parsed=new DOMParser().parseFromString(await blob.text(),'image/svg+xml');
        if(parsed.querySelector('parsererror'))throw new Error('Invalid exported SVG');
        const viewBox=(parsed.documentElement.getAttribute('viewBox')||'').trim().split(/\\s+/).map(Number);
        width=viewBox[2]||Number(parsed.documentElement.getAttribute('width'));
        height=viewBox[3]||Number(parsed.documentElement.getAttribute('height'));
      } else if(format==='webm') {
        const video=document.createElement('video'),url=URL.createObjectURL(blob);
        video.preload='metadata';video.src=url;
        await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('Cannot decode exported WebM'));video.load();});
        width=video.videoWidth;height=video.videoHeight;URL.revokeObjectURL(url);
      } else {
        const image=await createImageBitmap(blob);width=image.width;height=image.height;image.close();
      }
      const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
      return {name:file.name,type:blob.type,bytes:blob.size,width,height,sourceSvg,encoded,
        containsGuideText:new TextDecoder().decode(bytes).includes('GUIDE_ONLY_SENTINEL')};
    })()`);
  }
  async function record(name,action) {
    await run('__guideProbe.drain()',true);
    const directory=path.join(evidence,`${String(++sequence).padStart(2,'0')}-${name}`);
    fs.mkdirSync(directory,{recursive:true});
    const baseline=await run('__guideProbe.sample()',true);
    assert.ok(baseline,`${name}: a committed pre-action workspace exists`);
    const beforeImage=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(directory,'before.png'),Buffer.from(beforeImage.data,'base64'));
    fs.writeFileSync(path.join(directory,'before.json'),`${JSON.stringify(baseline,null,2)}\n`);
    const collected=await collectProcessEvidence({directory,
      read:()=>run('__guideProbe?.drain() || {frames:[],events:[],sample:null}',true),
      capture:()=>send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),
      timestamp:()=>run('performance.now()',true),action,
      settle:()=>run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',true),
    });
    caseRecords.push({name,directory,frames:collected.frames.length+1,images:collected.images.length+1,errors:collected.errors.map(item=>({phase:item.phase,message:item.error.message}))});
    if(collected.errors.length) throw collected.errors[0].error;
    assert.ok(collected.frames.length>1,`${name}: expected continuous rAF observations`);
    assert.ok(collected.images.length>0,`${name}: expected real PNG capture`);
    for(const frame of [baseline,...collected.frames]) {
      assert.equal(Number(frame.graphVisible)+Number(frame.guideVisible),1,`${name}: exactly one workspace: ${JSON.stringify(frame)}`);
      assert.deepEqual(frame.errors,[],`${name}: runtime errors`);
      assert.deepEqual(frame.duplicates,[],`${name}: duplicate DOM IDs`);
      assert.deepEqual(frame.outerDuplicates,[],`${name}: duplicate host DOM IDs`);
      const requestedTheme=new URL(frame.href).searchParams.get('theme');
      assert.equal(frame.theme,requestedTheme,`${name}: the active surface uses the committed theme`);
      assert.ok(frame.activeFrames<=1,`${name}: multiple active Atlas members`);
      assert.ok(frame.instances<=1,`${name}: duplicate guide instances`);
      if(frame.surface==='guide') {
        assert.equal(frame.guideVisible,true,`${name}: guide state must have guide content`);
        assert.equal(frame.graphProtected,true,`${name}: hidden graph must be inert and aria-hidden`);
        assert.equal(frame.guideNode,frame.focus,`${name}: guide must show the selected node`);
        assert.equal(frame.h1,1,`${name}: exactly one visible H1`);
      }
    }
  }
  async function assertGraphRestored(expected,label,options={}) {
    const actual=await run(graphSnapshot);
    assert.equal(actual.node,expected.node,`${label}: selected node`);
    assert.equal(actual.tab,expected.tab,`${label}: original inspector tab`);
    if(options.focus!==false) assert.equal(actual.focus,expected.focus,`${label}: original focus target`);
    closeNumbers(actual.rect,expected.rect,1,`${label}: graph edges`);
    for(const [name,value] of Object.entries(expected.camera)) closeNumbers({[name]:actual.camera[name]},{[name]:value},/scale/i.test(name)?.001:2,`${label}: camera`);
    closeNumbers({x:actual.scroll.x,y:actual.scroll.y},{x:expected.scroll.x,y:expected.scroll.y},2,`${label}: page scroll`);
    closeNumbers(actual.scroll.panels,expected.scroll.panels,2,`${label}: inspector scroll`);
    assert.deepEqual(actual.svg,expected.svg,`${label}: canonical node geometry`);
  }
  async function assertHiddenGraphAX() {
    const root=mode==='atlas' ? `document.querySelector('iframe[data-atlas-state="active"]').contentWindow` : 'window';
    const protections=await run(`(()=>['.guided-views','.diagram-container','.cards'].map(selector=>{const node=document.querySelector(selector);return {selector,exists:Boolean(node),inert:Boolean(node?.inert),ariaHidden:node?.getAttribute('aria-hidden'),hidden:node?getComputedStyle(node).display==='none':false};}))()`);
    for(const item of protections) {
      assert.equal(item.exists,true,`${item.selector}: protected graph root exists`);
      assert.equal(item.inert,true,`${item.selector}: protected graph root is inert`);
      assert.equal(item.ariaHidden,'true',`${item.selector}: protected graph root is aria-hidden`);
      assert.equal(item.hidden,true,`${item.selector}: protected graph root is not painted`);
    }
    if(mode==='atlas') {
      const toolbar=await run(`(()=>{const node=document.querySelector('.toolbar'),style=getComputedStyle(node);return {exists:Boolean(node),inert:Boolean(node?.inert),ariaHidden:node?.getAttribute('aria-hidden'),opacity:style.opacity,pointerEvents:style.pointerEvents};})()`);
      assert.deepEqual(toolbar,{exists:true,inert:true,ariaHidden:'true',opacity:'0',pointerEvents:'none'},'Atlas member toolbar is a protected duplicate of the exposed outer toolbar');
    }
    const selector=mode==='atlas'?'.guided-views,.diagram-container,.cards,.toolbar':'.guided-views,.diagram-container,.cards';
    const count=await run(`(()=>{const roots=[...document.querySelectorAll(${JSON.stringify(selector)})];window.__guideAxTargets=[...new Set(roots.flatMap(root=>[root,...root.querySelectorAll('[data-node-id],[data-edge-from],a[href],button,input,select,textarea,[tabindex],[role],[contenteditable]')]))];return __guideAxTargets.length;})()`);
    assert.ok(count>0,'The protected graph contains accessibility targets to verify');
    for(let index=0;index<count;index++) {
      const expression=`(${root}).__guideAxTargets[${index}]`;
      const target=await send('Runtime.evaluate',{expression});
      assert.ok(target.result.objectId,`hidden graph target ${index} has a CDP object`);
      const tree=await send('Accessibility.getPartialAXTree',{objectId:target.result.objectId,fetchRelatives:false});
      assert.ok(tree.nodes.length>0,`hidden graph target ${index}: Chrome returns accessibility state`);
      assert.equal(tree.nodes[0].ignored,true,`hidden graph target ${index}: content is ignored by actual Chrome AX tree`);
      await send('Runtime.releaseObject',{objectId:target.result.objectId});
    }
    await run('delete window.__guideAxTargets');
    if(mode==='atlas') {
      const target=await send('Runtime.evaluate',{expression:'document.querySelector("#atlas-toolbar #btn-theme")'});
      assert.ok(target.result.objectId,'Atlas outer theme control has a CDP object');
      const tree=await send('Accessibility.getPartialAXTree',{objectId:target.result.objectId,fetchRelatives:false});
      assert.ok(tree.nodes.length>0 && !tree.nodes[0].ignored,'Atlas outer toolbar remains exposed while the inner graph controls are ignored');
      await send('Runtime.releaseObject',{objectId:target.result.objectId});
    }
  }
  async function assertGuideLandmarksAX() {
    for(const [selector,role,named] of [['#node-developer-guide','main',false],['nav.node-guide-toc','navigation',true]]) {
      const expression=mode==='atlas' ? `document.querySelector('iframe[data-atlas-state="active"]').contentDocument.querySelector(${JSON.stringify(selector)})` : `document.querySelector(${JSON.stringify(selector)})`;
      const target=await send('Runtime.evaluate',{expression});
      assert.ok(target.result.objectId,`${selector}: guide landmark has a CDP object`);
      const tree=await send('Accessibility.getPartialAXTree',{objectId:target.result.objectId,fetchRelatives:false});
      assert.ok(tree.nodes.length>0 && !tree.nodes[0].ignored,`${selector}: guide landmark is exposed by actual Chrome AX tree`);
      assert.equal(tree.nodes[0].role?.value,role,`${selector}: semantic landmark role`);
      if(named) assert.ok(tree.nodes[0].name?.value?.trim(),`${selector}: repeated landmark type has a distinguishable accessible name`);
      await send('Runtime.releaseObject',{objectId:target.result.objectId});
    }
  }

  for(const kind of ['architecture','atlas']) await t.test(`${kind}: quicklook, original inspection, explicit guide commit and reading history`,async()=>{
    await open({kind});
    const unselected=await run(graphSnapshot), initialLength=await historyLength();
    await click('[data-node-id="controller"]');
    assert.match(await run('document.getElementById("focus-detail").textContent'),/支付与清算/,'Original responsibility is not replaced by guide summary');
    assert.equal(await run('document.getElementById("focus-id").textContent'),'controller');
    assert.equal(await run('document.querySelectorAll("#focus-interface-list > li").length'),3,'Four authored interfaces produce exactly three quicklook rows');
    assert.ok(await run('document.getElementById("focus-implementation-scope").textContent.trim().length>0'));
    const selected=await run(graphSnapshot);
    closeNumbers(selected.rect,unselected.rect,1,'Selecting guide node preserves graph geometry');
    closeNumbers(selected.camera,unselected.camera,.001,'Selecting guide node preserves camera');
    if(kind==='atlas') {
      assert.deepEqual(await run('[...document.querySelectorAll("[data-atlas-tab]")].map(node=>node.dataset.atlasTab)'),['details','relationships','sources']);
      for(const name of ['relationships','sources','details']) {
        await click(tab(name));
        const current=await run(graphSnapshot);
        closeNumbers(current.rect,selected.rect,1,`${name} does not move graph`);
        closeNumbers(current.camera,selected.camera,.001,`${name} does not move camera`);
      }
      await click(tab('relationships'));
      assert.match(await run('document.getElementById("relationship-lens-list").textContent'),/SQL/);
      assert.equal(await run('document.querySelectorAll("#relationship-lens-list [data-relationship-key]").length'),5);
      await click(tab('sources'));
      assert.deepEqual(await run('[...document.querySelectorAll("#focus-evidence-links .semantic-passport-source small")].map(node=>node.textContent)'),data.sourceRecords.map(source=>source.path));
      assert.match(await run('document.getElementById("focus-repository").textContent'),new RegExp(data.revision.slice(0,7)));
      await click(tab('details'));
    }
    assert.equal(await historyLength(),initialLength,'Selecting nodes and inspector tabs does not add history');
    await run(`document.querySelector(${JSON.stringify(enter)}).focus({preventScroll:true})`);
    const origin=await run(graphSnapshot), before=await historyLength();
    await record(`${kind}-enter-guide`,async()=>{await click(enter);await ready({surface:'guide',node:'controller',chapter:'flow'});});
    assert.equal(await historyLength(),before+1,'Explicit successful graph→guide adds exactly one entry');
    const enteredAddress=await address();
    assert.equal(enteredAddress.focus,'controller');assert.equal(enteredAddress.inspect,'guide');
    assert.equal(enteredAddress.diagram,kind==='atlas'?'system':undefined);
    assert.ok(enteredAddress.section===undefined || enteredAddress.section==='flow','The first chapter may be implicit or explicit');
    assert.deepEqual(await run('[...document.querySelectorAll("#node-guide-sections > section[data-guide-section]")].map(node=>node.dataset.guideSection)'),guideSections);
    assert.match(await run('document.getElementById("node-guide-sections").textContent'),/accept\(key, value\)/);
    assert.equal(await run('document.querySelectorAll("#node-guide-sections [role=tab],#node-guide-toc [role=tab]").length'),0);
    await assertHiddenGraphAX();
    await assertGuideLandmarksAX();
    const repeatedLength=await historyLength(), readyCount=await run('__guideEvents.filter(event=>event.type==="archify:guide-ready").length');
    assert.ok(readyCount>0,'Successful guide commit emits its semantic ready event');
    for(let count=0;count<5;count++) await run('Archify.developerGuide.open("controller")');
    await ready({surface:'guide',node:'controller',chapter:'flow'});
    assert.equal(await historyLength(),repeatedLength,'Repeated same-guide opening does not grow history');
    assert.equal(await run('__guideEvents.filter(event=>event.type==="archify:guide-ready").length'),readyCount,'Repeated same-guide opening does not emit extra ready events');
    await record(`${kind}-chapters-back-forward`,async()=>{
      for(const name of guideSections) {await click(section(name));await ready({surface:'guide',node:'controller',chapter:name});}
      assert.equal(await historyLength(),repeatedLength,'Five chapter changes replace one guide visit');
      const guideReading=await run(`(()=>{const e=document.activeElement;return {scrollY,focus:{id:e.id,section:e.dataset.guideSection || null},chapter:Archify.developerGuide.section()};})()`);
      assert.ok(guideReading.scrollY>0,'The fixture exercises a real nonzero guide reading position');
      assert.ok(guideReading.focus.id || guideReading.focus.section,'Chapter navigation leaves an identifiable focus target');
      await run('history.back()',true);await ready({node:'controller'});await assertGraphRestored(origin,'Native Back');
      await run('history.forward()',true);await ready({surface:'guide',node:'controller',chapter:'change_points'});
      assert.equal((await address()).section,'change_points');
      closeNumbers(await run('({scrollY})'),{scrollY:guideReading.scrollY},2,'Forward restores guide scroll');
      assert.deepEqual(await run('({id:document.activeElement.id,section:document.activeElement.dataset.guideSection || null})'),guideReading.focus,'Forward restores guide focus');
      await click('#node-guide-back');await ready({node:'controller'});await assertGraphRestored(origin,'Return to graph');
      await run('history.forward()',true);await ready({surface:'guide',node:'controller',chapter:'change_points'});
    });
    await click('#node-guide-back');await ready({node:'controller'});
    await click('#btn-focus-clear');
    await click('[data-node-id="auth"]');
    assert.equal(await run('document.getElementById("focus-developer-quicklook").hidden'),true,'Legacy node has no empty guide section');
    assert.equal(await run('document.getElementById("btn-open-developer-guide").hidden || document.getElementById("btn-open-developer-guide").closest("[hidden]")!==null'),true);
  });

  await t.test('Atlas detail actions and two shared occurrences preserve their original context',async()=>{
    await open();await click('[data-node-id="controller"]');
    assert.ok(await run('document.querySelector("[data-atlas-detail=controller]") && document.querySelector("#btn-open-developer-guide")'));
    await click('[data-atlas-detail="controller"]');await ready({diagram:'payment'});
    assert.equal((await address()).inspect,undefined,'Detail navigation remains a graph navigation');
    const copies=[];
    for(const diagram of ['payment','orders']) {
      const occurrenceGuide='#atlas-open-developer-guide';
      await open({hash:`#diagram=${diagram}&focus=redis`});
      await click(tab('relationships'));
      const relationshipText=await run('document.getElementById("relationship-lens-list").textContent');
      assert.ok(relationshipText.trim(),'Occurrence retains local relationships');
      await click(tab('details'));
      await run(`document.querySelector(${JSON.stringify(occurrenceGuide)}).focus({preventScroll:true})`);
      const origin=await run(graphSnapshot);
      await record(`${diagram}-canonical-guide`,async()=>{
        await click(occurrenceGuide);await ready({surface:'guide',diagram:'system',node:'redis',chapter:'flow'});
        await click(section('interfaces'));await ready({surface:'guide',diagram:'system',node:'redis',chapter:'interfaces'});
        await click('#node-guide-copy');
        copies.push(await run('__guideCopies.at(-1)'));
        await run('history.back()',true);await ready({diagram,node:'redis'});await assertGraphRestored(origin,`${diagram} occurrence Back`);
      });
      await click(tab('relationships'));
      assert.equal(await run('document.getElementById("relationship-lens-list").textContent'),relationshipText);
    }
    assert.equal(copies[0],copies[1],'Both occurrences copy exactly the same canonical guide URL');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(new URL(copies[0]).hash.slice(1))),{diagram:'system',focus:'redis',inspect:'guide',section:'interfaces'});
  });

  await t.test('standalone guide preparation failure preserves the committed graph and a retry succeeds',async()=>{
    await open({kind:'architecture'});
    await click('[data-node-id="controller"]');
    const beforeGraph=await run(graphSnapshot), beforeAddress=await address(), beforeHistory=await historyLength();
    const beforeErrors=await run('__guideEvents.filter(event=>event.type==="archify:guide-error").length');
    await record('architecture-guide-failure',async()=>{
      await run(`(()=>{
        const stable=Archify.readerLayout.whenStable.bind(Archify.readerLayout);let pending=true;
        Archify.readerLayout.whenStable=function(){
          if(!pending)return stable();pending=false;Archify.readerLayout.whenStable=stable;
          return Promise.reject(new Error('Controlled developer guide preparation failure'));
        };
        document.querySelector(${JSON.stringify(enter)}).click();
      })()`);
      await waitFor(`Archify.developerGuide.surface()==='graph' &&
        __guideEvents.filter(event=>event.type==='archify:guide-error').length>${beforeErrors}`,
      'Failed standalone guide preparation changed the committed graph or emitted no local error');
    });
    assert.deepEqual(await address(),beforeAddress,'Failed standalone preparation leaves the URL untouched');
    assert.equal(await historyLength(),beforeHistory,'Failed standalone preparation does not commit history');
    await assertGraphRestored(beforeGraph,'Failed standalone preparation',{focus:false});
    assert.match(await run('(document.getElementById("focus-guide-feedback")?.textContent||"")+(document.getElementById("node-guide-feedback")?.textContent||"")'),/guide|指南/i,'Failure is reported beside the guide action');
    await record('architecture-guide-failure-retry',async()=>{
      await click(enter);await ready({surface:'guide',node:'controller',chapter:'flow'});
    });
    assert.equal(await historyLength(),beforeHistory+1,'The successful retry commits one guide visit');
  });

  await t.test('Atlas guide candidate failure keeps the graph authoritative and its retry commits once',async()=>{
    await open();await click('[data-node-id="controller"]');
    const beforeGraph=await run(graphSnapshot), beforeAddress=await address(), beforeHistory=await historyLength();
    await run(`window.__guideCandidateControl={mode:'reject',claimed:false,phase:'armed'}`,true);
    await record('atlas-guide-failure',async()=>{
      await click(enter);
      await waitFor(`__guideCandidateControl.rejected &&
        !document.querySelector('iframe[data-atlas-state="staging"]') &&
        !document.getElementById('atlas-error').hidden`,
      'Controlled Atlas guide failure did not settle into the recovery state',true);
    });
    assert.deepEqual(await address(),beforeAddress,'Failed Atlas guide preparation leaves the URL untouched');
    assert.equal(await historyLength(),beforeHistory,'Failed Atlas guide preparation does not commit history');
    await assertGraphRestored(beforeGraph,'Failed Atlas guide preparation',{focus:false});
    assert.match(await run('document.getElementById("atlas-error").textContent',true),/Controlled developer guide preparation failure/);
    await run('__guideCandidateControl=null',true);
    await record('atlas-guide-failure-retry',async()=>{
      await click('#atlas-error button',true);await ready({surface:'guide',node:'controller',chapter:'flow'});
    });
    assert.equal(await historyLength(),beforeHistory+1,'The successful Atlas retry commits one guide visit');
  });

  await t.test('a held Atlas guide result cannot overwrite a later guide intent',async()=>{
    await open();await click('[data-node-id="controller"]');
    const beforeHistory=await historyLength();
    await run(`window.__guideCandidateControl={mode:'hold',claimed:false,phase:'armed'}`,true);
    await record('atlas-guide-late-result-race',async()=>{
      await click(enter);
      await waitFor(`__guideCandidateControl.phase==='held' &&
        document.querySelectorAll('iframe[data-atlas-state="staging"]').length===1`,
      'The first Atlas guide candidate was not held during preparation',true);
      await run(`ArchifyAddress.send('navigate',{focus:'redis',inspect:'guide',section:'interfaces'})`);
      await ready({surface:'guide',diagram:'system',node:'redis',chapter:'interfaces'});
      await run(`window.__guideCommittedFrame=document.querySelector('iframe[data-atlas-state="active"]')`,true);
      const committed={address:await address(),history:await historyLength(),guide:await run('Archify.developerGuide.snapshot()')};
      await run('__guideCandidateControl.release()',true);
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',true);
      await ready({surface:'guide',diagram:'system',node:'redis',chapter:'interfaces'});
      assert.deepEqual(await address(),committed.address,'A late candidate cannot change the latest URL');
      assert.equal(await historyLength(),committed.history,'A late candidate cannot add or replace history');
      assert.deepEqual(await run('Archify.developerGuide.snapshot()'),committed.guide,'A late candidate cannot replace guide reading state');
      assert.equal(await run(`document.querySelector('iframe[data-atlas-state="active"]')===__guideCommittedFrame &&
        !document.querySelector('iframe[data-atlas-state="staging"]')`,true),true,'The latest committed member remains the sole active member');
    });
    assert.equal(await historyLength(),beforeHistory+1,'Only the latest successful guide intent creates a visit');
    await run('__guideCandidateControl=null;delete window.__guideCommittedFrame',true);
  });

  await t.test('responsive guide uses page scrolling, localized controls and keyboard/AX navigation',async()=>{
    for(const [width,height] of [[1440,900],[721,800],[720,800],[390,844],[320,568]]) for(const locale of ['en','zh-CN']) for(const theme of ['light','dark']) {
      await open({locale,width,height,theme,reduced:width===320});
      await run('document.querySelector("[data-node-id=controller]").focus({preventScroll:true})');
      await key('Enter','Enter',13);await ready({node:'controller'});
      await run('document.getElementById("btn-open-developer-guide").scrollIntoView({block:"center"});document.getElementById("btn-open-developer-guide").focus()');
      await record(`${locale}-${width}-${theme}-keyboard`,async()=>{await key('Enter','Enter',13);await ready({surface:'guide',node:'controller',chapter:'flow'});});
      assert.equal(await run('document.documentElement.lang'),locale,`${locale}/${width}/${theme}: inner document language`);
      assert.equal(await run('document.documentElement.dataset.theme'),theme,`${locale}/${width}/${theme}: inner document theme`);
      if(mode==='atlas') assert.equal(await run('document.documentElement.dataset.theme',true),theme,`${locale}/${width}/${theme}: Atlas shell theme`);
      const evidenceLabel=await run('document.querySelector("#node-guide-sections [data-guide-source-ref=runtime-export]").textContent.trim()');
      assert.match(evidenceLabel,locale==='en'?/^Export · src\/runtime\.mjs:L1-L5 · accept$/:/^导出 · src\/runtime\.mjs:L1-L5 · accept$/,`${locale}/${width}/${theme}: role, relative path, range and symbol stay visible`);
      assert.equal(evidenceLabel.includes(data.repository),false,`${locale}/${width}/${theme}: local repository root stays private`);
      assert.equal(await run('document.querySelector(".node-guide-summary").textContent'),'Stores keyed values through explicit runtime entry points.',`${locale}/${width}/${theme}: authored guide text stays byte-for-byte unchanged`);
      assert.doesNotMatch(await run('document.getElementById("node-developer-guide").textContent'),/viewer\.developerGuide\./,`${locale}/${width}/${theme}: no untranslated catalog key is visible`);
      assert.equal(await run('document.documentElement.scrollWidth<=innerWidth+1'),true,`${locale}/${width}: no horizontal overflow`);
      const contrast=await run(`(()=>{
        const parse=value=>{const values=(value.match(/[\\d.]+/g)||[]).map(Number),scale=value.startsWith('color(srgb')?255:1;return {r:(values[0]||0)*scale,g:(values[1]||0)*scale,b:(values[2]||0)*scale,a:values.length>3?values[3]:1};};
        const over=(front,back)=>{const a=front.a+back.a*(1-front.a);return a?{r:(front.r*front.a+back.r*back.a*(1-front.a))/a,g:(front.g*front.a+back.g*back.a*(1-front.a))/a,b:(front.b*front.a+back.b*back.a*(1-front.a))/a,a}:back;};
        const background=node=>{const layers=[];for(let current=node;current;current=current.parentElement)layers.push(parse(getComputedStyle(current).backgroundColor));return layers.reverse().reduce((value,layer)=>over(layer,value),{r:255,g:255,b:255,a:1});};
        const luminance=color=>{const channels=[color.r,color.g,color.b].map(value=>{value/=255;return value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4);});return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
        const ratio=(front,back)=>{const foreground=over(front,back),values=[luminance(foreground),luminance(back)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);};
        const visible=node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';};
        const text=[...document.querySelectorAll('.node-guide-title,.node-guide-summary,.node-guide-scope,.node-guide-actions button,.node-guide-toc a,.node-guide-section h2,.node-guide-item h3,.node-guide-item p,.node-guide-item code,.node-guide-direction,.node-guide-source')]
          .filter(visible).map(node=>({label:node.textContent.trim().slice(0,80),ratio:ratio(parse(getComputedStyle(node).color),background(node))}));
        const focus=[];for(const node of document.querySelectorAll('.node-guide-actions button,.node-guide-toc a,.node-guide-source')){if(!visible(node))continue;node.focus({preventScroll:true});const style=getComputedStyle(node);focus.push({label:node.textContent.trim().slice(0,80),visible:node.matches(':focus-visible'),width:parseFloat(style.outlineWidth),ratio:ratio(parse(style.outlineColor),background(node.parentElement||node))});}
        const active=document.querySelector('.node-guide-toc a[aria-current="location"]'),activeStyle=getComputedStyle(active),mobile=innerWidth<=1023;
        const boundary={label:active.textContent.trim(),width:parseFloat(mobile?activeStyle.borderBottomWidth:activeStyle.borderLeftWidth),ratio:ratio(parse(mobile?activeStyle.borderBottomColor:activeStyle.borderLeftColor),background(active.parentElement||active))};
        return {text,focus,boundary};
      })()`);
      assert.ok(contrast.text.length>0 && contrast.focus.length>0,`${locale}/${width}: guide contrast samples exist`);
      for(const sample of contrast.text) assert.ok(sample.ratio>=4.5,`${locale}/${width}: body text contrast >= 4.5:1: ${JSON.stringify(sample)}`);
      for(const sample of contrast.focus) {
        assert.equal(sample.visible,true,`${locale}/${width}: primary control exposes a focus-visible indicator: ${JSON.stringify(sample)}`);
        assert.ok(sample.width>=2 && sample.ratio>=3,`${locale}/${width}: focus indicator contrast >= 3:1: ${JSON.stringify(sample)}`);
      }
      assert.ok(contrast.boundary.width>=2 && contrast.boundary.ratio>=3,`${locale}/${width}/${theme}: active section control boundary contrast >= 3:1: ${JSON.stringify(contrast.boundary)}`);
      const controls=await run(`(()=>{const selectors=['#node-guide-back','#node-guide-copy','#node-guide-toc [data-guide-section]'];return selectors.flatMap(selector=>[...document.querySelectorAll(selector)]).map(node=>({text:node.textContent.trim(),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}));})()`);
      assert.ok(controls.length>=7);
      assert.doesNotMatch(controls.map(control=>control.text).join(' '),/viewer\.developerGuide|undefined|\[object Object\]/);
      assert.match(controls[0].text,locale==='en'?/back|diagram|graph/i:/返回|架构图/);
      if(width===320) for(const control of controls) assert.ok(control.width>=44 && control.height>=44,`320px primary hit target is at least 44px: ${JSON.stringify(control)}`);
      const toolbarControls=await run(`(()=>[...document.querySelectorAll('#atlas-toolbar button')]
        .filter(node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return !node.hidden&&style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;})
        .map(node=>{const rect=node.getBoundingClientRect();return {id:node.id,left:rect.left,right:rect.right,width:rect.width,height:rect.height,viewport:innerWidth};}))()`,true);
      assert.ok(toolbarControls.length>=4,`${locale}/${width}/${theme}: Atlas toolbar controls remain present`);
      for(const control of toolbarControls) {
        assert.ok(control.left>=-1&&control.right<=control.viewport+1,`${locale}/${width}/${theme}: Atlas toolbar control stays inside the viewport: ${JSON.stringify(control)}`);
        assert.ok(control.width>=44&&control.height>=44,`${locale}/${width}/${theme}: visible Atlas toolbar hit target is at least 44px: ${JSON.stringify(control)}`);
      }
      assert.equal(await run(`(()=>{const root=document.getElementById('node-developer-guide');return [...root.querySelectorAll('*')].filter(node=>{const style=getComputedStyle(node);return /auto|scroll/.test(style.overflowY) && node.scrollHeight>node.clientHeight+1 && node.clientHeight>0;}).length;})()`),0,'Guide has no nested vertical scroll root');
      await assertHiddenGraphAX();
      await assertGuideLandmarksAX();
      await run('document.querySelector("#node-guide-toc [data-guide-section=interfaces]").focus()');
      await key('Enter','Enter',13);await ready({surface:'guide',node:'controller',chapter:'interfaces'});
      assert.equal(await run(`(()=>{const e=document.activeElement,r=e.getBoundingClientRect();return !e.closest('[inert],[hidden]') && r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight;})()`),true,'Keyboard focus stays visible');
      await run('document.getElementById("node-guide-back").scrollIntoView({block:"center"});document.getElementById("node-guide-back").focus()');
      await key('Enter','Enter',13);await ready({node:'controller'});
    }
  });

  await t.test('active guide survives breakpoint and theme changes then directory navigation returns to a graph',async()=>{
    await open({hash:'#diagram=system&focus=controller&inspect=guide&section=interfaces'});
    const before=await historyLength();
    await record('active-guide-resize-theme-and-directory',async()=>{
      for(const width of [721,720,390,320,1440]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        await ready({surface:'guide',node:'controller',chapter:'interfaces'});
        assert.equal(await run('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}: active resize stays contained`);
      }
      await run('document.getElementById("btn-theme").click()',true);
      await waitFor('document.documentElement.dataset.theme==="dark"','Outer theme did not commit',true);
      await waitFor('document.documentElement.dataset.theme==="dark"','Guide theme did not commit');
      await ready({surface:'guide',node:'controller',chapter:'interfaces'});
      assert.equal(await historyLength(),before,'Resize and theme change do not create guide visits');
      await click('#atlas-directory-toggle',true);
      await click('[data-atlas-diagram="payment"]',true);await ready({diagram:'payment'});
      assert.equal((await address()).inspect,undefined,'Directory selection starts the target graph surface');
    });
  });

  await t.test('cold guide links, refresh and safe local-only text work without external requests',async()=>{
    const server=http.createServer((request,response)=>{
      const url=new URL(request.url,'http://localhost');
      const kind=url.pathname==='/atlas.html'?'atlas':url.pathname==='/architecture.html'?'architecture':null;
      if(!kind){response.writeHead(404);response.end();return;}
      response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fs.readFileSync(data.outputs.en[kind]));
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
    for(const kind of ['architecture','atlas']) for(const protocol of ['file','http']) {
      const base=protocol==='http'?`http://127.0.0.1:${server.address().port}/${kind}.html`:undefined;
      const hash=`#${kind==='atlas'?'diagram=system&':''}focus=redis&inspect=guide&section=interfaces`;
      let original;
      if(kind==='architecture'&&protocol==='file') {
        const graph=await open({kind,base});
        const target=new URL(graph);target.hash=hash;
        await record('architecture-cold-guide-link',async()=>{
          await send('Page.navigate',{url:target.href});
          await ready({surface:'guide',node:'redis',chapter:'interfaces'});
        });
        original=target.href;
        await send('Page.resetNavigationHistory');
        assert.equal(await historyLength(),1,'Recorded cold guide remains a single visit');
      } else original=await open({kind,base,hash});
      const before=await historyLength();
      assert.ok((await run('document.getElementById("node-developer-guide").textContent')).includes(hostileGuideText),'Hostile author text is rendered verbatim');
      assert.equal(await run('Boolean(window.guideInjection || document.getElementById("guide-injected"))'),false,'Text cannot inject a live element or script');
      assert.equal(await run('document.querySelectorAll("#node-developer-guide a[href^=http],#focus-evidence a[href]").length'),0,'Local-only evidence creates no remote links');
      assert.equal(await run(`document.body.textContent.includes(${JSON.stringify(data.repository)})`),false,'Local repository absolute path is absent from reader content');
      await click('#node-guide-copy');
      const copied=await run('__guideCopies.at(-1)');
      assert.equal(new URL(copied).hash,new URL(original).hash,'Copied cold guide has only the canonical semantic address');
      await send('Page.reload');await ready({surface:'guide',node:'redis',chapter:'interfaces'});
      assert.equal(await historyLength(),before,'Refresh does not add a reader entry');
      await click('#node-guide-back');await ready({node:'redis'});
      assert.equal(await historyLength(),before,'Cold guide return replaces the current entry');
      assert.equal((await address()).inspect,undefined);assert.equal((await address()).section,undefined);
      assert.equal((await address()).focus,'redis');
    }
  });

  await t.test('an obsolete guide link stays explicit and cannot expose a copy action',async()=>{
    mode='architecture';
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    const target=new URL(pathToFileURL(data.outputs.en.architecture).href);
    target.hash='#focus=retired-node&inspect=guide&section=interfaces';
    allowedDocuments.add(documentKey(target.href));
    await send('Page.navigate',{url:'about:blank'});
    await send('Page.navigate',{url:target.href});
    await waitFor(`document.documentElement.dataset.readerSurface==='guide' &&
      document.querySelector('#node-developer-guide[data-guide-state="error"]') &&
      document.getElementById('node-guide-copy').hidden`,
    'Obsolete guide link did not expose its recoverable error without a copy action',true);
    await stable();
    const invalid=await run(`(()=>{const copy=document.getElementById('node-guide-copy');return {
      href:location.href,state:document.getElementById('node-developer-guide').dataset.guideState,
      message:document.querySelector('.node-guide-summary').textContent.trim(),copyHidden:copy.hidden,
      copyInteractive:copy.getClientRects().length>0&&!copy.closest('[inert],[hidden]'),copies:__guideCopies.length};})()`);
    assert.equal(new URL(invalid.href).hash,target.hash,'Invalid semantic address remains available for correction as an error target');
    assert.equal(invalid.state,'error');
    assert.ok(invalid.message);
    assert.equal(invalid.copyHidden,true);
    assert.equal(invalid.copyInteractive,false);
    assert.equal(invalid.copies,0,'No canonical-looking guide URL is copied from an invalid target');
  });

  await t.test('all existing image and motion formats export the canonical graph while a guide is active',async()=>{
    const expectedTypes={svg:/^image\/svg\+xml/,png:/^image\/png$/,jpeg:/^image\/jpeg$/,webp:/^image\/webp$/,webm:/^video\/webm/};
    for(const kind of ['architecture','atlas']) {
      await open({kind,hash:`#${kind==='atlas'?'diagram=system&':''}focus=redis`});
      const graphSources={};
      for(const format of ['svg','png','jpeg','webp']) graphSources[format]=(await exported(format)).sourceSvg;
      const beforeHistory=await historyLength();
      await click(enter);await ready({surface:'guide',node:'redis',chapter:'flow'});
      assert.equal(await historyLength(),beforeHistory+1,`${kind}: opening the guide creates exactly one visit`);
      const guideHistory=await send('Page.getNavigationHistory');
      const guideHistoryLength=await historyLength();
      const guideAddress=await address();
      assert.equal(await run('Archify.motion.canRecord()'),true,`${kind}: trace fixture supports real WebM export`);
      for(const format of ['svg','png','jpeg','webp','webm']) {
        const result=await exported(format);
        assert.ok(result.bytes>0 && result.width>0 && result.height>0,`${kind}/${format}: nonempty decodable export`);
        assert.match(result.type,expectedTypes[format],`${kind}/${format}: media type`);
        assert.ok(result.name.endsWith(`.${format}`),`${kind}/${format}: download filename`);
        assert.ok(result.sourceSvg,`${kind}/${format}: export is derived from an SVG source`);
        assert.match(result.sourceSvg,/Redis/,`${kind}/${format}: canonical diagram content remains`);
        assert.doesNotMatch(result.sourceSvg,/GUIDE_ONLY_SENTINEL|guide-injected|node-guide-sections|developer_guide|accept-interface/,`${kind}/${format}: guide data is absent from the export source`);
        assert.equal(result.containsGuideText,false,`${kind}/${format}: encoded output contains no guide sentinel`);
        if(format!=='webm') assert.equal(result.sourceSvg,graphSources[format],`${kind}/${format}: opening the guide does not alter exported graph content`);
        fs.writeFileSync(path.join(evidence,`${kind}-guide-active.${format}`),Buffer.from(result.encoded,'base64'));
        assert.deepEqual(await address(),guideAddress,`${kind}/${format}: export preserves guide address`);
        assert.equal(await historyLength(),guideHistoryLength,`${kind}/${format}: export preserves history length`);
        assert.deepEqual(await send('Page.getNavigationHistory'),guideHistory,`${kind}/${format}: export preserves every history entry and the current visit`);
        await ready({surface:'guide',node:'redis',chapter:'flow'});
      }
    }
  });
  await t.test('guide evidence actions focus the existing source and clipboard failure stays local',async()=>{
    for(const kind of ['architecture','atlas']) {
      await open({kind,hash:`#${kind==='atlas'?'diagram=system&':''}focus=controller&inspect=guide&section=interfaces`});
      const before=await historyLength(), beforeAddress=await address();
      await record(`${kind}-guide-source`,async()=>{
        await click('#node-guide-sections [data-guide-source-ref="runtime-export"]');
        await ready({surface:'guide',node:'controller',chapter:'interfaces'});
        if(kind==='atlas') assert.equal(await run('document.querySelector("[data-atlas-tab][aria-selected=true]").dataset.atlasTab'),'sources');
        assert.equal(await run('document.activeElement.closest("[data-source-id]")?.dataset.sourceId'),'runtime-export','Source action focuses the exact existing evidence record');
        assert.deepEqual(await run('[...document.querySelectorAll("#focus-evidence-links .semantic-passport-source small")].map(node=>node.textContent)'),data.sourceRecords.map(source=>source.path));
        assert.deepEqual(await address(),beforeAddress,'Same-node source reading preserves guide address');
        assert.equal(await historyLength(),before,'Same-node source reading does not add history');
      });
      await run('navigator.clipboard.writeText=async()=>{throw new Error("Injected clipboard denial")};document.execCommand=()=>false');
      await click('#node-guide-copy');
      await waitFor('/copy|clipboard/i.test(document.getElementById("node-guide-feedback").textContent) && /fail|unable|could not/i.test(document.getElementById("node-guide-feedback").textContent)','Guide did not report clipboard failure locally');
      assert.deepEqual(await address(),beforeAddress);
      assert.equal(await historyLength(),before);
      await ready({surface:'guide',node:'controller',chapter:'interfaces'});
    }
  });
  await t.test('guide relationship action reveals the graph inspector and guide headings have a distinct hierarchy',async()=>{
    for(const kind of ['architecture','atlas']) {
      await open({kind,hash:`#${kind==='atlas'?'diagram=system&':''}focus=controller&inspect=guide&section=flow`});
      const hierarchy=await run(`(()=>{
        const section=getComputedStyle(document.querySelector('.node-guide-section>h2'));
        const item=getComputedStyle(document.querySelector('.node-guide-item h3'));
        return {sectionSize:parseFloat(section.fontSize),itemSize:parseFloat(item.fontSize),
          sectionColor:section.color,itemColor:item.color,sectionSpacing:parseFloat(section.letterSpacing)};
      })()`);
      assert.ok(hierarchy.sectionSize<hierarchy.itemSize,'Section labels are smaller than guide item titles');
      assert.notEqual(hierarchy.sectionColor,hierarchy.itemColor,'Section labels and item titles use different colors');
      assert.ok(hierarchy.sectionSpacing>0,'Section labels use label-like tracking');
      await click('#node-guide-relations');
      await ready({surface:'graph',node:'controller'});
      if(kind==='atlas') {
        assert.equal(await run('document.querySelector("[data-atlas-tab][aria-selected=true]").dataset.atlasTab'),'relationships');
        assert.match(await run('document.getElementById("relationship-lens-list").textContent'),/SQL/);
      } else {
        assert.equal(await run('document.getElementById("btn-focus-relations").getAttribute("aria-expanded")'),'true');
      }
    }
  });
  await t.test('all observed documents remain offline without runtime errors',async()=>{
    assert.deepEqual(consoleErrors,[],'No browser console.error calls');
    const unexpected=requests.filter(request=>{
      if(/^(?:about:|data:|blob:)/.test(request.url))return false;
      const url=new URL(request.url);url.hash='';
      if(request.type==='Document' && allowedDocuments.has(documentKey(url.href)))return false;
      return true;
    });
    assert.deepEqual(unexpected,[],'Only explicitly opened documents may request resources');
  });
});
