function clearTrains(){closeCard();for(const t of[...trains])removeTrain(t,false)}
/* =====================================================================
   SERVICE ALERTS — straight from CTA's Customer Alerts feed via the Worker (L lines and stations only).
   An alert that's in the feed is active; one that's gone is over.
   Nothing here is inferred: lines come from the alert's own route list.
   If the Worker doesn't send alerts at all, the whole feature stays hidden.
   ===================================================================== */
let alerts=null,alertsErr="",seenAlertIds=null,openAlerts=new Set(),alertSig="";
const ROUTE_KEY=API_KEY;
// GTFS-realtime enums, as Metra sends them (the Worker passes the numbers through)
const EFFECT={1:"No service",2:"Reduced service",3:"Significant delays",4:"Detour",5:"Added service",6:"Modified service",
  9:"Stop moved",11:"Accessibility"};
const SEVERITY={2:"info",3:"warning",4:"severe"};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// Both systems' alerts, kept apart and shown together. sys = "cta" (CTA Customer Alerts) or "metra" (Metra's alerts feed).
const ALERT_BY={cta:null,metra:null},ALERT_ERR={cta:"",metra:""},ALERT_AT={cta:0,metra:0};
const SYS_NAME={cta:"CTA",metra:"Metra"};
/* Categories come from what each feed says about the alert itself, never guessed from the line or place:
     CTA:   its "Impact" text (e.g. Elevator Status, Planned Work, Significant Delays, Service Change)
     Metra: the GTFS-realtime effect, and cause = maintenance/construction for planned work
   Only when a feed gives neither (Metra's "other"/"unknown" effect) does a headline that literally names an
   elevator or escalator count as an accessibility alert. Everything else is "Other notices". */
const ACAT=[["delay","Delays"],["disrupt","Suspensions & disruptions"],["station","Station & service changes"],
  ["access","Elevators & accessibility"],["planned","Planned work"],["other","Other notices"]];
const ACAT_NAME=Object.fromEntries(ACAT),ACAT_SHORT={delay:"Delays",disrupt:"Disruptions",station:"Station changes",access:"Elevators",planned:"Planned work",other:"Other"};
function alertCategory(a,sys){
  if(sys==="cta"){const im=String(a.impact||"").toLowerCase();
    if(/elevator|escalator|accessib/.test(im))return"access";
    if(/planned|construction|maintenance|track work/.test(im))return"planned";
    if(/delay/.test(im))return"delay";
    if(/suspen|no (train )?service|disrupt|reroute|detour|shuttle|cancel/.test(im))return"disrupt";
    if(/station|service change|closure|closed|stop|added service|entrance/.test(im))return"station";
    return"other"}
  const e=+a.effect||0,c=+a.cause||0;
  if(e===11)return"access";
  if(e===3)return"delay";
  if(e===1||e===2||e===4)return"disrupt";
  if(c===9||c===10)return"planned";                    // MAINTENANCE, CONSTRUCTION
  if(e===5||e===6||e===9)return"station";
  if(/\b(elevator|escalator)s?\b/i.test(String(a.header||"")))return"access";
  return"other"}
// serious = the feed itself says so: CTA's MajorAlert flag, Metra's SEVERE level or a no-service effect
function alertSerious(a,sys){return sys==="cta"?!!a.major:(+a.severity===4||+a.effect===1)}
function alertTimes(a,sys){if(sys==="cta")return{start:+a.start>0?Math.round(+a.start/1000):0,end:+a.end>0?Math.round(+a.end/1000):0};
  const P=(Array.isArray(a.periods)?a.periods:[]).filter(p=>p&&(p.start||p.end));if(!P.length)return{start:0,end:0};
  const nowS=serverNow()/1000,cur=P.find(p=>(!p.start||p.start<=nowS)&&(!p.end||p.end>nowS))||P.find(p=>p.start>nowS)||P[P.length-1];
  return{start:+cur.start||0,end:P.every(p=>+p.end>0)?Math.max(...P.map(p=>+p.end)):(+cur.end||0)}}
