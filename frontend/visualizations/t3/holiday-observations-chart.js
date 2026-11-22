// Adapt the holiday-test.js yearly scales, dual-series joins, grid, palette, and legend.
const SERIES = [
  { key: "holidayAverage", label: "Holidays", color: "#e68625", dash: null },
  { key: "nonHolidayAverage", label: "Non-holidays", color: "#377eb8", dash: "6,3" }
];

export function createHolidayObservationsChart({ d3 = globalThis.d3, sizing = {}, presentation = "standalone", container, tooltip }) {
  const compact = presentation === "compact";
  const svg = d3.select(container).append("svg").attr("class", "holiday-patterns__plot")
    .attr("role", "group").attr("aria-label", "Average daily observation records on holidays and non-holidays")
    .attr("width", 0).attr("height", 0);
  const average = d3.format(",.3f");
  const integer = d3.format(",");
  let current;
  const hideTooltip = () => { tooltip.hidden = true; };
  const describe = point => point.year + ": holidays " + average(point.holidayAverage) + " records/day (" +
    integer(point.holidayObservations) + " records / " + point.holidayDays + " days); non-holidays " +
    average(point.nonHolidayAverage) + " records/day (" + integer(point.nonHolidayObservations) + " records / " + point.nonHolidayDays + " days)";

  function positionTooltip(event, node) {
    const box = node.getBoundingClientRect();
    const pointer = event.type.startsWith("pointer");
    const left = pointer ? event.clientX+12 : box.right+8;
    const top = pointer ? event.clientY+12 : box.top;
    tooltip.style.left = Math.max(8,Math.min(left,document.documentElement.clientWidth-tooltip.offsetWidth-8))+"px";
    tooltip.style.top = Math.max(8,Math.min(top,document.documentElement.clientHeight-tooltip.offsetHeight-8))+"px";
  }
  function showTooltip(event, point) {
    const title = document.createElement("strong");
    title.textContent = "Year: " + point.year;
    const lines = [
      "Holidays: " + average(point.holidayAverage) + " records/day",
      integer(point.holidayObservations) + " records / " + point.holidayDays + " calendar days",
      "Non-holidays: " + average(point.nonHolidayAverage) + " records/day",
      integer(point.nonHolidayObservations) + " records / " + point.nonHolidayDays + " calendar days"
    ].map(text => { const line=document.createElement("div");line.textContent=text;return line; });
    tooltip.replaceChildren(title,...lines);
    tooltip.hidden=false;
    positionTooltip(event,event.currentTarget);
  }

  function render(model) {
    const {series,startYear,endYear}=model;
    const width=Math.max(compact ? 320 : 720, container.clientWidth);
    const height = compact ? Math.max(110, container.clientHeight) : (sizing.height ?? 520);
    const margin=compact ? {left:72,right:16,top:34,bottom:34} : {left:100,right:32,top:60,bottom:60};
    current={...model,viewportWidth:container.clientWidth,viewportHeight:container.clientHeight};
    hideTooltip();
    svg.attr("width",width).attr("height",height).selectAll("*").remove();
    const x=d3.scaleLinear().domain(startYear===endYear?[startYear-0.5,endYear+0.5]:[startYear,endYear]).range([margin.left,width-margin.right]);
    const max=d3.max(series.flatMap(point=>[point.holidayAverage,point.nonHolidayAverage]).filter(value=>value!==null)) || 0;
    const y=d3.scaleLinear().domain([0,max || 1]).nice().range([height-margin.bottom,margin.top]);
    const grid=svg.append("g").attr("class","holiday-patterns__grid").attr("aria-hidden","true")
      .attr("transform","translate("+margin.left+",0)")
      .call(d3.axisLeft(y).ticks(compact && height < 145 ? 3 : 6).tickSize(-(width-margin.left-margin.right)).tickFormat(""));
    grid.select(".domain").remove();
    svg.append("g").attr("class","holiday-patterns__axis").attr("aria-hidden","true")
      .attr("transform","translate(0,"+(height-margin.bottom)+")")
      .call(d3.axisBottom(x).tickValues(series.filter((point,index)=>!compact||index%Math.max(1,Math.ceil(series.length/Math.max(2,Math.floor((width-margin.left-margin.right)/75))))===0||index===series.length-1).map(point=>point.year)).tickFormat(d3.format("d")));
    svg.append("g").attr("class","holiday-patterns__axis").attr("aria-hidden","true")
      .attr("transform","translate("+margin.left+",0)")
      .call(d3.axisLeft(y).ticks(compact && height < 145 ? 3 : 6).tickFormat(d3.format(".3~g")));
    svg.append("text").attr("x",margin.left+(width-margin.left-margin.right)/2).attr("y",height-(compact?5:14)).attr("text-anchor","middle").text("Year");
    svg.append("text").attr("transform","rotate(-90)").attr("x",-(margin.top+height-margin.bottom)/2)
      .attr("y",20).attr("text-anchor","middle").text(compact ? "Records per day" : "Average daily observation records");
    SERIES.forEach((item,index)=>{
      const legend=svg.append("g").attr("class","holiday-patterns__legend").attr("transform","translate("+(margin.left+index*(compact?150:200))+","+(compact?14:24)+")");
      legend.append("line").attr("x2",28).attr("stroke",item.color).attr("stroke-width",3).attr("stroke-dasharray",item.dash);
      legend.append("text").attr("x",36).attr("y",4).text(item.label);
      const line=d3.line().defined(point=>point[item.key]!==null).x(point=>x(point.year)).y(point=>y(point[item.key]));
      svg.append("path").datum(series).attr("class","holiday-patterns__line").attr("data-series",item.key)
        .attr("d",line).attr("fill","none").attr("stroke",item.color).attr("stroke-width",2.5).attr("stroke-dasharray",item.dash);
    });
    const years=svg.append("g").selectAll(".holiday-patterns__year")
      .data(series.filter(point=>point.holidayAverage!==null&&point.nonHolidayAverage!==null),point=>point.year)
      .join("g").attr("class","holiday-patterns__year").attr("data-year",point=>point.year)
      .attr("tabindex",0).attr("role","img").attr("aria-label",describe).attr("aria-describedby",tooltip.id)
      .on("pointerenter focus",showTooltip).on("pointermove",function(event){positionTooltip(event,this);})
      .on("pointerleave blur",hideTooltip).on("keydown",event=>{if(event.key==="Escape")hideTooltip();});
    SERIES.forEach((item,index)=>{
      years.append("circle").attr("cx",point=>x(point.year)).attr("cy",point=>y(point[item.key])).attr("r",11).attr("fill","transparent");
      years.append("circle").attr("class","holiday-patterns__dot").attr("data-series",item.key)
        .attr("cx",point=>x(point.year)).attr("cy",point=>y(point[item.key])).attr("r",index===0?5:3.5)
        .attr("fill",item.color).attr("pointer-events","none");
    });
    if(!series.some(point=>point.holidayAverage!==null)) svg.append("text").attr("x",(width+margin.left)/2)
      .attr("y",height/2).attr("text-anchor","middle").text("Observation summaries unavailable");
  }
  const resize=new ResizeObserver(()=>{if(current&&(current.viewportWidth!==container.clientWidth || (compact && current.viewportHeight!==container.clientHeight)))render(current);});
  resize.observe(container);
  return {
    render,
    clear(){current=null;hideTooltip();svg.selectAll("*").remove();svg.attr("width",0).attr("height",0);},
    destroy(){resize.disconnect();hideTooltip();svg.remove();}
  };
}
