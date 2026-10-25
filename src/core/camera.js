
/* =====================================================================
   CAMERA
   ===================================================================== */
let vb={x:0,y:0,w:1200,h:800},camAnim=null,following=null,selected=null,drag=null,focusKey=null;
// the map's size in pixels, kept up to date by a ResizeObserver (reading clientWidth every call forced a layout
// many times per frame while dragging)
let CWv=0,CHv=0;
const cw=()=>CWv||svg.clientWidth||window.innerWidth||1440, ch=()=>CHv||svg.clientHeight||window.innerHeight||900;
try{new ResizeObserver(es=>{for(const e of es){CWv=Math.round(e.contentRect.width);CHv=Math.round(e.contentRect.height)}}).observe(svg)}catch(_){}
const isNarrow=()=>cw()<=760||ch()<=500;
const sideSheet=()=>isNarrow()&&cw()>ch()&&ch()<=500;     // phone on its side: panels dock to the left instead of the bottom
const svgRect=()=>({left:0,top:0,right:cw(),bottom:ch(),width:cw(),height:ch()});   // #map fills the window; ignores the screensaver tilt
function uiInsets(){const sr=svgRect(),top=document.querySelector(".top").getBoundingClientRect();
  let bot=0;for(const q of[$("console"),document.querySelector(".zoom"),$("fstrip")]){const r=q.getBoundingClientRect();if(r.height)bot=Math.max(bot,sr.bottom-r.top)}
  let right=0;const bd=$("board");if(!isNarrow()&&bd.offsetHeight&&!bd.classList.contains("min"))right=sr.right-bd.getBoundingClientRect().left+4;
  return{top:Math.max(40,top.bottom-sr.top),bot:Math.max(40,bot),right}}
function fitBox(b){const W=cw(),H=ch(),I=uiInsets(),TOP_UI=I.top,BOT_UI=I.bot,side=isNarrow()?12:40,availH=H-TOP_UI-BOT_UI-16,availW=W-side-I.right;
  const s=Math.min(availW/(b.x1-b.x0),availH/(b.y1-b.y0));
  const w=W/s,h=H/s,cx=(b.x0+b.x1)/2,cyScreen=TOP_UI+8+availH/2,cxScreen=(W-I.right)/2;
  return{x:cx-cxScreen/s,y:(b.y0+b.y1)/2-cyScreen/s,w,h}}
const fitAll=()=>fitBox(HOME);                       // the home view (Chicago); sizes, labels and zoom steps are tuned to it
let FIT_W=1200;
function maxW(){return Math.max(FIT_W,fitBox(WORLD).w)*1.12} const MIN_W=10;   // fully out: all of Metra; fully in: the Loop fills the screen
function clampVB(){const cx=vb.x+vb.w/2,cy=vb.y+vb.h/2;
  const nx=Math.max(WORLD.x0,Math.min(WORLD.x1,cx)),ny=Math.max(WORLD.y0,Math.min(WORLD.y1,cy));
  vb.x+=nx-cx;vb.y+=ny-cy}
function applyVB(){svg.setAttribute("viewBox",`${vb.x} ${vb.y} ${vb.w} ${vb.h}`)}
function flyTo(t,ms=650){if(reduceMotion()){camAnim=null;Object.assign(vb,t);syncZoom();return}const f={...vb},t0=performance.now();
  camAnim=now=>{const k=Math.min(1,(now-t0)/ms),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
    for(const q of["x","y","w","h"])vb[q]=f[q]+(t[q]-f[q])*e;if(k>=1){camAnim=null;syncZoom()}}}
function zoomAround(f,mx,my){if(chase&&(chase.phase==="in"||chase.phase==="ride")){chase.zf=Math.max(.3,Math.min(6,(chase.zf||1)*f));return}camAnim=null;
  const nw=Math.max(MIN_W,Math.min(maxW(),vb.w*f)),k=nw/vb.w;
  vb.x=mx-(mx-vb.x)*k;vb.y=my-(my-vb.y)*k;vb.w=nw;vb.h*=k;clampVB();syncZoom()}
