
/* =====================================================================
   TRAIN CHECK-INS
   During train of the moment (never a train you picked yourself), a soft voice checks in on the train,
   like a weather stream's camera check-ins: which train, how it's running, what's next. Every phrase was
   recorded ahead of time (tools/build_voice.py, a free open-source voice) and is stitched together here,
   so nothing is generated live. Voice only, no caption. Toggle: sound menu → Train check-ins.
   ===================================================================== */
const ciTog=$("ciTog");
const VO={man:null,manP:null,bufs:{},loading:{},srcs:[],timers:[],hideT:0,gen:0};
function setCheckins(on){ciOn=on;try{localStorage.setItem(CI_KEY,on?"1":"0")}catch(_){}
  ciTog.setAttribute("aria-checked",String(on));if(on){startAudio();applySound();ciPreload()}else ciStop()}
ciTog.setAttribute("aria-checked",String(ciOn));
function voManifest(){return VO.manP||=fetch("voice/manifest.json").then(r=>r.ok?r.json():null).then(m=>VO.man=m).catch(()=>{VO.manP=null;return null})}
function voPack(name){if(VO.bufs[name])return Promise.resolve(VO.bufs[name]);if(!actx)return Promise.resolve(null);
  return VO.loading[name]||=fetch(`voice/${name}.mp3`).then(r=>{if(!r.ok)throw 0;return r.arrayBuffer()})
    .then(b=>new Promise((res,rej)=>actx.decodeAudioData(b,res,rej))).then(b=>VO.bufs[name]=b)
    .catch(()=>{delete VO.loading[name];return null})}
function ciPreload(){if(ciOn&&actx)voManifest().then(m=>{if(m)voPack("core")})}
function ciPrep(t){if(ciOn&&actx)voManifest().then(m=>{if(m){voPack("core");voPack(t.L.key)}})}
const ciPick=a=>a[Math.floor(Math.random()*a.length)];
// what the check-in can honestly say about this train, from the same data as its card
// the voice clips are named after the words they say: "Howard" -> howard, "95th/Dan Ryan" -> 95th_dan_ryan
const vslug=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
// what the check-in can honestly say about this train, from the same data as its card
function ciFacts(t){
  const r=t.L.routes[t.ri],s=t.lastObsS,n=r.st.length,near=Math.round(s),atStn=Math.abs(s-near)<0.12,v=t.cta||{};
  const lo=Math.floor(s),hi=Math.min(n-1,Math.ceil(s));
  const last=t.dirSign>0?stationAt(t,atStn?near:lo):stationAt(t,atStn?near:hi);
  const nx=v.next_sta_id&&STN.has(v.next_sta_id)&&STN.get(v.next_sta_id)!==last?{id:v.next_sta_id,tm:v.arrives_at?v.arrives_at/1000:0}:null;
  return{t,last,atStn,next:nx,dest:v.dest||"",delayed:!!v.delayed}}
// each sentence: [[pack,key],...] pieces plus the caption text
function ciLines(kind,f){
  const M=VO.man,L=[],nowSec=serverNow()/1000,lk=f.t.L.key,nm=id=>{const r=STN.get(id);return r?stnName(r):""};
  const tail=tm=>{if(!tm)return["t_up","coming up."];const m=Math.round((tm-nowSec)/60);
    return m<=0?["t_now","coming up now."]:m===1?["t_1","in about a minute."]:m<=90?["t_"+m,`in about ${m} minutes.`]:["t_up","coming up."]};
  const stop=(pre,word,p)=>{if(!p||!p.id||!STN.get(p.id))return;const[k,tx]=tail(p.tm);
    L.push({p:[[lk,pre+"_"+vslug(nm(p.id))],["core",k]],tx:`${word} ${nm(p.id)}, ${tx}`})};
  if(kind==="start"){
    const v=Math.random()<.5?0:1;
    L.push({p:[["core",`op_${lk}_${v}`]],tx:`${v?"Let's ride along with":"Checking in on"} a ${f.t.L.name} train.`});
    if(f.dest)L.push({p:[[lk,"to_"+vslug(shortName(f.dest))]],tx:`It's headed to ${shortName(f.dest)}.`});
    if(f.delayed)L.push({p:[["core","s_dly"]],tx:"CTA says it's running with a delay."});
    stop("nx","Next up,",f.next);
  }else if(kind==="mid"){
    if(f.last&&STN.get(f.last.id))L.push(f.atStn?{p:[[lk,"at_"+vslug(nm(f.last.id))]],tx:`Now at ${nm(f.last.id)}.`}
      :{p:[[lk,"ps_"+vslug(nm(f.last.id))]],tx:`Just passed ${nm(f.last.id)}.`});
    stop("nx","Next up,",f.next);
  }else{const v=Math.floor(Math.random()*3);
    L.push({p:[["core","end_"+v]],tx:["That's the check-in. Back out to the full map.","That's all for this one. Back to the whole system.","Okay, that wraps it up. Back out to the map."][v]})}
  // a sentence whose clip wasn't recorded (a destination CTA names some new way) is left out, not the whole check-in
  return M?L.filter(l=>l.p.every(([pk,k])=>pk==="core"?M.core&&M.core[k]:M.lines&&M.lines[pk]&&M.lines[pk][k])):L}
