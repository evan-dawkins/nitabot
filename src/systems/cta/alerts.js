function clearTrains(){closeCard();for(const t of[...trains])removeTrain(t,false)}
/* =====================================================================
   SERVICE ALERTS — straight from CTA's Customer Alerts feed via the Worker (L lines and stations only).
   An alert that's in the feed is active; one that's gone is over.
   Nothing here is inferred: lines come from the alert's own route list.
   If the Worker doesn't send alerts at all, the whole feature stays hidden.
   ===================================================================== */
let alerts=null,alertsErr="",seenAlertIds=null,openAlerts=new Set(),alertSig="";
const ROUTE_KEY=API_KEY;
const EFFECT={1:"No service",2:"Reduced service",3:"Significant delays",4:"Detour",5:"Added service",6:"Modified service",
  9:"Stop moved",11:"Accessibility"};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function takeAlerts(data){
  if(!("alerts" in data)&&!("alerts_error" in data)){alerts=null;renderAlerts();return}   // older Worker: no alerts feature
  alertsErr=data.alerts_error?String(data.alerts_error):"";
  if(Array.isArray(data.alerts)){
    const seen=new Set(),list=[];
    for(const a of data.alerts){if(!a||typeof a!=="object")continue;const id=String(a.id??(a.header||"")+(a.description||""));
      if(seen.has(id))continue;seen.add(id);
      const keys=[...new Set((Array.isArray(a.lines)?a.lines:[]).map(r=>ROUTE_KEY[r]).filter(Boolean))];
      const where=[...new Set((Array.isArray(a.stations)?a.stations:[]).map(s=>STN.get(String(s))).filter(Boolean).map(r=>r.label))].join(", ");
      list.push({id,keys,where,header:String(a.header||a.short||"").trim(),desc:String(a.description||a.short||"").trim(),
        url:/^https:\/\//i.test(a.url||"")?a.url:"",effect:String(a.impact||"").trim(),
        end:+a.end>0?Math.round(+a.end/1000):0})}
    // a gentle pulse on the button only when a genuinely new alert shows up after the first load
    if(seenAlertIds){for(const a of list)if(!seenAlertIds.has(a.id)){pulseAlerts();break}}
    seenAlertIds=new Set(list.map(a=>a.id));
    for(const id of[...openAlerts])if(!seenAlertIds.has(id))openAlerts.delete(id);
    alerts=list;
  }else if(!alerts)alerts=[];
  renderAlerts();
}
function pulseAlerts(){const b=$("abtn");b.classList.remove("fresh");void b.offsetWidth;b.classList.add("fresh")}
function visibleAlerts(){if(!alerts)return[];
  const list=focusKey?alerts.filter(a=>!a.keys.length||a.keys.includes(focusKey)):alerts.slice();
  // line-specific first in network order, system-wide notices last
  const rank=a=>a.keys.length?Math.min(...a.keys.map(k=>ORDER.indexOf(k))):99;
  return list.sort((a,b)=>rank(a)-rank(b))}
