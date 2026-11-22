import { compactCases } from "./compact-cases.js";
import { createFilterStore } from "/filters/filter-store.js";
import { createFilterHeader } from "/components/filter-header.js";
import * as api from "/api/info-loader.js";
import { loadTaxonNameMap } from "/api/taxon-converter.js";
const fixture=document.querySelector("#fixture"),results=document.querySelector("#results"),report=[];
const assert=(value,message)=>{if(!value)throw new Error(message);};
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
async function until(predicate){const start=performance.now();while(!predicate()){if(performance.now()-start>15000)throw new Error("Compact update timed out");await settle();}}
function createStore(){const store=createFilterStore();store.setShared({stateCode:"US-MA",countyCode:"US-MA-017",taxonId:"avibase-4E74AE22"});store.setChart("t4",{candidateLocationIds:["L1039531","L1055329","L1055336","L109121","L1121533"],selectedCombinationIds:["L1039531","L1055329","L1055336"]});return store;}
function host(item){const node=document.createElement("div");node.style.width=item.width+"px";node.style.height=item.height+"px";fixture.append(node);return node;}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function bounds(node,container){const box=node.getBoundingClientRect(),parent=container.getBoundingClientRect();return box.height<=parent.height+1&&box.width<=parent.width+1;}
async function run(){
 const [geography,taxa,topology]=await Promise.all([api.loadGeographicOptions(),loadTaxonNameMap(),d3.json("/data/counties-10m.json")]);
 const snapshots={},data=Object.fromEntries(Object.entries(api).map(([name,fn])=>[name,async(...args)=>{const value=await fn(...args);snapshots[name]=value;return value;}]));data.loadCountyGeometry=async()=>topology;
 const loaders={map:"loadCountyRichness",bars:"loadCountyRichness",trends:"loadSpeciesTrend",holiday:"loadHolidayObservations",combinations:"loadHotspotSpecies",heatmap:"loadSpeciesHeatmap",upset:"loadHotspotSpecies"};
 for(const item of compactCases){
  const normalHost=host(item),normal=item.mount({container:normalHost,store:createStore(),data,geography,taxa,d3,topojson});await normal.ready;
  const expected=normal.root.querySelectorAll(item.selector).length;assert(expected>0,item.id+" standalone did not render");
  const fixed={trends:480,holiday:520,heatmap:648,upset:680,combinations:510};
  if(fixed[item.id])assert(Number(normal.root.querySelector('[data-plot] svg').getAttribute('height'))===fixed[item.id],item.id+" standalone height changed");
  normal.destroy();normalHost.remove();
  const card=host(item),store=createStore(),view=item.mount({container:card,store,data,geography,taxa,d3,topojson,presentation:"compact"});
  const header=createFilterHeader({container:view.controls,store,chartId:item.chartId,scope:"chart"});await view.ready;await settle();
  assert(view.root.querySelectorAll(item.selector).length===expected,item.id+" changed the marks/data");
  assert(bounds(view.root,card),item.id+" escaped its panel");
  assert(document.documentElement.scrollHeight===document.documentElement.clientHeight,"Page-level vertical overflow: "+item.id);
  assert(document.documentElement.scrollWidth===document.documentElement.clientWidth,"Page-level horizontal overflow: "+item.id);
  if(item.id==="trends"||item.id==="holiday"){const svg=view.root.querySelector("[data-plot] svg"),svgBox=svg.getBoundingClientRect();assert([...svg.children].filter(node=>node.tagName==="text").every(node=>{const box=node.getBoundingClientRect();return box.top>=svgBox.top-1&&box.bottom<=svgBox.bottom+1;}),item.id+" axis label clipped");}
  const target=view.root.querySelector(item.selector);target.focus();await settle();
  const tooltip=document.querySelector('[role="tooltip"]');assert(tooltip?.parentElement===document.body,item.id+" tooltip was not portaled");
  const box=tooltip.getBoundingClientRect();assert(!tooltip.hidden&&box.left>=0&&box.right<=document.documentElement.clientWidth+1&&box.top>=0&&box.bottom<=innerHeight+1,item.id+" tooltip escaped viewport");
  if(item.id==="heatmap"){
   store.setChart("t2Heatmap",{speciesCount:20});await until(()=>view.root.querySelectorAll(item.selector).length===240);
   const body=view.root.querySelector('.visualization-heatmap__body'),months=view.root.querySelector('.visualization-heatmap__months'),legend=view.root.querySelector('.visualization-heatmap__legend');
   const heatSvg=body.querySelector("svg");assert([...heatSvg.querySelectorAll(item.selector)].every(cell=>Number(cell.getAttribute("y"))+Number(cell.getAttribute("height"))<=Number(heatSvg.getAttribute("height"))),"Heatmap cells extend beyond reachable scroll content");
   assert(Number(heatSvg.getAttribute("height"))===20*18,"Compact heatmap row spacing changed");
   assert(body.scrollHeight>body.clientHeight,"Heatmap does not scroll all twenty species");const top=months.getBoundingClientRect().top,bottom=legend.getBoundingClientRect().bottom;
   const legendBox=legend.getBoundingClientRect();assert([...legend.querySelectorAll("text")].every(text=>{const b=text.getBoundingClientRect();return b.top>=legendBox.top-1&&b.bottom<=legendBox.bottom+1;}),"Heatmap legend text clipped");body.scrollTop=body.scrollHeight;await settle();assert(months.getBoundingClientRect().top===top&&legend.getBoundingClientRect().bottom===bottom,"Heatmap header/legend moved with rows");
  }
  if(item.id==="trends"){
   const colors={all:"#E67E22",spring:"#2E8B57",summer:"#D4AC0D",fall:"#D64545",winter:"#3498DB"};
   assert(view.root.querySelectorAll('.observation-trends__line').length===5,"Five trends missing");
   assert(!view.root.querySelector('[data-filter-path="charts.t2.season"]'),"Season dropdown remains");
   function checkSeason(selected){
    assert(view.root.querySelectorAll('.observation-trends__legend-item[aria-pressed="true"]').length===1,"Multiple selected trends");
    for(const [season,color] of Object.entries(colors)){
     const group=view.root.querySelector('.observation-trends__series[data-season="'+season+'"]');
     const line=group.querySelector('.observation-trends__line');
     assert(line.getAttribute('stroke')===color,"Season lost its permanent color");
     assert(group.getAttribute('opacity')===(season===selected?'1':'0.65'),"Incorrect season opacity");
     assert(Number(line.getAttribute('stroke-width'))===(season===selected?3.5:2),"Incorrect emphasis");
    }
   }
   function checkTrendLayout(){
    const svg=view.root.querySelector('.observation-trends__plot'), box=svg.getBoundingClientRect();
    const items=[...svg.querySelectorAll('.observation-trends__legend-item')];
    assert(items.map(item=>item.dataset.season).join(',')==='all,spring,summer,fall,winter','Legend order changed');
    const bounds=items.map(item=>item.getBoundingClientRect());
    assert(bounds.every((rect,index)=>Math.abs(rect.left-bounds[0].left)<1&&(!index||rect.top>=bounds[index-1].bottom-1)),'Legend is not a vertical column');
    assert(bounds.every(rect=>rect.left>=box.left&&rect.right<=box.right&&rect.top>=box.top&&rect.bottom<=box.bottom),'Legend clipped by chart panel');
    assert([...svg.querySelectorAll('.observation-trends__point')].every(point=>point.getBoundingClientRect().right<bounds[0].left),'Legend obscures plotted points');
    assert([...svg.querySelectorAll('.observation-trends__axis text,.observation-trends__axis-label')].every(text=>{const rect=text.getBoundingClientRect();return rect.left>=box.left-1&&rect.right<=bounds[0].left&&rect.top>=box.top-1&&rect.bottom<=box.bottom+1;}),'Axes or labels clipped or obscured by legend');
   }
   checkTrendLayout();
   checkSeason('all');
   for(const season of Object.keys(colors)){
    view.root.querySelector('.observation-trends__legend-item[data-season="'+season+'"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
    checkSeason(season);assert(store.getFilters('t2').season===season,"Legend did not synchronize state");
    view.root.querySelector('.observation-trends__series[data-season="'+season+'"] .observation-trends__line').dispatchEvent(new MouseEvent('click',{bubbles:true}));
    checkSeason(season);
   }
   const legend=view.root.querySelector('.observation-trends__legend-item[data-season="spring"]');
   legend.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));checkSeason('spring');
   legend.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));checkSeason('spring');
   const before=card.getBoundingClientRect().height;
   const details=[...view.root.querySelectorAll('button')].find(button=>button.textContent==='Details');
   details.click();await settle();assert(document.querySelector('dialog[open]')?.textContent.includes('Winter selects January'),"Details lost seasonal calculation notes");
   assert(card.getBoundingClientRect().height===before,"Details changed compact panel height");
   document.querySelector('dialog[open] button').click();
  }
  if(item.id==="bars"){
   store.setShared({stateCode:"US-TX"});await until(()=>view.root.querySelectorAll(item.selector).length===254);const scroll=view.root.querySelector('.county-bars__viewport');assert(scroll.scrollWidth>scroll.clientWidth,"Large county rankings do not scroll");
  }
  if(item.id==="combinations"){
   const catalog=await data.loadHotspots("US-MA-017");store.setChart("t4",{candidateLocationIds:catalog.locations.slice(0,10).map(row=>row.locality_id),numberOfLocations:5});
   await until(()=>view.root.querySelectorAll(item.selector).length===50);const scroll=view.root.querySelector(".combination-chart__viewport");assert(scroll.scrollWidth>scroll.clientWidth,"Fifty combinations do not scroll internally");
   assert(view.root.querySelector('[data-role="combination-page"]').textContent.includes("252"),"Dense ranking lost combinations");
  }
  if(item.id==="combinations"||item.id==="upset"){
   const trigger=[...view.root.querySelectorAll('button')].find(button=>button.textContent.startsWith('Hotspots'));
   const height=card.getBoundingClientRect().height;trigger.click();await settle();const dialog=document.querySelector('dialog[open]');assert(dialog&&dialog.contains(document.activeElement),"Selector did not receive focus");assert(card.getBoundingClientRect().height===height,"Selector changed panel height");dialog.querySelector('button').click();await until(()=>document.activeElement===trigger);assert(document.activeElement===trigger,"Selector did not restore focus");
  }
  card.style.width=Math.max(500,item.width-200)+"px";card.style.height=Math.max(220,item.height-40)+"px";await settle();await settle();assert(bounds(view.root,card),item.id+" did not resize");
  assert(![...view.root.querySelectorAll('path')].some(path=>/NaN|Infinity/.test(path.getAttribute('d')||'')),item.id+" generated invalid resized geometry");
  if(item.id==="trends"){
   const legend=view.root.querySelector('.observation-trends__legend').getBoundingClientRect(), plot=view.root.querySelector('svg').getBoundingClientRect();
   assert(legend.right<=plot.right&&legend.bottom<=plot.bottom,'Resized legend escaped the chart');
   assert([...view.root.querySelectorAll('.observation-trends__point')].every(point=>point.getBoundingClientRect().right<legend.left),'Resized legend obscures lines');
  }
  const ids=[...document.querySelectorAll("[id]")].map(node=>node.id);assert(new Set(ids).size===ids.length,"Duplicate IDs including portals/overlays");
  header.destroy();view.destroy();view.destroy();card.remove();assert(!document.querySelector('.visualization-overlay')&&!document.querySelector('[role="tooltip"]'),item.id+" leaked portals/dialogs");
  for(const reject of [false,true]){
   const pending=deferred(),pendingHost=host(item),loader=loaders[item.id];const late=item.mount({container:pendingHost,store:createStore(),data:{...data,[loader]:()=>pending.promise},geography,taxa,d3,topojson,presentation:"compact"});await settle();late.destroy();if(reject)pending.reject(new Error("Expected late compact error"));else pending.resolve(snapshots[loader]);await late.ready;await settle();assert(!pendingHost.children.length&&!document.querySelector('.visualization-overlay')&&!document.querySelector('[role="tooltip"]'),item.id+" leaked after pending destroy");pendingHost.remove();
  }
  report.push(item.label+": standalone parity, target bounds, tooltip, resize, scrolling/overlay, cleanup passed");results.textContent="Running…\n"+report.join("\n");
 }
 // Force every five-set exclusive membership pattern, with no original-data scans.
 const item=compactCases.find(item=>item.id==='upset'),card=host(item),store=createStore();const ids=store.getFilters('t4').candidateLocationIds;
 const memberships=ids.map((id,index)=>({locality_id:id,locality_name:'Set '+(index+1),species_ids:Array.from({length:31},(_,mask)=>mask+1).filter(mask=>mask&(1<<index)).map(mask=>'species-'+mask)}));
 let selectedIds=[];const view=item.mount({container:card,store,data:{...data,loadHotspotSpecies:async()=>memberships},d3,presentation:'compact',onIntersectionSelect:ids=>{selectedIds=ids;}});await view.ready;assert(view.root.querySelectorAll(item.selector).length===31,'Missing five-set intersections');const scroll=view.root.querySelector('.upset-chart__viewport');assert(scroll.scrollWidth>scroll.clientWidth,'All31 intersections should scroll internally');view.root.querySelector(item.selector).dispatchEvent(new MouseEvent('click',{bubbles:true}));assert(selectedIds.length>0,'Intersection selection hook did not fire');view.destroy();
 const restored=item.mount({container:card,store,data:{...data,loadHotspotSpecies:async()=>memberships},d3,presentation:'compact',initialIntersectionIds:selectedIds});await restored.ready;assert(restored.root.querySelector('.is-selected'),'Intersection highlight did not restore');restored.destroy();card.remove();
 report.push('All 31 exclusive intersections, union=31, horizontal scrolling and ID-based highlight restoration passed');
 const barCase=compactCases.find(item=>item.id==='bars'),sharedStore=createStore();fixture.style.display='flex';fixture.style.gap='12px';
 const firstHost=host({...barCase,width:700,height:320}),secondHost=host({...barCase,width:700,height:320});
 const first=barCase.mount({container:firstHost,store:sharedStore,data,geography,d3,presentation:'compact'}),second=barCase.mount({container:secondHost,store:sharedStore,data,geography,d3,presentation:'compact'});await Promise.all([first.ready,second.ready]);
 const sharedIds=[...document.querySelectorAll('[id]')].map(node=>node.id);assert(new Set(sharedIds).size===sharedIds.length,'Two compact instances have duplicate portal IDs');
 first.destroy();sharedStore.setShared({countyCode:'US-MA-025'});await settle();assert(second.root.querySelectorAll('.county-bars__county.is-selected').length===1,'Destroying one compact instance broke another');assert(document.querySelectorAll('[role="tooltip"]').length===1,'Destroying one compact instance removed the wrong tooltip');second.destroy();firstHost.remove();secondHost.remove();
 report.push('Two compact instances, one store: independent portals, IDs, highlight and teardown passed');
 results.textContent="PASS\n"+report.join("\n");document.title="PASS — Compact presentation regression checks";
}
run().catch(error=>{console.error(error);results.textContent="FAIL\n"+error.stack;document.title="FAIL — Compact presentation regression checks";});
