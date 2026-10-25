
/* =====================================================================
   TRAINS — real reported positions decide WHERE (CTA's come from its signal system, not GPS);
   interpolation only decides HOW the marker gets there. It eases from where it was drawn to the newest
   real fix over the real gap between fixes and stops there. It never
   runs ahead of the data. Direction comes only from two real fixes.
   ===================================================================== */
const POLL=30000,STALE_AFTER=150000,DROP_AFTER=240000,FETCH_TIMEOUT=15000;
let trains=[],live=new Map(),clockOffset=0,lastOkAt=0,lastFeedAt=0,everLoaded=false,fails=0,inflight=false,nextPollAt=0,pollTimer=0,lastError="";
const serverNow=()=>Date.now()-clockOffset;
// distance along a route's track -> station index (2.5 = halfway between its 3rd and 4th stations)
function sAtD(r,d){const ds=r.ds,n=ds.length;if(d<=ds[0])return 0;if(d>=ds[n-1])return n-1;
  let i=1;while(i<n-1&&ds[i]<d)i++;return(i-1)+(d-ds[i-1])/((ds[i]-ds[i-1])||1)}
/* Where a reported position sits on its line: on the real track. Where the same spot is on the route more
   than once (the track into the Loop, a terminal loop), CTA's next station picks the pass: the one whose next
   stop it is. Without one: the branch and place we already know. */
function locate(L,lat,lon,prefRi,nextId,prevS){
  const g=geo(lat,lon);let best=null;
  L.routes.forEach((r,ri)=>{const A=r.anc,c=r.ac,pr=[];let mn=Infinity;
    for(let i=1;i<A.length;i++){const a=A[i-1],b=A[i],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
      const t=l2?Math.max(0,Math.min(1,((g[0]-a[0])*dx+(g[1]-a[1])*dy)/l2)):0;
      const d2=(a[0]+dx*t-g[0])**2+(a[1]+dy*t-g[1])**2;pr.push([d2,c[i-1]+t*(c[i]-c[i-1])]);if(d2<mn)mn=d2}
    const lim=(Math.sqrt(mn)+.6)**2,occ=[];                          // within ~20 m of the closest: the same physical spot
    if(nextId)r.ids.forEach((id,k)=>{if(id===nextId)occ.push(r.ds[k])});
    for(const[d2,d]of pr){if(d2>lim)continue;const s=sAtD(r,d);
      let score=Math.sqrt(d2)*3+(ri===prefRi?0:1.5);
      if(occ.length)score+=Math.min(...occ.map(x=>Math.abs(x-d)));
      else score+=1e3+(prevS!=null&&ri===prefRi?Math.abs(s-prevS)*5:0);
      if(!best||score<best.score)best={score,d:d2,ri,s}}});
  if(!best||best.d>MAX_MATCH_D2)return null;
  return best}
