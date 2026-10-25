
/* =====================================================================
   LINE FOCUS
   ===================================================================== */
const chips={};
const consoleEl=$("console");
const allChip=document.createElement("button");allChip.className="chip all";allChip.textContent="All lines";
allChip.setAttribute("aria-pressed","true");allChip.title="Show all lines and fold this bar";
allChip.onclick=()=>{if(focusKey)setFocus(null);if(!linesMin)ctog.onclick()};consoleEl.appendChild(allChip);   // All lines: back to every line, and fold the bar (the folded "All lines" opens it again)
for(const key of ORDER){const L=LINES[key],b=document.createElement("button");
  b.className="chip";b.setAttribute("aria-pressed","false");b.title=`Show only the ${L.name}`;
  b.innerHTML=`<i style="background:${L.color}"></i>${L.code}<span class="ad" aria-hidden="true"></span><span class="n" id="n-${key}"></span>`;
  b.onclick=()=>setFocus(focusKey===key?null:key);consoleEl.appendChild(b);chips[key]=b}
consoleEl.appendChild($("focusnote"));
/* the line bar folds down to just the current choice; remembered in this browser */
const ctog=document.createElement("button");ctog.className="ctog";consoleEl.appendChild(ctog);
const LINES_MIN_KEY="nitabot.linesMin";
let linesMin=(()=>{try{return localStorage.getItem(LINES_MIN_KEY)==="1"}catch(_){return false}})();
function syncLineBar(){consoleEl.classList.toggle("min",linesMin);
  const cur=focusKey?`<i style="background:${LINES[focusKey].color}"></i>${LINES[focusKey].code}`:"All lines";
  ctog.innerHTML=`<span class="cur">${cur}</span><span aria-hidden="true">${linesMin?"▸":"◂"}</span>`;
  ctog.setAttribute("aria-expanded",String(!linesMin));
  ctog.setAttribute("aria-label",linesMin?"Show all the line buttons":"Fold the line buttons away");ctog.title=linesMin?"Show lines":"Hide lines";labelsDirty=true}
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
  allChip.setAttribute("aria-pressed",String(!key));
  for(const k of ORDER){chips[k].setAttribute("aria-pressed",String(k===key));
    lineEls[k].track.classList.toggle("dim",!!key&&k!==key);if(lineEls[k].cases)lineEls[k].cases.classList.toggle("dim",!!key&&k!==key)}
  for(const rec of STATIONS)rec.g.classList.toggle("dim",!!key&&!rec.lines.has(key));
  // put the focused line on top so shared corridors read clearly
  if(key)trackG.appendChild(lineEls[key].track);
  for(const t of trains)applyTrainClass(t);
  if(selected&&key&&selected.L.key!==key)closeCard();
  $("focusnote").innerHTML=key?`Showing the <b>${LINES[key].name}</b> only`:"";syncLineBar();
  renderAlerts();
  (key?chips[key]:allChip).scrollIntoView({inline:"center",block:"nearest",behavior:"smooth"});   // phone: keep the active chip in view
  if(key){const b=lineBounds(key);flyTo(fitBox(b))}
  labelsDirty=true;refreshStatus();
}
