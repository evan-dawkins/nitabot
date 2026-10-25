
/* =====================================================================
   O'HARE AIRPORT TRANSIT SYSTEM (ATS)
   The airport's own people mover (Chicago Department of Aviation, not CTA): Terminals 1, 2, 3, 5 and the
   Multi-Modal Facility. Track and stations are real (OpenStreetMap, via tools/build_ats.py).
   The trains are SIMULATED: ATS publishes no live feed, so they follow its published service pattern
   (every 3-5 minutes, 24/7, about 10 minutes end to end). They are drawn hollow, every card says so, and
   they never count as L trains (not in the ticker, the counts or train of the moment).
   Shown only when you're zoomed in around the airport; clicking O'Hare zooms there.
   ===================================================================== */
const ATS=NET.ats,ATS_RED="#E2231A";
let atsAlpha=0;
function atsFrame(){}function atsTap(){return false}function atsOnStation(){}function atsPopHTML(){return""}
if(ATS){(()=>{
  const SHOW_W=320,FULL_W=220;                                    // fades in between these view widths (map units: ~10 km to ~7 km across)
  const TERM={"Terminal 1":["1","#3C83C5","#fff"],"Terminal 2":["2","#F39A2E","#1B1B1B"],"Terminal 3":["3","#17A08C","#fff"],"Terminal 5":["5","#F5C116","#1B1B1B"]};
  const MORE={"Terminal 1":"Walkway to the Blue Line (O'Hare station)","Terminal 2":"Walkway to the Blue Line (O'Hare station)",
    "Terminal 3":"Walkway to the Blue Line (O'Hare station)","Terminal 5":"International terminal",
    "Multi-Modal Facility":"Metra North Central Service (O'Hare Transfer), Pace buses, rental cars, Economy Parking"};
  const LBL={"Terminal 1":[-1,-1],"Terminal 2":[-1,1],"Terminal 3":[1,1],"Terminal 5":[-1,1],"Multi-Modal Facility":[-1,0]};   // label side, on screen
  const T=ATS.tracks.map((p,i)=>({p,c:cum(p),ds:ATS.ds[i]}));
  const S=ATS.stations.map((s,j)=>({name:s.name,xy:s.xy,j}));
  const n=S.length,last=n-1;
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const t of T)for(const q of t.p){x0=Math.min(x0,q[0]);y0=Math.min(y0,q[1]);x1=Math.max(x1,q[0]);y1=Math.max(y1,q[1])}
  const BOXA={x0:x0-14,y0:y0-6,x1:x1+6,y1:y1+8};          // with room for the station names
  const hubRec=STN.get(ATS.hub);

  /* ---- the service pattern: one round trip, T1 -> MMF on track 0, MMF -> T1 on track 1; trains evenly spaced ---- */
  const DWELL=30,TURN=60,NTR=5;                                    // s at a station, s to turn back at either end, trains in service
  const runT=du=>20+(du/GP.k*1000)/13;                             // s between stations: ~13 m/s average, gentle starts and stops
  const legs=[];let C=0;
  const push=q=>{q.t0=C;C+=q.dur;legs.push(q)};
  push({k:"turn",j:0,from:1,to:0,dur:TURN});
  for(let j=0;j<last;j++){push({k:"run",tr:0,a:j,b:j+1,dur:runT(T[0].ds[j+1]-T[0].ds[j])});if(j+1<last)push({k:"dwell",tr:0,j:j+1,dur:DWELL})}
  push({k:"turn",j:last,from:0,to:1,dur:TURN});
  for(let j=last;j>0;j--){push({k:"run",tr:1,a:j,b:j-1,dur:runT(T[1].ds[j]-T[1].ds[j-1])});if(j-1>0)push({k:"dwell",tr:1,j:j-1,dur:DWELL})}
  const HEAD=C/NTR;                                                 // ~4 min
  // when, in the cycle, a train is at station j heading each way (dir 0 = toward the MMF, 1 = toward Terminal 1)
  const ARR=[[],[]],DEP=[[],[]];                                   // when it gets there, and when it leaves
  for(const q of legs){if(q.k==="dwell"){ARR[q.tr][q.j]=q.t0;DEP[q.tr][q.j]=q.t0+q.dur}
    if(q.k==="turn"){ARR[q.from][q.j]=q.t0;DEP[q.to][q.j]=q.t0+q.dur}}
  const ease=u=>u*u*(3-2*u);
  function poseAtT(u){u=((u%C)+C)%C;let q=legs[0];for(const l of legs)if(u>=l.t0)q=l;const f=(u-q.t0)/q.dur;
    if(q.k==="run"){const t=T[q.tr],d=t.ds[q.a]+(t.ds[q.b]-t.ds[q.a])*ease(f),p=along(t.p,t.c,d),g=segAt(t.c,d),A=t.p[g],B=t.p[g+1];
      let ang=Math.atan2(B[1]-A[1],B[0]-A[0]);if(q.b<q.a)ang+=Math.PI;
      return{x:p[0],y:p[1],ang,dir:q.tr,at:-1,next:q.b,leg:q,f}}
    if(q.k==="dwell"){const t=T[q.tr],p=along(t.p,t.c,t.ds[q.j]),g=segAt(t.c,t.ds[q.j]),A=t.p[g],B=t.p[g+1];
      let ang=Math.atan2(B[1]-A[1],B[0]-A[0]);if(q.tr===1)ang+=Math.PI;
      return{x:p[0],y:p[1],ang,dir:q.tr,at:q.j,next:q.tr?q.j-1:q.j+1,leg:q,f}}
    // turning back at an end: crosses over to the other track in the middle of its stop
    const a=T[q.from],b=T[q.to],pa=along(a.p,a.c,a.ds[q.j]),pb=along(b.p,b.c,b.ds[q.j]),m=ease(Math.max(0,Math.min(1,(f-.35)/.3)));
    const g=segAt(b.c,b.ds[q.j]),A=b.p[g],B=b.p[g+1];let ang=Math.atan2(B[1]-A[1],B[0]-A[0]);if(q.to===1)ang+=Math.PI;
    return{x:pa[0]+(pb[0]-pa[0])*m,y:pa[1]+(pb[1]-pa[1])*m,ang,dir:q.to,at:q.j,next:q.to?q.j-1:q.j+1,leg:q,f}}
  const clockS=()=>Date.now()/1000;
  // seconds until the next train is at station j heading dir (several)
  function nextAt(tab,j,dir,count){const at=tab[dir][j];if(at==null)return[];const u=clockS(),out=[];
    for(let i=0;i<NTR;i++){const ph=(u+i*HEAD)%C;let w=at-ph;while(w<-5)w+=C;out.push(w)}
    out.sort((a,b)=>a-b);const res=[];for(let k=0;res.length<count;k++){const w=out[k%NTR]+Math.floor(k/NTR)*C;res.push(w)}return res}

  /* ---- drawing ---- */
  const g=el("g",{class:"ats","aria-label":"O'Hare Airport Transit System"});world.insertBefore(g,stnG);
  const trkG=el("g",{},g),sG=el("g",{},g),tG=el("g",{},g);
  for(const t of T){const d="M"+t.p.map(q=>q[0]+","+q[1]).join("L");el("path",{class:"atscase",d},trkG);t.el=el("path",{class:"atstrk",d,stroke:ATS_RED},trkG)}
  for(const s of S){
    s.g=el("g",{class:"atss",tabindex:"0",role:"button","aria-label":`${s.name}, Airport Transit System. Press Enter for simulated times.`},sG);
    s.hit=el("circle",{class:"atshit"},s.g);
    s.dot=el("circle",{class:"atsdot",stroke:ATS_RED},s.g);
    const tm=TERM[s.name];
    s.badge=tm?el("rect",{class:"atsbadge",fill:tm[1]},s.g):null;
    s.num=tm?el("text",{class:"atsnum",fill:tm[2],"text-anchor":"middle","dominant-baseline":"central"},s.g):null;if(s.num)s.num.textContent=tm[0];
    s.lbl=el("text",{class:"atsl","dominant-baseline":"central"},s.g);s.lbl.textContent=tm?"Terminal":s.name;
    s.rec={ats:"stn",id:"ats:"+s.name,s,xy:s.xy,full:s.name,label:s.name};
    s.g.addEventListener("pointerenter",e=>{if(!drag||!drag.moved)atsTip(`<div>${esc(s.name)}</div><div class="s">Airport Transit System</div>`,e)});
    s.g.addEventListener("pointerleave",hideTip);
    s.g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openStationPop(s.rec)}});
  }
  const TR=[];
  for(let i=0;i<NTR;i++){
    const tg=el("g",{class:"atst"},tG),inner=el("g",{},tg);
    el("circle",{class:"atshit",r:15},tg);
    el("path",{class:"atsarrow",d:"M10,0 L-5.6,6.4 L-2.6,0 L-5.6,-6.4 Z",stroke:ATS_RED},inner);   // hollow: not a real position
    const car=el("g",{class:"atscar"},inner);                       // cute style: a white three-car people mover
    el("rect",{x:-13,y:-3.9,width:26,height:7.8,rx:2.6,fill:"#000",opacity:.2},car);
    for(const x of[-12,-3.6,4.8]){el("rect",{x,y:-3.2,width:8,height:6.4,rx:1.8,fill:"#F6F8FA",stroke:ATS_RED,"stroke-width":.9,"stroke-dasharray":"2 1.2"},car)}
    el("rect",{x:-11,y:-.6,width:22.6,height:1.2,rx:.6,fill:ATS_RED,opacity:.8},car);
    el("path",{d:"M11.4,-2.2 Q12.6,0 11.4,2.2",stroke:"#0B1118","stroke-width":1.2,fill:"none","stroke-linecap":"round"},car);
    const t={i,g:tg,inner,rec:null,pose:null};
    t.rec={ats:"train",id:"ats:train"+i,t,xy:[0,0],full:"ATS train",label:"ATS train"};
    tg.addEventListener("pointerenter",e=>{if(!drag||!drag.moved)atsTip(trainTip(t),e)});
    tg.addEventListener("pointermove",e=>{if(!drag||!drag.moved)atsTip(trainTip(t),e)});
    tg.addEventListener("pointerleave",hideTip);
    TR.push(t)}
  function atsTip(html,e){tip.innerHTML=html;placeTip(e)}
  const dest=dir=>dir?S[0].name:S[last].name;
  function trainTip(t){const p=t.pose;if(!p)return"";
    return`<div><span class="lc" style="background:${ATS_RED}"></span>ATS · to ${esc(dest(p.dir))}</div><div class="s">${p.at>=0?"At "+esc(S[p.at].name):"Next: "+esc(S[p.next].name)} · simulated</div>`}

  let lastW=-1,shown=false;
  atsFrame=function(){
    const w=vb.w,a=focusKey&&focusKey!=="blue"?0:Math.max(0,Math.min(1,(SHOW_W-w)/(SHOW_W-FULL_W)));
    const onScreen=vb.x<BOXA.x1&&vb.x+vb.w>BOXA.x0&&vb.y<BOXA.y1&&vb.y+vb.h>BOXA.y0;
    followFit();atsAlpha=onScreen?a:0;
    if(!atsAlpha){if(shown){shown=false;g.style.display="none";if(spopRec&&spopRec.ats)closeStationPop()}return}
    if(!shown){shown=true;g.style.display="inline";lastW=-1}
    g.style.opacity=atsAlpha.toFixed(3);g.style.pointerEvents=atsAlpha>.5?"":"none";
    const k=w/cw();
    if(Math.abs(w-lastW)>1e-6){lastW=w;
      for(const s of S){const r=3.6*k,[x,y]=s.xy,dv=LBL[s.name]||[1,0];
        s.dot.setAttribute("cx",x);s.dot.setAttribute("cy",y);s.dot.setAttribute("r",r.toFixed(3));s.dot.setAttribute("stroke-width",(2*k).toFixed(3));
        s.hit.setAttribute("cx",x);s.hit.setAttribute("cy",y);s.hit.setAttribute("r",(14*k).toFixed(3));
        const fs=12.5*k,gap=9*k,bw=s.badge?15*k:0,tw=(s.badge?"Terminal".length*6.1:s.name.length*6.3)*k,total=bw+(bw?4*k:0)+tw;
        // where the label block starts: beside the dot (left/right) or centred under it
        let bx=dv[0]>.5?x+gap:dv[0]<-.5?x-gap-total:x-total/2+dv[0]*total*.55,by=dv[1]>.5?y+gap+fs*.6:dv[1]<-.5?y-gap-fs*.6:y;
        // "Terminal" then the terminal's own coloured number, as on O'Hare's signs
        const ex=bx+tw+(bw?4*k:0);
        if(s.badge){s.badge.setAttribute("x",ex.toFixed(3));s.badge.setAttribute("y",(by-bw/2).toFixed(3));s.badge.setAttribute("width",bw.toFixed(3));
          s.badge.setAttribute("height",bw.toFixed(3));s.badge.setAttribute("rx",(2.5*k).toFixed(3));
          s.num.setAttribute("x",(ex+bw/2).toFixed(3));s.num.setAttribute("y",(by+.5*k).toFixed(3));s.num.style.fontSize=(11*k).toFixed(3)+"px"}
        s.lbl.setAttribute("x",bx.toFixed(3));s.lbl.setAttribute("y",by.toFixed(3));
        s.lbl.style.fontSize=fs.toFixed(3)+"px";s.lbl.style.strokeWidth=(3.2*k).toFixed(3)+"px"}
    }
    const zf=Math.log2(Math.max(1,FIT_W/w)),ks=k*(cuteTrains?Math.min(1,.6+.4*zf/3):Math.min(1,.75+.25*zf/3)),u=clockS();
    for(const t of TR){const p=poseAtT(u+t.i*HEAD);t.pose=p;t.rec.xy=[p.x,p.y];
      const tf=`translate(${p.x.toFixed(2)},${p.y.toFixed(2)}) scale(${ks.toFixed(4)})`;if(tf!==t.tf){t.tf=tf;t.g.setAttribute("transform",tf)}
      const rs=`rotate(${(p.ang*180/Math.PI).toFixed(1)})`;if(rs!==t.rs){t.rs=rs;t.inner.setAttribute("transform",rs)}
      t.g.classList.toggle("sel",spopRec===t.rec)}
  };
  function pickTrain(tgt,e,touchy){
    const own=tgt&&tgt.closest&&tgt.closest(".atst");if(own){const t=TR.find(q=>q.g===own);if(t)return t}
    if(!touchy)return null;let best=null,bd=22;
    for(const t of TR){const r=t.g.getBoundingClientRect();if(!r.width)continue;const d=Math.hypot(r.x+r.width/2-e.clientX,r.y+r.height/2-e.clientY);if(d<bd){bd=d;best=t}}
    return best}
  // taps: phase 0 runs before the L trains get a look (only a direct hit on an ATS train or station), phase 1 after (a nearby ATS train)
  atsTap=function(tgt,e,touchy,phase){
    if(atsAlpha<=.5)return false;
    if(phase===0){const sg=tgt&&tgt.closest&&tgt.closest(".atss"),s=sg&&S.find(q=>q.g===sg);if(s){hideTip();openStationPop(s.rec);return true}
      const own=tgt&&tgt.closest&&tgt.closest(".atst");if(!own)return false}
    const t=pickTrain(tgt,e,touchy);if(!t)return false;hideTip();lastPick=performance.now();openStationPop(t.rec);return true};

  // clicking O'Hare zooms in on the airport, leaving room for the station card
  function atsView(){const b=BOXA,W=cw(),H=ch(),I=uiInsets();
    let L=isNarrow()?12:40,R=(isNarrow()?12:40)+I.right,Tp=I.top+8,B=I.bot+8;
    if(spop.classList.contains("on")){if(isNarrow()){if(sideSheet())L+=spop.offsetWidth+16;else B=Math.max(B,H-spop.getBoundingClientRect().top+8)}
      else L+=spop.offsetWidth+24}
    const aw=Math.max(80,W-L-R),ah=Math.max(80,H-Tp-B),s=Math.min(aw/(b.x1-b.x0),ah/(b.y1-b.y0));
    return{x:(b.x0+b.x1)/2-(L+aw/2)/s,y:(b.y0+b.y1)/2-(Tp+ah/2)/s,w:W/s,h:H/s}}
  // (on a phone the card grows once its arrival times load: the view follows it for a few seconds, until you touch the map)
  let fit=null;
  atsOnStation=function(rec){if(rec!==hubRec)return;
    requestAnimationFrame(()=>{const v=atsView();if(vb.w<v.w*.7||Math.abs(vb.w-v.w)<v.w*.15&&Math.abs(vb.x-v.x)<v.w*.2)return;   // already there, or closer in
      if(chase&&(chase.phase==="in"||chase.phase==="ride"))return;stopFollowing();flyTo(v,900);
      fit={until:performance.now()+4000,top:spop.getBoundingClientRect().top}})};
  function followFit(){if(!fit)return;
    if(!isNarrow()||performance.now()>fit.until||spopRec!==hubRec||drag||ptrs.size){fit=null;return}
    const top=spop.getBoundingClientRect().top;if(Math.abs(top-fit.top)>20){fit.top=top;flyTo(atsView(),500)}}
  window.__ats={S,TR,legs,C,HEAD,ARR,DEP,poseAtT,nextAt,atsView,get alpha(){return atsAlpha}};

  /* ---- the card (the station card's panel) ---- */
  const badge=`<span class="bullet" style="background:${ATS_RED};color:#fff">ATS</span>`;
  const mins=w=>w<45?"Due":Math.round(w/60)+" min";
  const at=w=>fmtClock(clockS()+w);
  const SIMNOTE=`<div class="note atsnote">Simulated. The Airport Transit System doesn't publish live train positions, so these trains and times follow its published pattern (every 3&ndash;5 minutes, 24/7). They aren't real positions. Track: &copy; OpenStreetMap contributors.</div>`;
  atsPopHTML=function(rec){
    if(rec.ats==="stn"){const s=rec.s,tm=TERM[s.name];let rows="";
      for(const dir of[0,1]){if((dir===0&&s.j===last)||(dir===1&&s.j===0))continue;
        const leaves=(dir===0&&s.j===0)||(dir===1&&s.j===last),ws=nextAt(leaves?DEP:ARR,s.j,dir,3);
        rows+=`<div class="sdir"><span class="kick2">${leaves?"Leaves for":"To"} ${esc(dest(dir))}</span>`
          +ws.map(w=>`<div class="arr pred">${badge}<span class="to">to ${esc(dest(dir))}</span><span class="when"><b>${mins(w)}</b>${at(w)}</span></div>`).join("")+`</div>`}
      return`<button class="x" aria-label="Close">×</button><div class="nm">${tm?`<span class="atsb" style="background:${tm[1]};color:${tm[2]}">${tm[0]}</span>`:""}${esc(s.name)}</div>`
        +`<div class="ln">${badge}<span class="atssub">Airport Transit System · free</span></div>`
        +(MORE[s.name]?`<div class="note">${esc(MORE[s.name])}</div>`:"")+rows+SIMNOTE}
    const t=rec.t,p=t.pose||poseAtT(clockS()+t.i*HEAD);
    let row="";
    if(p.at>=0)row=`<div class="arr">${badge}<span class="to">At ${esc(S[p.at].name)}</span><span class="when"><b>Now</b></span></div>`;
    // time until it reaches its next stop: walk the cycle forward to that stop
    const u=(clockS()+t.i*HEAD)%C,nx=p.next;
    if(nx>=0&&nx<=last){let w=ARR[p.dir][nx]-u;while(w<0)w+=C;
      row+=`<div class="arr">${badge}<span class="to">Next ${esc(S[nx].name)}</span><span class="when"><b>${mins(w)}</b>${at(w)}</span></div>`}
    return`<button class="x" aria-label="Close">×</button><div class="nm">to ${esc(dest(p.dir))}</div>`
      +`<div class="ln">${badge}<span class="atssub">Airport Transit System · simulated train</span></div>`
      +`<div class="sdir">${row}</div>`+SIMNOTE};
