export const dashboardHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Krypton Paper</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b0d10;color:#e9edf2;font:14px system-ui,-apple-system,sans-serif}
header{padding:18px 5%;border-bottom:1px solid #29313a;display:flex;justify-content:space-between;align-items:center}
.brand{font-weight:900;letter-spacing:.16em}.brand b,.up{color:#26c281}.down{color:#ef5350}
.tag,.pill{font-size:11px;padding:5px 8px;border:1px solid #356b57;border-radius:3px;color:#8cf0bd}.pill.loss{border-color:#6b3540;color:#f08b96}
.wrap{max-width:1280px;margin:auto;padding:28px}h1{margin:6px 0 20px}
.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}.card,.panel{background:#12161c;border:1px solid #29313a;border-radius:5px}
.card{padding:18px}.label,.muted{color:#8993a0;font-size:12px}.value{font-size:25px;font-weight:750;margin-top:8px}
.layout{display:grid;grid-template-columns:1.6fr 1fr;gap:14px;margin-top:14px}.layout>*{min-width:0}
.panel h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0;padding:15px 18px;border-bottom:1px solid #29313a}
.chead{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid #29313a}.zoom{display:flex;gap:5px;align-items:center}.zoom button{background:#1a2028;color:#cfd7e1;border:1px solid #39424d;border-radius:3px;padding:4px 8px;cursor:pointer}.zoom button:hover{border-color:#26c281;color:#fff}.zoom input{accent-color:#26c281;width:95px}.zoom output{min-width:30px;text-align:center;color:#8cf0bd;font:12px ui-monospace}
.chead h2{padding:0;border:0}.ohlc{font:12px ui-monospace,Menlo,monospace;color:#8993a0}.ohlc span{color:#e9edf2;margin-right:8px}
.live{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#8993a0}.live i{width:7px;height:7px;border-radius:50%;background:#26c281;animation:p 1.5s infinite}
@keyframes p{50%{opacity:.25}}
.chart{height:340px;position:relative}.chart svg{display:block;width:100%;height:100%}
.chart text{font:11px ui-monospace,Menlo,monospace;fill:#8993a0}.gl{stroke:#1d232b;stroke-width:1}
.row{display:grid;grid-template-columns:1fr auto auto;gap:12px;padding:12px 18px;border-bottom:1px solid #222831;align-items:center}
.event{padding:12px 18px;border-bottom:1px solid #222831}.feed{max-height:340px;overflow:auto}
.empty{padding:35px 18px;text-align:center;color:#8993a0}
.stats{display:grid;grid-template-columns:repeat(6,1fr)}.stat{padding:14px 18px;border-right:1px solid #222831;border-bottom:1px solid #222831}.stat b{display:block;font-size:18px;margin-top:6px}a.pill{text-decoration:none}@media(max-width:760px){.stats{grid-template-columns:repeat(2,1fr)}}.notice{margin-top:14px;padding:12px;border-left:3px solid #f2b74d;background:#211d15;color:#d9c18a;font-size:12px}
@media(max-width:1100px){.grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}.wrap{padding:16px}.chart{height:280px}}
</style></head><body><header><div class="brand">KRYPTON <b>PAPER</b></div><div class="tag">SIMULATION ONLY</div></header>
<main class="wrap"><p class="muted">SOLANA MEMECOIN DESK · 15 SECOND CANDLES</p><h1>Paper Trading Overview</h1>
<section class="grid"><div class="card"><div class="label">Portfolio value (net)</div><div class="value" id="portfolio">–</div></div><div class="card"><div class="label">Available cash</div><div class="value" id="cash">–</div></div><div class="card"><div class="label">Open positions</div><div class="value" id="positions">–</div></div><div class="card"><div class="label">Daily loss used</div><div class="value" id="loss">–</div></div><div class="card"><div class="label">Realized P&amp;L (net)</div><div class="value" id="pnl">–</div></div><div class="card"><div class="label">Fees paid</div><div class="value" id="fees">–</div><div class="muted" id="sol"></div></div></section>
<section class="layout"><div class="panel"><div class="chead"><h2>Portfolio · 15s</h2><div class="zoom"><button id="zoomOut" type="button" aria-label="Zoom out">−</button><input id="zoom" type="range" min="1" max="6" step="1" value="1" aria-label="Chart zoom"><output id="zoomValue">1×</output><button id="zoomIn" type="button" aria-label="Zoom in">+</button></div><div class="ohlc" id="ohlc"></div><div class="live"><i></i><span id="countdown">–</span></div></div><div class="chart" id="chart"><div class="empty">Waiting for the first candle…</div></div></div>
<div class="panel"><h2>Live activity</h2><div id="activity" class="feed"><div class="empty">Waiting for the first scan</div></div></div></section>
<section class="layout"><div class="panel"><h2>Open positions</h2><div id="position-list"><div class="empty">No active paper positions</div></div></div><div class="panel"><h2>Recent exits</h2><div id="trade-list" class="feed"><div class="empty">No closed paper trades yet</div></div></div></section>
<section class="panel" style="margin-top:14px"><div class="chead"><h2>Performance</h2><div class="muted" id="since"></div><a class="pill" href="/api/trades.csv" download>Export CSV</a></div><div class="stats" id="stats"><div class="empty">No closed trades yet</div></div></section><div class="notice" id="notice">Paper mode only. No wallet is connected and no on-chain transaction can be sent.</div><p class="muted" id="checkpoints"></p><p class="muted" id="updated">Loading live status…</p></main>
<script>
const $=id=>document.getElementById(id),money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n),px=n=>n>=1?money(n):'$'+Number(n).toPrecision(4),short=t=>t.length>12?t.slice(0,7)+'…'+t.slice(-4):t;
const UP='#26c281',DOWN='#ef5350';let candles=[],candleMs=15000,clockOffset=0,hover=null,zoom=1;
function rows(a,kind){return a.length?a.map(x=>'<div class="row"><div><strong>'+(x.symbol||short(x.token))+'</strong><div class="muted">'+(kind?x.reason+(x.feesUsd!=null?' · fees '+money(x.feesUsd):''):'Opened '+new Date(x.openedAt).toLocaleTimeString()+(x.buyFeesUsd!=null?' · fees '+money(x.buyFeesUsd):''))+'</div></div><div class="muted">'+(kind?new Date(x.closedAt).toLocaleTimeString():'Entry '+px(x.entryPriceUsd)+(x.fillPriceUsd?' · fill '+px(x.fillPriceUsd):''))+'</div><div class="pill '+(kind&&x.pnlUsd<0?'loss':'')+'">'+(kind?(x.pnlUsd>=0?'+':'')+money(x.pnlUsd):money(x.amountUsd))+'</div></div>').join(''):'<div class="empty">No data yet</div>'}
function decimals(range){return range<0.01?4:range<1?3:2}
function fmt(v,d){return v.toFixed(d)}
function draw(){
  const el=$('chart'),W=el.clientWidth,H=el.clientHeight;
  if(!candles.length){el.innerHTML='<div class="empty">Waiting for the first candle…</div>';return}
  const padR=72,padB=24,padT=12,plotW=W-padR,plotH=H-padB-padT,slot=Math.max(7,Math.min(16,plotW/40)),n=Math.max(1,Math.floor(plotW/slot/zoom)),vis=candles.slice(-n);
  let lo=Math.min(...vis.map(c=>c.low)),hi=Math.max(...vis.map(c=>c.high));
  const minRange=Math.max(Math.abs(hi)*0.0005,0.0004);if(hi-lo<minRange){const m=(hi+lo)/2;lo=m-minRange/2;hi=m+minRange/2}
  const pad=(hi-lo)*0.08;lo-=pad;hi+=pad;
  const y=v=>padT+(hi-v)/(hi-lo)*plotH,d=decimals(hi-lo),x0=plotW-vis.length*slot;
  let s='<svg viewBox="0 0 '+W+' '+H+'">';
  for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,yy=y(v).toFixed(1);s+='<line class="gl" x1="0" x2="'+plotW+'" y1="'+yy+'" y2="'+yy+'"/><text x="'+(plotW+8)+'" y="'+(+yy+4)+'">'+fmt(v,d)+'</text>'}
  const every=Math.max(1,Math.ceil(80/slot));
  vis.forEach((c,i)=>{const cx=x0+i*slot+slot/2;if((c.time/candleMs)%every===0){s+='<line class="gl" x1="'+cx+'" x2="'+cx+'" y1="'+padT+'" y2="'+(padT+plotH)+'"/><text x="'+cx+'" y="'+(H-7)+'" text-anchor="middle">'+new Date(c.time).toLocaleTimeString('de-DE')+'</text>'}});
  vis.forEach((c,i)=>{const cx=x0+i*slot+slot/2,col=c.close>=c.open?UP:DOWN,bw=Math.max(3,slot*0.62),top=y(Math.max(c.open,c.close)),bh=Math.max(1,y(Math.min(c.open,c.close))-top);
    s+='<g data-i="'+(candles.length-vis.length+i)+'"><rect x="'+(cx-slot/2)+'" y="'+padT+'" width="'+slot+'" height="'+plotH+'" fill="transparent"/><line x1="'+cx+'" x2="'+cx+'" y1="'+y(c.high).toFixed(1)+'" y2="'+y(c.low).toFixed(1)+'" stroke="'+col+'" stroke-width="1"/><rect x="'+(cx-bw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+bh.toFixed(1)+'" fill="'+col+'"/></g>'});
  const last=candles.at(-1),ly=y(last.close).toFixed(1),lc=last.close>=last.open?UP:DOWN;
  s+='<line x1="0" x2="'+plotW+'" y1="'+ly+'" y2="'+ly+'" stroke="'+lc+'" stroke-dasharray="3 3" stroke-width="1"/><rect x="'+plotW+'" y="'+(ly-9)+'" width="'+padR+'" height="18" fill="'+lc+'"/><text x="'+(plotW+8)+'" y="'+(+ly+4)+'" style="fill:#0b0d10;font-weight:700">'+fmt(last.close,d)+'</text></svg>';
  el.innerHTML=s;showOhlc();
}
function showOhlc(){const c=candles[hover??candles.length-1];if(!c)return;const d=decimals(Math.max(...candles.map(c=>c.high))-Math.min(...candles.map(c=>c.low))),ch=c.close-c.open,cls=ch>=0?'up':'down';$('ohlc').innerHTML='O<span>'+fmt(c.open,d)+'</span>H<span>'+fmt(c.high,d)+'</span>L<span>'+fmt(c.low,d)+'</span>C<span class="'+cls+'">'+fmt(c.close,d)+'</span><b class="'+cls+'">'+(ch>=0?'+':'')+fmt(ch,d)+'</b>'}
$('chart').addEventListener('mousemove',e=>{const g=e.target.closest('g[data-i]');const i=g?+g.dataset.i:null;if(i!==hover){hover=i;showOhlc()}});
$('chart').addEventListener('mouseleave',()=>{hover=null;showOhlc()});
const zoomControl=$('zoom');function setZoom(value){zoom=Math.max(1,Math.min(6,value));zoomControl.value=zoom;$('zoomValue').textContent=zoom+'×';draw()}zoomControl.addEventListener('input',()=>setZoom(Number(zoomControl.value)));$('zoomOut').addEventListener('click',()=>setZoom(zoom-1));$('zoomIn').addEventListener('click',()=>setZoom(zoom+1));
function tickCountdown(){const now=Date.now()+clockOffset,left=Math.ceil((candleMs-now%candleMs)/1000);$('countdown').textContent='next candle in '+left+'s'}
function stats(s){const t=s.stats;if(!t)return;$('since').textContent=(t.since?'since '+new Date(t.since).toLocaleString():'')+' · storage: '+s.storage+(s.storage==='file'?' (resets on restart)':'');const signed=v=>v==null?'–':(v>=0?'+':'-')+money(Math.abs(v)),cls=v=>v==null?'':v<0?'down':'up',items=[['Return',t.returnPercent==null?'–':(t.returnPercent>=0?'+':'')+t.returnPercent+' %',cls(t.returnPercent)],['Realized P&amp;L',signed(t.realizedPnlUsd),cls(t.realizedPnlUsd)],['Trades',t.trades+' ('+t.wins+'W / '+t.losses+'L)',''],['Win rate',t.winRatePercent==null?'–':t.winRatePercent+' %',''],['Profit factor',t.profitFactor??'–',''],['Fees paid',money(t.feesPaidUsd),''],['Avg trade',signed(t.avgPnlUsd),cls(t.avgPnlUsd)],['Avg win',signed(t.avgWinUsd),'up'],['Avg loss',signed(t.avgLossUsd),'down'],['Best trade',signed(t.bestTradeUsd),cls(t.bestTradeUsd)],['Worst trade',signed(t.worstTradeUsd),cls(t.worstTradeUsd)],['Avg hold',t.avgHoldMinutes==null?'–':t.avgHoldMinutes+' min','']];$('stats').innerHTML=items.map(([l,v,c])=>'<div class="stat"><span class="muted">'+l+'</span><b class="'+c+'">'+v+'</b></div>').join('')}
async function refresh(){try{
  const s=await fetch('/api/status',{cache:'no-store'}).then(r=>r.json());
  clockOffset=s.serverTime?Date.parse(s.serverTime)-Date.now():0;candleMs=s.candleMs||15000;candles=s.candles||[];
  $('portfolio').textContent=money(s.portfolioUsd);$('cash').textContent=money(s.cashUsd);$('positions').textContent=s.openPositions+' / '+s.maxOpenPositions;$('loss').textContent=money(s.dailyLossUsd)+' / $5.00';$('pnl').textContent=(s.realizedPnlUsd>=0?'+':'')+money(s.realizedPnlUsd);$('pnl').className='value '+(s.realizedPnlUsd<0?'down':'up');$('fees').textContent=money(s.feesPaidUsd);$('sol').textContent=(s.solPriceUsd?'SOL '+money(s.solPriceUsd):'')+(s.priorityFeeSol!=null?' · prio '+s.priorityFeeSol.toFixed(6)+' SOL ('+s.priorityFeeSource+')':'');
  $('checkpoints').textContent='Storage: '+s.storage+' · Last save: '+(s.lastSavedAt?new Date(s.lastSavedAt).toLocaleTimeString():'pending')+(s.saveError?' · '+s.saveError:'')+' · Self-ping: '+(s.keepAlive?.lastError|| (s.keepAlive?.lastSuccess?new Date(s.keepAlive.lastSuccess).toLocaleTimeString():s.keepAlive?.enabled?'pending':'off'));
  stats(s);draw();$('position-list').innerHTML=rows(s.positions);$('trade-list').innerHTML=rows(s.closedTrades,true);
  $('activity').innerHTML=s.events.length?s.events.map(e=>'<div class="event"><strong class="'+(e.type==='stop-loss'?'down':'up')+'">'+e.type+'</strong><div>'+e.detail+'</div><div class="muted">'+new Date(e.at).toLocaleTimeString()+'</div></div>').join(''):'<div class="empty">Waiting for the first scan</div>';
  $('updated').textContent='Last price tick: '+(s.lastTickAt?new Date(s.lastTickAt).toLocaleTimeString():'waiting')+' · Last scan: '+(s.lastScanAt?new Date(s.lastScanAt).toLocaleTimeString():'waiting')+' · Swap pricing: '+(!s.jupiter?.enabled?'cost model':s.jupiter.lastError?'cost model (Jupiter: '+s.jupiter.lastError+')':'Jupiter quotes'+(s.jupiter.authenticated?'':' (no API key)'));
  $('notice').textContent=s.lastError?'Market data temporarily unavailable: '+s.lastError:'Paper mode only. No wallet is connected and no on-chain transaction can be sent.';
}catch{$('updated').textContent='Status temporarily unavailable'}}
refresh();setInterval(refresh,2000);setInterval(tickCountdown,250);addEventListener('resize',draw);
</script></body></html>`;