const DWELL=20000,VAVG=0.5,DWELL_MIN=3000;   // ms at a stop; top average speed between stops (map units/s, ~15 m/s); shortest stop worth showing
const easeIn=u=>u*u*(2-u),easeOut=u=>1-(1-u)*(1-u)*(1+u),easeBoth=u=>u*u*(3-2*u);
function trackD(r,s){const n=r.ds.length,c=Math.max(0,Math.min(n-1,s)),i=Math.min(n-2,Math.floor(c));return r.ds[i]+(r.ds[i+1]-r.ds[i])*(c-i)}
function glidePlan(t){
  const key=t.segFrom+","+t.segTo+","+t.segT0+","+t.segDur+","+t.ri;if(t.planKey===key)return t.plan;t.planKey=key;
  const a=t.segFrom,b=t.segTo,r=t.L.routes[t.ri],dir=b>a?1:-1,isStn=s=>Math.abs(s-Math.round(s))<.02;
  let stops=[];
  if(Math.abs(b-a)>1e-3)for(let k=dir>0?Math.floor(a+.02)+1:Math.ceil(a-.02)-1;dir>0?k<b-.02:k>b+.02;k+=dir)stops.push(k);   // stations strictly between
  const dist=Math.abs(trackD(r,b)-trackD(r,a)),spare=Math.max(0,t.segDur-dist/VAVG*1000);
  let end=isStn(b)&&Math.abs(b-a)>.02;                                  // CTA puts it at a station: it gets there, then waits
  if(t.L.sys==="metra"){stops=[];end=false}                              // Metra sends GPS, and express trains skip stops: no made-up stops
  const nS=stops.length+(end?1:0);let dw=nS?Math.min(DWELL,spare/nS):0;
  if(dw<DWELL_MIN){dw=0;stops=[];end=false}                             // no time to stop: it flows through
  const pts=[a,...stops,b],moveT=t.segDur-dw*(stops.length+(end?1:0)),legs=[];let tt=0;
  for(let i=1;i<pts.length;i++){const p0=pts[i-1],p1=pts[i],len=Math.abs(trackD(r,p1)-trackD(r,p0));
    const st0=i>1||isStn(p0),st1=i<pts.length-1||isStn(p1),dur=dist>0?moveT*len/dist:moveT/(pts.length-1);
    legs.push({s0:p0,s1:p1,t0:tt,dur,f:st0&&st1?easeBoth:st0?easeIn:st1?easeOut:u=>u});tt+=dur;
    if(i<pts.length-1||end){legs.push({s0:p1,s1:p1,t0:tt,dur:dw,stop:true});tt+=dw}}
  return t.plan=legs}
function curS(t,now){const e=now-t.segT0;t.dwell=false;
  if(e>=t.segDur||Math.abs(t.segTo-t.segFrom)<1e-4)return t.segTo;if(e<=0)return t.segFrom;
  for(const l of glidePlan(t)){if(e<l.t0+l.dur||l===t.plan[t.plan.length-1]){if(l.stop){t.dwell=true;return l.s0}
      const u=l.dur>0?Math.max(0,Math.min(1,(e-l.t0)/l.dur)):1;return l.s0+(l.s1-l.s0)*l.f(u)}}
  return t.segTo}
function poseAt(r,s){const n=r.ds.length;s=Math.max(0,Math.min(n-1,s));
  const i=Math.min(n-2,Math.floor(s)),t=s-i,d=r.ds[i]+(r.ds[i+1]-r.ds[i])*t,p=alongOff(r,d);   // on its own colour in a bundle
  return{x:p[0],y:p[1],d,ang:angAt(r,segAt(r.ac,d))}}
// polyline along the track between two distances (for trails)
function trackPath(r,d0,d1){const lo=Math.max(0,Math.min(d0,d1)),hi=Math.min(r.ac[r.ac.length-1],Math.max(d0,d1));
  const pts=[alongOff(r,lo)];for(let i=1;i<r.ac.length-1;i++)if(r.ac[i]>lo&&r.ac[i]<hi)pts.push(r.off[i]);
  pts.push(alongOff(r,hi));return pts}