function takeAlerts(data,sys="cta"){
  if(!("alerts" in data)&&!("alerts_error" in data))ALERT_BY[sys]=null;   // older Worker: no alerts from it
  else{
    ALERT_ERR[sys]=data.alerts_error?String(data.alerts_error):"";
    if(Array.isArray(data.alerts)){
      ALERT_AT[sys]=Date.now();
      const seen=new Map(),KEY=sys==="metra"?METRA_KEY:ROUTE_KEY,nowS=serverNow()/1000;
      for(const a of data.alerts){if(!a||typeof a!=="object")continue;
        const header=String(a.header||a.short||"").trim(),desc=String(a.description||a.short||"").trim();
        if(!header&&!desc)continue;
        const id=sys+":"+String(a.id||header+"|"+desc);                    // the feed's own id; text only if it has none
        const keys=[...new Set((Array.isArray(sys==="metra"?a.routes:a.lines)?(sys==="metra"?a.routes:a.lines):[]).map(r=>KEY[r]).filter(Boolean))];
        const stns=[...new Set((Array.isArray(sys==="metra"?a.stops:a.stations)?(sys==="metra"?a.stops:a.stations):[]).map(x=>STN.get(String(x))).filter(Boolean))];
        const tm=alertTimes(a,sys);
        if(tm.end&&tm.end<nowS-60)continue;                                 // already over
        const rec={id,sys,keys,stns,where:stns.map(r=>r.label).join(", "),header,desc,
          url:/^https:\/\//i.test(a.url||"")?a.url:"",cat:alertCategory(a,sys),serious:alertSerious(a,sys),
          effect:sys==="metra"?(EFFECT[a.effect]||""):String(a.impact||"").trim(),start:tm.start,end:tm.end,
          sev:sys==="cta"?(+a.severity||0):(+a.severity||0)*25,ver:header+"|"+desc+"|"+tm.end};
        const prev=seen.get(id);if(prev&&prev.ver===rec.ver)continue;        // the same alert twice in one answer
        seen.set(id,rec)}
      ALERT_BY[sys]=[...seen.values()];
    }else if(!ALERT_BY[sys])ALERT_BY[sys]=[];
  }
  const parts=[ALERT_BY.cta,ALERT_BY.metra].filter(Boolean);
  const list=parts.length?[].concat(...parts):null;
  alertsErr=["cta","metra"].filter(k=>ALERT_ERR[k]).map(k=>SYS_NAME[k]).join(" and ");   // whose alerts feed isn't answering
  if(list){
    // a gentle pulse on the button only when a genuinely new (or changed) serious alert shows up after the first load
    if(seenAlertIds){for(const a of list)if(!seenAlertIds.has(a.id+a.ver)&&a.serious){pulseAlerts();break}}
    seenAlertIds=new Set(list.map(a=>a.id+a.ver));
    for(const id of[...openAlerts])if(!list.some(a=>a.id===id))openAlerts.delete(id);
  }
  alerts=list;
  renderAlerts();
}
function pulseAlerts(){const b=$("abtn");b.classList.remove("fresh");void b.offsetWidth;b.classList.add("fresh")}
let aSys="all",aCat="all";                                                 // the alert panel's filters (this visit only)
function alertPool(){if(!alerts)return[];return focusKey?alerts.filter(a=>!a.keys.length||a.keys.includes(focusKey)):alerts.slice()}
function visibleAlerts(){
  const rank=a=>a.keys.length?Math.min(...a.keys.map(k=>ORDER.indexOf(k))):99;
  return alertPool().filter(a=>(aSys==="all"||a.sys===aSys)&&(aCat==="all"||a.cat===aCat))
    .sort((a,b)=>(b.serious-a.serious)||(ACAT.findIndex(c=>c[0]===a.cat)-ACAT.findIndex(c=>c[0]===b.cat))||(rank(a)-rank(b))||(b.sev-a.sev))}
const fmtDay=(sec,o)=>new Date(sec*1000).toLocaleString([],{timeZone:"America/Chicago",...o});
function fmtUntil(sec){const d=new Date(sec*1000);if(!isFinite(d))return"";
  const same=fmtDay(sec,{dateStyle:"short"})===fmtDay(serverNow()/1000,{dateStyle:"short"});
  return"Until "+(same?fmtDay(sec,{hour:"numeric",minute:"2-digit"}):fmtDay(sec,{month:"short",day:"numeric"}))}