function zoomBy(f){if(chase&&(chase.phase==="in"||chase.phase==="ride")){chase.zf=Math.max(.3,Math.min(6,(chase.zf||1)*f));return}const t={...vb},nw=Math.max(MIN_W,Math.min(maxW(),vb.w*f)),k=nw/vb.w;
  const mx=following?following.shown[0]:vb.x+vb.w/2,my=following?following.shown[1]:vb.y+vb.h/2;
  t.x=mx-(mx-vb.x)*k;t.y=my-(my-vb.y)*k;t.w=nw;t.h=vb.h*k;flyTo(t,260)}
function syncZoom(){$("zin").disabled=vb.w<=MIN_W+1;$("zout").disabled=vb.w>=maxW()-1}
function resetView(){if(chase&&(chase.phase==="in"||chase.phase==="ride")){chase.stop=true;endChase(performance.now(),false);return}stopFollowing();flyTo(fitAll())}

const stage=$("stage");
const ptrs=new Map();let pinch=null;
const toWorld=(cx,cy)=>{const r=svg.getBoundingClientRect();return[vb.x+(cx-r.left)/r.width*vb.w,vb.y+(cy-r.top)/r.height*vb.h]};
function startPinch(){const[a,b]=[...ptrs.values()];
  pinch={d0:Math.hypot(a.x-b.x,a.y-b.y)||1,vb0:{...vb},mid:toWorld((a.x+b.x)/2,(a.y+b.y)/2)};
  drag=null;stopFollowing();camAnim=null;hideTip()}
svg.addEventListener("pointerdown",e=>{if(e.button!==0)return;
  hideTip();ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  try{svg.setPointerCapture(e.pointerId)}catch(_){}
  if(ptrs.size===2){startPinch();return}
  if(ptrs.size===1)drag={x:e.clientX,y:e.clientY,vb:{...vb},moved:false,target:e.target,touch:e.pointerType!=="mouse"}});
svg.addEventListener("pointermove",e=>{
  if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pinch&&ptrs.size>=2){const[a,b]=[...ptrs.values()],r=svg.getBoundingClientRect();
    const d=Math.hypot(a.x-b.x,a.y-b.y)||1;if(chase&&(chase.phase==="in"||chase.phase==="ride")){if(pinch.zf0==null)pinch.zf0=chase.zf||1;chase.zf=Math.max(.3,Math.min(6,pinch.zf0*pinch.d0/d));return}
    const nw=Math.max(MIN_W,Math.min(maxW(),pinch.vb0.w*pinch.d0/d)),k=nw/pinch.vb0.w;
    const mx=((a.x+b.x)/2-r.left)/r.width,my=((a.y+b.y)/2-r.top)/r.height;   // keep the pinched spot under the fingers
    vb.w=nw;vb.h=pinch.vb0.h*k;vb.x=pinch.mid[0]-mx*vb.w;vb.y=pinch.mid[1]-my*vb.h;clampVB();syncZoom();return}
  if(!drag)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(!drag.moved&&Math.hypot(dx,dy)>(e.pointerType==="touch"?8:4)){drag.moved=true;stage.classList.add("drag");stopFollowing();camAnim=null;hideTip()}
  if(!drag.moved)return;const s=vb.w/cw();vb.x=drag.vb.x-dx*s;vb.y=drag.vb.y-dy*s;clampVB()});
