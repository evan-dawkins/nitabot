/* =====================================================================
   METRA FEED — Metra's live GPS positions and trip predictions, through the same Worker MetraBot uses
   (/?trips=1, every 30 s; paused while the tab is hidden, like the CTA feed).
   Each Metra train is turned into the same shape as a CTA report, so the train model, cards, tooltips and
   train of the moment treat both systems alike:
     uid          Metra's vehicle id (stable while the train runs)
     run          the train number Metra shows (e.g. 2216)
     dest         the station the trip ends at, from Metra's own trip predictions
     next_sta_id  the next stop the trip still has ahead, from those predictions; it picks the direction
     arrives_at   Metra's predicted time there
   Positions are Metra's GPS. Nothing is placed where Metra didn't report it.
   ===================================================================== */
const METRA_POLL=30000;
let mTrips=null,mTripById=new Map(),mLastOk=0,mFails=0,mErr="",mInflight=false,mTimer=0,mEverLoaded=false;
const mStopName=id=>{const r=STN.get(id);return r?r.label:id};
// the first stop a trip still has ahead (Metra lists every stop with a predicted time; past ones drop off)
function mNextStop(tr,nowSec){if(!tr||!Array.isArray(tr.stops))return null;
  for(const x of tr.stops){const tm=x.arr||x.dep;if(tm&&tm>=nowSec-30)return x}return null}
function mTakeTrips(data){
  mTrips=Array.isArray(data.trips)?data.trips:null;mTripById=new Map();
  if(mTrips)for(const tr of mTrips)if(tr&&tr.trip_id)mTripById.set(tr.trip_id,tr);
  mStationTimes()}
// Metra GPS reports -> the CTA-shaped reports ingest() reads
function mReports(data){const out={},nowSec=Math.floor(serverNow()/1000);
  for(const key of METRA_ORDER){const L=LINES[key],vs=data.metra_lines&&Array.isArray(data.metra_lines[L.api])?data.metra_lines[L.api]:[];
    out[L.api]=vs.filter(v=>v&&v.vehicle_id!=null).map(v=>{const tr=mTripById.get(v.trip_id),nx=mNextStop(tr,nowSec);
      const last=tr&&(tr.last_stop||(tr.stops&&tr.stops.length?tr.stops[tr.stops.length-1].id:""));
      return{uid:String(v.vehicle_id),run:trainNo(v.veh_label),lat:v.latitude,lon:v.longitude,predicted_at:v.updated_at,
        dest:last?mStopName(last):"",dest_id:last||"",next_sta_id:nx?nx.id:"",next_sta:nx?mStopName(nx.id):"",
        arrives_at:nx&&(nx.arr||nx.dep)?(nx.arr||nx.dep)*1000:null,delay:nx&&nx.delay!=null?nx.delay:null,
        delayed:!!(nx&&nx.delay>=360),approaching:false,scheduled:false,fault:false,trip_id:v.trip_id||"",metra:true}})}
  return out}
// predicted arrivals at every Metra station, in the same shape as CTA's (ARR), for station sheets and the board
const M_DOWNTOWN=new Set(["OTC","CUS","LSS","MILLENNIUM"]);
function mStationTimes(){if(!mTrips)return;const nowSec=Math.floor(serverNow()/1000),by=new Map(),at=Date.now();
  for(const tr of mTrips){if(!tr||tr.canceled||!Array.isArray(tr.stops))continue;const key=METRA_KEY[tr.route_id];if(!key)continue;
    const last=tr.last_stop||(tr.stops.length?tr.stops[tr.stops.length-1].id:""),inb=M_DOWNTOWN.has(last);
    const live=trains.some(t=>t.cta&&t.cta.trip_id===tr.trip_id&&!t.stale);
    tr.stops.forEach((x,i)=>{const tm=x.arr||x.dep;if(!tm||tm<nowSec-30||i===tr.stops.length-1)return;   // a train ending here isn't one to catch
      (by.get(x.id)||by.set(x.id,[]).get(x.id)).push({line:tr.route_id,run:trainNo(tr.veh_label),dest:mStopName(last),
        arrives_at:tm*1000,delayed:x.delay>=360,scheduled:!live,approaching:false,fault:false,
        platform:inb?"Service toward downtown Chicago":"Service away from downtown"})})}
  for(const rec of STATIONS){if(rec.sys!=="metra")continue;
    const e=(by.get(rec.id)||[]).sort((a,b)=>a.arrives_at-b.arrives_at);ARR.set(rec.id,{at,etas:e,metra:true})}}
