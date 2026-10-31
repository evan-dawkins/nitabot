/* =====================================================================
   DASHBOARD MODE (?dashboard): NITABot inside Desk Glance
   Desk Glance, a desk display, frames this page as one slide of its slideshow. Only Metra rides
   (the 'L' stays as a faint ghost); no controls, welcome, hints, sound or voice.
   Each time that slide comes up, the frame sends {type:"nitabot:ride"}: the camera starts from the
   whole map and swings in behind a new train of the moment (never the one before). Once a second
   this page tells the frame what it's showing (line, train, destination, next stop, when Metra last
   answered), so the frame can draw its own big card, say how fresh the data is, and skip the slide
   when no Metra train can be ridden. Nothing else comes in; the normal site never runs this.
   ===================================================================== */
if(DASH){
  document.body.classList.add("dash");
  const say=m=>{try{parent.postMessage(Object.assign({source:"nitabot"},m),"*")}catch(_){}};
  addEventListener("message",e=>{const d=e.data;if(!d||d.type!=="nitabot:ride")return;
    if(chase)finishChase();
    Object.assign(vb,fitAll());applyVB();updateMarkers();                 // straight from the whole map, flat
    startRide(performance.now());
    if(chase&&chase.t)chase.zf=.55});                                    // a bit closer than the site's own ride: read from across the room
  setInterval(()=>{
    const t=chase&&chase.t&&(chase.phase==="in"||chase.phase==="ride")?chase.t:null,v=t&&t.cta||{},sNow=serverNow();
    say({type:"nitabot:state",
      rideable:trains.filter(chaseOk).length,                             // Metra trains a ride could follow right now
      metraOkAt:mLastOk||0,metraErr:mErr||"",
      train:t?{line:t.L.code,name:t.L.name,color:t.L.color,label:trainLabel(t),dest:v.dest||"",next:v.next_sta||"",
        etaMin:v.arrives_at?Math.max(0,Math.round((v.arrives_at-sNow)/60000)):null,
        delayMin:v.delay!=null?Math.round(v.delay/60):null,ageMs:Math.max(0,sNow-t.updated)}:null})},1000);
}
