
/* =====================================================================
   FAVORITE STATIONS — click a station, ☆ to pin (up to 5).
   Saved in this browser only (localStorage key nitabot.favorites).
   ===================================================================== */
const FAV_KEY="nitabot.favorites",FAV_MAX=5;
const FAV=(()=>{try{const v=JSON.parse(localStorage.getItem(FAV_KEY)||"{}");return{ids:(Array.isArray(v.ids)?v.ids:[]).filter(id=>STN.has(id)).slice(0,FAV_MAX),min:!!v.min}}catch(_){return{ids:[],min:false}}})();
function saveFav(){try{localStorage.setItem(FAV_KEY,JSON.stringify(FAV))}catch(_){}}
const isFav=id=>FAV.ids.includes(id);
// stations saved on CTABot or MetraBot (same site address, so the same browser storage): offered once the board is empty
function oldFavs(){const out=[],get=k=>{try{const v=JSON.parse(localStorage.getItem(k)||"{}");return Array.isArray(v.ids)?v.ids:[]}catch(_){return[]}};
  for(const id of get("ctabot.favorites"))if(STN.has(id)&&!out.includes(id))out.push(id);
  for(const nm of get("metrabot.favorites")){const rec=STATIONS.find(r=>r.mb===nm);if(rec&&!out.includes(rec.id))out.push(rec.id)}   // MetraBot saved station names
  return out.slice(0,FAV_MAX)}
function toggleFav(rec){if(isFav(rec.id))FAV.ids=FAV.ids.filter(x=>x!==rec.id);else if(FAV.ids.length<FAV_MAX)FAV.ids.push(rec.id);else return;
  saveFav();boardSig="";renderBoard();renderStationPop();refit();arrivalsTick()}
function refit(){FIT_W=fitAll().w;syncZoom();labelsDirty=true}

/* ---- station popover ---- */
const spop=$("spop");let spopRec=null;
function openStationPop(rec){if(spopRec===rec){closeStationPop();return}
  hideTip();closeAlerts();closeBoardSheet();if(selected)closeCard();
  spopRec=rec;spop.classList.add("on");document.body.classList.add("pop");renderStationPop();placeStationPop();labelsDirty=true;arrivalsTick();atsOnStation(rec)}
function closeStationPop(){if(!spopRec)return;spopRec=null;spop.classList.remove("on");document.body.classList.remove("pop");labelsDirty=true}
let spopSig="";
function renderStationPop(){const rec=spopRec;if(!rec)return;
  if(rec.ats){const html=atsPopHTML(rec);if(html!==spopSig){spopSig=html;spop.innerHTML=html;labelsDirty=true;spop.querySelector(".x").onclick=closeStationPop}return}
  const lines=ORDER.filter(k=>rec.lines.has(k)),on=isFav(rec.id),full=!on&&FAV.ids.length>=FAV_MAX;   // CTA's full station name in the title
  const html=`<button class="x" aria-label="Close station">×</button><div class="nm">${esc(rec.full)}</div><div class="ln">${lines.map(bullet).join("")}</div>`
    +`<button class="star" aria-pressed="${on}" ${full?"disabled":""}>${on?"★ On your board":"☆ Add to your board"}</button>`
    +(full?`<div class="note">Your board holds ${FAV_MAX} stations. Remove one to add this.</div>`:on?`<div class="note">Click again to remove it.</div>`:"")
    +xferHTML(rec)+stationSchedule(rec,3);
  if(html===spopSig)return;spopSig=html;spop.innerHTML=html;labelsDirty=true;
  for(const b of spop.querySelectorAll(".xf button"))b.onclick=()=>{const r=STN.get(b.dataset.id);if(r){const z=Math.min(vb.w,FIT_W*.12),ra=cw()/ch();flyTo({x:r.xy[0]-z/2,y:r.xy[1]-z/ra/2,w:z,h:z/ra});openStationPop(r)}};
  spop.querySelector(".x").onclick=closeStationPop;spop.querySelector(".star").onclick=()=>toggleFav(rec)}
// transfers to the other system, from the checked list only
function xferHTML(rec){const xs=(XFER.get(rec.id)||[]).map(id=>STN.get(id)).filter(Boolean);if(!xs.length)return"";
  return`<div class="xf"><span class="kick2">${rec.sys==="metra"?"Transfer to the L":"Transfer to Metra"}</span>`
    +xs.map(r=>`<button data-id="${esc(r.id)}" title="Show ${esc(r.full)}">${ORDER.filter(k=>r.lines.has(k)).map(bullet).join("")}<span>${esc(r.label)}</span></button>`).join("")+`</div>`}