function fmtFrom(sec){return"Starts "+fmtDay(sec,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}
function renderAlerts(){
  const btn=$("abtn"),show=alerts!==null&&mode!=="sim";
  btn.classList.toggle("show",show);
  for(const k of ORDER)chips[k].classList.toggle("alerted",!!show&&alerts.some(a=>a.keys.includes(k)&&(a.serious||a.cat==="delay"||a.cat==="disrupt")));
  if(!show){closeAlerts();return}
  const pool=alertPool(),n=pool.length,serious=pool.filter(a=>a.serious).length;
  btn.classList.toggle("has",n>0);btn.classList.toggle("serious",serious>0);
  $("acount").textContent=n?String(n):"";
  $("aword").textContent=n?(n===1?"alert":"alerts"):(alertsErr&&!alerts.length?"Alerts unavailable":"No alerts");
  btn.title=n?`${n} service alert${n>1?"s":""}${serious?`, ${serious} major`:""}${focusKey?" for the "+LINES[focusKey].name:""}`:"No active service alerts";
  const sig=JSON.stringify([pool.map(a=>a.id+a.ver),focusKey,ALERT_ERR,aSys,aCat,[...openAlerts]]);
  if(sig===alertSig)return;alertSig=sig;
  // filters: system, then the categories that actually have alerts (with counts)
  const sysN=k=>pool.filter(a=>k==="all"||a.sys===k).length,inSys=pool.filter(a=>aSys==="all"||a.sys===aSys);
  if(aCat!=="all"&&!inSys.some(a=>a.cat===aCat))aCat="all";
  const showSys=(sysN("cta")>0&&sysN("metra")>0)||aSys!=="all",showCats=ACAT.filter(([k])=>inSys.some(a=>a.cat===k)).length>1||aCat!=="all";
  $("afilt").hidden=!showSys&&!showCats;
  $("afilt").innerHTML=(showSys?`<div class="aseg" role="group" aria-label="System">${[["all","All"],["cta","CTA"],["metra","Metra"]].map(([k,l])=>
      `<button data-sys="${k}" aria-pressed="${aSys===k}">${l}<span>${sysN(k)}</span></button>`).join("")}</div>`:"")
    +(showCats?`<div class="acats" role="group" aria-label="Type of alert">${[["all","Everything"],...ACAT].map(([k,l])=>{const c=k==="all"?inSys.length:inSys.filter(a=>a.cat===k).length;
      return c||k==="all"?`<button data-cat="${k}" aria-pressed="${aCat===k}" title="${esc(l)}">${esc(k==="all"?l:ACAT_SHORT[k])} <span>${c}</span></button>`:""}).join("")}</div>`:"");
  $("ascope").textContent=focusKey?`${LINES[focusKey].code} and system-wide`:"";
  const vis=visibleAlerts(),L=$("alist");
  // a feed that isn't answering never reads as "no alerts": say whose, and since when
  const down=["cta","metra"].filter(k=>ALERT_ERR[k]&&(aSys==="all"||aSys===k)).map(k=>`<div class="awarn">${SYS_NAME[k]}'s alerts aren't loading${ALERT_AT[k]?`; showing what it last sent (${ago(Date.now()-ALERT_AT[k])})`:""}. That doesn't mean there are none.</div>`).join("");
  if(!vis.length){const what=(aCat==="all"?"":ACAT_NAME[aCat].toLowerCase()+" ")+"alerts";
    L.innerHTML=down+`<div class="aempty">No ${aSys==="all"?"":SYS_NAME[aSys]+" "}${esc(what)}${focusKey?" for the "+esc(LINES[focusKey].name):""} right now.</div>`;return}
  L.innerHTML=down+vis.map(a=>{
    const lines=a.keys.length?a.keys.map(k=>bullet(k)).join(""):`<span class="aall">${a.sys==="metra"?"Metra":"CTA"}${a.stns.length?"":" · all lines"}</span>`;
    const when=a.start&&a.start>serverNow()/1000?fmtFrom(a.start):a.end?fmtUntil(a.end):"";
    const mapb=a.stns.length||a.keys.length?`<button class="amap" data-id="${esc(a.id)}">Show on map</button>`:"";
    const more=`<div class="more"><div>${a.where?`<p class="awhere"><b>Stations:</b> ${esc(a.where)}</p>`:""}${a.desc&&a.desc!==a.header?esc(a.desc):""}${a.url?`<p><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Full notice on ${a.sys==="metra"?"metra.com":"transitchicago.com"} ↗</a></p>`:""}${mapb}</div></div>`;
    return`<div class="aitem${openAlerts.has(a.id)?" open":""}${a.serious?" major":""}" data-id="${esc(a.id)}" role="button" tabindex="0" aria-expanded="${openAlerts.has(a.id)}">`
      +`<div><div class="tags"><span class="asys ${a.sys}">${SYS_NAME[a.sys]}</span><span class="acat c-${a.cat}">${esc(ACAT_NAME[a.cat])}</span>${a.serious?'<span class="amaj">Major</span>':""}${when?`<span>${esc(when)}</span>`:""}<span class="chev" aria-hidden="true">▾</span></div>`
      +`<div class="h">${esc(a.header||a.desc.split("\n")[0])}</div><div class="alines">${lines}${a.where&&!openAlerts.has(a.id)?`<span class="awh">${esc(a.where)}</span>`:""}</div>${more}</div></div>`}).join("");
}
function toggleAlertItem(it){const id=it.dataset.id;
  if(openAlerts.has(id))openAlerts.delete(id);else openAlerts.add(id);
  it.classList.toggle("open");it.setAttribute("aria-expanded",String(openAlerts.has(id)));alertSig="";renderAlerts()}
// an alert on the map: its stations if it names any (an elevator alert finds its station), else its line(s)
function showAlertOnMap(a){
  if(a.stns.length){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const r of a.stns){x0=Math.min(x0,r.xy[0]);y0=Math.min(y0,r.xy[1]);x1=Math.max(x1,r.xy[0]);y1=Math.max(y1,r.xy[1])}
    const pad=Math.max(18,(x1-x0+y1-y0)*.15);stopFollowing();flyTo(fitBox({x0:x0-pad,y0:y0-pad,x1:x1+pad,y1:y1+pad}));
    for(const r of a.stns){r.g.classList.remove("ahl");void r.g.getBBox();r.g.classList.add("ahl");setTimeout(()=>r.g.classList.remove("ahl"),9000)}
    if(a.stns.length===1)setTimeout(()=>openStationPop(a.stns[0]),700)}
  else if(a.keys.length===1)setFocus(a.keys[0]);
  else if(a.keys.length){let b=null;for(const k of a.keys){const q=lineBounds(k);b=b?{x0:Math.min(b.x0,q.x0),y0:Math.min(b.y0,q.y0),x1:Math.max(b.x1,q.x1),y1:Math.max(b.y1,q.y1)}:q}
    stopFollowing();flyTo(fitBox(b))}
  if(isNarrow())closeAlerts()}
