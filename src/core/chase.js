
/* =====================================================================
   TRAIN OF THE MOMENT (screensaver)
   After 2 minutes with no input (20 seconds on a phone), the camera picks a live train, swings in behind it (the map turns
   so the train points up the screen, and tilts back in 3D), rides along for about a minute, then
   pulls back to the whole map and rests before picking another. Any mouse move, touch, scroll or
   key brings the normal map straight back. Only trains with a known direction and fresh GPS are
   picked, so the camera never guesses. Tilt is skipped on phones and small devices; the whole thing
   is off with reduced motion.
   ===================================================================== */
const ROT={a:0,cx:0,cy:0};                 // world turn (radians) around a pivot; the label layout uses it too
function rotPt(p){if(!ROT.a)return p;const c=Math.cos(ROT.a),s=Math.sin(ROT.a),dx=p[0]-ROT.cx,dy=p[1]-ROT.cy;return[ROT.cx+dx*c-dy*s,ROT.cy+dx*s+dy*c]}
const CH={IDLE:120000,IN:3200,RIDE:50000,OUT:2800,REST:25000,EXIT:550},PHONE_IDLE=20000,isTouch=()=>matchMedia("(pointer:coarse)").matches;let wakeLock=null;function wakeOn(){if(wakeLock||!navigator.wakeLock||!isTouch())return;wakeLock="wait";navigator.wakeLock.request("screen").then(l=>{if(chase&&wakeLock==="wait")wakeLock=l;else l.release()}).catch(()=>{wakeLock=null})}function wakeOff(){const l=wakeLock;wakeLock=null;if(l&&l!=="wait")l.release().catch(()=>{})}   // phones lock themselves within a minute: start sooner, and keep the screen on while it rides
let chase=null,chaseLast=null,chaseTilt=0,worldRotKey="",lastPtr=null;
const horizon=$("horizon");
const canTilt=()=>!isNarrow()&&(navigator.hardwareConcurrency||8)>4;
const easeIO=k=>k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
const angDiff=(a,b)=>{let d=(b-a)%(2*Math.PI);if(d>Math.PI)d-=2*Math.PI;if(d<-Math.PI)d+=2*Math.PI;return d};
const lerpVB=(a,b,k)=>({x:a.x+(b.x-a.x)*k,y:a.y+(b.y-a.y)*k,w:a.w+(b.w-a.w)*k,h:a.h+(b.h-a.h)*k});
function chaseOk(t){return t&&!t.gone&&!t.stale&&t.dirSign!==0&&t.rot!=null&&(!focusKey||t.L.key===focusKey)}
function pickChaseTrain(){const c=trains.filter(chaseOk);if(!c.length)return null;
  const moving=c.filter(t=>Math.abs(t.segTo-t.segFrom)>.05),pool=(moving.length?moving:c).filter(t=>t!==chaseLast||c.length===1);
  return pool[Math.floor(Math.random()*pool.length)]}
const headingOf=t=>-Math.PI/2-t.rot*Math.PI/180;                     // the world turn that points this train up the screen
// the same, but from where the track goes over the next stretch (about a quarter of the screen ahead), so the
// camera starts round a bend smoothly and ignores small kinks
function chaseHeading(t,now){const r=t.L.routes[t.ri],p=poseAt(r,curS(t,now)),L=vb.w*.22,tot=r.ac[r.ac.length-1];
  const d1=Math.max(0,Math.min(tot,p.d+t.dirSign*L)),d0=Math.max(0,Math.min(tot,p.d-t.dirSign*L*.25));
  if(!(Math.abs(d1-d0)>L*.3))return headingOf(t);
  const a=along(r.anc,r.ac,d0),b=along(r.anc,r.ac,d1);return angDiff(0,-Math.PI/2-Math.atan2(b[1]-a[1],b[0]-a[0]))}   // the short way round