function fmtUntil(sec){const d=new Date(sec*1000);if(!isFinite(d))return"";
  const now=new Date(),same=d.toDateString()===now.toDateString();
  return"Until "+(same?d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit",timeZone:"America/Chicago"}):d.toLocaleDateString([],{month:"short",day:"numeric",timeZone:"America/Chicago"}))}
function renderAlerts(){
  const btn=$("abtn"),show=alerts!==null&&mode!=="sim";
  btn.classList.toggle("show",show);
  for(const k of ORDER)chips[k].classList.toggle("alerted",!!show&&alerts.some(a=>a.keys.includes(k)));
  if(!show){closeAlerts();return}
  const vis=visibleAlerts(),n=vis.length;
  btn.classList.toggle("has",n>0);
  $("acount").textContent=n?String(n):"";
  $("aword").textContent=n?(n===1?"alert":"alerts"):(alertsErr&&!alerts.length?"Alerts unavailable":"No alerts");
  btn.title=n?`${n} CTA service alert${n>1?"s":""}${focusKey?" for the "+LINES[focusKey].name:""}`:"No active CTA service alerts";
  const stale=alertsErr&&alerts.length;           // feed down: these are the last ones we saw, say so
  $("ascope").textContent=(focusKey?`${LINES[focusKey].code} and system-wide`:n?"All lines":"")+(stale?" · last known, feed not answering":"");
  if(stale)btn.title+=" (last known; alerts feed not answering)";
  const sig=JSON.stringify([vis.map(a=>a.id),focusKey,alertsErr,[...openAlerts]]);
  if(sig===alertSig)return;alertSig=sig;
  const L=$("alist");
  if(!n){L.innerHTML=`<div class="aempty">${alertsErr&&!alerts.length?"CTA's alerts feed isn't answering right now.":"No active alerts"+(focusKey?" for "+esc(LINES[focusKey].name):"")+"."}</div>`;return}
  L.innerHTML=vis.map(a=>{
    const bars=a.keys.length?a.keys.map(k=>`<i style="background:${LINES[k].color}"></i>`).join(""):`<i style="background:var(--faint)"></i>`;
    const tags=[a.keys.length?a.keys.map(k=>LINES[k].code).join(", "):a.where||"All lines"];
    const fx=a.effect?`<span class="fx">${esc(a.effect)}</span>`:"";
    const until=a.end?`<span>${esc(fmtUntil(a.end))}</span>`:"";
    const body=a.desc||a.url;
    const more=body?`<div class="more"><div>${esc(a.desc)}${a.url?`${a.desc?"\n\n":""}<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Details on transitchicago.com</a>`:""}</div></div>`:"";
    return`<div class="aitem${openAlerts.has(a.id)?" open":""}" data-id="${esc(a.id)}" ${body?'role="button" tabindex="0" aria-expanded="'+openAlerts.has(a.id)+'"':""}>`
      +`<span class="bars">${bars}</span><div><div class="tags"><span>${esc(tags[0])}</span>${fx}${until}${body?'<span class="chev" aria-hidden="true">▾</span>':""}</div>`
      +`<div class="h">${esc(a.header||a.desc.split("\n")[0])}</div>${more}</div></div>`}).join("");
}
function toggleAlertItem(it){const id=it.dataset.id;if(!it.querySelector(".more"))return;
  if(openAlerts.has(id))openAlerts.delete(id);else openAlerts.add(id);
  it.classList.toggle("open");it.setAttribute("aria-expanded",String(openAlerts.has(id)));alertSig=""}
function openAlertsPanel(){$("apanel").classList.add("on");$("abtn").setAttribute("aria-expanded","true");hideTip()}
function closeAlerts(){$("apanel").classList.remove("on");$("abtn").setAttribute("aria-expanded","false")}
$("abtn").onclick=e=>{e.stopPropagation();$("apanel").classList.contains("on")?closeAlerts():openAlertsPanel()};
$("aclose").onclick=closeAlerts;
$("alist").addEventListener("click",e=>{if(e.target.closest("a"))return;const it=e.target.closest(".aitem");if(it)toggleAlertItem(it)});
$("alist").addEventListener("keydown",e=>{if(e.key!=="Enter"&&e.key!==" ")return;const it=e.target.closest(".aitem");if(it){e.preventDefault();toggleAlertItem(it)}});
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
  clockOffset=0;ingest({lines:out});refreshStatus();
}
document.addEventListener("visibilitychange",()=>{
  if(document.hidden)return;
  lastFrame=performance.now();
  if(mode==="live"&&Date.now()-lastOkAt>POLL+5000)poll();
});


/* ---- status ---- */
function ago(ms){const s=Math.max(0,Math.round(ms/1000));if(s<5)return"just now";if(s<60)return s+" s ago";const m=Math.round(s/60);return m<60?m+" min ago":Math.round(m/60)+" h ago"}
function setState(cls,text){const s=$("state");s.className="state "+cls;$("stateText").textContent=text;
  document.body.classList.toggle("trouble",everLoaded&&mode!=="sim"&&(cls==="warn"||cls==="err"))}
function notice(html){const n=$("notice");
  if(html){if(n.dataset.h!==html){const i=html.indexOf('<div class="acts">');
      n.innerHTML=i<0?`<div class="msg">${html}</div>`:`<div class="msg">${html.slice(0,i)}</div>${html.slice(i)}`;n.dataset.h=html;labelsDirty=true}
    if(!n.classList.contains("on")){n.classList.add("on");labelsDirty=true}}
  else if(n.classList.contains("on")){n.classList.remove("on");n.dataset.h="";labelsDirty=true}}
$("notice").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  if(b.dataset.act==="sim")startSim();else if(b.dataset.act==="live")stopSim();else if(b.dataset.act==="retry")poll()});
const SIM_OFFER=`<div class="acts"><button class="go" data-act="sim">Show simulated trains</button><button data-act="retry">Try again</button></div>`;
function refreshStatus(){
  if(mode==="sim"){
    const vis=trains.filter(t=>!focusKey||t.L.key===focusKey);
    $("count").textContent=vis.length;for(const k of ORDER)$("n-"+k).textContent=trains.filter(t=>t.L.key===k).length;
    setState("sim","Simulated");$("updated").textContent="Not real positions";
    notice(liveBack?`The live feed is working again. <div class="acts"><button class="go" data-act="live">Switch to live</button></div>`
      :`Simulated trains, not real positions. <div class="acts"><button data-act="live">Try live</button></div>`);
    return}
  const vis=trains.filter(t=>!focusKey||t.L.key===focusKey),fresh=vis.filter(t=>!t.stale);
  $("count").textContent=everLoaded?fresh.length:"–";
  for(const k of ORDER){const n=trains.filter(t=>t.L.key===k&&!t.stale).length;$("n-"+k).textContent=everLoaded?n:""}
  const age=Date.now()-lastOkAt;
  if(!everLoaded){
    if(fails>0){setState("err","Offline");$("updated").textContent="No data received yet";
      notice(`Can't reach the live feed. <span>${lastError}. Trying again every 30 s.</span>${SIM_OFFER}`)}
    else{setState("busy","Connecting");$("updated").textContent="Waiting for first report";notice("")}
    return}
  $("updated").textContent="Updated "+ago(age);
  if(fails>=3||age>3*POLL){setState("err","Offline");
    notice(`Can't reach the live feed. <span>Last good data ${ago(age)}; trains shown at their last known positions. Retrying every 30 s.</span>${SIM_OFFER}`);return}
  if(fails>0||age>POLL*1.6){setState("warn","Delayed");notice("");return}
  if(!trains.length){setState("live","Live");notice(`No L trains are reporting right now. <span>Overnight only the Red and Blue Lines run. The map fills in as service starts.</span>`);return}
  if(trains.every(t=>t.stale)){setState("warn","Feed not moving");notice(`CTA's feed is answering, but no train has reported a new position recently.`);return}
  notice("");setState(inflight?"busy":"live","Live");
}
function tickHeader(){
  const now=new Date();$("clock").textContent=now.toLocaleTimeString([],{hour:"numeric",minute:"2-digit",second:"2-digit",timeZone:"America/Chicago"});$("clock").title="Chicago time";
  const left=Math.max(0,nextPollAt-Date.now());
  $("state").title=mode==="sim"?"Simulated trains, not real positions":
    (everLoaded?"Updated "+ago(Date.now()-lastOkAt)+". ":"")+(inflight?"Checking now.":nextPollAt?"Next check in about "+Math.max(5,Math.ceil(left/5000)*5)+" s.":"")
    +" CTA publishes new positions about every 30 seconds.";
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
   +`<div class="s">${nx?(v.approaching?"Arriving at ":"Next: ")+esc(nx.label):dirText(t)}${v.delayed?" · delayed":""}${t.stale?" · position out of date":""}</div>`;placeTip(e)}