const endDrag=e=>{ptrs.delete(e.pointerId);
  if(pinch){if(ptrs.size<2){pinch=null;const p=[...ptrs.values()][0];   // one finger left: carry on panning from it
      drag=p?{x:p.x,y:p.y,vb:{...vb},moved:true}:null;if(!p)stage.classList.remove("drag")}return}
  if(!drag)return;const wasClick=!drag.moved,tgt=drag.target,touchy=drag.touch;drag=null;stage.classList.remove("drag");
  if(!wasClick||e.type!=="pointerup")return;
  if(atsTap(tgt,e,touchy,0)||tapPick(tgt,e,touchy)||atsTap(tgt,e,touchy,1))return;
  const g=tgt&&tgt.closest&&tgt.closest("g"),rec=g&&gRec.get(g);
  if(rec){openStationPop(rec);return}
  closeStationPop();closeBoardSheet();if(selected&&!rideCard())closeCard()};   // plain tap/click on empty map closes details (not a riding train's card: only its × does)
let lastPick=0;
function tapPick(tgt,e,touchy){
  const R=touchy&&!rideCard()?22:0,x=e.clientX,y=e.clientY,own=tgt&&tgt.closest&&tgt.closest(".train"),ownT=own&&trains.find(t=>t.g===own);
  const near=[];if(R)for(const t of trains){if(t.gone||t.g.classList.contains("dim"))continue;const r=t.g.getBoundingClientRect();if(!r.width)continue;
    const d=Math.hypot(r.x+r.width/2-x,r.y+r.height/2-y);if(d<=R)near.push([d,t])}
  near.sort((a,b)=>a[0]-b[0]);
  if(!ownT&&(!near.length||(tgt&&tgt.closest&&gRec.get(tgt.closest("g")))))return false;   // a station right under the finger wins over a nearby train
  lastPick=performance.now();
  if(near.length>=2&&near[1][0]-near[0][0]<9&&vb.w>MIN_W*2.2&&!rideCard()){   // two trains equally under the finger: zoom in on them instead of guessing
    const p=toWorld(x,y),nw=Math.max(MIN_W,vb.w/2.6),k=nw/vb.w;stopFollowing();
    flyTo({x:p[0]-(p[0]-vb.x)*k,y:p[1]-(p[1]-vb.y)*k,w:nw,h:vb.h*k},380);return true}
  const t=ownT||near[0][1];hideTip();if(selected===t){if(!rideCard())closeCard();return true}selectTrain(t);return true}
svg.addEventListener("pointerup",endDrag);svg.addEventListener("pointercancel",endDrag);
// a drag on the map is always a pan: never a text selection or a native image drag (the CSS stops most of it;
// these catch a selection that starts on the map and would run on into the page)
for(const ev of["selectstart","dragstart"])stage.addEventListener(ev,e=>e.preventDefault());
document.addEventListener("selectstart",e=>{if(drag||pinch)e.preventDefault()});
svg.addEventListener("wheel",e=>{e.preventDefault();
  const r=svg.getBoundingClientRect(),f=Math.exp(Math.max(-60,Math.min(60,e.deltaY))*0.0022);
  const mx=following?following.shown[0]:vb.x+(e.clientX-r.left)/r.width*vb.w;
  const my=following?following.shown[1]:vb.y+(e.clientY-r.top)/r.height*vb.h;
  zoomAround(f,mx,my)},{passive:false});
addEventListener("keydown",e=>{if(e.target.closest&&e.target.closest('input:not([type="checkbox"]),textarea'))return;
  if(e.key==="?"){e.preventDefault();introOpen?closeIntro():openIntro();return}
  if(introOpen){if(e.key==="Escape")closeIntro();return}
  if(e.key==="Escape"){if(sndMenu.classList.contains("on")){closeSndMenu();sndBtn.focus({preventScroll:true})}else if($("apanel").classList.contains("on"))closeAlerts();else if(spopRec)closeStationPop();else if(document.body.classList.contains("boardsheet"))closeBoardSheet();
    else if(selected){if(!rideCard())closeCard()}else if(focusKey)setFocus(null)}
  if(e.key==="+"||e.key==="=")zoomBy(1/1.35);
  if(e.key==="-"||e.key==="_")zoomBy(1.35);
  if(e.key==="0")resetView();
  if(e.key==="t"||e.key==="T")themeBtn.click();
  if(e.key==="c"||e.key==="C")styleBtn.click();
  if(e.key==="m"||e.key==="M")setSndMode(sndMode==="off"?sndLast:"off");});