function openAlertsPanel(){$("apanel").classList.add("on");$("abtn").setAttribute("aria-expanded","true");hideTip()}
function closeAlerts(){$("apanel").classList.remove("on");$("abtn").setAttribute("aria-expanded","false")}
$("abtn").onclick=e=>{e.stopPropagation();$("apanel").classList.contains("on")?closeAlerts():openAlertsPanel()};
$("aclose").onclick=closeAlerts;
$("afilt").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  if(b.dataset.sys)aSys=b.dataset.sys;if(b.dataset.cat)aCat=b.dataset.cat;alertSig="";renderAlerts()});
$("alist").addEventListener("click",e=>{if(e.target.closest("a"))return;
  const m=e.target.closest(".amap");if(m){const a=(alerts||[]).find(x=>x.id===m.dataset.id);if(a)showAlertOnMap(a);return}
  const it=e.target.closest(".aitem");if(it)toggleAlertItem(it)});
$("alist").addEventListener("keydown",e=>{if(e.key!=="Enter"&&e.key!==" ")return;if(e.target.closest("a,button"))return;const it=e.target.closest(".aitem");if(it){e.preventDefault();toggleAlertItem(it)}});
document.addEventListener("pointerdown",e=>{if($("apanel").classList.contains("on")&&!e.target.closest("#apanel,#abtn"))closeAlerts()});

function startSim(){
  mode="sim";liveBack=false;document.body.classList.add("simmode");clearTrains();
  let n=0;simTrains=[];
  for(const key of ORDER)LINES[key].routes.forEach((r,ri)=>{const last=r.st.length-1,per=ri===0?3:1;
    for(let j=0;j<per;j++)simTrains.push({key,ri,s:last*(j+.5)/per+Math.random()*.8,dir:(n%2?1:-1),v:.11+Math.random()*.07,run:String(900+n++)})});
  simTick();clearInterval(simTimer);simTimer=setInterval(simTick,8000);renderAlerts();refreshStatus();
}
function stopSim(){
  mode="live";liveBack=false;clearInterval(simTimer);document.body.classList.remove("simmode");clearTrains();
  everLoaded=false;fails=0;poll();
}
function simTick(){
  const out={},now=Date.now();
  for(const q of simTrains){const r=LINES[q.key].routes[q.ri],last=r.st.length-1;
    q.s+=q.dir*q.v;if(q.s<=0){q.s=0;q.dir=1}else if(q.s>=last){q.s=last;q.dir=-1}
    const i=Math.min(last-1,Math.floor(q.s)),f=q.s-i,a=STOPS[r.st[i]],b=STOPS[r.st[i+1]];
    (out[LINES[q.key].api]||=[]).push({run:q.run,sim:true,lat:a.lat+(b.lat-a.lat)*f,lon:a.lon+(b.lon-a.lon)*f,predicted_at:now,
      next_sta_id:q.dir>0?r.st[i+1]:r.st[i],dest:shortName(STOPS[q.dir>0?r.st[last]:r.st[0]].name)})}
  clockOffset=0;ingest({lines:out},ORDER);refreshStatus();
}
document.addEventListener("visibilitychange",()=>{
  if(document.hidden)return;
  lastFrame=performance.now();
  if(mode==="live"&&Date.now()-lastOkAt>POLL+5000)poll();
});


/* ---- status ---- */
function ago(ms){const s=Math.max(0,Math.round(ms/1000));if(s<5)return"just now";if(s<60)return s+" s ago";const m=Math.round(s/60);return m<60?m+" min ago":Math.round(m/60)+" h ago"}
function setState(cls,text){const s=$("state");s.className="state "+cls;$("stateText").textContent=text;
  document.body.classList.toggle("trouble",(everLoaded||mEverLoaded)&&mode!=="sim"&&(cls==="warn"||cls==="err"))}
function notice(html){const n=$("notice");
  if(html){if(n.dataset.h!==html){const i=html.indexOf('<div class="acts">');
      n.innerHTML=i<0?`<div class="msg">${html}</div>`:`<div class="msg">${html.slice(0,i)}</div>${html.slice(i)}`;n.dataset.h=html;labelsDirty=true}
    if(!n.classList.contains("on")){n.classList.add("on");labelsDirty=true}}
  else if(n.classList.contains("on")){n.classList.remove("on");n.dataset.h="";labelsDirty=true}}
