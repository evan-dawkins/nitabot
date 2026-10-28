
/* =====================================================================
   LINE FOCUS
   ===================================================================== */
const chips={};
const consoleEl=$("console");
const allChip=document.createElement("button");allChip.className="chip all";allChip.textContent="All lines";
allChip.setAttribute("aria-pressed","true");allChip.title="Show all lines";
allChip.onclick=()=>{if(focusKey)setFocus(null)};consoleEl.appendChild(allChip);   // All lines: back to every line (folding the bar is the arrow's job)
/* two groups of line buttons, the L and Metra: one shows at a time (remembered in this browser); both systems stay on the map */
const GROUP_KEY="nitabot.lineGroup",grpWrap=document.createElement("span"),gtabs={};
grpWrap.className="grp";grpWrap.setAttribute("role","group");grpWrap.setAttribute("aria-label","Which line buttons to show");
let lineGroup=(()=>{try{return localStorage.getItem(GROUP_KEY)==="metra"?"metra":"cta"}catch(_){return"cta"}})();
for(const[g,label]of[["cta","L"],["metra","Metra"]]){const b=document.createElement("button");b.className="gtab";b.textContent=label;
  b.title=g==="cta"?"Show the L's lines":"Show Metra's lines";b.onclick=()=>setGroup(g);grpWrap.appendChild(b);gtabs[g]=b}
consoleEl.appendChild(grpWrap);
for(const key of ORDER){const L=LINES[key],b=document.createElement("button");
  b.className="chip";b.setAttribute("aria-pressed","false");b.title=`Show only the ${L.name}`;
  b.innerHTML=`<i style="background:${L.color}"></i>${L.code}<span class="ad" aria-hidden="true"></span><span class="n" id="n-${key}"></span>`;
  b.onclick=()=>setFocus(focusKey===key?null:key);consoleEl.appendChild(b);chips[key]=b}
consoleEl.appendChild($("focusnote"));
let grpAuto=false;   // switched by the zoom (not by a tap), so zooming back switches it back
function setGroup(g,auto){lineGroup=g;grpAuto=!!auto;if(!auto)try{localStorage.setItem(GROUP_KEY,g)}catch(_){}
  for(const k of ORDER)chips[k].hidden=LINES[k].sys!==g;
  for(const x in gtabs)gtabs[x].setAttribute("aria-pressed",String(x===g));labelsDirty=true}
setGroup(lineGroup);
/* the line bar folds down to just the current choice; remembered in this browser */
const ctog=document.createElement("button");ctog.className="ctog";consoleEl.appendChild(ctog);
const LINES_MIN_KEY="nitabot.linesMin";
let linesMin=(()=>{try{return localStorage.getItem(LINES_MIN_KEY)==="1"}catch(_){return false}})();
function syncLineBar(){consoleEl.classList.toggle("min",linesMin);
  const cur=focusKey?`<i style="background:${LINES[focusKey].color}"></i>${LINES[focusKey].code}`:"All lines";
  ctog.innerHTML=`<span class="cur">${cur}</span><span aria-hidden="true">${linesMin?"▸":"◂"}</span>`;
  ctog.setAttribute("aria-expanded",String(!linesMin));
  ctog.setAttribute("aria-label",linesMin?"Show all the line buttons":"Fold the line buttons away");ctog.title=linesMin?"Show lines":"Hide lines";labelsDirty=true}
const moreHint=()=>{const m=consoleEl.scrollWidth-consoleEl.clientWidth-consoleEl.scrollLeft>6;consoleEl.classList.toggle("more",m&&isNarrow())};
consoleEl.addEventListener("scroll",moreHint,{passive:true});addEventListener("resize",moreHint);setTimeout(moreHint,300);   // phone: fade the right edge while more lines are off-screen
let foldT=0;
ctog.onclick=()=>{linesMin=!linesMin;try{linesMin?localStorage.setItem(LINES_MIN_KEY,"1"):localStorage.removeItem(LINES_MIN_KEY)}catch(_){}
  const el=consoleEl;clearTimeout(foldT);el.classList.remove("folding","shut");el.style.width="";
  if(reduceMotion()){syncLineBar();return}
  const w0=el.offsetWidth;el.classList.toggle("min",linesMin);const w1=el.offsetWidth;el.classList.toggle("min",!linesMin);   // measure both ends
  el.style.width=w0+"px";el.classList.add("folding");if(!linesMin){el.classList.remove("min");syncLineBar();el.classList.add("shut")}
  void el.offsetWidth;el.style.width=w1+"px";if(linesMin)el.classList.add("shut");else el.classList.remove("shut");
  foldT=setTimeout(()=>{el.classList.remove("folding","shut");el.style.width="";syncLineBar()},470)};
syncLineBar();
function lineBounds(key){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const r of LINES[key].routes)for(const p of r.anc){x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);x1=Math.max(x1,p[0]);y1=Math.max(y1,p[1])}
  const pad=15;return{x0:x0-pad,y0:y0-pad,x1:x1+pad+15,y1:y1+pad}}
function setFocus(key){
  focusKey=key;document.body.classList.toggle("focused",!!key);
  if(key&&LINES[key].sys!==lineGroup)setGroup(LINES[key].sys);          // its button has to be on show
  allChip.setAttribute("aria-pressed",String(!key));
  for(const k of ORDER){chips[k].setAttribute("aria-pressed",String(k===key));
    lineEls[k].track.classList.toggle("dim",!!key&&k!==key);if(lineEls[k].cases)lineEls[k].cases.classList.toggle("dim",!!key&&k!==key)}
  for(const rec of STATIONS)rec.g.classList.toggle("dim",!!key&&!rec.lines.has(key));
  for(const x of XLINKS)x.g.classList.toggle("dim",!!key&&!x.a.lines.has(key)&&!x.b.lines.has(key));
  // put the focused line on top so shared corridors read clearly
  if(key)lineEls[key].track.parentNode.appendChild(lineEls[key].track);
  for(const t of trains)applyTrainClass(t);
  if(selected&&key&&selected.L.key!==key)closeCard();
  $("focusnote").innerHTML=key?`Showing the <b>${LINES[key].name}</b> only`:"";syncLineBar();
  renderAlerts();
  (key?chips[key]:allChip).scrollIntoView({inline:"center",block:"nearest",behavior:"smooth"});   // phone: keep the active chip in view
  if(key){const b=lineBounds(key);flyTo(fitBox(b))}
  labelsDirty=true;refreshStatus();ctaK=-1;
}