function makeTrainVisual(L){
  const g=el("g",{class:"train",tabindex:"0",role:"button"},trainG);
  el("title",{},g);
  el("circle",{class:"glow",r:10,fill:L.color},g);
  el("circle",{class:"halo",r:16},g);
  el("circle",{class:"ring",r:7,stroke:L.color},g);
  const inner=el("g",{},g);
  const arrow=el("path",{class:"body arrow",d:"M12.5,0 L-7,8 L-3.2,0 L-7,-8 Z",fill:L.color},inner);

  // A CTA 7000-series car, seen from above, facing +x: brushed stainless with ribbed sides, a blue cab end with a
  // black windshield and pink-ringed headlights, and AC units on the roof. Real cars don't carry their line's colour;
  // here a thin stripe down each side does, so the lines stay easy to tell apart.
  if(!window.__cg){window.__cg=1;
    const steel=el("linearGradient",{id:"cta-steel",x1:0,y1:0,x2:0,y2:1},defs);
    for(const[o,c]of[[0,"#8E99A3"],[.18,"#D9DFE4"],[.5,"#F2F5F7"],[.82,"#C9D0D6"],[1,"#7F8A94"]])el("stop",{offset:o,"stop-color":c},steel);
    const blue=el("linearGradient",{id:"cta-blue",x1:0,y1:0,x2:0,y2:1},defs);
    for(const[o,c]of[[0,"#0B4FA8"],[.5,"#2F86E6"],[1,"#0A4596"]])el("stop",{offset:o,"stop-color":c},blue)}
  const carFlip=el("g",{class:"car"},inner),cz=el("g",{},carFlip);
  el("rect",{x:-13.6,y:-3.6,width:29,height:9.2,rx:3,fill:"#000",opacity:.22},cz);                                     // shadow underneath
  const cb=el("g",{class:"cb"},cz);
  el("path",{d:"M15.5,0 L27,-4.2 L27,4.2 Z",fill:"#FFE7A3",opacity:.16},cb);                                         // headlight beam
  el("path",{d:"M-13,-4.6 L12.4,-4.6 Q15.4,-4.6 15.6,-2.2 L15.6,2.2 Q15.4,4.6 12.4,4.6 L-13,4.6 Q-14.6,4.6 -14.6,3 L-14.6,-3 Q-14.6,-4.6 -13,-4.6 Z",
    fill:"url(#cta-steel)",stroke:"var(--bg)","stroke-width":1.1,"stroke-linejoin":"round"},cb);                        // stainless body, squared off like the 7000s
  for(const y of[-4.3,3.2])el("rect",{x:-13.2,y,width:23.4,height:1.1,rx:.55,fill:L.color},cb);                          // the line's colour, down each side
  el("path",{d:"M-12.6,-2.9H9.4M-12.6,2.9H9.4",stroke:"#9AA5AF","stroke-width":.35,fill:"none"},cb);                     // ribbed stainless edges
  for(const x of[-10.4,-1.6])el("rect",{x,y:-1.9,width:5.4,height:3.8,rx:.8,fill:"#6E7A85"},cb);                        // roof AC units
  el("path",{d:"M-9.6,-.9h3.8M-9.6,.9h3.8M-.8,-.9h3.8M-.8,.9h3.8",stroke:"#9AA5AF","stroke-width":.35},cb);
  el("path",{d:"M10.2,-4.6 L12.4,-4.6 Q15.4,-4.6 15.6,-2.2 L15.6,2.2 Q15.4,4.6 12.4,4.6 L10.2,4.6 Z",fill:"url(#cta-blue)"},cb);   // blue cab end
  el("path",{d:"M13.2,-2.8 Q14.6,-2.4 14.7,0 Q14.6,2.4 13.2,2.8",stroke:"#0B1118","stroke-width":1.4,fill:"none","stroke-linecap":"round"},cb);  // windshield
  for(const y of[-3.4,3.4])el("circle",{cx:14.8,cy:y,r:.75,fill:"#FF5A6E",stroke:"#FFC2CC","stroke-width":.35},cb);    // headlights
  const dot=el("circle",{class:"body",r:6.2,fill:L.color},g);
  el("circle",{class:"hit",r:18},g);
  // trail: a soft band in the line's colour with a bright core, both fading out behind the train
  const tg=el("g",{class:"trail"},trailG),uid="tr"+(++trailUid);
  const mkGrad=(id,col,a)=>{const gr=el("linearGradient",{id,gradientUnits:"userSpaceOnUse"},tg);
    el("stop",{offset:0,style:`stop-color:${col};stop-opacity:0`},gr);el("stop",{offset:1,style:`stop-color:${col};stop-opacity:${a}`},gr);return gr};
  const gh=mkGrad(uid+"h",L.color,.8),gc=mkGrad(uid+"c","#FFFFFF",.95);
  const band=el("path",{class:"tband",stroke:`url(#${uid}h)`},tg),core=el("path",{class:"tcore",stroke:`url(#${uid}c)`},tg);
  return{g,inner,arrow,dot,carFlip,cb,phase:Math.random()*6.3,trail:{g:tg,band,core,grads:[gh,gc]},hist:[],histRi:-1}}
