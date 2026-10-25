
/* =====================================================================
   BASE MAP
   Real shapes from the US Census map (TIGER): Chicago in the lighter shade and the suburbs a shade darker,
   as on CTA's own system map; Chicago's street grid; and Lake Michigan's real shoreline.
   ===================================================================== */
const svg=$("map"),lsvg=$("labels");
el("rect",{x:-6000,y:-6000,width:13000,height:13000,fill:"var(--bg)"},svg);
const world=el("g",{},svg);
const defs=el("defs",{},svg);
const ringD=rs=>rs.map(r=>"M"+r.map(p=>p[0]+","+p[1]).join("L")+"Z").join("");
const borderG=el("g",{"aria-hidden":"true"},world),STATE_LBL=[];
const SL=(txt,x,y,dx,dy,anchor)=>{const t=el("text",{class:"stlbl","text-anchor":anchor},borderG);t.textContent=txt;STATE_LBL.push({t,x,y,dx,dy})};
for(const t of NET.base.towns)if(t.name!=="Chicago")el("path",{class:"town",d:ringD(t.rings)},borderG);
{const chi=NET.base.towns.find(t=>t.name==="Chicago");
 if(chi){el("path",{class:"city",d:ringD(chi.rings)},borderG);
  // Chicago's address grid: a line every half mile (400 in the street numbers), from State & Madison, inside the city
  const cp=el("clipPath",{id:"cityclip"},defs);el("path",{d:ringD(chi.rings)},cp);
  const G=NET.base.grid,m=G.mile/2,[ox,oy]=G.origin;let d="";
  for(let x=ox-Math.floor(ox/m)*m;x<=BOX.x1;x+=m)d+=`M${x.toFixed(1)},${BOX.y0}V${BOX.y1}`;
  for(let y=oy-Math.floor(oy/m)*m;y<=BOX.y1;y+=m)d+=`M${BOX.x0},${y.toFixed(1)}H${BOX.x1}`;
  el("path",{class:"grid",d,"clip-path":"url(#cityclip)"},borderG)}}
for(const t of NET.base.towns.filter(t=>t.label).sort((a,b)=>a.rank-b.rank))SL(t.name.toUpperCase(),t.label[0],t.label[1],0,4,"middle");   // most important first
// state lines (Census outlines, data/states.json). Drawn under the lake, so the parts that run out over the water are covered.
const STATE_NM=[];
if(NET.base.states&&NET.base.states.length){
  el("path",{class:"stateline",d:NET.base.states.map(s=>"M"+s.pts.map(p=>p[0]+","+p[1]).join("L")).join("")},borderG);
  for(const s of NET.base.state_names||[]){const t=el("text",{class:"stname","text-anchor":"middle"},borderG);t.textContent=s.name;STATE_NM.push({t,x:s.xy[0],y:s.xy[1]})}}
// the lake runs on past the map's edges (north, east, south), so it never ends in a straight line
const onEdge=p=>Math.abs(p[0]-BOX.x1)<.06||Math.abs(p[1]-BOX.y0)<.06||Math.abs(p[1]-BOX.y1)<.06;
const LAKE_RINGS=NET.base.lake.map(r=>r.map(([x,y])=>[Math.abs(x-BOX.x1)<.06?x+5000:x,Math.abs(y-BOX.y0)<.06?y-4000:Math.abs(y-BOX.y1)<.06?y+4000:y]));
const LAKE=ringD(LAKE_RINGS);
el("path",{class:"lake",d:LAKE},world);
{let d="";for(const r of NET.base.lake){let open=false;      // the shoreline only, not the map's own edges
   for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];
     if(onEdge(a)&&onEdge(b)){open=false;continue}
     d+=(open?"":`M${a[0]},${a[1]}`)+`L${b[0]},${b[1]}`;open=true}}
 el("path",{class:"shore",d},world)}
/* ---- lake water ----
   Small glints on a jittered grid + a few ripples, generated once from a fixed seed (same water every load),
   clipped to the lake. Covers everything you can reach when zoomed all the way out. */
