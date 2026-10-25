
/* =====================================================================
   STATION TIMES
   Only CTA's own arrival predictions (Train Tracker, through the Worker), for the station you have open and
   the stations on your board, refreshed every 30 s while they're on screen. CTA marks a prediction
   "scheduled" when it comes from the timetable and no train is reporting for it yet: those are shown faded.
   ===================================================================== */
const stnName=rec=>rec.label;
function inkOn(hex){const h=hex.replace("#",""),v=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.03928?c/12.92:((c+.055)/1.055)**2.4);
  return .2126*v[0]+.7152*v[1]+.0722*v[2]>.38?"#0B1620":"#FFFFFF"}
const bullet=k=>`<span class="bullet" style="background:${LINES[k].color};color:${inkOn(LINES[k].color)}">${LINES[k].code}</span>`;
function feedHealthy(){return everLoaded&&Date.now()-lastOkAt<3*POLL}
const ARR=new Map();let arrBusy=false;                                  // station id -> {at, etas} or {at, err}
async function fetchArrivals(ids){arrBusy=true;
  try{for(let i=0;i<ids.length;i+=4){const chunk=ids.slice(i,i+4);         // CTA answers up to 4 stations per request
      try{const r=await fetch(WORKER_URL+"/cta/arrivals?mapid="+chunk.join(","),{cache:"no-store"});let d=null;try{d=await r.json()}catch(_){}
        for(const id of chunk){const s=d&&d.stations&&d.stations[id];
          ARR.set(id,s&&Array.isArray(s.etas)?{at:Date.now(),etas:s.etas}:{at:Date.now(),err:(s&&s.error)||(d&&d.error)||"No answer"})}}
      catch(e){for(const id of chunk)ARR.set(id,{at:Date.now(),err:"Network error"})}}}
  finally{arrBusy=false;spopSig="";boardSig="";if(spopRec)renderStationPop();renderBoard()}}
function arrivalsTick(){if(arrBusy||mode==="sim"||document.hidden)return;
  const want=new Set(FAV.ids);if(spopRec&&!spopRec.ats)want.add(spopRec.id);
  const due=[...want].filter(id=>/^4\d{4}$/.test(id)).filter(id=>{   // CTA stations only: Metra's times come with its feed
    const a=ARR.get(id);return!a||Date.now()-a.at>(a.err?15000:30000)});
  if(due.length)fetchArrivals(due)}
// CTA names each platform: "Service toward Howard", "Subway service toward O'Hare",
// "Service at Outer Loop platform", "Dempster-Skokie (Arrival)" (trains ending their run here)
function platformHead(p){const s=String(p||"").trim();let m;
  if((m=/service toward\s+(.+)$/i.exec(s)))return"Toward "+m[1].replace(/\s+Branch$/i,"");
  if((m=/^service at\s+(.+?)(\s+platform)?$/i.exec(s)))return m[1]+" platform";
  if(/\(arrival\)\s*$/i.test(s))return"Arriving here";
  return s||"Arriving"}
function etaWhen(e,nowMs){const m=e.arrives_at?Math.round((e.arrives_at-nowMs)/60000):null;
  return e.approaching||(m!=null&&m<=1)?"Due":m!=null?m+" min":""}
function etaRow(e,nowMs){const k=API_KEY[e.line]||METRA_KEY[e.line];if(!k)return"";
  const flag=e.delayed?`<span class="st late">Delayed</span>`:e.fault?`<span class="st cx">Not certain</span>`:"";
  return`<div class="arr${e.scheduled?" pred":""}" title="${e.scheduled?"Scheduled: no train is reporting for this one yet":"Live prediction from a train that's reporting"}">${bullet(k)}`
    +`<span class="to">${trainNo(e.run)?`<span class="no">${trainNo(e.run)}</span>`:""}to ${esc(e.dest||"?")}</span>`
    +`<span class="when"><b>${etaWhen(e,nowMs)}</b>${e.arrives_at?fmtClock(e.arrives_at/1000):""}${flag}</span></div>`}
function upcoming(rec){const a=ARR.get(rec.id),nowMs=serverNow();
  if(!a||a.err)return a;return{...a,etas:a.etas.filter(e=>!e.arrives_at||e.arrives_at>nowMs-45000)}}
function arrivalSections(rec,per){
  if(mode==="sim")return{msg:"Arrival times show for live trains only."};
  const a=upcoming(rec);
  if(!a)return{msg:"Getting arrival times…"};
  if(a.err)return{msg:"CTA's arrival times aren't answering right now."};
  if(a.metra&&!mTrips)return{msg:"Metra's predicted times aren't available right now."};
  if(!a.etas.length)return{msg:"No trains on the way right now."};
  const nowMs=serverNow(),groups=new Map();
  for(const e of a.etas){const h=platformHead(e.platform);if(!groups.has(h))groups.set(h,[]);groups.get(h).push(e)}
  let html="";for(const[h,es]of groups)html+=`<div class="sdir"><span class="kick2">${esc(h)}</span>${es.slice(0,per).map(e=>etaRow(e,nowMs)).join("")}</div>`;
  return{html,src:"pred"}}
function stationSchedule(rec,per){const r=arrivalSections(rec,per);
  if(r.msg)return`<div class="fav none" style="padding:0;border:0">${r.msg}</div>`;
  return r.html+(rec.sys==="metra"?`<div class="note">Minutes are Metra's live predictions. Faded = no train reporting its position for it yet.</div>`
    :`<div class="note">Minutes are CTA's live predictions. Faded = scheduled, no train reporting for it yet.</div>`)}