function placeStationPop(){if(!spopRec)return;if(isNarrow()){spop.style.transform="";return}
  const sx=cw()/vb.w,sy=ch()/vb.h,px=(spopRec.xy[0]-vb.x)*sx,py=(spopRec.xy[1]-vb.y)*sy,w=spop.offsetWidth,h=spop.offsetHeight,W=cw(),H=ch(),I=uiInsets();
  let x=px+18,y=py-24;if(x+w>W-12)x=px-18-w;if(ATS&&spopRec.id===ATS.hub&&atsAlpha>.5)x=12;   // at the airport: out of the way, on the leftx=Math.max(12,Math.min(W-w-12,x));y=Math.max(I.top,Math.min(H-I.bot-h-6,y));
  const tf=`translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`;if(tf!==spop.style.transform){spop.style.transform=tf;labelsDirty=true}}
spop.addEventListener("pointerdown",e=>e.stopPropagation());
for(const q of document.querySelectorAll(".pnl"))q.addEventListener("transitionend",e=>{if(e.target===q&&(e.propertyName==="scale"||e.propertyName==="translate"))labelsDirty=true});   // re-place labels once a panel settles

/* ---- the board ---- */
const board=$("board"),fstrip=$("fstrip");let boardSig="";
function closeBoardSheet(){if(document.body.classList.contains("boardsheet")){document.body.classList.remove("boardsheet");labelsDirty=true}}
function boardRows(rec){return arrivalSections(rec,2)}
function renderBoard(){
  const favs=FAV.ids.map(id=>STN.get(id)).filter(Boolean),narrow=isNarrow();
  document.body.classList.toggle("hasfav",favs.length>0);
  if(!board.classList.contains("fly"))board.classList.toggle("min",FAV.min&&!narrow);
  document.body.classList.toggle("favmin",FAV.min&&!narrow);
  let src="",body;
  if(!favs.length){const old=oldFavs();body=`<p class="bmsg">Click any station on the map, then ☆, to pin it here. Up to ${FAV_MAX}.</p>`
    +(old.length?`<p class="bmsg"><button class="imp">Bring in ${old.length===1?"your station":"your "+old.length+" stations"} from CTABot and MetraBot</button></p>`:"")}
  else body=favs.map(rec=>{const r=boardRows(rec);if(r.src)src=src||r.src;
    return`<div class="fav" data-id="${esc(rec.id)}"><div class="fn"><button class="go" title="Show ${esc(rec.full)} on the map">${esc(rec.label)}</button>`
      +`<button class="rm" aria-label="Remove ${esc(rec.full)} from your board" title="Remove">×</button></div>`
      +(r.html||`<div class="none">${r.msg}</div>`)+`</div>`}).join("");
  const foot=!favs.length?"":mode==="sim"?"Simulated trains, not real.":src==="pred"?"Times are CTA's live predictions. Faded = scheduled, no train reporting for it yet.":"";
  const html=`<div class="bh"><span class="kick2">★ Your stations</span>${favs.length?`<span class="cnt">${favs.length}/${FAV_MAX}</span>`:""}`
    +(mode==="sim"?`<span class="simtag">Simulated</span>`:"")
    +`<button class="col" aria-label="${narrow?"Close your stations":"Tuck your stations into the ★ button"}" title="${narrow?"Close":"Tuck into ★"}">${narrow?"×":"▴"}</button></div>`
    +`<div class="bl">${body}</div>${foot?`<div class="bf">${foot}</div>`:""}`;
  if(html===boardSig)return;boardSig=html;board.innerHTML=html;labelsDirty=true;
}
board.addEventListener("pointerdown",e=>e.stopPropagation());
board.addEventListener("click",e=>{
  if(e.target.closest(".imp")){FAV.ids=oldFavs();saveFav();boardSig="";renderBoard();refit();arrivalsTick();return}   // copies only: CTABot's and MetraBot's own lists stay as they are
  if(e.target.closest(".col")){if(isNarrow()){closeBoardSheet();return}setBoardMin(true);return}
  const f=e.target.closest(".fav");if(!f)return;const rec=STN.get(f.dataset.id);if(!rec)return;
  if(e.target.closest(".rm")){toggleFav(rec);return}
  if(e.target.closest(".go")){closeBoardSheet();const z=Math.min(vb.w,FIT_W*.45),r=cw()/ch();stopFollowing();
    flyTo({x:rec.xy[0]-z/2,y:rec.xy[1]-z/r/2,w:z,h:z/r});setTimeout(()=>openStationPop(rec),reduceMotion()?0:680)}});