function ciStop(){VO.gen++;for(const x of VO.srcs)try{x.stop()}catch(_){}VO.srcs=[];for(const x of VO.timers)clearTimeout(x);VO.timers=[];
  if(duckG&&actx){const t=actx.currentTime;duckG.gain.cancelScheduledValues(t);duckG.gain.setTargetAtTime(1,t,.4)}}
async function ciSay(kind,t){
  if(!ciOn||!t)return;
  const gen=++VO.gen;for(const x of VO.srcs)try{x.stop()}catch(_){}VO.srcs=[];for(const x of VO.timers)clearTimeout(x);VO.timers=[];
  await voManifest();if(gen!==VO.gen)return;
  const f=ciFacts(t),lines=ciLines(kind,f);if(!lines.length)return;
  // can we speak it? every piece must be recorded and loaded, and audio must be allowed (after a first click)
  let voice=!!(VO.man&&actx&&actx.state==="running");
  if(voice){const packs=[...new Set(lines.flatMap(l=>l.p.map(q=>q[0])))];
    const bufs=await Promise.race([Promise.all(packs.map(voPack)),new Promise(r=>setTimeout(()=>r(null),2500))]);if(gen!==VO.gen)return;
    voice=!!bufs&&bufs.every(Boolean)&&lines.every(l=>l.p.every(([pk,k])=>VO.man[pk==="core"?"core":"lines"]&&(pk==="core"?VO.man.core[k]:VO.man.lines[pk]&&VO.man.lines[pk][k])))}
  if(!voice)return;                                                        // no voice yet (before the first click): stay quiet
  const a0=actx.currentTime+.12;let at=a0;
  duckG.gain.cancelScheduledValues(a0);duckG.gain.setTargetAtTime(.4,actx.currentTime,.25);
  for(const l of lines){for(const[pk,k]of l.p){const ix=pk==="core"?VO.man.core[k]:VO.man.lines[pk][k],src=actx.createBufferSource();
      src.buffer=VO.bufs[pk];src.connect(voG);src.start(at,ix[0],ix[1]);VO.srcs.push(src);at+=ix[1]-.03}
    at+=.32}
  duckG.gain.setTargetAtTime(1,at,.6)}
const nmSafe=id=>{const r=STN.get(id);return r?stnName(r):""};
// in a background tab (sound on, check-ins on) rides and check-ins carry on: the ride clock ticks once a second
// without drawing, so you can listen while you work in another tab
function bgVoice(){return ciOn&&!!actx&&actx.state==="running"}
setInterval(()=>{if(!document.hidden||!bgVoice())return;const now=performance.now(),t=chase&&chase.t;
  if(t&&!t.gone&&t.L){const p=poseAt(t.L.routes[t.ri],curS(t,now));t.shown=[p.x,p.y]}
  chaseFrame(now,1)},1000);
document.addEventListener("visibilitychange",()=>{if(document.hidden&&!bgVoice())ciStop()});
