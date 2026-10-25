
/* =====================================================================
   NETWORK DATA
   Written by tools/build_layout.py from CTA's own timetable data (GTFS: stations, stop patterns and the real
   track shapes) and the US Census map of Lake Michigan and the towns. True geography: 30 map units per km,
   nothing enlarged, so the Loop is its real size and you zoom in to read it.
   Each route runs from its outer terminal in toward the Loop (loop lines: and once around it).
     anc   the line's centre line, along real track
     ds    each stop's distance along anc
     slot  where the line sits in a shared-track bundle on each piece of anc (0 = centre, ±0.5, ±1, ...)
   ===================================================================== */
/*NET:BEGIN*/const NET=null;/*NET:END*/
const WORLD={x0:NET.world.x0,y0:NET.world.y0,x1:NET.world.x1,y1:NET.world.y1};            // the camera: every station, plus a margin
const BOX=NET.box;                                                         // what the base map (lake, towns) covers: wider, so its edges stay off-screen
const CTA_ORDER=["red","blue","brn","g","org","pink","p","y"];             // CTA's own order
const METRA_ORDER=NET.metra_order||[];                                      // MetraBot's order: UP-N, UP-NW, UP-W, MD-N, ...
const ORDER=[...CTA_ORDER,...METRA_ORDER];
const LINES={};for(const k of ORDER){const L=NET.lines[k];LINES[k]={key:k,code:L.code,name:L.name,color:L.color,api:L.api,sys:L.sys||"cta",routes:L.routes}}
const STOPS=NET.stations;                                                  // CTA station id -> {name, lat, lon, ada}
const PLATFORM=NET.platforms;                                              // CTA platform (stop) id -> station id
const API_KEY={};for(const k of CTA_ORDER)API_KEY[LINES[k].api]=k;       // "Red" -> "red"
const METRA_KEY={};for(const k of METRA_ORDER)METRA_KEY[LINES[k].api]=k;   // "UP-N" -> "upn"
const isMetra=k=>LINES[k]&&LINES[k].sys==="metra";
// CTA tells same-named stations apart with "(Red)", "(Brown/Purple)", ...; on the map the line colours do that
const shortName=n=>String(n||"").replace(/\s*\([^)]*\)\s*$/,"").replace("Harold Washington Library-State/Van Buren","Harold Washington Library");