/* desktop: the board tucks into the ★ next to the title, and grows back out of it */
const favBtn=$("favBtn");
function boardAtStar(){return"scale(.86)"}   // shrink into its own top corner
let boardAnim=0;
function setBoardMin(min){clearTimeout(boardAnim);
  if(min===FAV.min&&!board.classList.contains("fly"))return;
  FAV.min=min;saveFav();boardSig="";
  if(reduceMotion()){board.classList.remove("fly");renderBoard();refit();if(min)favBtn.focus({preventScroll:true});return}
  if(min){document.body.classList.add("favmin");board.classList.add("fly");board.style.transform=boardAtStar();board.style.opacity="0";
    favBtn.classList.add("catch");setTimeout(()=>favBtn.classList.remove("catch"),900);
    boardAnim=setTimeout(()=>{board.classList.remove("fly");board.style.transform=board.style.opacity="";renderBoard();refit()},330)}
  else{board.classList.remove("min");renderBoard();board.style.transform=boardAtStar();board.style.opacity="0";void board.offsetWidth;
    board.classList.add("fly");requestAnimationFrame(()=>{board.style.transform="";board.style.opacity=""});
    boardAnim=setTimeout(()=>{board.classList.remove("fly");refit()},350)}
}
favBtn.onclick=e=>{e.stopPropagation();if(isNarrow()){closeStationPop();if(selected)closeCard();document.body.classList.add("boardsheet");boardSig="";renderBoard();return}setBoardMin(!FAV.min)};

/* phone: one favorite at a time on a strip; tap for the whole board */
let stripIdx=0,stripT=0;
function tickStrip(){if(!isNarrow())return;const favs=FAV.ids.map(id=>STN.get(id)).filter(Boolean);if(!favs.length)return;
  if(++stripT>=8){stripT=0;stripIdx++}const rec=favs[stripIdx%favs.length],a=upcoming(rec),nowMs=serverNow();let info="";
  if(mode==="sim")info="Arrival times show for live trains only";
  else if(!a)info="Getting arrival times…";else if(a.err)info="Arrival times aren't answering";
  else{const e=a.etas[0],k=e&&API_KEY[e.line];info=e&&k?`<b>${etaWhen(e,nowMs)}</b> · ${LINES[k].code} to ${esc(e.dest||"")}`:"No trains on the way"}
  const html=`<span class="s">★ ${esc(rec.label)}</span><span class="i">${info}</span>${favs.length>1?`<span class="n">${stripIdx%favs.length+1}/${favs.length}</span>`:""}`;
  if(fstrip.dataset.h!==html){const first=!fstrip.dataset.h;fstrip.dataset.h=html;
    if(first||reduceMotion()){fstrip.innerHTML=html;return}
    fstrip.classList.add("swap");setTimeout(()=>{fstrip.innerHTML=fstrip.dataset.h;fstrip.classList.remove("swap")},200)}}
fstrip.addEventListener("pointerdown",e=>e.stopPropagation());
fstrip.onclick=()=>{closeStationPop();if(selected)closeCard();document.body.classList.add("boardsheet");boardSig="";renderBoard()};

/* ---- ambient: after 10 s with no input, the controls step back ---- */
let lastInput=Date.now();
for(const ev of["pointermove","pointerdown","keydown","wheel","touchstart"])addEventListener(ev,()=>{lastInput=Date.now();
  if(document.body.classList.contains("idle"))document.body.classList.remove("idle")},{passive:true,capture:true});
function tickIdle(){const busy=introOpen||$("apanel").classList.contains("on")||sndMenu.classList.contains("on")||spopRec||document.body.classList.contains("boardsheet");
  document.body.classList.toggle("idle",!busy&&Date.now()-lastInput>10000)}
renderBoard();

/* ---- the line under the title: what the L is doing right now (Chicago time) ----
   A new line every 10 minutes, drifting across the top bar like a calm ticker. Two kinds take turns:
   numbers read live off the map (how many trains, which line has the most, trains around the Loop...) and lines
   about the time of day that are true by CTA's schedule (Purple Line Express runs only at weekday rush;
   the Red and Blue Lines run all night). Delays CTA reports always come first. Nothing here is guessed. */
