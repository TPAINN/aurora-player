// Opt-in, local-only measurements. No requests or analytics are sent.
const samples = [];
const stats = { lcpMs: null, cls: 0, longTasks: 0, longestTaskMs: 0, frames: 0 };
for (const type of ['largest-contentful-paint','layout-shift','longtask']) {
  if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (type === 'largest-contentful-paint') stats.lcpMs = Math.round(entry.startTime);
      if (type === 'layout-shift' && !entry.hadRecentInput) stats.cls += entry.value;
      if (type === 'longtask') { stats.longTasks++; stats.longestTaskMs = Math.max(stats.longestTaskMs, Math.round(entry.duration)); }
    }
  }).observe({type,buffered:true});
}
let previous;
function frame(now) {
  if (!document.hidden && previous !== undefined) { samples.push(now-previous); if (samples.length > 3600) samples.shift(); stats.frames++; }
  previous = document.hidden ? undefined : now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const output = document.createElement('output');
output.id = 'aurora-audit'; output.hidden = true; document.body.append(output);
setInterval(() => {
  const sorted = [...samples].sort((a,b)=>a-b);
  output.textContent = JSON.stringify({...stats,cls:Number(stats.cls.toFixed(4)), frameP95Ms: Math.round(sorted[Math.floor(sorted.length*.95)] || 0), framesOver33ms:samples.filter(n=>n>33.4).length, sampleFrames:samples.length,viewport:`${innerWidth}x${innerHeight}`,visibility:document.visibilityState});
},1000);
