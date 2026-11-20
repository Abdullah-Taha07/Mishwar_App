import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const owner = 'a'.repeat(64);
const A = {name: 'فرع المتجر التجريبي', area: 'فرع غربي اصطناعي', lat: 24.7, lng: 46.6};
const B = {...A, area: 'فرع شرقي اصطناعي', lng: 46.8};

// Actual search component, account ownership and geographic ranking. The small
// DOM/localStorage fixture supplies two synthetic provider results, never a
// provider connection or a customer account. Clicks invoke its real listener.
function harness() {
  const nodes = new Map(), listeners = new Map(), storage = new Map(), choices = [];
  let sandbox;
  function node(selector) {
    if (nodes.has(selector)) return nodes.get(selector);
    const handlers = new Map(), attributes = new Map();
    const value = {
      hidden: false, open: false, innerHTML: '', textContent: '', value: '', dataset: {}, isConnected: true,
      classList: {add() {}, remove() {}, toggle() {}},
      setAttribute: (key, text) => attributes.set(key, String(text)), getAttribute: key => attributes.get(key) ?? null,
      addEventListener: (type, handler) => handlers.set(type, handler), handlers,
      append() {}, querySelectorAll: () => [], querySelector: () => null,
      focus() {sandbox.document.activeElement = value;}, select() {}, blur() {sandbox.document.activeElement = null;},
      matches: () => false, close() {this.open = false;},
    };
    nodes.set(selector, value); return value;
  }
  sandbox = {
    console, Map, Set, Promise, AbortController, JSON, Number, String, Math,
    Event: class {constructor(type) {this.type = type;}},
    CustomEvent: class {constructor(type, {detail}) {this.type = type; this.detail = detail;}},
    addEventListener(type, handler) {if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler);},
    dispatchEvent(event) {for (const handler of listeners.get(event.type) || []) handler(event);},
    document: {createElement: () => node('search-sheet'), body: node('body'), activeElement: null, querySelectorAll: () => []},
    ResizeObserver: class {observe() {}},
    localStorage: {setItem: (key, value) => storage.set(key, value)},
    read: (key, fallback) => storage.has(key) ? JSON.parse(storage.get(key)) : fallback,
    validPoint: p => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180,
    $: node, icon: () => '', esc: value => String(value ?? ''), toast() {},
    state: {stage: 'home', destination: null}, pickupPoint: null,
    choose(point) {choices.push(point); sandbox.state.destination = point;},
    startAddressEditor() {}, focusAddress() {}, showSearch() {}, closeAddressEditor() {}, positionSuggestions() {}, drawSuggestions() {},
    editor: {target: null, query: '', results: [], visibleResults: [], sequence: 0, loading: false, error: ''},
    suggestionBox: node('suggestions'), stopAddressSearch() {sandbox.editor.sequence++;},
    scheduleAddressSearch(query) {sandbox.editor.query = query;}, runAddressSearch() {},
    searchFocus: () => ({lat: A.lat, lng: A.lng}),
    setPickup() {}, fitLocations() {}, startMapPick() {}, locatePickup() {}, modal() {}, setStage() {}, syncMapPoints() {},
    clearTimeout() {}, requestAnimationFrame: () => 1,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source('account-context.js'), sandbox);
  const context = sandbox.MishwarAccountContext;
  context.applyAuth({authenticated: true, phoneVerified: true, accountKey: owner}, context.beginAuthRead());
  context.notifyAuth();
  vm.runInContext(source('geo-policy.js'), sandbox);
  vm.runInContext(source('search-ui.js'), sandbox);
  function results(points = [A, B]) {
    sandbox.openSearchSheet('destination');
    sandbox.editor.query = A.name;
    sandbox.editor.results = points.map(point => ({...point}));
    sandbox.drawSuggestions();
  }
  function click(attribute, index) {
    const button = {dataset: {[attribute]: String(index)}, hasAttribute: () => false};
    node('search-sheet').handlers.get('click')({target: {closest: () => button}, preventDefault() {}, stopPropagation() {}});
  }
  return {
    c: sandbox, choices, results,
    favorite: index => click('searchFavorite', index), select: index => click('searchSelect', index),
    saved: () => Array.from(sandbox.savedAddresses(), point => ({name: point.name, lat: point.lat, lng: point.lng})),
    existing(points) {assert.equal(sandbox.saveAddressList('mishwar-favorites', points, context.capture()), true);},
    marked(index) {
      const match = node('#search-results-list').innerHTML.match(new RegExp('<button class="favorite-address ([^"]*)" data-search-favorite="' + index + '"'));
      assert.ok(match, 'Actual result renders its favorite control');
      return match[1].split(/\s+/).includes('saved');
    },
  };
}

test('RIDER-014.001 saving one branch does not mark a same-name, same-latitude branch at another longitude', () => {
  const h = harness(); h.results(); h.favorite(0);
  assert.equal(h.marked(0), true);
  assert.equal(h.marked(1), false, 'The eastern branch is a different location');
  assert.deepEqual(h.saved(), [{name: A.name, lat: A.lat, lng: A.lng}]);
});

test('RIDER-014.001 saving the second branch preserves the first branch', () => {
  const h = harness(); h.results(); h.favorite(0); h.favorite(1);
  assert.deepEqual(h.saved().map(point => point.lng).sort(), [A.lng, B.lng]);
  assert.equal(h.marked(0), true); assert.equal(h.marked(1), true);
});

test('RIDER-014.001 removing the second existing branch preserves the first branch', () => {
  const h = harness(); h.existing([A, B]); h.results(); h.favorite(1);
  assert.deepEqual(h.saved(), [{name: A.name, lat: A.lat, lng: A.lng}]);
  assert.equal(h.marked(0), true); assert.equal(h.marked(1), false);
});

test('RIDER-014.001 selecting the second result uses its actual longitude and remembers that location', () => {
  const h = harness(); h.results(); h.select(1);
  assert.equal(h.choices.length, 1);
  assert.equal(h.choices[0].lat, B.lat); assert.equal(h.choices[0].lng, B.lng);
  assert.equal(h.c.state.destination.lng, B.lng);
  assert.equal(h.c.recentAddresses()[0].lng, B.lng);
});

test('RIDER-014.001 preserves the existing favorite tolerance when both coordinate axes are nearby', () => {
  const h = harness(), nearby = {...A, lat: A.lat + 0.0004, lng: A.lng + 0.0004};
  h.existing([A]); h.results([nearby]);
  assert.equal(h.marked(0), true, 'Small movement within both current tolerances remains the same favorite');
  h.favorite(0);
  assert.deepEqual(h.saved(), []);
});

test('RIDER-014 recent selections preserve same-name branches at a different longitude',()=>{
 const h=harness();h.c.rememberAddress(A);h.c.rememberAddress(B);
 assert.deepEqual(Array.from(h.c.recentAddresses(),point=>point.lng).sort(),[A.lng,B.lng]);
});

test('RIDER-014 recent selections still deduplicate the same nearby point on both axes',()=>{
 const h=harness();h.c.rememberAddress(A);h.c.rememberAddress({...A,lat:A.lat+.0004,lng:A.lng+.0004});
 assert.equal(h.c.recentAddresses().length,1);
});

test('RIDER-014 invalid recent coordinates are rejected instead of being serialized to storage',()=>{
 const h=harness();assert.equal(h.c.rememberAddress({...A,lat:NaN}),false);assert.equal(h.c.recentAddresses().length,0);
});
