/* =====================================================================
   METRA DEPARTURE BOARDS — Ogilvie, Union Station, LaSalle St and Millennium (from MetraBot)
   Like the screen on the station wall: every train leaving in the next 3 hours from Metra's timetable
   (schedule.json, rebuilt nightly by tools/build_schedule.py), with a countdown. When Metra has a live
   prediction for that train, its time replaces the timetable one and the status says on time / late;
   otherwise it says Scheduled. A train past its time with no live news is gone from the board.
   ===================================================================== */
let TT=null,TT_BY={};
async function loadTimetable(){try{const r=await fetch("schedule.json",{cache:"no-cache"});if(!r.ok)return;const d=await r.json();
  if(!d||!Array.isArray(d.deps))return;TT=d;TT_BY={};for(const x of d.deps)(TT_BY[x[0]]||=[]).push(x);boardSig="";spopSig=""}catch(_){}}
const chiDate=ms=>{const p=chiParts(ms);return p.year+p.month+p.day};
const dayBaseM=new Map();
// GTFS times count from "noon minus 12 h" on the service date (and can run past 24:00)
function gtfsBase(date){let b=dayBaseM.get(date);if(b==null){const g=Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6,8),12),p=chiParts(g);
  const off=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(g/1000)*1000;b=Math.round((g-off)/1000)-12*3600;dayBaseM.set(date,b)}return b}
const hms=t=>{const[h,m,x]=t.split(":").map(Number);return h*3600+m*60+x};
// the train number inside a trip id: new format BNSF_1200_8_2009_... ; old format BNSF_BN1200_V4_A
const trainNoOf=tid=>{const s=String(tid||"");let m=/^[A-Z-]+_(\d+)_/.exec(s);if(m)return m[1];m=/_[A-Z]+(\d+)_V/.exec(s);return m?m[1]:""};
function departuresAt(rec,nowSec,n){
  const stop=rec.id;if(!TT||!TT_BY[stop])return null;
  const now=nowSec*1000,dates=[chiDate(now-24*3600e3),chiDate(now)],out=[];
  for(const[,t,tid,route,sid]of TT_BY[stop]){const days=TT.svc[sid];if(!days)continue;
    for(const d of dates){if(!days.includes(d))continue;const sched=gtfsBase(d)+hms(t);if(sched<nowSec-2*3600||sched>nowSec+3*3600)continue;
      const tr=mTripById.get(tid);
      if(sched<nowSec-90&&!tr)continue;                                       // past its time with no live news: gone
      const key=METRA_KEY[route];if(!key)continue;
      let pred=0,cx=false;
      if(tr){cx=!!tr.canceled;const x=(tr.stops||[]).find(q=>q.id===stop);if(x)pred=x.dep||x.arr||0}
      const tm=pred||sched;if(tm<nowSec-60)continue;                          // already gone
      const gps=trains.some(q=>q.cta&&q.cta.trip_id===tid&&!q.stale);
      const last=TT.trips[tid]?TT.trips[tid][0]:"";
      out.push({key,tm,sched,pred,cx,gps,no:trainNoOf(tid)||trainNo(tr&&tr.veh_label),dest:last?mStopName(last):""})}}
  return out.sort((a,b)=>a.tm-b.tm).slice(0,n)}
function depRow(a,nowSec){
  const late=a.pred?Math.round((a.pred-a.sched)/60):0;
  const st=a.cx?`<span class="st cx">Canceled</span>`:a.pred?(late>=2?`<span class="st late">${late} min late</span>`:`<span class="st ok">On time</span>`):`<span class="st">Scheduled</span>`;
  const m=Math.round((a.tm-nowSec)/60),cd=a.cx?"–":m<=0?"Now":m+" min";
  return`<div class="arr dep" title="${a.pred?"Metra's live prediction":"From Metra's timetable"}${a.gps?". Train is reporting GPS":""}">${bullet(a.key)}`
    +`<span class="to">${a.no?`<span class="no">${a.no}</span>`:""}to ${esc(a.dest||"?")}</span>`
    +`<span class="when"><b>${cd}</b>${fmtClock(a.tm)}${st}</span></div>`}
// a downtown terminal's sheet: its departure board instead of arrivals
function mBoardSections(rec,per){const nowSec=serverNow()/1000,b=departuresAt(rec,nowSec,per+3);
  if(!b)return{msg:"Getting Metra's timetable…"};
  if(!b.length)return{msg:"No Metra departures in the next 3 hours."};
  return{html:`<div class="sdir"><span class="kick2">Departures</span>${b.map(x=>depRow(x,nowSec)).join("")}</div>`,src:"board"}}