let trailUid=0;
const TRAIL_MS=90000,TRAIL_MAX_PX=150;
function drawTrail(t,r,p,now,k){
  // the trail is where the marker has actually been drawn over the last ~24 s, capped in length;
  // it shrinks away while a train sits still and never extends ahead of the train
  if(t.histRi!==t.ri){t.hist=[];t.histRi=t.ri}
  const h=t.hist;if(!h.length||now-h[h.length-1][0]>200)h.push([now,p.d]);
  while(h.length>1&&now-h[0][0]>TRAIL_MS)h.shift();
  const T=t.trail;
  let d0=h[0][1],diff=p.d-d0;const cap=TRAIL_MAX_PX*k;
  if(Math.abs(diff)>cap){d0=p.d-Math.sign(diff)*cap;diff=p.d-d0}
  if(Math.abs(diff)<3*k||t.stale){if(T.g.style.display!=="none")T.g.style.display="none";T.key="";return}
  if(T.g.style.display)T.g.style.display="";
  const tk=d0.toFixed(2)+"|"+p.d.toFixed(2)+"|"+t.ri;if(tk===T.key)return;T.key=tk;      // nothing moved: skip the redraw
  const pts=trackPath(r,d0,p.d),dStr="M"+pts.map(q=>q[0].toFixed(2)+","+q[1].toFixed(2)).join("L");
  T.band.setAttribute("d",dStr);T.core.setAttribute("d",dStr);
  const tail=alongOff(r,d0);
  for(const gr of T.grads){gr.setAttribute("x1",tail[0].toFixed(2));gr.setAttribute("y1",tail[1].toFixed(2));
    gr.setAttribute("x2",p.x.toFixed(2));gr.setAttribute("y2",p.y.toFixed(2))}
}
function applyTrainClass(t){const d=!!focusKey&&t.L.key!==focusKey;t.g.classList.toggle("dim",d);t.trail.g.classList.toggle("dim",d)}
function pingTrain(t){t.g.classList.remove("ping");clearTimeout(t.pingTO);
  requestAnimationFrame(()=>{if(!t.gone){t.g.classList.add("ping");t.pingTO=setTimeout(()=>t.g.classList.remove("ping"),1450)}})}
function removeTrain(t,fade){
  t.gone=true;clearTimeout(t.pingTO);live.delete(t.id);trains=trains.filter(x=>x!==t);
  if(selected===t)closeCard();
  if(fade){t.g.classList.add("bye");t.trail.g.classList.add("bye");setTimeout(()=>{t.g.remove();t.trail.g.remove()},900)}
  else{t.g.remove();t.trail.g.remove()}}
function trainNo(x){x=String(x??"").trim();return/^\d{1,5}$/.test(x)?x:""}
function runLabel(v){if(v.sim)return{sim:true,no:String(v.run)};return{no:trainNo(v.run)}}
// CTA says which station each train is heading to next. On its route that gives the direction from the very
// first fix (s counts stations along the route): toward a higher index = +1, lower = -1.
function nextDir(r,s,nextId){if(!nextId)return 0;let best=null;
  r.ids.forEach((id,k)=>{if(id===nextId&&(best==null||Math.abs(k-s)<Math.abs(best-s)))best=k});
  if(best==null||Math.abs(best-s)>3)return 0;
  return best>s+.02?1:best<s-.02?-1:0}
/* ---- position integrity ----
   Each train keeps three things apart:
     t.raw  the latest report exactly as it came in (source lat/lon and timestamp; never rewritten)
     t.acc  the last report NITABot trusts: the marker only ever glides between trusted reports
     t.pend a report that disagrees with the trusted one, held back until the next report settles it
   A report is held back when it would mean an impossible trip from the trusted one (further than the train could
   go in the time between them), a hop to another branch with neither report on shared track, or (as before) a
   step backwards. The next report decides: if it agrees with the trusted position the odd one was a blip
   (dropped); if it carries on from the held one, the move was real and is accepted. Time alone never accepts it.
   Thresholds (why these numbers):
     VMAX   fastest a train runs: the L tops out near 55-70 mph (31 m/s); Metra at 79 mph (35 m/s, +margin)
     SLACK  CTA positions come from its signal system and are placed by CTA's own predictions, so they can sit a
            block or two ahead (a few hundred metres; the back-and-forth measured in Oct 2026 was 1-3% of moves).
            Metra's is real GPS, refreshed about every 30 s.
   A train whose position can't be confirmed goes grey after 2.5 minutes (STALE_AFTER, from the trusted report's
   own time) and is hidden after 5 (HIDE_UNRESOLVED); it comes back the moment a report is confirmed. */