$("notice").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  if(b.dataset.act==="sim")startSim();else if(b.dataset.act==="live")stopSim();else if(b.dataset.act==="retry"){poll();pollMetra()}});
const SIM_OFFER=`<div class="acts"><button class="go" data-act="retry">Try again</button><button data-act="sim">Show simulated trains</button></div>`;
function refreshStatus(){
  if(mode==="sim"){
    const vis=trains.filter(t=>!focusKey||t.L.key===focusKey);
    $("count").textContent=vis.length;for(const k of ORDER)$("n-"+k).textContent=trains.filter(t=>t.L.key===k).length;
    setState("sim","Simulated");$("updated").textContent="Simulated trains, not live data";metraUI("ok",false);
    notice(liveBack?`The live feed is working again. <div class="acts"><button class="go" data-act="live">Switch to live</button></div>`
      :`Simulated trains, not live data. <div class="acts"><button data-act="live">Try live</button></div>`);
    return}
  const vis=trains.filter(t=>!focusKey||t.L.key===focusKey),fresh=vis.filter(t=>!t.stale&&!t.hidden),any=everLoaded||mEverLoaded;
  $("count").textContent=any?fresh.length:"–";
  for(const k of ORDER){const n=trains.filter(t=>t.L.key===k&&!t.stale&&!t.hidden).length;$("n-"+k).textContent=any?n:""}
  // each system on its own. CTA: positions every 30 s. Metra: see metraHealth() in systems/metra/feed.js
  const C={loaded:everLoaded,ok:lastOkAt,fails,err:lastError};C.age=Date.now()-C.ok;
  C.down=C.loaded?(C.fails>=3||C.age>3*POLL):C.fails>0;C.slow=!C.down&&C.loaded&&(C.fails>0||C.age>POLL*1.6);
  const mh=metraHealth(),mDown=mh==="down"||(!mEverLoaded&&MH.fails>=2);
  if(!any){
    if(C.down&&mDown){setState("err","Offline");$("updated").textContent="No data received yet";metraUI(mh,false);
      notice(`Can't reach the live feeds. <span>${C.err||MH.detail}. Trying again every 30 seconds.</span>${SIM_OFFER}`)}
    else{setState("busy first","Connecting");$("updated").textContent="Waiting for first report";metraUI(mh,!C.down);notice("")}
    return}
  $("updated").textContent=C.loaded?"CTA updated "+ago(C.age):"Waiting for CTA";
  if(C.down&&mDown){setState("err","Offline");metraUI(mh,false);
    notice(`Can't reach the live feeds. <span>Trains are shown at their last known positions. Trying again every 30 seconds.</span>${SIM_OFFER}`);return}
  metraUI(mh,true);
  if(C.down){setState("warn","CTA offline");
    notice(`CTA's feed isn't answering. <span>${C.loaded?`L trains are shown at their last known positions (${ago(C.age)}).`:`L trains will appear when it answers.`} Metra is separate. Trying again every 30 seconds.</span>`);return}
  if(C.slow){setState("warn","CTA updates slow");notice("");return}
  if(!trains.length){setState("live","Live");notice(`No trains are reporting right now. <span>Overnight only the Red and Blue Lines run, and Metra runs few trains. The map fills in as service starts.</span>`);return}
  if(trains.every(t=>t.stale)){setState("warn","Data not updating");notice(`The feeds are answering, but no train has reported a new position recently.`);return}
  notice("");setState(inflight||mInflight?"busy":"live","Live");
}
const fmtHM=ms=>new Date(ms).toLocaleTimeString([],{hour:"numeric",minute:"2-digit",timeZone:"America/Chicago"});
// the Metra mark by the status (stage 1) and the Metra banner (stage 2)
function metraUI(mh,banner){const m=$("mhealth"),b=$("mbanner");
  const show=mh==="missed"||mh==="down"||mh==="empty"||(mh==="waiting"&&MH.fails>0);
  m.hidden=!show;m.className="mh "+(mh==="down"?"down":mh==="empty"?"quiet":"miss");
  const last=MH.lastUsable?`Last good Metra update ${ago(Date.now()-MH.lastUsable)} (${fmtHM(MH.lastUsable)}).`:"No Metra update received yet.";
  const why=MH.detail?` Reason: ${MH.detail}.`:"";
  m.title=mh==="empty"?"Metra's feed is answering but has no trains reporting right now (normal late at night)."
    :mh==="down"?`Metra updates have stopped. ${last}${why} Trying again every 30 seconds.`
    :`Missed a Metra update at ${fmtHM(MH.lastMissAt||Date.now())}${MH.fails>1?` (${MH.fails} in a row)`:""}. ${last}${why} Trying again shortly.`;
  m.querySelector("span").textContent=mh==="empty"?"Metra: none reporting":mh==="down"?"No Metra updates":"Metra updates slow";
  m.setAttribute("aria-label",m.title);
  const on=banner&&mh==="down";
  if(on){const h=`<b>Metra updates have stopped.</b> <span>${MH.lastUsable?`Last good update ${ago(Date.now()-MH.lastUsable)}.`:"No update yet."} Metra trains stay greyed out where they last reported. ${everLoaded&&!(Date.now()-lastOkAt>3*POLL)?"L trains are still live.":""}</span><button data-act="mretry">Try now</button>`;
    if(b.dataset.h!==h){b.innerHTML=h;b.dataset.h=h}}
  if(on!==!b.hidden){b.hidden=!on;labelsDirty=true}
}
$("mbanner").addEventListener("click",e=>{if(e.target.closest("[data-act=mretry]"))pollMetra()});
/* when each feed last delivered fresh data, always on screen: Metra's license asks for the date and time the data
   was last updated, and it's the honest answer to "is this live?" from across the room. A feed more than 90 s
   behind turns amber. */