function rideVB(t){const W=cw(),H=ch(),w=Math.max(MIN_W,Math.min(maxW(),Math.max(MIN_W*3,FIT_W/14)*(chase&&chase.zf||1))),h=w*H/W,k=w/W;let sx=W/2,sy=H*.62;
  if(isNarrow()){const I=uiInsets();                                 // phone: keep the train in the open map, clear of its card
    if(sideSheet()){const cwid=(card.offsetWidth||Math.min(340,W*.46))+16;sx=cwid+(W-cwid)/2;sy=I.top+(H-I.top-I.bot)*.58}
    else{const sh=card.classList.contains("on")&&card.offsetHeight?card.offsetHeight:220,bot=66+sh;sy=I.top+Math.max(40,H-I.top-bot)*.62}}
  return{x:t.shown[0]-sx*k,y:t.shown[1]-sy*k,w,h}}
function chaseBusy(){return introOpen||(selected&&!(chase&&(chase.card||chase.manual)&&selected===chase.t))||spopRec||document.body.classList.contains("boardsheet")}
function startRide(now){const t=pickChaseTrain();if(!t){chase={phase:"rest",t0:now};return}wakeOn();
  chaseLast=t;camAnim=null;following=null;ciPrep(t);
  chase={phase:"in",t0:now,t,home:chase&&chase.home||fitAll(),from:{...vb},a:0,tilt:0,goTilt:canTilt()};
  document.body.classList.add("chasing")}
// Follow on a train's card: the same ride-along view, for that train, until you close its card
function rideAlong(t){
  if(reduceMotion()){following=t;renderCard();return}                  // no motion: just keep it centred, flat
  const now=performance.now(),home=chase&&chase.home||fitAll();
  if(chase){hideChaseCard();ROT.a=0;setTilt(0)}
  camAnim=null;following=null;
  chase={phase:"in",t0:now,t,manual:true,home:chaseTilt?home:fitAll(),from:{...vb},a:0,tilt:0,goTilt:canTilt()};
  document.body.classList.add("chasing");renderCard()}
const riding=t=>!!(chase&&chase.manual&&chase.t===t&&(chase.phase==="in"||chase.phase==="ride"));
function endChase(now,quick){if(!chase||chase.phase==="exit"||chase.phase==="out"&&!quick)return;
  if(quick)ciStop();else if(!chase.manual&&chase.phase==="ride")ciSay("end",chase.t);
  if(chase.phase==="rest"&&quick){finishChase();return}
  hideChaseCard();
  chase={...chase,phase:quick?"exit":"out",t0:now,from:{...vb},fromA:ROT.a,fromTilt:chaseTilt}}
function showChaseCard(t){if(selected&&selected!==t)return;                     // you picked a train yourself: leave it alone
  selected=t;t.g.classList.add("sel");card.classList.add("on");if(isNarrow())document.body.classList.add("sheet");
  chase.card=true;renderCard();placeCard();labelsDirty=true}
// the card of the train being ridden right now: only its × closes it
function rideCard(){return!!(chase&&(chase.manual||chase.card)&&selected===chase.t&&(chase.phase==="in"||chase.phase==="ride"))}
function hideChaseCard(){if(!chase||!chase.card)return;chase.card=false;if(selected===chase.t)closeCard()}
function finishChase(){hideChaseCard();ciStop();wakeOff();chase=null;ROT.a=0;setTilt(0);worldRotKey="";world.removeAttribute("transform");document.body.classList.remove("chasing");labelsDirty=true}
function setTilt(k){chaseTilt=k;
  if(k<=.001){if(stage.classList.contains("tilt")){stage.classList.remove("tilt","moving");stage.style.transform="";horizon.style.opacity=0}return}
  stage.classList.add("tilt");stage.classList.toggle("moving",k<.999);stage.style.transform=`perspective(1000px) rotateX(${(34*k).toFixed(2)}deg) scale(${(1+.55*k).toFixed(3)})`;horizon.style.opacity=k.toFixed(3)}