/* ---- Metra feed health ----
   Every answer is sorted into one of these, from what it actually contains:
     ok         readable, with train positions whose own GPS times are recent
     empty      readable, but no train positions at all (normal overnight; not counted as a failure)
     stale      readable, but even the newest position is over 3 minutes older than the Worker's own clock
                (Metra's feed has stopped moving, or an old copy is being passed on)
     metra      the Worker answered, but says Metra's own feed failed (metra_error)
     http / unreadable / timeout / network   the Worker didn't give a usable answer
   ok and empty count as a usable update. Two stages when updates stop:
     1. at the first missed update: a small "Metra" mark by the status, with when it was missed (nothing louder:
        one miss is usually a blip, and the next try is 10 s later)
     2. once there's been no usable update for 90 s (3 regular polls) and at least 2 misses in a row: a banner
        that stays until Metra answers properly again, saying how long it's been. CTA's status is separate.
   Why 90 s: Metra publishes positions about every 30 s, the Worker keeps a copy for 25 s, and NITABot asks every
   30 s (sooner after a miss: 10, 20, 30 s). A healthy feed is never 90 s old; one or two blips never reach it. */
const M_ESCALATE=90000,M_UPSTREAM_STALE=180000;
const MH={kind:"",fails:0,lastUsable:0,lastTry:0,firstMissAt:0,lastMissAt:0,newestFix:0,vehicles:0,detail:""};
function mClassify(resp,data){
  if(!data||typeof data!=="object")return{kind:resp&&!resp.ok?"http":"unreadable",detail:resp&&!resp.ok?"NITABot's data server had a problem (error "+resp.status+")":"the data couldn't be read"};
  if(data.metra_error)return{kind:"metra",detail:"Metra's feed: "+String(data.metra_error).slice(0,120)};
  if(!data.metra_lines||typeof data.metra_lines!=="object")return{kind:resp&&!resp.ok?"http":"unreadable",detail:resp&&!resp.ok?"NITABot's data server had a problem (error "+resp.status+")":"no train positions came back"};
  let n=0,newest=0;for(const k in data.metra_lines){const vs=data.metra_lines[k];if(!Array.isArray(vs))continue;
    for(const v of vs){if(!v||v.latitude==null)continue;n++;const f=+v.updated_at||0;if(f>newest)newest=f}}
  const at=+data.fetched_at>0?+data.fetched_at:Date.now();
  if(!n)return{kind:"empty",vehicles:0,detail:"no Metra trains reporting"};
  if(newest&&at-newest*1000>M_UPSTREAM_STALE)return{kind:"stale",vehicles:n,newest:newest*1000,detail:"newest position is "+ago(at-newest*1000).replace(" ago","")+" old"};
  return{kind:"ok",vehicles:n,newest:newest*1000}}
// what the page says about Metra right now: "ok" | "empty" | "missed" (stage 1) | "down" (stage 2) | "waiting"
function metraHealth(){if(mode==="sim")return"ok";
  const usable=MH.kind==="ok"||MH.kind==="empty";
  if(!MH.lastTry)return"waiting";
  if(usable)return MH.kind;
  const since=Date.now()-(MH.lastUsable||MH.firstMissAt);
  return since>=M_ESCALATE&&MH.fails>=2?"down":"missed"}
async function pollMetra(){clearTimeout(mTimer);
  if(mInflight)return;
  if(document.hidden&&mode==="live"&&!bgVoice()){mTimer=setTimeout(pollMetra,METRA_POLL);return}   // background tab: don't ask
  mInflight=true;const ac=new AbortController(),to=setTimeout(()=>ac.abort(),FETCH_TIMEOUT);let c;
  try{const resp=await fetch(WORKER_URL+"/?trips=1",{cache:"no-store",signal:ac.signal});
    let data=null;try{data=await resp.json()}catch(_){}
    c=mClassify(resp,data);
    if(data&&typeof data==="object"&&mode!=="sim"){
      if("alerts" in data||"alerts_error" in data)takeAlerts(data,"metra");     // alerts are their own part of the answer
      if(c.kind==="ok"||c.kind==="empty"||c.kind==="stale"){mTakeTrips(data);ingest({lines:mReports(data)},METRA_ORDER);mEverLoaded=true}}}
  catch(e){c={kind:e&&e.name==="AbortError"?"timeout":"network",detail:e&&e.name==="AbortError"?"no answer within 15 s":(e&&e.message)||"network error"}}
  finally{clearTimeout(to);mInflight=false;const now=Date.now();MH.lastTry=now;
    MH.kind=c.kind;MH.detail=c.detail||"";if(c.vehicles!=null)MH.vehicles=c.vehicles;if(c.newest)MH.newestFix=c.newest;
    if(c.kind==="ok"||c.kind==="empty"){MH.fails=0;MH.lastUsable=now;MH.firstMissAt=0;mFails=0;mLastOk=now;mErr=""}
    else{MH.fails++;MH.lastMissAt=now;if(!MH.firstMissAt)MH.firstMissAt=now;mFails=MH.fails;mErr=MH.detail}
    mTimer=setTimeout(pollMetra,MH.fails?Math.min(METRA_POLL,10000*MH.fails):METRA_POLL);refreshStatus()}}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&Date.now()-mLastOk>METRA_POLL)pollMetra()});
