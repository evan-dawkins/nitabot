applySat();
/* =====================================================================
   MAIN LOOP
   ===================================================================== */
FIT_W=fitAll().w;vb=fitAll();applyVB();syncZoom();
let lastFrame=performance.now(),labelT=0,cardT=0,statusT=0,lastVB="",lastMarkW=-1;
/* the L fades out as you zoom out: fully faded by the zoom where Elburn and Big Timber Rd (Metra's far west) are both
   on screen from the Chicago view, starting at 70% of that zoom (never closer than the Chicago view itself). Its
   track goes to a faint ghost (context); its trains, stations, links and labels all the way (they stop taking clicks
   once mostly gone). Worked out per screen shape, so a phone and a wide monitor fade at the same place on the map.
   A CTA line picked in the line bar stays. */
const CTA_GHOST=.14;let ctaK=-1,ctaFadeAt=null;
function ctaFadeRange(){const v=fitAll(),cx=v.x+v.w/2,cy=v.y+v.h/2,r=v.h/v.w;let done=FIT_W*1.6;
  const need=STATIONS.filter(q=>q.id==="ELBURN"||q.id==="BIGTIMBER");
  if(need.length)done=Math.max(...need.map(q=>Math.max(Math.abs(q.xy[0]-cx)*2,Math.abs(q.xy[1]-cy)*2/r)))*1.04;   // a little margin: on screen, not on the edge
  return[Math.max(FIT_W*1.05,done*.7),done]}
addEventListener("resize",()=>{ctaFadeAt=null;ctaK=-1});
function ctaFadeK(){if(focusKey&&!isMetra(focusKey))return 0;if(!ctaFadeAt)ctaFadeAt=ctaFadeRange();
  const[a,b]=ctaFadeAt;return Math.max(0,Math.min(1,(vb.w-a)/(b-a)))}
function fadeCTA(){const k=+ctaFadeK().toFixed(3);if(k===ctaK)return;ctaK=k;const e=k*k*(3-2*k);
  const tr=(1-e*(1-CTA_GHOST)).toFixed(3),gone=(1-e).toFixed(3),off=e>.6;
  // fill-/stroke-opacity, inherited by everything inside: a group opacity below 1 would put each group in its own
  // compositor layer (measured: 11 -> 31), the thing that blurred the tracks before
  const set=(g,v)=>{g.setAttribute("fill-opacity",v);g.setAttribute("stroke-opacity",v);g.style.display=+v<.005?"none":""};
  for(const g of[ctaW.track,ctaW.cases])set(g,tr);
  for(const g of[ctaW.stn,ctaW.trail,ctaW.train,xlinkG])set(g,gone);
  for(const g of[ctaW.stn,ctaW.train,xlinkG])g.style.pointerEvents=off?"none":"";
  document.body.classList.toggle("ctafaded",off);labelsDirty=true}
