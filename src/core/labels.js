
/* =====================================================================
   STATION LABELS
   Screen-space layer. Real canvas measurement of every label. Placement is
   greedy by priority (terminals, termini/interchanges, then an even
   midpoint subdivision along each line). A label is only placed where it
   clears other labels, every track segment, and every station marker.
   Labels visible last time are tried first at equal priority, so small
   zoom changes don't make them flicker. Between layouts, labels ride along
   with the map at a constant size.
   ===================================================================== */
const wcache=new Map();
const LFS=t=>t===0?14:12.5;
// where the short name repeats elsewhere on the network ("75th St"), show its alternate name too
const primCount={};for(const r of STATIONS)primCount[r.label]=(primCount[r.label]||0)+1;
for(const r of STATIONS)r.alt="";   // same-named stations (Western, Damen, ...) are told apart by their line colours, as on CTA's map
const SHORT={};   // used only when the full name can't fit cleanly between neighbouring lines
function fillLabel(t,rec,v=0){t.textContent=v===2?SHORT[rec.id]:rec.label;if(rec.alt){const sp=el("tspan",{class:"alt",dx:"4"},t);sp.textContent=rec.alt}
  if(rec.tier===0&&v===0){let first=true;for(const k of ORDER)if(rec.lines.has(k)){          // which lines use this terminal
    const sp=el("tspan",{class:"tl",dx:first?"5":"1",fill:LINES[k].color,"data-k":k},t);sp.textContent="●";first=false}}}
const meas=el("text",{style:"visibility:hidden"},lsvg);
function textBox(rec,v=0){const key=rec.id+"|"+v;let m=wcache.get(key);   // real rendered size at base font size
  if(!m){meas.setAttribute("class","lbl t"+rec.tier);meas.setAttribute("font-size",LFS(rec.tier));
    meas.textContent="";fillLabel(meas,rec,v);
    const bb=meas.getBBox();m={w:bb.width,h:bb.height};wcache.set(key,m)}
  return m}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{wcache.clear();labelsDirty=true});
if(document.fonts)document.fonts.addEventListener("loadingdone",()=>{wcache.clear();labelsDirty=true});

let prevShown=new Set(),labelsDirty=true,labelVB=null;
const labelEls=new Map();   // id -> {t, dx, dy} dx/dy = screen offset from station anchor at layout time
function boxHitsSeg(b,a,c){  // Liang–Barsky: does segment a->c enter box b?
  let t0=0,t1=1;const dx=c[0]-a[0],dy=c[1]-a[1];
  const p=[-dx,dx,-dy,dy],q=[a[0]-b.x0,b.x1-a[0],a[1]-b.y0,b.y1-a[1]];
  for(let i=0;i<4;i++){if(p[i]===0){if(q[i]<0)return false}else{const r=q[i]/p[i];
    if(p[i]<0){if(r>t1)return false;if(r>t0)t0=r}else{if(r<t0)return false;if(r<t1)t1=r}}}
  return true}