function tickAsOf(){const el=$("asof");if(mode==="sim"){el.innerHTML="Simulated trains, not live data";el.className="asof";return}
  const t=ms=>fmtHM(ms).replace(/\s?[AP]M$/i,""),now=Date.now(),day=new Date(Math.max(lastOkAt,MH.lastUsable)||now).toLocaleDateString([],{month:"short",day:"numeric",timeZone:"America/Chicago"});
  const part=(name,ms)=>ms?`<span class="${now-ms>90000?"late":""}">${name} ${t(ms)}</span>`:`<span class="late">${name} waiting</span>`;
  const h=`<span class="lbl">Data as of</span> ${part("CTA",everLoaded?lastOkAt:0)}<i aria-hidden="true">·</i>${part("Metra",MH.lastUsable)}<i aria-hidden="true">·</i><span class="day">${day}</span>`;
  if(el.dataset.h!==h){el.dataset.h=h;el.innerHTML=h;el.className="asof"}
  el.title=`Last fresh data, Chicago time. CTA: ${everLoaded?new Date(lastOkAt).toLocaleString([],{timeZone:"America/Chicago"}):"none yet"}. Metra: ${MH.lastUsable?new Date(MH.lastUsable).toLocaleString([],{timeZone:"America/Chicago"}):"none yet"}.`}
function tickHeader(){
  tickAsOf();
  const left=Math.max(0,nextPollAt-Date.now());
  $("state").title=mode==="sim"?"Simulated trains, not live data":
    (everLoaded?"Updated "+ago(Date.now()-lastOkAt)+". ":"")+(inflight?"Checking now.":nextPollAt?"Next check in about "+Math.max(5,Math.ceil(left/5000)*5)+" s.":"")
    +" CTA and Metra publish new positions about every 30 seconds.";
}

/* ---- tooltip ---- */
const tip=$("tip");
function placeTip(e){const r=stage.getBoundingClientRect(),tw=tip.offsetWidth,th=tip.offsetHeight;
  let x=(e?e.clientX-r.left:r.width/2)+14,y=(e?e.clientY-r.top:r.height/2)+14;
  if(x+tw>r.width-6)x-=tw+28;if(y+th>r.height-6)y-=th+28;tip.style.left=x+"px";tip.style.top=y+"px";tip.style.opacity=1}
function showStationTip(rec,e){
  const lines=[...rec.lines].map(k=>`<span class="lc" style="background:${LINES[k].color}"></span>${LINES[k].code}`).join("&nbsp; ");
  tip.innerHTML=`<div>${rec.full}</div><div class="s">${lines}</div>`;placeTip(e)}
function showTrainTip(t,e){
  const v=t.cta||{},nx=v.next_sta_id&&STN.get(v.next_sta_id);
  tip.innerHTML=`<div><span class="lc" style="background:${t.L.color}"></span>${t.L.code}${trainLabel(t)?" · "+trainLabel(t):""}${v.dest?" to "+esc(v.dest):""}</div>`
   +`<div class="s">${nx?(v.approaching?"Arriving at ":"Next: ")+esc(nx.label):dirText(t)}${v.delayed?" · delayed":""}${t.stale?" · position out of date":t.held?" · checking an odd report":""}</div>`;placeTip(e)}
function trainLabel(t){return t.run.sim?"Simulated "+t.run.no:t.run.no?(t.L.sys==="metra"?"Train ":"Run ")+t.run.no:""}
function hideTip(){tip.style.opacity=0}
function dirText(t){const d=t.cta&&t.cta.dest;return d?"to "+d:t.dirSign===0?"Direction not known yet":"Direction known"}

/* ---- floating train details ---- */
const card=$("card");
function bindTrain(t){
  t.g.addEventListener("pointerenter",e=>{if(!drag||!drag.moved)showTrainTip(t,e)});
  t.g.addEventListener("pointermove",e=>{if(!drag||!drag.moved)showTrainTip(t,e)});
  t.g.addEventListener("pointerleave",hideTip);
  t.g.addEventListener("focus",()=>showTrainTip(t));t.g.addEventListener("blur",hideTip);
  const pick=()=>{hideTip();if(selected===t){if(!rideCard())closeCard();return}selectTrain(t)};
  t.g.addEventListener("click",e=>{e.stopPropagation();if(performance.now()-lastPick>500)pick()});   // the map already handled a real tap
  t.g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();pick()}});
}
let cardBack=null;
function selectTrain(t){
  closeStationPop();closeBoardSheet();
  if(!card.classList.contains("on"))cardBack=document.activeElement;   // before re-stacking the train, which drops its focus
  if(selected)selected.g.classList.remove("sel");
  selected=t;t.g.classList.add("sel");t.g.parentNode.appendChild(t.g);
  card.classList.add("on");document.body.classList.add("sheet");renderCard();card.focus({preventScroll:true});
  // picking a train opens its card and leaves the camera alone (Follow is what rides along). Only a train that's
  // off-screen, or hidden under the phone's bottom sheet, gets panned into view, at the same zoom
  const W=cw(),H=ch(),I=uiInsets(),px=(t.shown[0]-vb.x)*W/vb.w,py=(t.shown[1]-vb.y)*H/vb.h;
  const bottom=isNarrow()?Math.min(H-I.bot,H-card.offsetHeight-8):H-I.bot;
  if(!(px>24&&px<W-24&&py>I.top+16&&py<bottom-16)){const cy=(I.top+bottom)/2;flyTo({x:t.shown[0]-vb.w/2,y:t.shown[1]-cy/H*vb.h,w:vb.w,h:vb.h})}
  labelsDirty=true}