const MOOD_WEEKDAY=[
  [240,330,["The first trains of the morning are rolling out.", "Most lines are making their first runs of the day.", "Early trains, quiet platforms.", "The Red and Blue Lines ran all night. Everything else is waking up."]],
  [330,420,["The morning rush is building.", "More trains joining the map every few minutes.", "Commuters are starting to head downtown.", "Purple Line Express is starting its morning runs."]],
  [420,570,["Rush hour: Purple Line Express is running to the Loop.", "Brown Line trains are lining up into the Loop.", "Rush hour: trains every few minutes on the Red and Blue.", "Morning rush. Packed trains headed downtown.", "The busiest part of the morning on the L."]],
  [570,630,["The morning rush is easing off.", "Purple Line Express is wrapping up for the morning.", "Fewer trains now as the rush winds down."]],
  [630,870,["Purple Line is shuttling between Linden and Howard.", "A calmer stretch between the rushes.", "Midday on the L. Easier to find a seat.", "Steady trains in both directions."]],
  [870,960,["The evening rush is starting to build.", "Purple Line Express is starting its evening runs.", "People are starting to head home."]],
  [960,1110,["Purple Line Express is heading back to Evanston.", "Loop trains are circling and heading home.", "Evening rush. Crowded trains leaving the Loop.", "Rush hour: trains every few minutes on the Red and Blue."]],
  [1110,1170,["The evening rush is winding down.", "Fewer trains now as the rush fades.", "The last Purple Line Express runs are heading out."]],
  [1170,1380,["A quieter evening on the L.", "Longer gaps between trains tonight.", "Purple Line is back to Linden–Howard shuttles.", "Evening trains, easy rides home."]],
  [1380,1470,["Most lines are wrapping up for the night.", "The last trains on several lines are heading out.", "Owl service soon: only the Red and Blue Lines run all night."]]];   // [from, to) in minutes after midnight
const MOOD_WEEKEND=[
  [240,540,["Weekend morning on the L.", "A slow weekend start.", "Purple Line is shuttling between Linden and Howard.", "Weekend trains are getting going."]],
  [540,1080,["Weekend service on the L.", "A good day for a trip downtown.", "Weekend trains, roomier rides.", "Purple Line is shuttling between Linden and Howard."]],
  [1080,1380,["A weekend evening on the L.", "Trains heading in for the night out.", "Evening trains, lighter service."]],
  [1380,1470,["Late weekend night. Most lines wrap up soon.", "Owl service soon: only the Red and Blue Lines run all night.", "The last trains on several lines are heading out."]]];
const MOOD_NIGHT=["Owl service: only the Red and Blue Lines run all night.", "Overnight on the L: the Red and Blue are still running.", "Everything else is parked until morning.", "A quiet night on the L."];
const moodEl=$("mood"),moodPick={},dayFmt=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",weekday:"short"});
let moodText="";
const chiFmt=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
function chiParts(ms){const p={};for(const x of chiFmt.formatToParts(new Date(ms)))p[x.type]=x.value;return p}
const SIT={
  nothing:["No trains reporting right now.","Quiet tracks until the first trains.","Most lines are parked for the night."],
  late:["Delays on several lines right now.","CTA is reporting delays across the system.","A slow stretch. Several lines are running late."],
  line:["Delays on the {L} right now.","The {L} is running behind. Other lines look normal.","Heads up: CTA reports delays on the {L}."]};