function frame(now){
  const dt=Math.min(.25,(now-lastFrame)/1000);lastFrame=now;
  moodFrame(dt);
  const sNow=serverNow(),k=vb.w/cw();
  // trains shrink when you zoom out (so the whole map isn't buried under them) and reach full size ~3 zoom steps in
  const zf=Math.log2(Math.max(1,FIT_W/vb.w)),tsz=cuteTrains?Math.min(1,.6+.4*zf/3):Math.min(1,.75+.25*zf/3),ks=k*tsz;
  for(const t of trains){
    const r=t.L.routes[t.ri],s=curS(t,now),p=poseAt(r,s);t.shown=[p.x,p.y];
    const stale=sNow-t.updated>STALE_AFTER;
    if(stale!==t.stale){t.stale=stale;t.g.classList.toggle("stale",stale)}
    if(t.held!==t.heldC){t.heldC=t.held;t.g.classList.toggle("held",!!t.held)}       // a report is being checked: the marker waits
    const hide=t.held&&sNow-t.updated>HIDE_UNRESOLVED;                         // can't confirm where it is for 5 min: off the map
    if(hide!==!!t.hidden){t.hidden=hide;t.g.style.display=hide?"none":"";t.trail.g.style.display=hide?"none":"";if(hide&&selected===t)closeCard()}
    if(t.hidden)continue;
    drawTrail(t,r,p,now,k);
    const known=t.dirSign!==0;
    if(t.known!==known){t.known=known;t.arrow.style.display=known?"":"none";t.dot.style.display=known?"none":"";t.g.classList.toggle("known",known)}
    if(cuteTrains){const roll=known&&!stale&&now-t.segT0<t.segDur&&Math.abs(t.segTo-t.segFrom)>.01&&!t.dwell&&!reduceMotion();   // it sways only while it's really moving
      if(roll!==t.roll){t.roll=roll;t.g.classList.toggle("roll",roll);if(!roll&&t.cb)t.cb.removeAttribute("transform")}
      if(roll&&t.cb){const c=`translate(0 ${(.25*Math.sin(now/45+t.phase)).toFixed(2)})`;if(c!==t.cbt){t.cbt=c;t.cb.setAttribute("transform",c)}}}   // an attribute, not a CSS animation (see the ping note in styles.css)
    const tf=`translate(${p.x.toFixed(2)},${p.y.toFixed(2)}) scale(${ks.toFixed(4)})`;if(tf!==t.tf){t.tf=tf;t.g.setAttribute("transform",tf)}
    if(known){const want=(t.dirSign<0?p.ang+Math.PI:p.ang)*180/Math.PI;
      if(t.rot==null||reduceMotion())t.rot=want;else{let d=((want-t.rot)%360+540)%360-180;t.rot+=Math.abs(d)<.3?d:d*(1-Math.exp(-dt/.09))}  // turn at bends over ~0.15 s
      const rs=`rotate(${t.rot.toFixed(1)})`;if(rs!==t.rs){t.rs=rs;t.inner.setAttribute("transform",rs)}
      if(false){const c=0,flip=false;   // (seen from above, so it never needs flipping)   // keep the wheels on the bottom
        if(flip!==t.flip){t.flip=flip;t.carFlip.setAttribute("transform",flip?"scale(1,-1)":"")}}}
    const a=`${t.L.name} train${trainLabel(t)?", "+trainLabel(t).toLowerCase():""}, ${dirText(t)}${t.stale?", position out of date":t.held?", position being checked":""}`;
    if(a!==t.a11y){t.a11y=a;t.g.firstChild.textContent=a}
  }
  radarFrame(now);fadeCTA();                                                 // cheap: returns at once unless the fade changed
  if(following&&!camAnim&&!drag){
    const cx=vb.x+vb.w/2,cy=vb.y+vb.h/2;
    let ox=0,oy=0;if(isNarrow()&&card.classList.contains("on")){if(sideSheet())ox=-(card.offsetWidth+16)/2*(vb.w/cw());else oy=card.offsetHeight/2*(vb.h/ch())}
    const f=reduceMotion()?1:1-Math.pow(.95,dt*60);                 // same feel at 60 Hz, 120 Hz or 144 Hz
    vb.x+=(following.shown[0]+ox-cx)*f;vb.y+=(following.shown[1]+oy-cy)*f;
  }
  if(camAnim)camAnim(now);
  const chasing=chaseFrame(now,dt);
  applyVB();atsFrame();satFrame();
  const key=vb.x.toFixed(2)+","+vb.y.toFixed(2)+","+vb.w.toFixed(2)+","+ROT.a.toFixed(4);
  if(key!==lastVB){lastVB=key;labelsDirty=true;
    document.documentElement.style.setProperty("--tw",twPx().toFixed(2)+"px");
    if(Math.abs(vb.w-lastMarkW)>1e-6){lastMarkW=vb.w;updateMarkers()}
    positionLabels()}
  labelT-=dt;if(labelT<=0&&labelsDirty&&!camAnim){labelT=chasing?.4:.12;labelsDirty=false;renderLabels()}   // during a camera glide labels just ride along; re-placed when it lands
  placeCard();placeStationPop();
  cardT-=dt;if(cardT<=0){cardT=1;if(selected)renderCard();if(spopRec)renderStationPop();renderBoard()}
  statusT-=dt;if(statusT<=0){statusT=1;refreshStatus();tickHeader();tickIdle();tickStrip();tickMood();arrivalsTick()}
  requestAnimationFrame(frame);
}
if(GEO_ISSUES.length)console.warn("Map ordering issues:",GEO_ISSUES);
window.__cta={ciSay,ciFacts,ciLines,mciFacts,mciLines,VOS,liveStats,pollMetra,get mTrips(){return mTrips},get VO(){return VO},setCheckins,get ciOn(){return ciOn},FAV,openStationPop,renderBoard,get introOpen(){return introOpen},get actx(){return actx},get sndOn(){return sndOn},get sndMode(){return sndMode},setSndMode,get RADAR_C(){return RADAR_C},tickMood:()=>{sitAt=0;tickMood()},get moodSit(){return moodSit},liveSituation,get chase(){return chase},startRide:()=>startRide(performance.now()),get ROT(){return ROT},takeAlerts,get alerts(){return alerts},startSim,stopSim,get mode(){return mode},poll,LINES,STN,STATIONS,GEO_ISSUES,layoutLabels,ingest,get trains(){return trains},get vb(){return vb},set vb(v){vb=v},renderLabels,setFocus,selectTrain,fitAll,ARR,arrivalsTick,get FIT_W(){return FIT_W},updateMarkers,closeCard,locate,sAtD,get ctaFade(){return ctaK},glidePlan,curS,posDiag,posState,
  llAt:(key,ri,s,off=0)=>{const r=LINES[key].routes[ri],d=trackD(r,s),p=along(r.anc,r.ac,d),a=angAt(r,segAt(r.ac,d));return ungeo(p[0]-Math.sin(a)*off,p[1]+Math.cos(a)*off)},
  trackD,sharedPrefix,MH,metraHealth,pollAlerts,get spopRec(){return spopRec},get focusKey(){return focusKey},get STALE_AFTER(){return STALE_AFTER},get HIDE_UNRESOLVED(){return HIDE_UNRESOLVED}};
applyStyle();tickHeader();poll();pollAlerts();pollMetra();loadTimetable();setInterval(loadTimetable,6*3600e3);requestAnimationFrame(frame);
})();