function stopFollowing(){if(!following)return;following=null;if(selected)renderCard()}
function closeCard(){if(chase&&chase.cap&&!selected){hideRideCap(true);chase.stop=true;endChase(performance.now(),false);return}   // the train of the moment's caption: stop riding
  if(chase&&(chase.manual||chase.card)&&selected===chase.t){if(!chase.manual)chase.stop=true;endChase(performance.now(),false)}   // back to the whole network
  const back=card.contains(document.activeElement);
  if(selected)selected.g.classList.remove("sel");selected=null;following=null;card.classList.remove("on");document.body.classList.remove("sheet");labelsDirty=true;
  if(back&&cardBack&&cardBack.isConnected&&cardBack.focus)cardBack.focus({preventScroll:true})}
function stationAt(t,i){const r=t.L.routes[t.ri];i=Math.max(0,Math.min(r.st.length-1,i));return STN.get(r.ids[i])}
const fmtClock=sec=>new Date(sec*1000).toLocaleTimeString([],{hour:"numeric",minute:"2-digit",timeZone:"America/Chicago"});
function minsTo(sec,nowSec){const m=Math.round((sec-nowSec)/60);return m<=0?"Due":m+" min"}
/* every stop this train has left, with CTA's predicted arrival at each (Train Tracker "follow this train"),
   fetched when its card opens and every 30 s while it stays open */
const FOLLOW=new Map();let followBusy=false;                            // train id -> {at, stops} or {at, err}
async function fetchFollow(t){const run=t.run&&t.run.no;if(!run||followBusy)return;followBusy=true;
  try{const r=await fetch(WORKER_URL+"/cta/follow?run="+encodeURIComponent(run),{cache:"no-store"});let d=null;try{d=await r.json()}catch(_){}
    FOLLOW.set(t.id,d&&Array.isArray(d.stops)?{at:Date.now(),stops:d.stops}:{at:Date.now(),err:true})}
  catch(_){FOLLOW.set(t.id,{at:Date.now(),err:true})}
  finally{followBusy=false;if(selected===t)renderCard()}}