const VMAX={cta:31,metra:37},SLACK={cta:700,metra:450},HIDE_UNRESOLVED=300000,ONTRACK2=(60/33.3)**2;
const POSDIAG={accepted:0,held:0,blips:0,confirmed:0,replaced:0,old:0,dup:0,offtrack:0,events:[]};
function pdLog(t,what,o){POSDIAG.events.push({at:Date.now(),id:t?t.id:"",what,lat:o&&o.lat,lon:o&&o.lon,fix:o&&o.fix});
  if(POSDIAG.events.length>200)POSDIAG.events.shift();if(t){(t.log||(t.log=[])).push(what);if(t.log.length>8)t.log.shift()}}
function mDist(a,b){const dy=(a.lat-b.lat)*110540,dx=(a.lon-b.lon)*111320*Math.cos(a.lat*Math.PI/180);return Math.hypot(dx,dy)}
// could the train get from report a to report b in the time between them?
function reachable(L,a,b){const dt=Math.max(0,(b.fix-a.fix)/1000);return mDist(a,b)<=VMAX[L.sys]*dt+SLACK[L.sys]}
function nearRoute(r,lat,lon){const g=geo(lat,lon),A=r.anc;let mn=Infinity;
  for(let i=1;i<A.length;i++){const a=A[i-1],b=A[i],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((g[0]-a[0])*dx+(g[1]-a[1])*dy)/l2)):0;
    mn=Math.min(mn,(a[0]+dx*t-g[0])**2+(a[1]+dy*t-g[1])**2)}return mn<ONTRACK2}
