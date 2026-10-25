<script>
(()=>{
"use strict";
const NS="http://www.w3.org/2000/svg";
const $=id=>document.getElementById(id);
const el=(t,a={},p)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e};
const WORKER_URL="https://transit-aquarium.edawk10.workers.dev";