/* ---- arrows or cute trains (remembered in this browser) ---- */
const styleBtn=$("styleBtn"),STYLE_KEY="nitabot.cuteTrains";
let cuteTrains=(()=>{try{return localStorage.getItem(STYLE_KEY)==="1"}catch(_){return false}})();
function applyStyle(){document.body.classList.toggle("cute",cuteTrains);styleBtn.setAttribute("aria-pressed",String(cuteTrains));
  styleBtn.title=cuteTrains?"Back to arrows (C)":"Cute trains (C)";styleBtn.setAttribute("aria-label",cuteTrains?"Show trains as arrows":"Show trains as cute little trains");
  if(!cuteTrains)for(const t of trains){t.roll=false;t.g.classList.remove("roll")}}
styleBtn.onclick=e=>{e.stopPropagation();cuteTrains=!cuteTrains;try{cuteTrains?localStorage.setItem(STYLE_KEY,"1"):localStorage.removeItem(STYLE_KEY)}catch(_){}applyStyle()};
/* ---- dark / light ---- */
const themeBtn=$("theme");
function setTheme(t){
  document.documentElement.dataset.theme=t;{const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==="light"?"#EEF2F5":"#1B2C3A"}
  const to=t==="dark"?"light":"dark";                         // the icon shows what it switches TO
  themeBtn.setAttribute("aria-label",`Switch to ${to} mode`);themeBtn.title=`Switch to ${to} mode (T)`;
}
setTheme(matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");
themeBtn.onclick=e=>{if(e)e.stopPropagation();const next=document.documentElement.dataset.theme==="dark"?"light":"dark";
  if(document.startViewTransition&&!reduceMotion())document.startViewTransition(()=>setTheme(next));else setTheme(next)};
/* ---- ambient sound ----
   Pick from the speaker menu: brown noise, water, sonar or off (remembered in this browser).
   Browsers block sound until the page is clicked/tapped/keyed once, so it starts on the first interaction.
   One 12 s noise buffer (ends crossfaded, so the loop never clicks) feeds each mode through its own
   filter and volume; switching crossfades. Sonar shows a radar over the Loop that turns once per data refresh
   and pings once each time fresh data lands. */
const sndBtn=$("snd"),sndMenu=$("sndmenu"),SND_KEY="nitabot.sound",SND_MODES=["brown","water","sonar","off"];
const SND_LEVEL={brown:1,water:1,sonar:1},SND_NAME={brown:"brown noise",water:"water",sonar:"sonar",off:"off"};
let sndMode="brown",sndLast="brown";
const CI_KEY="nitabot.checkins";let ciOn=true;try{ciOn=localStorage.getItem(CI_KEY)!=="0"}catch(_){}
try{const v=localStorage.getItem(SND_KEY);if(SND_MODES.includes(v))sndMode=v;
  const l=localStorage.getItem(SND_KEY+"Last");if(SND_MODES.includes(l)&&l!=="off")sndLast=l}catch(_){}
if(sndMode!=="off")sndLast=sndMode;
let sndOn=sndMode!=="off",actx=null,duckG=null,voG=null,bus={},pingIn=null,bubbleTO=0,waterBands=[],waterTO=0;
function buildNoise(ctx){
  const sr=ctx.sampleRate,n=Math.floor(sr*12),fade=Math.floor(sr*1.5),raw=new Float32Array(n+fade);
  let last=0;for(let i=0;i<raw.length;i++){last=(last+0.02*(Math.random()*2-1))/1.02;raw[i]=last*3.5}
  const buf=ctx.createBuffer(1,n,sr),d=buf.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=raw[i];
  for(let i=0;i<fade;i++){const t=i/fade;d[i]=raw[i]*t+raw[n+i]*(1-t)}       // seamless loop
  let mean=0;for(let i=0;i<n;i++)mean+=d[i];mean/=n;for(let i=0;i<n;i++)d[i]-=mean;
  return buf}
function buildWhite(ctx){                                                     // plain hiss for the water: nothing like the brown-noise bed
  const sr=ctx.sampleRate,n=Math.floor(sr*8),fade=Math.floor(sr*.8),raw=new Float32Array(n+fade);
  for(let i=0;i<raw.length;i++)raw[i]=Math.random()*2-1;
  const buf=ctx.createBuffer(1,n,sr),d=buf.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=raw[i];
  for(let i=0;i<fade;i++){const t=i/fade;d[i]=raw[i]*t+raw[n+i]*(1-t)}
  return buf}
function startAudio(){
  if(actx)return;
  try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;actx=new AC()}catch(_){actx=null;return}
  const brownBuf=buildNoise(actx),whiteBuf=buildWhite(actx);
  duckG=actx.createGain();duckG.connect(actx.destination);                   // ambient dips under the check-in voice
  voG=actx.createGain();voG.gain.value=.95;voG.connect(actx.destination);
  const master=()=>{const g=actx.createGain();g.gain.value=0;g.connect(duckG);return g};
  const loop=buf=>{const src=actx.createBufferSource();src.buffer=buf;src.loop=true;src.start(0,Math.random()*(buf.duration-1));return src};
  const filt=(type,freq,q)=>{const f=actx.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=q;return f};
  const gain=v=>{const g=actx.createGain();g.gain.value=v;return g};
  // brown noise: unchanged
  bus.brown=master();loop(brownBuf).connect(filt("lowpass",650,.3)).connect(gain(.07)).connect(bus.brown);
  // water: mostly bubbles, over a very quiet, low murmur of moving water (broad and low, so it never sounds like wind)
  bus.water=master();const wsrc=loop(whiteBuf);
  waterBands=[170,260].map(f=>{const bp=filt("bandpass",f,1.2),g=gain(.03);wsrc.connect(bp).connect(filt("lowpass",420,.5)).connect(g).connect(bus.water);return{bp,g,base:f}});
  // sonar: a muffled underwater rumble that slowly swells, with the ping on top
  bus.sonar=master();
  const swell=gain(.065),lfo=actx.createOscillator(),depth=gain(.024);lfo.frequency.value=.07;lfo.connect(depth).connect(swell.gain);lfo.start();
  loop(brownBuf).connect(filt("lowpass",200,1.6)).connect(swell).connect(bus.sonar);
  pingIn=gain(1);                                                             // pings: softened, with an underwater echo
  const plp=filt("lowpass",1400,.4),dly=actx.createDelay(1),fb=gain(.3),dlp=filt("lowpass",1500,.5);dly.delayTime.value=.34;
  pingIn.connect(plp);plp.connect(bus.sonar);plp.connect(dly);dly.connect(dlp);dlp.connect(fb);fb.connect(dly);dlp.connect(bus.sonar);
  applySound();
}
function wanderWater(){clearTimeout(waterTO);if(sndMode!=="water"||!actx)return;
  const t=actx.currentTime;
  for(const b of waterBands){b.bp.frequency.setTargetAtTime(b.base*(.85+Math.random()*.3),t,2.5);b.g.gain.setTargetAtTime(.03*(.6+Math.random()*.6),t,2)}
  waterTO=setTimeout(wanderWater,900+Math.random()*900)}
