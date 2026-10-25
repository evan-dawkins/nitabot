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
async function pollMetra(){clearTimeout(mTimer);
  if(mInflight)return;
  if(document.hidden&&mode==="live"&&!bgVoice()){mTimer=setTimeout(pollMetra,METRA_POLL);return}   // background tab: don't ask
  mInflight=true;const ac=new AbortController(),to=setTimeout(()=>ac.abort(),FETCH_TIMEOUT);
  try{const resp=await fetch(WORKER_URL+"/?trips=1",{cache:"no-store",signal:ac.signal});
    let data=null;try{data=await resp.json()}catch(_){}
    if(!data||typeof data!=="object")throw new Error(resp.ok?"Metra's relay sent something unreadable":"Metra's relay answered "+resp.status);
    if(data.metra_error)throw new Error("Metra's feed returned an error: "+data.metra_error);
    if(mode!=="sim"){mTakeTrips(data);ingest({lines:mReports(data)},METRA_ORDER);mEverLoaded=true;takeAlerts(data,"metra")}
    mFails=0;mLastOk=Date.now();mErr=""}
  catch(e){mFails++;mErr=e&&e.name==="AbortError"?"Metra's feed took too long to answer":(e&&e.message)||"Network error"}
  finally{clearTimeout(to);mInflight=false;mTimer=setTimeout(pollMetra,mFails?Math.min(METRA_POLL,10000*mFails):METRA_POLL);refreshStatus()}}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&Date.now()-mLastOk>METRA_POLL)pollMetra()});
