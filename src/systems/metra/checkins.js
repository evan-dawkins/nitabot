/* =====================================================================
   METRA CHECK-INS — what the voice says on a Metra ride (from MetraBot, with the same clips: voice/metra).
   Inbound or outbound, on time or late (Metra's prediction at the trip's last stop against the timetable in
   schedule.json), the next stop and, midway, the last stop. Clips are found by MetraBot's station id (rec.mb).
   A sentence whose clip isn't recorded (a station MetraBot never had, like Peterson/Ridge) is left out.
   ===================================================================== */
function mciFacts(t){
  const r=t.L.routes[t.ri],s=t.lastObsS,n=r.st.length,near=Math.round(s),atStn=Math.abs(s-near)<0.12,nowSec=serverNow()/1000,v=t.cta||{};
  const lo=Math.floor(s),hi=Math.min(n-1,Math.ceil(s));
  const last=t.dirSign>0?stationAt(t,atStn?near:lo):stationAt(t,atStn?near:hi);   // NITABot's routes run toward downtown
  const tr=mTripById.get(v.trip_id),end=tr&&(tr.last_stop||(tr.stops&&tr.stops.length?tr.stops[tr.stops.length-1].id:""));
  const f={t,code:t.L.api,dir:end?(M_DOWNTOWN.has(end)?"in":"out"):(t.dirSign>0?"in":"out"),last,atStn,next:null,final:null,late:null,hasTrip:false};
  if(tr&&tr.stops&&tr.stops.length){f.hasTrip=true;
    let st=tr.stops.filter(x=>(x.arr||x.dep||0)>=nowSec-30);
    if(st.length>1&&last&&st[0].id===last.id)st=st.slice(1);
    const pt=x=>({id:x.id,tm:x.arr||x.dep||0});
    if(st.length){f.next=pt(st[0]);if(st.length>1)f.final=pt(st[st.length-1])}
    const sc=TT&&TT.trips&&TT.trips[tr.trip_id],fs=sc&&tr.stops.find(x=>x.id===sc[0]),pr=fs&&(fs.arr||fs.dep);
    if(pr){const day=chiDate(serverNow());let sched=gtfsBase(day)+hms(sc[1]);
      if(sched-pr>12*3600)sched-=86400;else if(pr-sched>12*3600)sched+=86400;
      if(Math.abs(pr-sched)<3*3600)f.late=pr-sched}}
  return f}
function mciLines(kind,f){
  const M=VOS.metra.man,L=[],nowSec=serverNow()/1000,lk=f.t.L.key;
  const slug=id=>{const r=STN.get(id);return M&&r&&r.mb&&M.stn?M.stn[r.mb]:null},nm=id=>{const r=STN.get(id);return r?stnName(r):""};
  const tail=tm=>{if(!tm)return["t_up","coming up."];const m=Math.round((tm-nowSec)/60);
    return m<=0?["t_now","coming up now."]:m===1?["t_1","in about a minute."]:m<=90?["t_"+m,`in about ${m} minutes.`]:["t_up","coming up."]};
  const stop=(pre,word,p)=>{if(!p||!p.id||!STN.get(p.id)||!slug(p.id))return;const[k,tx]=tail(p.tm);
    L.push({p:[[lk,pre+"_"+slug(p.id)],["core",k]],tx:`${word} ${nm(p.id)}, ${tx}`})};
  if(kind==="start"){
    const v=Math.random()<.5?0:1,dw=f.dir==="in"?"an inbound":"an outbound";
    L.push({p:[["core",`op_${f.code}_${f.dir}_${v}`]],tx:`${v?"Let's ride along with":"Checking in on"} ${dw} ${f.t.L.name} train.`});
    if(!f.hasTrip)L.push({p:[["core","s_gps"]],tx:"No times from Metra on this one. Just its GPS."});
    else if(f.late!=null){const m=Math.round(f.late/60);
      L.push(m<=-2?{p:[["core","s_early"]],tx:"It's running a little ahead of schedule."}
        :m<=0?ciPick([{p:[["core","s_ontime_0"]],tx:"It's right on schedule."},{p:[["core","s_ontime_1"]],tx:"Right on time so far."}])
        :m===1?{p:[["core","s_late_1"]],tx:"It's running about a minute behind."}
        :m<=30?{p:[["core","s_late_"+m]],tx:`It's running about ${m} minutes behind.`}
        :{p:[["core","s_late_big"]],tx:"It's running more than half an hour behind."})}
    stop("nx","Next up,",f.next);
  }else if(kind==="mid"){
    if(f.last&&slug(f.last.id))L.push(f.atStn?{p:[[lk,"at_"+slug(f.last.id)]],tx:`Now at ${nm(f.last.id)}.`}
      :{p:[[lk,"ps_"+slug(f.last.id)]],tx:`Just passed ${nm(f.last.id)}.`});
    if(f.final&&f.final.id!==(f.next&&f.next.id))stop("ls","The last stop is",f.final);else stop("nx","Next up,",f.next);
  }else{const v=Math.floor(Math.random()*3);
    L.push({p:[["core","end_"+v]],tx:["That's the check-in. Back out to the full map.","That's all for this one. Back to the whole network.","Okay, that wraps it up. Back out to the map."][v]})}
  return M?L.filter(l=>l.p.every(([pk,k])=>pk==="core"?M.core&&M.core[k]:M.lines&&M.lines[pk]&&M.lines[pk][k])):L}