function applySound(fast){
  sndOn=sndMode!=="off";
  sndBtn.setAttribute("aria-pressed",String(sndOn));
  const waiting=sndOn&&(!actx||actx.state!=="running");
  sndBtn.classList.toggle("wait",waiting);
  sndBtn.title=`Sound: ${SND_NAME[sndMode]}${waiting?", starts when you click anywhere":""}. Click to choose (M mutes)`;
  for(const q of sndMenu.querySelectorAll("[data-m]"))q.setAttribute("aria-checked",String(q.dataset.m===sndMode));
  scheduleBubbles();wanderWater();document.body.classList.toggle("sonar",sndMode==="sonar");
  if(!actx)return;
  if((sndOn||ciOn)&&actx.state==="suspended")actx.resume().then(()=>applySound()).catch(()=>{});
  const t=actx.currentTime;
  for(const m in bus){const g=bus[m].gain,on=m===sndMode;g.cancelScheduledValues(t);g.setValueAtTime(g.value,t);
    g.linearRampToValueAtTime(on?SND_LEVEL[m]:0,t+(on?(fast?1.4:2.5):.6))}
}
function scheduleBubbles(){clearTimeout(bubbleTO);if(sndMode!=="water"||!actx)return;
  bubbleTO=setTimeout(()=>{if(actx.state==="running"&&!document.hidden)bubble();scheduleBubbles()},350+Math.random()*1600)}