function renderCard(){
  const t=selected;if(!t)return;
  const r=t.L.routes[t.ri],s=t.lastObsS,n=r.st.length,v=t.cta||{};      // the latest REAL fix, never the animated position
  const near=Math.round(s),atStn=Math.abs(s-near)<0.12,nowMs=serverNow();
  // where it is, from CTA's reported position (its signal system: the cars have no GPS)
  let nowRow="",gpsNext=null,lastRec=null;
  if(t.dirSign!==0){
    const lo=Math.floor(s),hi=Math.min(n-1,Math.ceil(s));
    lastRec=t.dirSign>0?stationAt(t,atStn?near:lo):stationAt(t,atStn?near:hi);
    const ni=t.dirSign>0?(atStn?near+1:hi):(atStn?near-1:lo);
    if(ni>=0&&ni<n&&!(atStn&&(ni===near)))gpsNext=stationAt(t,ni);
    nowRow=`<div class="row"><span class="kick2">${atStn?"At":"Passed"}</span><span class="v">${esc(stnName(lastRec))}</span><span></span></div>`;
  }else nowRow=`<div class="row"><span class="kick2">Near</span><span class="v">${esc(stnName(stationAt(t,near)))}</span><span></span></div>`;
  // where it's going next: CTA's own next station and its predicted arrival there
  let nextRow="";const nx=v.next_sta_id&&STN.get(v.next_sta_id);
  if(nx&&nx!==lastRec){const tm=+v.arrives_at||0,m=tm?Math.round((tm-nowMs)/60000):null;
    nextRow=`<div class="row"><span class="kick2">${v.approaching?"Arriving":"Next"}</span><span class="v">${esc(stnName(nx))}</span>`
      +(tm?`<span class="t"><b>${v.approaching||m<=1?"Due":m+" min"}</b> ${fmtClock(tm/1000)}</span>`:"<span></span>")+`</div>`}
  else if(gpsNext)nextRow=`<div class="row"><span class="kick2">Next</span><span class="v">${esc(stnName(gpsNext))}</span><span></span></div>`;
  // the next few stops with their predicted times
  let upRows="";
  if(mode!=="sim"&&t.L.sys==="metra"){const tr=mTripById.get(v.trip_id),nowSec=nowMs/1000;
    const list=tr&&Array.isArray(tr.stops)?tr.stops.filter(x=>(x.arr||x.dep)&&(x.arr||x.dep)>nowSec-45).slice(0,4):[];   // Metra's trip predictions: the next 4
    if(list.length)upRows=`<div class="ups"><span class="kick2 uh">Next stops</span>`+list.map((x,i)=>{
      const rec=STN.get(x.id),nm=rec?stnName(rec):x.id,tm=x.arr||x.dep,m=Math.round((tm-nowSec)/60);
      const late=x.delay>=60?` <span class="st${x.delay>=360?" late":""}" title="${Math.round(x.delay/60)} minutes late, per Metra">+${Math.round(x.delay/60)} min</span>`:"";   // short: the station name keeps its room
      return`<div class="row"><span class="kick2">${i===0?"Next":""}</span><span class="v">${esc(nm)}</span>`
        +`<span class="t"><b>${m<=1?"Due":m+" min"}</b> ${fmtClock(tm)}${late}</span></div>`}).join("")+`</div>`}
  else if(mode!=="sim"&&t.run&&t.run.no){const f=FOLLOW.get(t.id);
    if(!f||Date.now()-f.at>(f.err?20000:30000))fetchFollow(t);
    const list=f&&f.stops?f.stops.filter(e=>!e.arrives_at||e.arrives_at>nowMs-45000).slice(0,4):[];      // just the next 4
    if(list.length)upRows=`<div class="ups"><span class="kick2 uh">Next stops</span>`+list.map((e,i)=>{
      const rec=STN.get(e.next_sta_id),nm=rec?stnName(rec):shortName(e.station),tm=+e.arrives_at||0,m=tm?Math.round((tm-nowMs)/60000):null;
      const w=e.approaching||(m!=null&&m<=1)?"Due":m!=null?m+" min":"";
      return`<div class="row${e.scheduled?" pred":""}"><span class="kick2">${i===0?(e.approaching?"Arriving":"Next"):""}</span><span class="v">${esc(nm)}</span>`
        +`<span class="t"><b>${w}</b> ${tm?fmtClock(tm/1000):""}</span></div>`}).join("")+`</div>`}
  const headline=v.dest?`to ${esc(v.dest)}`:"Destination not known";
  const age=serverNow()-t.updated;
  const foot=mode==="sim"?`<span>Simulated train, not live data</span>`
    :t.held?`<span class="wn">Shown where it was ${ago(age)}: its newest report jumped somewhere it couldn't have reached, so it's being checked</span>`
    :t.stale?`<span class="wn">No new position for ${ago(age).replace(" ago","")}</span>`
    :t.L.sys==="metra"?(v.delayed?`<span class="wn">Running ${Math.round(v.delay/60)} min late, per Metra</span>`:`<span>GPS position from Metra, ${ago(age)}</span>`)
    :v.delayed?`<span class="wn">CTA reports a delay</span>`:`<span>Position from CTA's signals, ${ago(age)}</span>`;
  const sub=[trainLabel(t),r.branch].filter(Boolean).join(" · ");
  const keep=card.querySelector(".ups"),scroll=keep?keep.scrollTop:0;      // the card redraws every second: keep the list where you scrolled it
  card.innerHTML=
   `<div class="hd">${bullet(t.L.key)}<div><div class="ttl">${t.L.name}</div>${sub?`<div class="sub">${esc(sub)}</div>`:""}</div>`
   +`<button class="x" aria-label="Close train details">×</button></div>`
   +`<div class="dest"><b>${headline}</b></div>`
   +`<div class="rows">${nowRow}${upRows?"":nextRow}</div>${upRows}`
   +`<div class="ft">${foot}<button class="fl" aria-pressed="${riding(t)||(reduceMotion()&&following===t)}" title="Ride along behind this train">${riding(t)||(reduceMotion()&&following===t)?"Following":"Follow"}</button></div>`;
  const ups=card.querySelector(".ups");if(ups&&scroll)ups.scrollTop=scroll;
  card.querySelector(".x").onclick=closeCard;
  card.querySelector(".fl").onclick=()=>{if(riding(t))endChase(performance.now(),false);else if(reduceMotion()&&following===t){following=null;renderCard()}else rideAlong(t)};
}
function placeCard(){
  if(!selected)return;
  if(chase&&(chase.card||chase.manual)&&selected===chase.t&&(chase.phase==="in"||chase.phase==="ride")&&!isNarrow()){            // riding along: the train sits at the middle, 62% down
    const W=cw(),H=ch(),h=card.offsetHeight,I=uiInsets();
    card.style.transform=`translate(${Math.round(W/2+70)}px,${Math.round(Math.max(I.top,Math.min(H-I.bot-h-6,H*.62-h/2)))}px)`;return}
  const sx=cw()/vb.w,sy=ch()/vb.h;
  const px=(selected.shown[0]-vb.x)*sx,py=(selected.shown[1]-vb.y)*sy;
  const w=card.offsetWidth,h=card.offsetHeight,W=cw(),H=ch();
  let x=px+22,y=py-h/2;if(x+w>W-12)x=px-22-w;
  if(isNarrow()){card.style.transform="";return}          // phone: CSS docks it as a bottom sheet
  const I=uiInsets();x=Math.max(12,Math.min(W-w-12,x));y=Math.max(I.top,Math.min(H-I.bot-h-6,y));
  card.style.transform=`translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`}