function layoutLabels(){
  const W=cw(),H=ch(),sx=W/vb.w,sy=H/vb.h,toS=p=>{const q=rotPt(p);return[(q[0]-vb.x)*sx,(q[1]-vb.y)*sy]};
  const rc=Math.cos(ROT.a),rs=Math.sin(ROT.a),turned=Math.abs(ROT.a)>1e-4;
  const trackHalf=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tw"))/2+1.5;
  // obstacles in screen space, culled to the viewport (+margin)
  const M=160,inView=(x,y)=>x>-M&&x<W+M&&y>-M&&y<H+M;
  const segs=[];for(const s of SEGMENTS){if(focusKey&&s.key!==focusKey)continue;const a=toS(s.a),b=toS(s.b);
    if(Math.max(a[0],b[0])<-M||Math.min(a[0],b[0])>W+M||Math.max(a[1],b[1])<-M||Math.min(a[1],b[1])>H+M)continue;segs.push([a,b,s.key])}
  for(const x of XLINKS){if(focusKey&&!x.a.lines.has(focusKey)&&!x.b.lines.has(focusKey))continue;segs.push([toS(x.a.xy),toS(x.b.xy),"xlink"])}   // labels keep off the transfer links too
  // a coarse screen grid over the track, so a label checks only the track near it (NITABot has ~4x CTABot's track)
  const GC=48,sgrid=new Map();
  segs.forEach((s,i)=>{const x0=Math.floor(Math.min(s[0][0],s[1][0])/GC),x1=Math.floor(Math.max(s[0][0],s[1][0])/GC),
    y0=Math.floor(Math.min(s[0][1],s[1][1])/GC),y1=Math.floor(Math.max(s[0][1],s[1][1])/GC);
    for(let gx=x0;gx<=x1;gx++)for(let gy=y0;gy<=y1;gy++){const k=gx*100003+gy;let c=sgrid.get(k);if(!c)sgrid.set(k,c=[]);c.push(i)}});
  const segsNear=(b,pad)=>{const out=new Set();for(let gx=Math.floor((b.x0-pad)/GC);gx<=Math.floor((b.x1+pad)/GC);gx++)
    for(let gy=Math.floor((b.y0-pad)/GC);gy<=Math.floor((b.y1+pad)/GC);gy++){const c=sgrid.get(gx*100003+gy);if(c)for(const i of c)out.add(i)}
    return[...out].map(i=>segs[i])};
  const dPtSeg=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy||1;let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2;t=Math.max(0,Math.min(1,t));
    return Math.hypot(a[0]+dx*t-p[0],a[1]+dy*t-p[1])};
  const dBoxSeg=(b,a,c)=>{const cs=[[b.x0,b.y0],[b.x1,b.y0],[b.x0,b.y1],[b.x1,b.y1]];let m=Infinity;
    for(const q of cs)m=Math.min(m,dPtSeg(q,a,c));
    for(const q of[a,c]){const dx=Math.max(b.x0-q[0],q[0]-b.x1,0),dy=Math.max(b.y0-q[1],q[1]-b.y1,0);m=Math.min(m,Math.hypot(dx,dy))}
    return m};
  const marks=[];for(const rec of STATIONS){if(focusKey&&!rec.lines.has(focusKey))continue;const c=toS(rec.xy);if(!inView(c[0],c[1]))continue;
    const hm=turned?Math.max(rec.half[0],rec.half[1]):0,hx=(turned?hm:rec.half[0])*sx+1.5,hy=(turned?hm:rec.half[1])*sy+1.5;marks.push({x0:c[0]-hx,y0:c[1]-hy,x1:c[0]+hx,y1:c[1]+hy,id:rec.id,c,hx,hy})}
  const UI=[{x0:0,y0:0,x1:W,y1:uiInsets().top-4}];          // don't draw labels under the top strip
  const consoleR=$("console").getBoundingClientRect(),zoomR=document.querySelector(".zoom").getBoundingClientRect(),sr=svgRect();
  for(const r of[consoleR,zoomR])UI.push({x0:r.left-sr.left-4,y0:r.top-sr.top-4,x1:r.right-sr.left+4,y1:r.bottom-sr.top+4});
  for(const q of[$("card"),$("notice"),$("spop"),$("board"),$("fstrip")]){if(!q.offsetHeight||(q.classList.contains("pnl")&&!q.classList.contains("on"))||getComputedStyle(q).visibility==="hidden")continue;const r=q.getBoundingClientRect();
    const gx=r.width*.03+3,gy=r.height*.03+3;     // panels may still be scaling in: leave room for their full size
    UI.push({x0:r.left-sr.left-gx,y0:r.top-sr.top-gy,x1:r.right-sr.left+gx,y1:r.bottom-sr.top+gy})}
  const placed=[],out=[],PAD=3,FS=labelScale();
  const hit=(b,list)=>{for(const p of list)if(b.x0<p.x1&&b.x1>p.x0&&b.y0<p.y1&&b.y1>p.y0)return true;return false};
  const cands=[];
  for(const rec of STATIONS){
    if(focusKey&&!rec.lines.has(focusKey))continue;
    const c=toS(rec.xy);if(c[0]<-60||c[0]>W+60||c[1]<-30||c[1]>H+30)continue;
    cands.push({rec,c});
  }
  cands.sort((a,b)=>a.rec.tier-b.rec.tier||(a.rec.torder||0)-(b.rec.torder||0)||a.rec.rank-b.rec.rank||
    (prevShown.has(b.rec.id)-prevShown.has(a.rec.id))||a.c[1]-b.c[1]||a.c[0]-b.c[0]);
  for(const{rec,c}of cands){
    // terminals: name + line dots if there's room, otherwise just the name
    // terminals try, in order: name + line dots, name only, short name; first without crossing track, then (last resort) allowing it
    const combos=rec.tier===0?[0,1].flatMap(ps=>(SHORT[rec.id]?[0,1,2]:[0,1]).map(v=>[ps,v])):[[0,0]];
    for(const[pass,v]of combos){
    const m=textBox(rec,v),w=m.w*FS+2,h=m.h*FS*0.92;
    const nx=rec.n[0]*rc-rec.n[1]*rs,ny=rec.n[0]*rs+rec.n[1]*rc,hh=turned?[Math.max(...rec.half),Math.max(...rec.half)]:rec.half;
    const ext=v=>Math.abs(v[0])*hh[0]*sx+Math.abs(v[1])*hh[1]*sy; // marker half-size along v
    const D=.7071,diag=[[D,-D],[D,D],[-D,-D],[-D,D]].sort((a,b)=>(b[0]*nx+b[1]*ny)-(a[0]*nx+a[1]*ny));
    const dirs=rec.tier===0?[[nx,ny],[1,0],[0,1],[-1,0],[0,-1],...diag]:[[nx,ny],[-nx,-ny],...diag];
    let best=null;
    outer:for(const extra of[0,7])for(const d of dirs)for(const sl of rec.tier===0?[0,6,-6,12,-12]:[0]){
      const horiz=Math.abs(d[0])>0.3&&Math.abs(d[1])<=0.3,vert=Math.abs(d[1])>0.3&&Math.abs(d[0])<=0.3;
      if(sl!==0&&!horiz&&!vert)continue;                  // terminals may slide a few px along their side to dodge a neighbour
      const g=ext(d)+4+extra;
      let x0,y0;
      if(d[0]>0.3)x0=c[0]+d[0]*g;else if(d[0]<-0.3)x0=c[0]+d[0]*g-w;else x0=c[0]-w/2;
      if(d[1]<-0.3)y0=c[1]+d[1]*g-h;else if(d[1]>0.3)y0=c[1]+d[1]*g;else y0=c[1]-h/2;
      if(horiz)y0+=sl;else if(vert)x0+=sl;
      const box={x0,y0,x1:x0+w,y1:y0+h};
      if(box.x0<2||box.x1>W-2||box.y1>H-2)continue;
      const pb={x0:box.x0-PAD,y0:box.y0-PAD+1,x1:box.x1+PAD,y1:box.y1+PAD-1};
      if(hit(pb,placed)||hit(box,marks)||hit(box,UI))continue;
      // a label must read as belonging to its own station:
      // (1) measured from where the label attaches, its own station is the nearest one
      const ap=[Math.max(box.x0,Math.min(box.x1,c[0])),Math.max(box.y0,Math.min(box.y1,c[1]))];
      const dOwn=Math.hypot(ap[0]-c[0],ap[1]-c[1]);let amb=false;
      for(const m of marks){if(m.id===rec.id)continue;if(Math.abs(m.c[0]-c[0])>w+60||Math.abs(m.c[1]-c[1])>70)continue;
        if(Math.hypot(ap[0]-m.c[0],ap[1]-m.c[1])<dOwn+1){amb=true;break}}
      // (1b) terminals: its own box must be clearly the nearest marker to the name (no reading "Union" as Ogilvie's)
      if(!amb&&rec.tier===0){const own=marks.find(m=>m.id===rec.id);
        const dm=(m)=>Math.hypot(Math.max(box.x0-m.x1,m.x0-box.x1,0),Math.max(box.y0-m.y1,m.y0-box.y1,0));
        if(own){const dO=dm(own);for(const m of marks){if(m.id===rec.id)continue;if(Math.abs(m.c[0]-c[0])>w+60||Math.abs(m.c[1]-c[1])>80)continue;
          if(dm(m)<=dO+2){amb=true;break}}}}
      // (2) it doesn't hug the track of a line that doesn't serve this station
      if(!amb&&pass===0)for(const sg of segsNear(box,8)){if(rec.lines.has(sg[2]))continue;if(dBoxSeg(box,sg[0],sg[1])<(rec.tier===0?3:7)){amb=true;break}}
      if(amb)continue;
      const tb={x0:box.x0-trackHalf+1,y0:box.y0-trackHalf+1,x1:box.x1+trackHalf-1,y1:box.y1+trackHalf-1};
      let bad=false;if(pass===0)for(const s of segsNear(tb,1))if(boxHitsSeg(tb,s[0],s[1])){bad=true;break}
      if(bad)continue;
      best={box,pb};break outer;
    }
        if(!best)continue;       // no clean spot at this zoom: leave it out rather than overlap anything
    placed.push(best.pb);
    out.push({rec,v,dx:best.box.x0+1-c[0],dy:(best.box.y0+best.box.y1)/2-c[1]});break;
    }
  }
  return out}