function bubble(){                                                            // a quick rising blip, sometimes two or three in a row
  const n=Math.random()<.35?2+Math.floor(Math.random()*2):1;let t=actx.currentTime;
  for(let i=0;i<n;i++){const f=300+Math.random()*500,d=.05+Math.random()*.06;
    const o=actx.createOscillator(),g=actx.createGain();o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*2.3,t+d);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.05,t+.008);g.gain.exponentialRampToValueAtTime(.0005,t+d);
    o.connect(g).connect(bus.water);o.start(t);o.stop(t+d+.02);t+=.05+Math.random()*.09}}
function sonarPing(){                                                         // one soft ping each time the radar completes a turn (fresh data landed)
  if(sndMode!=="sonar"||!actx||actx.state!=="running"||!pingIn)return;
  const now=actx.currentTime,f=520,o=actx.createOscillator(),g=actx.createGain();
  o.frequency.setValueAtTime(f,now);o.frequency.exponentialRampToValueAtTime(f*.96,now+2);
  g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(.014,now+.025);g.gain.exponentialRampToValueAtTime(.0002,now+2.4);
  o.connect(g).connect(pingIn);o.start(now);o.stop(now+2.45)}
function setSndMode(m){if(!SND_MODES.includes(m))return;sndMode=m;if(m!=="off")sndLast=m;
  try{localStorage.setItem(SND_KEY,m);localStorage.setItem(SND_KEY+"Last",sndLast)}catch(_){}
  if(m!=="off")startAudio();applySound(true)}
function openSndMenu(){const r=sndBtn.getBoundingClientRect();
  sndMenu.style.left=Math.max(8,Math.min(innerWidth-sndMenu.offsetWidth-8,r.left-6))+"px";sndMenu.style.top=(r.bottom+8)+"px";
  sndMenu.classList.add("on");sndBtn.setAttribute("aria-expanded","true");
  (sndMenu.querySelector('[aria-checked="true"]')||sndMenu.querySelector("button")).focus({preventScroll:true})}
function closeSndMenu(){if(!sndMenu.classList.contains("on"))return;sndMenu.classList.remove("on");sndBtn.setAttribute("aria-expanded","false")}
sndBtn.onclick=e=>{e.stopPropagation();sndMenu.classList.contains("on")?closeSndMenu():openSndMenu()};
sndMenu.addEventListener("pointerdown",e=>e.stopPropagation());
sndMenu.addEventListener("click",e=>{if(e.target.closest("#ciTog")){e.stopPropagation();setCheckins(!ciOn);return}
  const q=e.target.closest("[data-m]");if(!q)return;e.stopPropagation();setSndMode(q.dataset.m);closeSndMenu();sndBtn.focus({preventScroll:true})});
sndMenu.addEventListener("keydown",e=>{const items=[...sndMenu.querySelectorAll("button")],i=items.indexOf(document.activeElement);
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();items[(i+(e.key==="ArrowDown"?1:items.length-1))%items.length].focus()}
  else if(e.key==="Tab")closeSndMenu()});