const LOOP_C=(()=>{const c=geo(41.8818,-87.6298),e=geo(41.8818,-87.6250);return{c,r:Math.hypot(e[0]-c[0],e[1]-c[1])*1.25}})();
let moodSit={key:"",why:""},sitCache=null,sitAt=0,statSlot=-1,statLines=null;
// numbers straight off the live map, worked out once per 10-minute slot so the line doesn't flicker
function liveStats(live,mlive=[]){
  const by={};for(const t of live)by[t.L.key]=(by[t.L.key]||0)+1;
  const top=ORDER.filter(k=>by[k]).sort((a,b)=>by[b]-by[a])[0];
  const loop=live.filter(t=>Math.hypot(t.shown[0]-LOOP_C.c[0],t.shown[1]-LOOP_C.c[1])<LOOP_C.r).length;
  const ohare=live.filter(t=>t.L.key==="blue"&&t.cta&&/o'?hare/i.test(t.cta.dest||"")).length;
  const out=[`${live.length} trains on the L right now.`];
  if(top&&by[top]>=3)out.push(`The ${LINES[top].name} has the most trains out: ${by[top]}.`);
  if(loop>=12)out.push(`A busy moment in the Loop: ${loop} trains circling it.`);else if(loop>=4)out.push(`${loop} trains around the Loop right now.`);
  if(ohare>=2)out.push(`${ohare} Blue Line trains heading to O'Hare.`);
  // Metra, from its own feed: how many are out, the busiest line, and how many are 6+ minutes late (Metra's on-time line)
  if(mEverLoaded&&Date.now()-mLastOk<3*METRA_POLL&&mlive.length){
    const mb={};for(const t of mlive)mb[t.L.key]=(mb[t.L.key]||0)+1;
    const mtop=METRA_ORDER.filter(k=>mb[k]).sort((a,b)=>mb[b]-mb[a])[0];
    const late=mlive.filter(t=>t.cta&&t.cta.delay>=360).length;
    out.push(mlive.length===1?"One Metra train out across the region.":`${mlive.length} Metra trains out across the region.`);
    if(mtop&&mb[mtop]>=3)out.push(`Metra's ${LINES[mtop].name} has the most trains out: ${mb[mtop]}.`);
    out.push(late===0?"Every Metra train reporting is within 6 minutes of its time.":late===1?"One Metra train is running 6 or more minutes late.":`${late} Metra trains are running 6 or more minutes late.`)}
  return out}
function liveSituation(now){
  if(mode==="sim"||!feedHealthy())return null;
  const hr=+chiParts(now).hour,live=trains.filter(t=>!t.stale&&t.L.sys!=="metra"),N=live.length;   // the delay phrases are about the L (CTA's delay flag)
  const mlive=trains.filter(t=>!t.stale&&t.L.sys==="metra");
  if(N===0)return hr>=1&&hr<5?{key:"nothing"}:null;                    // no trains in the day: don't trust it, use the clock
  // 1. delays CTA reports
  const dl=live.filter(t=>t.cta&&t.cta.delayed);
  if(N>=20&&dl.length/N>=.25)return{key:"late"};
  const by={};for(const t of dl)by[t.L.key]=(by[t.L.key]||0)+1;let worst=null;
  for(const k in by){const tot=live.filter(t=>t.L.key===k).length;if(by[k]>=3&&by[k]/tot>=.3&&(!worst||by[k]>by[worst]))worst=k}
  if(worst)return{key:"line",line:LINES[worst].name};
  // 2. every other 10 minutes: what the live map shows
  const slot=Math.floor(now/600e3);if(slot%2)return null;
  if(slot!==statSlot||!statLines){statSlot=slot;statLines=liveStats(live,mlive)}
  return{key:"stats"+slot,lines:statLines}}
function tickMood(){
  const now=window.__moodNow||Date.now();if(now-sitAt>30e3||sitAt>now||window.__moodNow){sitCache=liveSituation(now);sitAt=now}const sit=sitCache;let key,lines;   // re-read the trains every 30 s
  if(sit){key="s:"+sit.key+(sit.line||"");lines=sit.lines||SIT[sit.key].map(x=>x.replaceAll("{L}",sit.line||""));moodSit=sit}
  else{const p=chiParts(now);let m=+p.hour*60+ +p.minute;
    // after midnight still counts as the night before until 12:30 AM
    const late=m<30,wd=dayFmt.format(new Date(late?now-3600e3:now)),weekend=wd==="Sat"||wd==="Sun";if(late)m+=1440;
    key="night";lines=MOOD_NIGHT;moodSit={key:"clock"};
    for(const[a,b,l]of weekend?MOOD_WEEKEND:MOOD_WEEKDAY)if(m>=a&&m<b){key=(weekend?"we":"wd")+a;lines=l;break}}
  if(!(key in moodPick)){const order=lines.map((_,i)=>i);for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]]}
    moodPick[key]={order,i:0,at:now}}
  const P=moodPick[key];if(now-P.at>=600e3){P.i=(P.i+1)%P.order.length;P.at=now}     // a new line every 10 minutes (or right away when the situation changes)
  const t=lines[P.order[P.i]];if(t===moodText)return;
  const first=!moodText;moodText=t;
  if(first){moodTxt.textContent=t;moodX=null;return}
  moodEl.classList.add("swap");setTimeout(()=>{moodTxt.textContent=moodText;moodX=null;moodEl.classList.remove("swap")},800)}
// a slow ticker: the line drifts right to left across the empty part of the top bar, then comes around again
const moodTxt=moodEl.querySelector(".mt"),MOOD_SPEED=26;   // pixels per second; longer lines move a little faster
let moodX=null;
function moodFrame(dt){
  const W=moodEl.clientWidth,w=moodTxt.offsetWidth;if(!W)return;
  if(reduceMotion()){moodTxt.style.transform=`translateX(${Math.max(0,(W-w)/2)}px)`;return}   // no motion: sits still
  if(moodX==null)moodX=W*.55;
  moodX-=MOOD_SPEED*Math.max(1,Math.min(1.7,w/420))*dt;if(moodX<-w)moodX=W;
  moodTxt.style.transform=`translateX(${moodX.toFixed(1)}px)`}
tickMood();