(function lakeWater(){
  let seed=20261009;
  const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
  const poly=LAKE_RINGS.reduce((a,r)=>r.length>a.length?r:a,[]);
  const inside=(x,y)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c}return c};
  const edge=(x,y)=>{let m=1e9;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[j],b=poly[i],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy||1;
    let t=((x-a[0])*dx+(y-a[1])*dy)/l2;t=Math.max(0,Math.min(1,t));m=Math.min(m,Math.hypot(a[0]+dx*t-x,a[1]+dy*t-y))}return m};
  const cp=el("clipPath",{id:"lakeclip"},defs);el("path",{d:LAKE},cp);
  const g=el("g",{class:"water","clip-path":"url(#lakeclip)","aria-hidden":"true"},world);
  const CW=240,CH=176,X0=Math.min(...poly.map(p=>p[0]));
  for(let cy=BOX.y0-1100;cy<BOX.y1+1100;cy+=CH)for(let cx=X0;cx<BOX.x1+1600;cx+=CW){
    const x=cx+rnd()*CW,y=cy+rnd()*CH;
    if(!inside(x,y)||!inside(x+50,y)||edge(x,y)<18||edge(x+50,y)<18)continue;
    const dur=13+rnd()*9,a=.35+rnd()*.55,dl=-rnd()*dur,ring=rnd()<.28,r=ring?3.2+rnd()*2.4:1.7+rnd()*1.9;
    const w=el("g",{transform:`translate(${x.toFixed(1)},${y.toFixed(1)})`},g);
    el("circle",{class:"wv "+(ring?"ring":"dot"),r:r.toFixed(2),style:`--a:${a.toFixed(2)};--dur:${dur.toFixed(1)}s;--dl:${dl.toFixed(1)}s`},w);
  }
  for(let k=0,tries=0;k<12&&tries<600;tries++){
    const x=X0+rnd()*1800,y=BOX.y0-900+rnd()*(BOX.y1-BOX.y0+1800);if(!inside(x,y)||edge(x,y)<70)continue;k++;
    const dur=11+rnd()*7;
    el("circle",{class:"rp",cx:x.toFixed(1),cy:y.toFixed(1),r:6,style:`--dur:${dur.toFixed(1)}s;--dl:${(-rnd()*dur).toFixed(1)}s`},g);
  }
})();
// the lake's name, big and spaced out, running offshore alongside the coast (as on CTA's map)
{const a=geo(42.04,-87.572),b=geo(41.845,-87.497),cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2,ang=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;
 el("text",{class:"lakelbl",x:cx.toFixed(1),y:cy.toFixed(1),transform:`rotate(${ang.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})`,"text-anchor":"middle","dominant-baseline":"middle"},world).textContent="LAKE MICHIGAN"}

const trackG=el("g",{},world),xlinkG=el("g",{class:"xlinks","aria-hidden":"true"},world),stnG=el("g",{},world),trailG=el("g",{},world),trainG=el("g",{},world);
const lineEls={};
// every line's thin casing (in the land colour) goes in one layer UNDER all the colours, so a line drawn later
// never paints over its neighbour's stripe: side by side, every colour shows in full (as on CTA's map)
const caseG=el("g",{},trackG);
for(const key of ORDER){const L=LINES[key],cg=el("g",{},caseG),g=el("g",{},trackG);
  for(const r of L.routes){r.cel=el("path",{class:"track case"},cg);r.el=el("path",{class:"track"+(L.sys==="metra"?" metra":""),stroke:L.color},g);
    if(L.sys==="metra")r.sel=el("path",{class:"track stripe"},g)}         // Metra: a thin stripe down the middle, like a railroad on a map
  lineEls[key]={track:g,cases:cg,stns:[]};}
const gRec=new WeakMap();
/* transfers, as on a wayfinding map:
     one station, several lines (same CTA station id / same Metra stop id): a white pill with a dark outline
     two stations with a checked walk between them (data/transfers.json): both get a dark outline, joined by a link
   A line crossing another isn't a transfer, and nothing else is drawn as one. */
const XLINKS=[...(NET.transfers||[]).map(([a,b])=>[a,b,"cm"]),...(NET.walks||[]).map(([a,b])=>[a,b,"cc"])]
  .map(([a,b,kind])=>({a:STN.get(a),b:STN.get(b),kind})).filter(x=>x.a&&x.b);
const XEND=new Set();for(const x of XLINKS){XEND.add(x.a);XEND.add(x.b)}
// a short link (same building, under 150 m) is a solid connector; a longer one is a walk along the street: dotted
for(const x of XLINKS){const m=Math.hypot(STOPS[x.a.id]?(STOPS[x.a.id].lat-STOPS[x.b.id].lat)*110540:0,STOPS[x.a.id]?(STOPS[x.a.id].lon-STOPS[x.b.id].lon)*82500:0);
  x.m=Math.round(m);x.g=el("g",{class:"xlink "+x.kind+(m>150?" walk":"")},xlinkG);x.c=el("path",{class:"xc"},x.g);x.i=el("path",{class:"xi"},x.g)}
