import { mountCountyRichnessBar } from "/visualizations/t1/county-richness-bar-view.js";
import { mountCountyChoropleth } from "/visualizations/t1/county-choropleth-view.js";
import { mountObservationTrends } from "/visualizations/t2/observation-trends-view.js";
import { mountSeasonalSpeciesHeatmap } from "/visualizations/t2/seasonal-species-heatmap-view.js";
import { mountHolidayObservationPatterns } from "/visualizations/t3/holiday-observation-patterns-view.js";
import { mountLocationCombinations } from "/visualizations/t4/location-combinations-view.js";
import { mountHotspotSpeciesOverlap } from "/visualizations/t4/hotspot-species-overlap-view.js";
import { createFilterStore } from "/filters/filter-store.js";
import * as api from "/api/info-loader.js";
import { loadTaxonNameMap } from "/api/taxon-converter.js";

const results = document.querySelector("#results");
const fixture = document.querySelector("#fixture");
const report = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate) {
  const start = performance.now();
  while (!predicate()) { if (performance.now()-start>15000) throw new Error("Timed out waiting for view update"); await new Promise(resolve=>setTimeout(resolve,20)); }
}
const cases = [
  ["county bars",mountCountyRichnessBar,"loadCountyRichness",".county-bars__county"],
  ["choropleth",mountCountyChoropleth,"loadCountyRichness",".county-choropleth__map .county"],
  ["trends",mountObservationTrends,"loadSpeciesTrend",".observation-trends__point"],
  ["heatmap",mountSeasonalSpeciesHeatmap,"loadSpeciesReportingFrequency",".species-heatmap__cell"],
  ["holidays",mountHolidayObservationPatterns,"loadHolidayObservations",".holiday-patterns__year"],
  ["combinations",mountLocationCombinations,"loadHotspotSpecies",".combination-chart__combination"],
  ["UpSet",mountHotspotSpeciesOverlap,"loadHotspotSpecies",".upset-chart__column"]
];
function createStore() {
  const store=createFilterStore();
  store.setShared({stateCode:"US-MA",countyCode:"US-MA-017",taxonId:"avibase-4E74AE22"});
  store.setChart("t4",{candidateLocationIds:["L1039531","L1055329","L1055336"],selectedCombinationIds:["L1039531","L1055329","L1055336"]});
  return store;
}
function host(width=900) { const element=document.createElement("div");element.style.width=width+"px";fixture.append(element);return element; }
function deferred() { let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }

