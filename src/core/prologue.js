<script>
(()=>{
"use strict";
const NS="http://www.w3.org/2000/svg";
const $=id=>document.getElementById(id);
const el=(t,a={},p)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e};
const WORKER_URL="https://transit-aquarium.edawk10.workers.dev";
// ?dashboard: NITABot framed inside Desk Glance (a desk display). Metra only, no controls, no welcome, no sound;
// the frame asks for a train of the moment each time its slide comes up. See core/dashboard.js.
const DASH=new URLSearchParams(location.search).has("dashboard");