function chaseFrame(now,dt){
  if(!chase){
    if(Date.now()-lastInput>(isTouch()?PHONE_IDLE:CH.IDLE)&&!chaseBusy()&&!reduceMotion()&&(!document.hidden||bgVoice())&&trains.length)startRide(now);
    return false}
  const e=now-chase.t0,t=chase.t;
  if(chase.phase==="rest"){if(e>CH.REST&&!chaseBusy()){chase.home=fitAll();startRide(now)}return false}
  if((chase.phase==="in"||chase.phase==="ride")&&(!chaseOk(t)||chaseBusy())){endChase(now,false);return true}   // (next frame starts the pull-back from here, instead of snapping)
  if((chase.phase==="in"||chase.phase==="ride")&&!chase.manual){if(chase.dir==null)chase.dir=t.dirSign;else if(t.dirSign!==chase.dir){endChase(now,false);return true}}   // it turned round: end the ride, don't spin the map
  if(chase.phase==="in"||chase.phase==="ride"){
    ROT.cx=t.shown[0];ROT.cy=t.shown[1];
    const want=chaseHeading(t,now);
    {const d=angDiff(chase.a,want),w0=1.6;chase.av=(chase.av||0)+(w0*w0*d-2*w0*(chase.av||0))*dt;   // a soft spring, never faster than ~25 degrees a second
     chase.av=Math.max(-.45,Math.min(.45,chase.av));chase.a+=chase.av*dt}
    if(chase.phase==="in"){const k=Math.min(1,e/CH.IN),z=easeIO(k),r=easeIO(Math.max(0,(k-.2)/.8));
      if(k===0||chase.a===0)chase.a=want;
      Object.assign(vb,lerpVB(chase.from,rideVB(t),z));ROT.a=chase.a*r;setTilt(chase.goTilt?r:0);
      if(k>=1){chase.phase="ride";chase.t0=now;if(!chase.manual){showChaseCard(t);ciSay("start",t)}}}
    else{Object.assign(vb,rideVB(t));ROT.a=chase.a;if(chase.goTilt)setTilt(1);
      if(!chase.manual&&!chase.ciMid&&e>CH.RIDE*.5){chase.ciMid=true;ciSay("mid",t)}
      if(e>CH.RIDE&&!chase.manual)endChase(now,false)}
  }else{                                                                // "out" (ride over) or "exit" (you moved): back to the flat, whole map
    const d=chase.phase==="exit"?CH.EXIT:CH.OUT,k=Math.min(1,e/d),z=easeIO(k);
    if(t&&!t.gone){ROT.cx=t.shown[0];ROT.cy=t.shown[1]}
    Object.assign(vb,lerpVB(chase.from,chase.home,z));ROT.a=chase.fromA*(1-z);setTilt(chase.fromTilt*(1-z));
    if(k>=1){if(chase.phase==="exit"||chase.manual||chase.stop){const m=chase.manual;finishChase();if(m&&selected)renderCard()}else{ROT.a=0;setTilt(0);document.body.classList.remove("chasing");chase={phase:"rest",t0:now,home:chase.home};labelsDirty=true}}
  }
  const rk=ROT.a?`rotate(${(ROT.a*180/Math.PI).toFixed(3)} ${ROT.cx.toFixed(2)} ${ROT.cy.toFixed(2)})`:"";
  if(rk!==worldRotKey){worldRotKey=rk;rk?world.setAttribute("transform",rk):world.removeAttribute("transform")}
  return true}
// mouse moves, clicks, scrolls and keys never end a ride: only closing the train's card (×) does
document.addEventListener("visibilitychange",()=>{if(!document.hidden||!chase||bgVoice())return;const home=chase.phase!=="rest"&&chase.home;finishChase();if(home){Object.assign(vb,home);applyVB();updateMarkers()}});   // leaving mid-ride: straighten the map and zoom back out