// a change of branch is believable when either report sits on track both branches use
function branchOk(L,a,b){if(a.ri===b.ri)return true;return nearRoute(L.routes[b.ri],a.lat,a.lon)||nearRoute(L.routes[a.ri],b.lat,b.lon)}
function suspicious(L,a,b){if(!reachable(L,a,b))return"jump";if(!branchOk(L,a,b))return"branch";return""}
// data.lines: line api name -> reports shaped like CTA's (Metra's are turned into this shape by systems/metra/feed.js)
function ingest(data,keys=CTA_ORDER){
  const ml=data.lines||{};const seenAll=new Set();let bad=0;
  for(const key of keys){const L=LINES[key],vs=Array.isArray(ml[L.api])?ml[L.api]:[];
    for(const v of vs){
      if(!v||(v.uid==null&&(v.run==null||v.run===""))){bad++;continue}
      const id=key+":"+(v.uid??v.run);if(seenAll.has(id))continue;         // CTA: run numbers are unique within a line; Metra: vehicle id
      const lat=+v.lat,lon=+v.lon;
      if(!isFinite(lat)||!isFinite(lon)||lat===0||lon===0){bad++;continue}
      let fix=+v.predicted_at;fix=isFinite(fix)&&fix>0?(fix<1e12?fix*1000:fix):serverNow();
      let t=live.get(id);
      const loc=locate(L,lat,lon,t?t.ri:null,v.next_sta_id,t?t.lastObsS:null);
      if(!loc){bad++;POSDIAG.offtrack++;if(t){t.lastSeen=Date.now();pdLog(t,"off track",{lat,lon,fix})}continue}   // fix isn't on this line (yard, bad data)
      seenAll.add(id);
      const obs={lat,lon,fix,ri:loc.ri,s:loc.s,next:v.next_sta_id||""};
      const hint=nextDir(L.routes[loc.ri],loc.s,v.next_sta_id);
      const now=performance.now();
      if(!t){
        const vis=makeTrainVisual(L),p=poseAt(L.routes[loc.ri],loc.s);
        if(!reduceMotion()){for(const q of[vis.g,vis.trail.g])q.classList.add("born","grow");
          requestAnimationFrame(()=>requestAnimationFrame(()=>{for(const q of[vis.g,vis.trail.g])q.classList.remove("born");
            setTimeout(()=>{for(const q of[vis.g,vis.trail.g])q.classList.remove("grow")},700)}))}
        t={id,L,ri:loc.ri,segFrom:loc.s,segTo:loc.s,segT0:now,segDur:1,lastObsS:loc.s,dirSign:hint,
           updated:fix,lastSeen:Date.now(),stale:false,shown:[p.x,p.y],ang:0,a11y:"",raw:obs,acc:obs,pend:null,held:false,...vis};
        t.run=runLabel(v);t.cta=v;POSDIAG.accepted++;
        bindTrain(t);applyTrainClass(t);trains.push(t);live.set(id,t);
        continue}
      t.run=runLabel(v);t.lastSeen=Date.now();t.raw=obs;
      // older than what we trust, or the same report again: nothing new
      if(fix<t.acc.fix){POSDIAG.old++;pdLog(t,"older than trusted",obs);continue}
      if(fix===t.acc.fix){if(mDist(obs,t.acc)>1){POSDIAG.dup++;pdLog(t,"same time, other place",obs)}t.cta=v;continue}
      if(t.pend&&fix<=t.pend.fix)continue;                                  // a repeat of the report being checked
      let why=suspicious(L,t.acc,obs),corroborated=false;
      if(why){
        if(t.pend&&!suspicious(L,t.pend,obs)){corroborated=true;POSDIAG.confirmed++;pdLog(t,"confirmed "+t.pend.why,obs)}   // it carries on from the held report: real
        else{if(t.pend){POSDIAG.replaced++;pdLog(t,"held report contradicted",obs)}else{POSDIAG.held++;pdLog(t,"held: "+why,obs)}
          t.pend={...obs,why};t.held=true;continue}                        // hold the marker where it was trusted
      }else if(t.pend){POSDIAG.blips++;pdLog(t,"dropped a blip ("+t.pend.why+")",t.pend)}
      t.pend=null;t.held=false;t.cta=v;
      const moved=Math.abs(loc.s-t.lastObsS)>0.02||loc.ri!==t.ri;
      // CTA now and then puts a train a few hundred metres back, then forward again (1-3% of moves, measured
      // Oct 2026; often after placing it at its next station early). A train goes backwards on the map only if CTA
      // keeps saying so for 3 reports in a row (about a minute and a half), or turns it around.
      const exp=hint||t.dirSign;
      if(!corroborated&&moved&&loc.ri===t.ri&&exp&&(loc.s-t.lastObsS)*exp<-0.08){t.backN=(t.backN||0)+1;if(t.backN<3){pdLog(t,"held: step back",obs);continue}}
      t.backN=0;
      const gap=Math.max(5000,Math.min(75000,fix-t.acc.fix));
      const cs=curS(t,now);
      if(corroborated&&!reachable(L,t.acc,obs)){
        // a confirmed jump: put it there, without drawing a trip along track nobody saw it take
        t.ri=loc.ri;t.segFrom=loc.s;t.hist=[];t.dirSign=hint;
      }else if(loc.ri===t.ri){
        const dl=loc.s-t.lastObsS;if(Math.abs(dl)>0.03)t.dirSign=dl<0?-1:1;
        // a jump of more than a few stations isn't a train moving along the line (e.g. finishing a lap of the
        // Loop and heading back out): place it there, don't draw a path we don't know
        t.segFrom=Math.abs(loc.s-cs)>4?loc.s:cs;
      }else{
        // branch change: positions are comparable only while one of them is on the shared stretch
        const P=sharedPrefix(L,t.ri,loc.ri);
        if(Math.min(t.lastObsS,loc.s)<=P){const dl=loc.s-t.lastObsS;if(Math.abs(dl)>0.03)t.dirSign=dl<0?-1:1}else t.dirSign=0;
        t.segFrom=cs<=P?cs:loc.s;t.ri=loc.ri;
      }
      t.lastObsS=loc.s;t.segTo=loc.s;t.segT0=now;t.segDur=gap;t.updated=fix;t.acc=obs;POSDIAG.accepted++;
      if(moved)pingTrain(t);
      if(hint)t.dirSign=hint;                                               // CTA's own next station settles the direction
    }
  }
  for(const t of[...trains])if(keys.includes(t.L.key)&&!seenAll.has(t.id)&&Date.now()-t.lastSeen>DROP_AFTER)removeTrain(t,true);
  return bad}