document.addEventListener("pointerdown",e=>{if(sndMenu.classList.contains("on")&&!e.target.closest("#sndmenu,#snd"))closeSndMenu()});
const firstGesture=()=>{removeEventListener("pointerdown",firstGesture,true);removeEventListener("keydown",firstGesture,true);
  if(sndOn||ciOn){startAudio();ciPreload()}else applySound()};
addEventListener("pointerdown",firstGesture,true);addEventListener("keydown",firstGesture,true);
applySound();
/* radar: centred on the downtown terminals, one full turn per 30 s data refresh.
   The beam reaches the top as the next fetch goes out, waits there while it's in flight, and pings when it lands. */
const RADAR_C=geo(41.8818,-87.6298);   // the middle of the Loop
let RADAR_R=340,radarSweep=null,radarRot="",radarTrail=null;
// the fading trail behind the beam: one smooth sweep painted once into an image (no slices, so no seams)
function paintRadarTrail(){
  if(!radarTrail)return;
  const n=512,c=document.createElement("canvas");c.width=c.height=n;const g=c.getContext("2d");
  if(!g||!g.createConicGradient){radarTrail.remove();radarTrail=null;return}
  const SPAN=40*Math.PI/180,f=SPAN/(2*Math.PI);                 // 40° behind the beam, which points straight up
  const cg=g.createConicGradient(-Math.PI/2-SPAN,n/2,n/2);
  for(let k=0;k<=12;k++)cg.addColorStop(f*k/12,`rgba(255,255,255,${Math.pow(k/12,1.6).toFixed(4)})`);   // eases out behind the beam
  cg.addColorStop(Math.min(1,f+.0005),"rgba(255,255,255,0)");cg.addColorStop(1,"rgba(255,255,255,0)");
  g.fillStyle=cg;g.beginPath();g.arc(n/2,n/2,n/2,0,2*Math.PI);g.fill();
  g.globalCompositeOperation="source-in";g.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()||"#fff";g.fillRect(0,0,n,n);
  radarTrail.setAttribute("href",c.toDataURL())}
new MutationObserver(()=>paintRadarTrail()).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
if(RADAR_C)RADAR_R=Math.ceil(Math.hypot(Math.max(RADAR_C[0]-WORLD.x0,WORLD.x1-RADAR_C[0]),Math.max(RADAR_C[1]-WORLD.y0,WORLD.y1-RADAR_C[1]))*1.6);   // reaches past every edge of the page
if(RADAR_C){const g=el("g",{class:"radar",transform:`translate(${RADAR_C[0].toFixed(1)},${RADAR_C[1].toFixed(1)})`});world.insertBefore(g,trackG);
  radarSweep=el("g",{class:"sweep"},g);
  radarTrail=el("image",{class:"trail",x:-RADAR_R,y:-RADAR_R,width:2*RADAR_R,height:2*RADAR_R,preserveAspectRatio:"none"},radarSweep);
  paintRadarTrail();
  el("path",{class:"beam",d:`M0 0V${-RADAR_R}`},radarSweep)}
let radarLand=0,radarCycle=30000,radarPh=0,radarT=0,radarFresh=true;
function radarLanded(t0){const t=performance.now();radarLand=t;radarCycle=Math.max(POLL,Math.min(POLL+15000,POLL+(t-t0)))}   // a turn = the wait plus the fetch
function radarFrame(now){
  const dt=radarT?Math.min(.25,(now-radarT)/1000):0;radarT=now;
  if(!radarSweep||sndMode!=="sonar"){radarFresh=true;return}
  // the beam never stops: it turns at a steady speed and is eased back into step with the data (top = fresh data landed)
  let speed=1;
  if(radarLand){const ideal=((now-radarLand)/radarCycle)%1;let err=ideal-radarPh;err-=Math.round(err);
    if(radarFresh)radarPh=ideal;else speed=1+Math.max(-.4,Math.min(.4,err*4))}   // a little faster or slower to stay in step, never backwards
  radarPh=(radarPh+speed*dt*1000/radarCycle)%1;
  radarFresh=false;
  const r=`rotate(${(radarPh*360).toFixed(2)})`;if(r!==radarRot){radarRot=r;radarSweep.setAttribute("transform",r)}}