function labelScale(){return Math.max(1,Math.min(1.28,1+0.11*Math.log2(Math.max(1,FIT_W/vb.w))))}
function renderLabels(){
  const list=layoutLabels(),now=new Set(),fs=labelScale();
  for(const d of list){now.add(d.rec.id);let L=labelEls.get(d.rec.id);
    if(!L){const t=el("text",{class:"lbl t"+d.rec.tier},lsvg);L={t,v:-1};labelEls.set(d.rec.id,L)}
    if(L.v!==d.v){L.v=d.v;L.t.textContent="";fillLabel(L.t,d.rec,d.v)}
    L.dx=d.dx;L.dy=d.dy;L.rec=d.rec;L.t.style.display="";
L.t.setAttribute("font-size",(LFS(d.rec.tier)*fs).toFixed(2));}
  for(const[id,L]of labelEls)if(!now.has(id))L.t.style.display="none";
  prevShown=now;labelVB={...vb};positionLabels();
  const lb=[];for(const id of prevShown)lb.push(labelEls.get(id).t.getBoundingClientRect());
  for(const q of STATE_LBL){q.t.style.visibility="";const r=q.t.getBoundingClientRect();   // town names: never on a station name or each other
    const hide=lb.some(b=>b.left<r.right+6&&b.right+6>r.left&&b.top<r.bottom&&b.bottom>r.top);q.t.style.visibility=hide?"hidden":"";if(!hide)lb.push(r)}}
function positionLabels(){
  const sx=cw()/vb.w,sy=ch()/vb.h;
  for(const id of prevShown){const L=labelEls.get(id);
    const q=rotPt(L.rec.xy);
    L.t.setAttribute("x",((q[0]-vb.x)*sx+L.dx).toFixed(1));
    L.t.setAttribute("y",((q[1]-vb.y)*sy+L.dy).toFixed(1));}}