// what the map may say about a train's position right now
function posState(t){if(t.held&&serverNow()-t.updated>HIDE_UNRESOLVED)return"hidden";if(t.stale)return t.held?"held-stale":"stale";return t.held?"held":"ok"}
function posDiag(){const by={};for(const t of trains){const k=posState(t);by[k]=(by[k]||0)+1}
  return{...POSDIAG,events:POSDIAG.events.slice(-40),now:by,trains:trains.filter(t=>t.held||t.stale).map(t=>({id:t.id,state:posState(t),
    trusted:t.acc,raw:t.raw,held:t.pend,age_s:Math.round((serverNow()-t.updated)/1000),log:t.log||[]}))}}
async function poll(){
  clearTimeout(pollTimer);
  if(inflight)return;
  if(document.hidden&&mode==="live"&&!bgVoice()){nextPollAt=Date.now()+POLL;pollTimer=setTimeout(poll,POLL);return}   // tab in the background: don't ask (it catches up the moment you look), unless check-ins are talking
  inflight=true;refreshStatus();const pollT0=performance.now();
  const ac=new AbortController(),to=setTimeout(()=>ac.abort(),FETCH_TIMEOUT);
  try{
    const resp=await fetch(WORKER_URL+"/cta/positions",{cache:"no-store",signal:ac.signal});
    let data=null;try{data=await resp.json()}catch(_){}
    if(!data||typeof data!=="object")throw new Error(resp.ok?"The feed relay sent something unreadable":"The feed relay answered with an error ("+resp.status+")");
    if(data.error)throw new Error("CTA's feed returned an error: "+data.error);
    if(!resp.ok)throw new Error("The feed relay answered with an error ("+resp.status+")");
    let fa=+data.fetched_at;if(isFinite(fa)&&fa>0){if(fa<1e12)fa*=1000;clockOffset=Date.now()-fa;lastFeedAt=fa}else{clockOffset=0;lastFeedAt=Date.now()}
    if(mode==="sim"){liveBack=true}                 // live works again: offer to switch, don't mix it with simulated trains
    else{ingest(data);everLoaded=true}
    sonarPing();
    if(fails&&alertsErr)pollAlerts();                // the relay is back: fetch alerts now instead of in up to 2 minutes
    fails=0;lastOkAt=Date.now();lastError="";
  }catch(e){fails++;lastError=e&&e.name==="AbortError"?"The feed took too long to answer":(e&&e.message)||"Network error"}
  finally{clearTimeout(to);inflight=false;radarLanded(pollT0);const wait=fails?Math.min(POLL,10000*fails):POLL;   // after a miss, try again sooner
    nextPollAt=Date.now()+wait;pollTimer=setTimeout(poll,wait);refreshStatus()}
}
// service alerts come from CTA's Customer Alerts feed (through the Worker), checked every 2 minutes
let alertTimer=0,alertsAt=0;
async function pollAlerts(){clearTimeout(alertTimer);
  if(document.hidden){alertTimer=setTimeout(pollAlerts,120000);return}
  alertsAt=Date.now();
  try{const r=await fetch(WORKER_URL+"/cta/alerts",{cache:"no-store"});let d=null;try{d=await r.json()}catch(_){}
    if(d&&Array.isArray(d.alerts))takeAlerts({alerts:d.alerts});else takeAlerts({alerts_error:(d&&d.error)||"No answer"})}
  catch(e){takeAlerts({alerts_error:(e&&e.message)||"Network error"})}
  alertTimer=setTimeout(pollAlerts,120000)}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&Date.now()-alertsAt>120000)pollAlerts()});
/* ---- simulated mode: only on request, always labelled, never mixed with live data ----
   Fake trains are fed through the same pipeline as real reports (so they move the same way),
   every 8 s, at a sped-up pace so there's something to watch. */
let mode="live",liveBack=false,simTimer=0,simTrains=[];
