
/* =====================================================================
   GEOMETRY
   ===================================================================== */
const GP=NET.proj;
function geo(lat,lon){return[(lon-GP.lon0)*111.32*GP.cos*GP.k,(GP.lat0-lat)*110.54*GP.k]}
const MAX_MATCH_D2=36*36;                                         // ~1.2 km: a fix further than that from its own line isn't placed
function cum(p){const c=[0];for(let i=1;i<p.length;i++)c.push(c[i-1]+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));return c}
function along(p,c,d){const tot=c[c.length-1];d=Math.max(0,Math.min(tot,d));
  let i=1;while(i<c.length-1&&c[i]<d)i++;const seg=c[i]-c[i-1]||1,t=(d-c[i-1])/seg;
  return[p[i-1][0]+(p[i][0]-p[i-1][0])*t,p[i-1][1]+(p[i][1]-p[i-1][1])*t]}
function segAt(c,d){for(let i=1;i<c.length;i++)if(d<c[i]-1e-6)return i-1;return c.length-2}
/* Shared track: lines that share track are drawn side by side at a fixed spacing on screen, worked out again
   whenever the zoom changes (far out they merge into one line, close in they fan out into stripes).
   Trains, trails and stations all use the same offset line, so a train always sits on its own colour.
   off keeps one point per point of anc, so a distance along anc maps straight onto it. */
function offsetLine(anc,slot,g,out){
  const n=anc.length,nrm=[];let px=0,py=0;
  for(let i=0;i<n-1;i++){const dx=anc[i+1][0]-anc[i][0],dy=anc[i+1][1]-anc[i][1],l=Math.hypot(dx,dy);
    if(l>1e-9){px=-dy/l;py=dx/l}nrm.push([px,py])}
  const first=nrm.find(v=>v[0]||v[1])||[0,0];for(let i=0;i<nrm.length&&!(nrm[i][0]||nrm[i][1]);i++)nrm[i]=first;
  for(let i=0;i<n;i++){const a=i>0?i-1:0,b=i<n-1?i:n-2,o1=slot[a]*g,o2=slot[b]*g,n1=nrm[a],n2=nrm[b];
    let vx=(n1[0]*o1+n2[0]*o2)/2,vy=(n1[1]*o1+n2[1]*o2)/2;
    const det=n1[0]*n2[1]-n1[1]*n2[0];
    if(a!==b&&Math.abs(det)>1e-4){const mx=(o1*n2[1]-n1[1]*o2)/det,my=(n1[0]*o2-o1*n2[0])/det;   // where the two offset sides meet
      if(Math.hypot(mx,my)<=2.5*Math.max(Math.abs(o1),Math.abs(o2))+1e-9){vx=mx;vy=my}}
    out[i][0]=anc[i][0]+vx;out[i][1]=anc[i][1]+vy}}
function alongOff(r,d){const c=r.ac,tot=c[c.length-1];d=Math.max(0,Math.min(tot,d));
  let i=1;while(i<c.length-1&&c[i]<d)i++;const seg=c[i]-c[i-1]||1,t=(d-c[i-1])/seg,p=r.off;
  return[p[i-1][0]+(p[i][0]-p[i-1][0])*t,p[i-1][1]+(p[i][1]-p[i-1][1])*t]}
function angAt(r,g){const a=r.anc;for(let j=g;j<a.length-1;j++){const dx=a[j+1][0]-a[j][0],dy=a[j+1][1]-a[j][1];if(dx||dy)return Math.atan2(dy,dx)}
  for(let j=g-1;j>=0;j--){const dx=a[j+1][0]-a[j][0],dy=a[j+1][1]-a[j][1];if(dx||dy)return Math.atan2(dy,dx)}return 0}
const GEO_ISSUES=[];
for(const key of ORDER){const L=LINES[key];
  L.routes=L.routes.map(r=>{const anc=r.anc,ac=cum(anc),ds=r.ds;
    for(let i=1;i<ds.length;i++)if(ds[i]<ds[i-1])GEO_ISSUES.push(`${L.code}: ${r.st[i]} before ${r.st[i-1]}`);
    return{st:r.st,ids:r.st,anc,ac,ds,slot:r.slot,off:anc.map(p=>[p[0],p[1]]),segs:ds.map(d=>segAt(ac,d)),
      geoPts:r.st.map(id=>geo(STOPS[id].lat,STOPS[id].lon)),branch:r.branch||""}})}
// how many leading stations two routes of the same line share (index of the last shared one)
function sharedPrefix(L,a,b){if(a===b)return Infinity;const A=L.routes[a].ids,B=L.routes[b].ids;let i=0;
  while(i<A.length&&i<B.length&&A[i]===B[i])i++;return i-1}

/* ---- station records (one per real station, shared across lines) ---- */
const STN=new Map();
for(const key of ORDER){const L=LINES[key];
  L.routes.forEach(r=>{const last=r.st.length-1;
    r.st.forEach((id,i)=>{
      let rec=STN.get(id);
      if(!rec){const nm=STOPS[id].name;rec={id,label:shortName(nm),full:STOPS[id].full||nm,sys:STOPS[id].sys||"cta",inst:[],lines:new Set(),terminus:false,rank:99,ada:!!STOPS[id].ada};STN.set(id,rec)}
      if(!rec.inst.some(q=>q.key===key&&q.r===r&&Math.abs(q.d-r.ds[i])<.5))rec.inst.push({key,r,d:r.ds[i],xy:[0,0]});
      rec.lines.add(key);
      if(i===0||(i===last&&r.st.indexOf(id)===last))rec.terminus=true;   // a loop route's last stop is where it started round the Loop
    })})}
const TERMINALS={};                                                         // MetraBot's big downtown-terminal style: the L has none
for(const rec of STN.values()){rec.multi=rec.inst.length>1;rec.tier=(rec.terminus||rec.lines.size>1)?1:2;
  rec.box={x0:0,y0:0,x1:0,y1:0};rec.xy=[0,0];rec.n=[1,0];rec.half=[1,1]}
// spatially even priority: midpoints between already-important stations come first
for(const key of ORDER)for(const r of LINES[key].routes){
  const recs=r.ids.map(id=>STN.get(id));
  const keys=[];recs.forEach((q,i)=>{if(q.tier<=1||i===0||i===recs.length-1)keys.push(i)});
  const walk=(a,b,depth)=>{if(b-a<2)return;const m=Math.round((a+b)/2);recs[m].rank=Math.min(recs[m].rank,depth);walk(a,m,depth+1);walk(m,b,depth+1)};
  keys.forEach(i=>recs[i].rank=0);for(let k=1;k<keys.length;k++)walk(keys[k-1],keys[k],1);
}
const STATIONS=[...STN.values()];