async function run() {
  const [geography,taxa,topology]=await Promise.all([api.loadGeographicOptions(),loadTaxonNameMap(),d3.json("/data/counties-10m.json")]);
  const snapshots={};
  const appearances={};
  const appearance = root => ({font:getComputedStyle(root).font,color:getComputedStyle(root).color,tooltip:getComputedStyle(root.querySelector('[role="tooltip"]')).backgroundColor});
  const calls=[];
  const data=Object.fromEntries(Object.entries(api).map(([name,fn])=>[name,async(...args)=>{calls.push(name);const result=await fn(...args);snapshots[name]=result;return result;}]));
  data.loadCountyGeometry=async()=>topology;
  const mount=(factory,container,store,extra={})=>factory({container,store,data,geography,taxa,d3,topojson,...extra});
  for (const [name,factory,loader,selector] of cases) {
    for (let iteration=0;iteration<2;iteration++) {
      const container=host(iteration?620:900),store=createStore();
      const view=mount(factory,container,store);await view.ready;
      assert(container.querySelector(selector),name+" failed to render");
      appearances[name]=appearance(view.root);
      container.style.width="500px";await settle();await settle();
      assert(container.querySelector(selector),name+" lost its render on resize");
      assert(![...container.querySelectorAll("path")].some(path=>/NaN|Infinity/.test(path.getAttribute("d")||"")),name+" generated invalid resized geometry");
      view.destroy();view.destroy();assert(!container.children.length,name+" did not clean its DOM");
      const count=calls.length;store.setShared({countyCode:"US-MA-025"});await settle();
      assert(calls.length===count,name+" retained a subscription after destroy");container.remove();
    }
    for (const reject of [false,true]) {
      const container=host(),store=createStore(),pending=deferred();
      const view=mount(factory,container,store,{data:{...data,[loader]:()=>pending.promise}});
      await settle();view.destroy();
      if(reject)pending.reject(new Error("Expected late rejection"));else pending.resolve(snapshots[loader]);
      await view.ready;await settle();assert(!container.children.length,name+" wrote stale data after destroy");container.remove();
    }
    report.push(name+": repeated mounts, two widths, unsubscribe, pending resolve/reject passed");
  }
  // Initialization can itself be pending before the choropleth renderer exists.
  const pending=deferred(),container=host(),view=mount(mountCountyChoropleth,container,createStore(),{data:{...data,loadCountyGeometry:()=>pending.promise}});
  view.destroy();pending.resolve(topology);await view.ready;assert(!container.children.length,"late geometry recreated a destroyed map");container.remove();
  report.push("pending geometry initialization: passed");

  const store=createStore();const views=cases.map(([,factory])=>mount(factory,host(700),store));await Promise.all(views.map(view=>view.ready));
  views.forEach((view,index)=>assert(JSON.stringify(appearance(view.root))===JSON.stringify(appearances[cases[index][0]]),"Cross-view CSS collision: "+cases[index][0]));
  const ids=[...fixture.querySelectorAll("[id]")].map(node=>node.id);assert(new Set(ids).size===ids.length,"Duplicate IDs across views");
  const count=calls.length;store.setChart("t2",{season:"winter"});
  await until(()=>calls.length>count&&!views[2].root.querySelector('[aria-busy="true"]'));
  assert(calls.slice(count).every(name=>name==="loadSpeciesTrend"),"Season changed an unrelated view");
  store.setShared({countyCode:"US-MA-025"});await settle();
  assert(views[0].root.querySelectorAll('.county-bars__county').length===14,"County selection filtered the statewide bars");
  assert(views[0].root.querySelectorAll('.county-bars__county.is-selected').length===1,"Shared county highlight did not update");
  assert(!views[6].root.querySelector('.upset-chart__column'),"County change retained old UpSet data");
  views.forEach(view=>view.destroy());fixture.replaceChildren();
  report.push("seven views, one store: unique IDs, CSS isolation, isolated season, county highlight/reset passed");

  const linked=createStore();linked.setChart("t4",{candidateLocationIds:["L1039531","L1055329","L1055336","L109121","L1121533"]});
  const bars=mount(mountLocationCombinations,host(),linked);
  const overlap=mount(mountHotspotSpeciesOverlap,host(),linked,{selection:{getIds:()=>linked.getFilters("t4").selectedCombinationIds,keys:["charts.t4.selectedCombinationIds"]}});
  await Promise.all([bars.ready,overlap.ready]);
  assert(!overlap.root.querySelector('.hotspot-picker'),"Read-only overlap binding created an independent picker");
  assert(overlap.root.textContent.includes('3 hotspots'),"Linked overlap used the five-candidate pool");
  linked.setChart("t4",{selectedCombinationIds:["L1039531","L109121","L1121533"]});
  await until(()=>overlap.root.textContent.includes('3 hotspots')&&!overlap.root.querySelector('[aria-busy="true"]'));
  bars.destroy();overlap.destroy();fixture.replaceChildren();
  report.push("T4 injected selected-combination binding: passed");
  results.textContent="PASS\n"+report.join("\n");document.title="PASS — Visualization lifecycle regression checks";
}
run().catch(error=>{console.error(error);results.textContent="FAIL\n"+error.stack;document.title="FAIL — Visualization lifecycle regression checks";});