function trainLabel(t){return t.run.sim?"Simulated "+t.run.no:t.run.no?"Run "+t.run.no:""}
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
function selectTrain(t){
  closeStationPop();closeBoardSheet();
  if(selected)selected.g.classList.remove("sel");
  selected=t;t.g.classList.add("sel");trainG.appendChild(t.g);
  following=t;card.classList.add("on");document.body.classList.add("sheet");renderCard();
  const r=cw()/ch(),tw=vb.w>FIT_W*0.2?Math.max(MIN_W,FIT_W/9):vb.w;    // zoom in to the neighbourhood only if we're far out
  flyTo({x:t.shown[0]-tw/2,y:t.shown[1]-(tw/r)/2,w:tw,h:tw/r});labelsDirty=true}
function stopFollowing(){if(!following)return;following=null;if(selected)renderCard()}
function closeCard(){if(chase&&(chase.manual||chase.card)&&selected===chase.t){if(!chase.manual)chase.stop=true;endChase(performance.now(),false)}   // back to the whole network
  if(selected)selected.g.classList.remove("sel");selected=null;following=null;card.classList.remove("on");document.body.classList.remove("sheet");labelsDirty=true}
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
  if(mode!=="sim"&&t.run&&t.run.no){const f=FOLLOW.get(t.id);
    if(!f||Date.now()-f.at>(f.err?20000:30000))fetchFollow(t);
    const list=f&&f.stops?f.stops.filter(e=>!e.arrives_at||e.arrives_at>nowMs-45000).slice(0,4):[];      // just the next 4
    if(list.length)upRows=`<div class="ups"><span class="kick2 uh">Next stops</span>`+list.map((e,i)=>{
      const rec=STN.get(e.next_sta_id),nm=rec?stnName(rec):shortName(e.station),tm=+e.arrives_at||0,m=tm?Math.round((tm-nowMs)/60000):null;
      const w=e.approaching||(m!=null&&m<=1)?"Due":m!=null?m+" min":"";
      return`<div class="row${e.scheduled?" pred":""}"><span class="kick2">${i===0?(e.approaching?"Arriving":"Next"):""}</span><span class="v">${esc(nm)}</span>`
        +`<span class="t"><b>${w}</b> ${tm?fmtClock(tm/1000):""}</span></div>`}).join("")+`</div>`}
  const headline=v.dest?`to ${esc(v.dest)}`:"Destination not known";
  const age=serverNow()-t.updated;
  const foot=mode==="sim"?`<span>Simulated train, not real</span>`:t.stale?`<span class="wn">No new position for ${ago(age).replace(" ago","")}</span>`
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