for(const rec of STATIONS){
  rec.inter=rec.lines.size>1||XEND.has(rec);                                // a real transfer point (several lines, or a checked walk)
  const g=el("g",{class:"sg"+(rec.inter?" xfer":"")+(rec.terminus?" termn":"")},stnG);rec.g=g;
  if(rec.multi){rec.kind="pill";rec.shape=el("rect",rec.lines.size>1?{class:"pill"}:{class:"pill one"+(XEND.has(rec)?" xend":""),style:`stroke:${LINES[rec.inst[0].key].color}`},g)}
  else{const q=rec.inst[0];rec.kind="dot";rec.shape=el("circle",{class:"stn"+(XEND.has(rec)?" xend":""),stroke:LINES[q.key].color},g)}
  rec.hit=el("rect",{class:"stnhit",rx:4},g);gRec.set(g,rec);
  g.setAttribute("tabindex","0");g.setAttribute("role","button");
  g.setAttribute("aria-label",`${rec.full} station, ${ORDER.filter(k=>rec.lines.has(k)).map(k=>LINES[k].name).join(", ")}. Press Enter for arrivals.`);
  g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openStationPop(rec)}});
  g.addEventListener("pointerenter",e=>{if(!drag||!drag.moved)showStationTip(rec,e)});
  g.addEventListener("pointermove",e=>{if(!drag||!drag.moved)showStationTip(rec,e)});
  g.addEventListener("pointerleave",hideTip);
}
// track width on screen, from zoom (the same rule MetraBot uses)
function twPx(){const z=FIT_W/vb.w;return Math.max(2.4,Math.min(6.5,2.6+1.5*Math.log2(Math.max(1,z))))}
// lines on shared track: far out they sit at their real spacing (merging into one band); zoomed in they fan out
// to a full line width each, side by side with a hairline between, like the stripes on CTA's map
// (never more than ~27 m apart on the ground, so the outer stripes of a bundle still turn cleanly round its curves)
function bundleGap(upp){const tw=twPx(),z=FIT_W/(upp*cw()),k=Math.max(0,Math.min(1,(z-1.6)/3));
  return Math.min(.9,Math.max(Math.min(tw,.25/upp),(tw+.8)*k)*upp)}
function placeNetwork(){
  const upp=vb.w/cw(),g=bundleGap(upp);
  for(const key of ORDER)for(const r of LINES[key].routes){offsetLine(r.anc,r.slot,g,r.off);
    const d="M"+r.off.map(p=>p[0].toFixed(2)+","+p[1].toFixed(2)).join("L");r.el.setAttribute("d",d);r.cel.setAttribute("d",d);if(r.sel)r.sel.setAttribute("d",d)}
  for(const rec of STATIONS){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for(const q of rec.inst){q.xy=alongOff(q.r,q.d);x0=Math.min(x0,q.xy[0]);y0=Math.min(y0,q.xy[1]);x1=Math.max(x1,q.xy[0]);y1=Math.max(y1,q.xy[1])}
    rec.box={x0,y0,x1,y1};rec.xy=[(x0+x1)/2,(y0+y1)/2];
    const q=rec.inst[0],a=angAt(q.r,segAt(q.r.ac,q.d));rec.n=[-Math.sin(a),Math.cos(a)]}   // labels try beside the track first
}
// markers keep a steady on-screen size; only the track geometry scales with zoom
function updateStateLabels(k){for(const q of STATE_LBL){q.t.style.fontSize=(11.5*k).toFixed(3)+"px";
  q.t.setAttribute("y",(q.y+q.dy*k).toFixed(2));q.t.setAttribute("x",(q.x+q.dx*k).toFixed(2))}
  const far=vb.w>FIT_W*1.5;                                                  // the states' names only once you're out past Chicago
  for(const q of STATE_NM){q.t.style.fontSize=(12*k).toFixed(3)+"px";q.t.setAttribute("x",q.x);q.t.setAttribute("y",q.y);q.t.style.display=far?"":"none"}}
function updateMarkers(){
  placeNetwork();
  updateStateLabels(vb.w/cw());
  const k=vb.w/cw(),z=FIT_W/vb.w,rs=Math.min(4,1.8*Math.sqrt(Math.max(1,z)));
  for(const rec of STATIONS){const b=rec.box;
    if(rec.kind==="dot"){const r=rs*k;rec.shape.setAttribute("cx",rec.xy[0].toFixed(3));rec.shape.setAttribute("cy",rec.xy[1].toFixed(3));
      rec.shape.setAttribute("r",r.toFixed(3));rec.half=[r,r]}
    else{const pad=(rs+1.8)*k;
      const a={x:b.x0-pad,y:b.y0-pad,width:b.x1-b.x0+pad*2,height:b.y1-b.y0+pad*2,rx:pad};
      for(const q in a)rec.shape.setAttribute(q,a[q].toFixed(3));rec.half=[(b.x1-b.x0)/2+pad,(b.y1-b.y0)/2+pad]}
    rec.hit.setAttribute("x",(rec.xy[0]-rec.half[0]-7*k).toFixed(2));rec.hit.setAttribute("y",(rec.xy[1]-rec.half[1]-7*k).toFixed(2));
    rec.hit.setAttribute("width",(rec.half[0]*2+14*k).toFixed(2));rec.hit.setAttribute("height",(rec.half[1]*2+14*k).toFixed(2));}
  for(const x of XLINKS){const d=`M${x.a.xy[0].toFixed(2)},${x.a.xy[1].toFixed(2)}L${x.b.xy[0].toFixed(2)},${x.b.xy[1].toFixed(2)}`;x.c.setAttribute("d",d);x.i.setAttribute("d",d)}
}
// segments used as label obstacles (they share the offset lines' points, so they follow every re-offset)
const SEGMENTS=[];for(const key of ORDER)for(const r of LINES[key].routes)for(let i=1;i<r.off.length;i++)SEGMENTS.push({key,a:r.off[i-1],b:r.off[i]});