/* ---- welcome panel ----
   Shows on start unless "Don't show this on start" was ticked (remembered in this browser).
   Closing shrinks it into the ? button by the title; the ? grows it back out. */
const intro=$("intro"),introVeil=$("introVeil"),helpBtn=$("helpBtn"),introHide=$("introHide"),HIDE_KEY="nitabot.hideIntro";
let introOpen=false,introBusy=false;
const store={get(){try{return localStorage.getItem(HIDE_KEY)==="1"}catch(_){return false}},
  set(v){try{v?localStorage.setItem(HIDE_KEY,"1"):localStorage.removeItem(HIDE_KEY)}catch(_){}}};
function reduceMotion(){return!!(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)}
function introRest(){return"translate(-50%,-50%)"}
function introAtButton(){   // transform that puts the panel's top-left corner on the ? button, tiny
  const b=helpBtn.getBoundingClientRect(),st=stage.getBoundingClientRect();
  const W=intro.offsetWidth,H=intro.offsetHeight,cx=st.width/2,cy=st.height/2;
  const k=Math.max(.04,b.width/W);
  return`translate(${(b.left-st.left)-cx}px,${(b.top-st.top)-cy}px) scale(${k})`}
function openIntro(){
  if(introOpen||introBusy)return;introOpen=true;introBusy=true;
  introHide.checked=store.get();intro.hidden=false;hideTip();
  if(reduceMotion()){intro.style.transform=introRest();intro.style.opacity=1;introVeil.classList.add("on");introBusy=false;intro.querySelector(".go").focus();return}
  intro.classList.remove("anim");intro.style.transform=introAtButton();intro.style.opacity=0;intro.style.borderRadius="40px";
  void intro.offsetWidth;intro.classList.add("anim");
  requestAnimationFrame(()=>{intro.style.transform=introRest();intro.style.opacity=1;intro.style.borderRadius="";introVeil.classList.add("on")});
  setTimeout(()=>{introBusy=false;intro.querySelector(".go").focus({preventScroll:true})},560);
}
function closeIntro(){
  if(!introOpen||introBusy)return;introOpen=false;introBusy=true;
  store.set(introHide.checked);introVeil.classList.remove("on");
  const done=()=>{intro.hidden=true;intro.classList.remove("anim");introBusy=false;
    helpBtn.classList.add("catch");setTimeout(()=>helpBtn.classList.remove("catch"),700)};
  if(reduceMotion()){done();return}
  intro.classList.add("anim");intro.style.transform=introAtButton();intro.style.opacity=0;intro.style.borderRadius="40px";
  setTimeout(done,560);
}
introHide.onchange=()=>store.set(introHide.checked);
intro.querySelector(".go").onclick=closeIntro;intro.querySelector(".x").onclick=closeIntro;
introVeil.addEventListener("pointerdown",e=>{e.stopPropagation();closeIntro()});
helpBtn.onclick=e=>{e.stopPropagation();introOpen?closeIntro():openIntro()};
if(!store.get())setTimeout(openIntro,350);
$("zin").onclick=()=>zoomBy(1/1.4);$("zout").onclick=()=>zoomBy(1.4);$("fit").onclick=resetView;
let resizeT=0;
addEventListener("resize",()=>{clearTimeout(resizeT);resizeT=setTimeout(()=>{
  const cx=vb.x+vb.w/2,cy=vb.y+vb.h/2,r=cw()/ch();FIT_W=fitAll().w;
  vb.h=vb.w/r;vb.x=cx-vb.w/2;vb.y=cy-vb.h/2;vb.w=Math.min(vb.w,maxW());vb.h=vb.w/r;clampVB();labelsDirty=true;syncZoom()},80)});
