})()}
/* =====================================================================
   SATELLITE MAP (optional, button by the title, S)
   Aerial photos from the USGS National Map (USDA NAIP orthoimagery, public domain), loaded straight from
   USGS as the map's background. Each 256 px Web Mercator tile is placed by its own latitude/longitude, so it
   lines up with the real track; only tiles for what's on screen load, at a detail level matched to the zoom.
   The drawn city and street grid step aside while it's on; Lake Michigan stays drawn (USGS has no photos far
   out on the lake). Remembered in this browser.
   ===================================================================== */
const SAT_URL=(z,x,y)=>`https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`;
const SAT_KEY="ctabot.satellite",SAT_ZMAX=16,SAT_ZMIN=9,SAT_MAXTILES=120;
let satOn=(()=>{try{return localStorage.getItem(SAT_KEY)==="1"}catch(_){return false}})();
const satG=el("g",{class:"sat","aria-hidden":"true"});world.insertBefore(satG,world.firstChild);   // under everything: the drawn lake, the sonar and the lines all sit on top
const satLayers=new Map(),satTiles=new Map();let satKey="",satT=0,satZ=0;
const unGeo=(x,y)=>[GP.lat0-y/(110.54*GP.k),x/(111.32*GP.cos*GP.k)+GP.lon0];   // map units -> lat, lon
const tileLon=(x,z)=>x/2**z*360-180,tileLat=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;
const lonTile=(lon,z)=>Math.floor((lon+180)/360*2**z),latTile=(lat,z)=>{const r=lat*Math.PI/180;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*2**z)};
function satLayer(z){let g=satLayers.get(z);if(!g){g=el("g",{});satLayers.set(z,g);
    const after=[...satLayers.keys()].filter(k=>k>z).sort((a,b)=>a-b)[0];satG.insertBefore(g,after!=null?satLayers.get(after):null)}return g}
function satUpdate(){
  // the view (wider while riding: the map turns and tilts), in tiles at a zoom where one tile is ~300 px on screen
  const ride=document.body.classList.contains("chasing"),m=ride?.9:.25,
    x0=vb.x-vb.w*m,x1=vb.x+vb.w*(1+m),y0=vb.y-vb.h*m,y1=vb.y+vb.h*(1+m);
  const [la1,lo0]=unGeo(x0,y0),[la0,lo1]=unGeo(x1,y1),pxPerKm=cw()/vb.w*GP.k*Math.min(2,window.devicePixelRatio||1);
  let z=Math.round(Math.log2(40075*Math.cos(41.88*Math.PI/180)*pxPerKm/300));z=Math.max(SAT_ZMIN,Math.min(SAT_ZMAX,z));
  let tx0,tx1,ty0,ty1;
  for(;;){tx0=lonTile(lo0,z);tx1=lonTile(lo1,z);ty0=latTile(la1,z);ty1=latTile(la0,z);
    if((tx1-tx0+1)*(ty1-ty0+1)<=SAT_MAXTILES||z<=SAT_ZMIN)break;z--}
  satZ=z;const want=new Set(),g=satLayer(z);let pending=0;
  for(let tx=tx0;tx<=tx1;tx++)for(let ty=ty0;ty<=ty1;ty++){const k=z+"/"+tx+"/"+ty;want.add(k);let t=satTiles.get(k);
    if(!t){const[ax,ay]=geo(tileLat(ty,z),tileLon(tx,z)),[bx,by]=geo(tileLat(ty+1,z),tileLon(tx+1,z));
      const im=el("image",{x:ax.toFixed(3),y:ay.toFixed(3),width:(bx-ax).toFixed(3),height:(by-ay).toFixed(3),preserveAspectRatio:"none"},g);
      t={im,z,ok:false};satTiles.set(k,t);
      im.addEventListener("load",()=>{t.ok=true;satPrune()});im.addEventListener("error",()=>{t.ok=true;satPrune()});
      im.setAttribute("href",SAT_URL(z,tx,ty))}
    if(!t.ok)pending++}
  satWant=want;if(!pending)satPrune()}
let satWant=new Set();
// tiles of other zooms stay as a backdrop until the new ones have loaded, then go
function satPrune(){for(const k of satWant){const t=satTiles.get(k);if(t&&!t.ok)return}
  for(const[k,t]of satTiles)if(!satWant.has(k)){t.im.remove();satTiles.delete(k)}
  if(satTiles.size>600){satTiles.clear();satLayers.clear();satG.textContent=""}}
function satFrame(){if(!satOn)return;const k=vb.x.toFixed(1)+","+vb.y.toFixed(1)+","+vb.w.toFixed(2)+(document.body.classList.contains("chasing")?"r":"");
  if(k===satKey)return;satKey=k;const now=performance.now();if(now-satT<180){clearTimeout(satFrame.to);satFrame.to=setTimeout(()=>{satKey="";satFrame()},200);return}
  satT=now;satUpdate()}
const satBtn=$("satBtn"),satCred=$("satcred");
function applySat(){document.body.classList.toggle("satmode",satOn);satBtn.setAttribute("aria-pressed",String(satOn));
  satBtn.title=satOn?"Back to the drawn map (S)":"Satellite map (S)";satBtn.setAttribute("aria-label",satOn?"Switch to the drawn map":"Switch to the satellite map");
  satCred.hidden=!satOn;satKey="";if(satOn)satFrame();labelsDirty=true}
satBtn.addEventListener("click",()=>{satOn=!satOn;try{localStorage.setItem(SAT_KEY,satOn?"1":"0")}catch(_){}applySat()});
addEventListener("keydown",e=>{if(e.target.closest&&e.target.closest("input,textarea"))return;if((e.key==="s"||e.key==="S")&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!introOpen)satBtn.click()});
