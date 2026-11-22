import { mountDashboard } from "/dashboard/dashboard.js";
import { createFilterStore } from "/filters/filter-store.js";
import * as api from "/api/info-loader.js";
import { loadTaxonNameMap } from "/api/taxon-converter.js";
const fixture=document.querySelector("#fixture"), results=document.querySelector("#results"), report=[];
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
async function until(predicate){const start=performance.now();while(!predicate()){if(performance.now()-start>20000)throw new Error("Timed out waiting for dashboard update");await settle();}}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function trackedStore(){const store=createFilterStore(), original=store.subscribe;let count=0;store.subscribe=(options,callback)=>{count++;let active=true;const off=original(options,callback);return()=>{if(active){active=false;count--;off();}};};return {store,count:()=>count};}
function checkBounds(root){
 assert(document.documentElement.scrollWidth===innerWidth&&document.documentElement.scrollHeight===innerHeight,"Page-level overflow");
 const targets={map:[1088,360],bars:[784,360],trends:[936,240],holiday:[936,240],analysis:[768,324],combinations:[1104,324]};
 for(const panel of root.querySelectorAll('[data-panel]')){const [width,height]=targets[panel.dataset.panel];assert(Math.abs(panel.clientWidth-width)<=1&&Math.abs(panel.clientHeight-height)<=1,"Wrong panel allocation: "+panel.dataset.panel);}
}
function checkOwnership(root){const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);assert(new Set(ids).size===ids.length,"Duplicate IDs");assert(root.querySelectorAll('.visualization-view').length===6,"Expected exactly six mounted views");assert(document.querySelectorAll('[role="tooltip"]').length===6,"Leaked tooltip portal");}
async function run(){
 const [geography,taxa,topology]=await Promise.all([api.loadGeographicOptions(),loadTaxonNameMap(),d3.json('/data/counties-10m.json')]);
 const tracked=trackedStore(),store=tracked.store,calls=[];let blockedHeatmap;
 const data=Object.fromEntries(Object.entries(api).map(([name,fn])=>[name,async(...args)=>{calls.push({name,args});if(name==='loadSpeciesHeatmap'&&blockedHeatmap){const pending=blockedHeatmap;blockedHeatmap=null;return pending.promise;}return fn(...args);} ]));data.loadCountyGeometry=async()=>topology;
 store.setShared({stateCode:'US-MA',countyCode:'US-MA-017',taxonId:'avibase-4E74AE22'});
 const candidates=['L1039531','L1055329','L1055336','L109121','L1121533'];
 store.setChart('t4',{candidateLocationIds:candidates});
 const dashboard=mountDashboard({container:fixture,store,data,geography,taxa,d3,topojson});await dashboard.ready;await settle();
 const root=dashboard.root,common=[...root.querySelectorAll('[data-panel]:not([data-panel="analysis"]) > .visualization-view')];
 checkBounds(root);checkOwnership(root);assert(root.querySelectorAll('[data-dashboard-shared] .filter-header').length===1,'Shared header duplicated');
 assert(root.querySelectorAll('.county').length===14&&root.querySelectorAll('.county-bars__county').length===14,'Statewide county data missing');
 report.push('Dashboard A: six views, one header/store, exact target dimensions, no page scroll');
 const rankingCalls=calls.filter(call=>call.name==='loadCountyRichness').length;
 root.querySelector('.county[data-county-code="US-MA-025"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 assert(store.getState().shared.countyCode==='US-MA-025','Map keyboard selection did not reach shared store');
 assert(root.querySelector('.county-bars__county.is-selected')?.dataset.countyCode==='US-MA-025','Map did not highlight bars');
 assert(root.querySelectorAll('.county-bars__county').length===14&&calls.filter(call=>call.name==='loadCountyRichness').length===rankingCalls,'County selection filtered/refetched statewide comparison');
 assert(root.querySelector('[data-filter-path="shared.countyCode"]').value==='US-MA-025','Header out of sync');
 root.querySelector('.county-bars__county[data-county-code="US-MA-017"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 assert(root.querySelector('.county.is-selected')?.dataset.countyCode==='US-MA-017','Bar selection did not highlight map');
 await until(()=>!root.querySelector('[data-panel="holiday"] [aria-busy="true"]'));
 store.setChart('t4',{candidateLocationIds:candidates});await until(()=>root.querySelectorAll('.combination-chart__combination').length===10);
 report.push('T1 keyboard selection links map, bars and header; all statewide counties retained');
 const beforeLocal=calls.length;store.setChart('t2',{season:'winter'});await settle();await until(()=>!root.querySelector('[data-panel="trends"] [aria-busy="true"]'));
 assert(calls.length===beforeLocal,'Trend highlight unnecessarily reloaded data');
 assert(root.querySelector('[data-panel="trends"] .observation-trends__legend-item.is-selected').dataset.season==='winter','Trend highlight did not update');
 const beforeSpecies=calls.length;store.setShared({taxonId:'avibase-00AF5DA1'});await until(()=>calls.length>=beforeSpecies+2);assert(calls.slice(beforeSpecies).every(call=>['loadSpeciesTrend','loadHolidayObservations'].includes(call.name)),'Shared species restricted heatmap/T1/T4');
 await until(()=>!root.querySelector('[aria-busy="true"]'));
 const beforeYears=calls.length;store.setShared({startYear:2015});await until(()=>calls.length>=beforeYears+3);assert(calls.slice(beforeYears).every(call=>['loadSpeciesTrend','loadHolidayObservations','loadSpeciesHeatmap'].includes(call.name)),'Shared years affected fixed-coverage views');
 await until(()=>!root.querySelector('[aria-busy="true"]'));
 store.setChart('t2Heatmap',{speciesCount:20,sortOrder:'alpha'});await until(()=>root.querySelectorAll('.species-heatmap__cell').length===240);
 const body=root.querySelector('.visualization-heatmap__body');assert(body.scrollHeight>body.clientHeight,'Heatmap lacks internal row scrolling');
 const snapshot=JSON.stringify(store.getState()),baseline={};
 for(let i=0;i<12;i++){
  const mode=i%2?'seasonal':'overlap';await dashboard.setConfiguration(mode);await settle();checkOwnership(root);checkBounds(root);
  assert(common.every(node=>node.isConnected&&root.contains(node)),'Configuration remounted a common view');
  assert(JSON.stringify(store.getState())===snapshot,'Switching changed filter selections');
  const ownership=[tracked.count(),document.querySelectorAll('.visualization-overlay').length].join(':');
  if(baseline[mode])assert(baseline[mode]===ownership,'Switch leaked subscriptions or overlays');else baseline[mode]=ownership;
 }
 assert(root.querySelector('[data-filter-path="charts.t2Heatmap.speciesCount"]').value==='20','Heatmap controls not retained');
 report.push('Local filter isolation and shared species/year relevance passed; twelve swaps preserve five roots, filters, IDs and subscription/portal counts');
 await dashboard.setConfiguration('overlap');assert(!root.querySelector('[data-panel="analysis"] .hotspot-picker'),'UpSet duplicated candidate controls');
 root.querySelector('.combination-chart__combination').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 await until(()=>root.querySelectorAll('.upset-chart__column').length>0);
 const selected=store.getFilters('t4').selectedCombinationIds,rows=await api.loadHotspotSpecies('US-MA-017',selected),expectedUnion=new Set(rows.flatMap(row=>row.species_ids)).size;
 assert(root.querySelector('[data-role="overlap-total"]').textContent.includes('Union: '+expectedUnion+' species'),'Linked UpSet union does not match memberships');
 const column=root.querySelector('.upset-chart__column');column.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert(column.isConnected===false||root.querySelector('.upset-chart__column.is-selected'),'Intersection selection failed');
 const selectedLabel=root.querySelector('.upset-chart__column.is-selected').getAttribute('aria-label');
 await dashboard.setConfiguration('seasonal');await dashboard.setConfiguration('overlap');assert(root.querySelector('.upset-chart__column.is-selected')?.getAttribute('aria-label')===selectedLabel,'Intersection highlight lost across configuration switch');
 const next=root.querySelectorAll('.combination-chart__combination')[1];next.dispatchEvent(new MouseEvent('click',{bubbles:true}));await until(()=>root.querySelector('[data-role="overlap-chart"]').getAttribute('aria-busy')==='false');
 assert(JSON.stringify(store.getFilters('t4').selectedCombinationIds)!==JSON.stringify(selected),'Combination selection did not change');
 const catalog=await api.loadHotspots('US-MA-017'),ten=catalog.locations.slice(0,10).map(row=>row.locality_id);
 for(const size of [4,5]){
  store.setChart('t4',{candidateLocationIds:ten,numberOfLocations:size});await until(()=>root.querySelectorAll('.combination-chart__combination').length===50);
  const scroll=root.querySelector('.combination-chart__viewport');assert(scroll.scrollWidth>scroll.clientWidth,'Dense T4 ranking does not scroll internally');
  root.querySelector('.combination-chart__combination').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await until(()=>document.querySelectorAll('[data-role="overlap-hotspots"] li').length===size);
  const memberships=await api.loadHotspotSpecies('US-MA-017',store.getFilters('t4').selectedCombinationIds),union=new Set(memberships.flatMap(row=>row.species_ids)).size;
  assert(root.querySelector('[data-role="overlap-total"]').textContent.includes('Union: '+union+' species'),'Linked '+size+'-set union differs');
  checkBounds(root);checkOwnership(root);
 }
 report.push('Dashboard B: linked 3/4/5-hotspot unions, 50-bar internal scrolling, intersection keyboard selection/restoration passed');
 await dashboard.setConfiguration('seasonal');const late=deferred();blockedHeatmap=late;store.setChart('t2Heatmap',{speciesCount:10});await dashboard.setConfiguration('overlap');late.resolve([]);await settle();checkOwnership(root);assert(!root.querySelector('.species-heatmap__plot'),'Late heatmap recreated removed view');
 store.setShared({countyCode:'US-MA-025'});await settle();assert(store.getFilters('t4').candidateLocationIds.length===0&&store.getFilters('t4').selectedCombinationIds.length===0,'Geographic change retained incompatible hotspots');assert(!root.querySelector('.upset-chart__column'),'UpSet retained old county data');
 dashboard.destroy();dashboard.destroy();assert(tracked.count()===0&&!fixture.children.length&&!document.querySelector('[role="tooltip"],.visualization-overlay'),'Dashboard teardown leaked owned state or DOM');
 for(const fail of [false,true]){const pending=deferred(),other=trackedStore();const lateDashboard=mountDashboard({container:fixture,store:other.store,data:{...data,loadCountyGeometry:()=>pending.promise},geography,taxa,d3,topojson});lateDashboard.setConfiguration('overlap');lateDashboard.destroy();if(fail)pending.reject(new Error('Expected pending geometry rejection'));else pending.resolve(topology);await lateDashboard.ready;await settle();assert(other.count()===0&&!fixture.children.length&&!document.querySelector('[role="tooltip"],.visualization-overlay'),'Pending initialization survived dashboard destroy');}
 report.push('Geographic reset, pending swap, repeated destruction and pending geometry success/failure cleanup passed');
 results.textContent='PASS\n'+report.join('\n');document.title='PASS — Dashboard composition regression checks';
}
run().catch(error=>{console.error(error);results.textContent='FAIL\n'+error.stack;document.title='FAIL — Dashboard composition regression checks';});
