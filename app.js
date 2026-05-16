
const interval=document.getElementById("interval");
const threshold=document.getElementById("threshold");
const duration=document.getElementById("duration");
const volume=document.getElementById("volume");
const intervalValue=document.getElementById("intervalValue");
const thresholdValue=document.getElementById("thresholdValue");
const durationValue=document.getElementById("durationValue");
const volumeValue=document.getElementById("volumeValue");
const soundChoice=document.getElementById("soundChoice");
const stateEl=document.getElementById("state");
const elapsedEl=document.getElementById("elapsed");
const meterBar=document.getElementById("meterBar");
const dbReadout=document.getElementById("dbReadout");
const latencyReadout=document.getElementById("latencyReadout");
const effectiveDelay=document.getElementById("effectiveDelay");

let ctx, analyser, mic, source;
let armed=false;
let startedAt=0;
let raf;
let active=[];
let timingTimeout=null;
let stopTimeout=null;
let latencyMs=Number(localStorage.getItem("soundTimerLatencyMs") || 0);

function sync(){
 intervalValue.textContent=Number(interval.value).toFixed(2);
 thresholdValue.textContent=threshold.value;
 durationValue.textContent=Number(duration.value).toFixed(2);
 volumeValue.textContent=volume.value;

 const targetMs=Number(interval.value)*1000;
 const appDelayMs=Math.max(0,targetMs-latencyMs);

 latencyReadout.innerHTML=`Measured latency: <strong>${Math.round(latencyMs)} ms</strong>`;
 effectiveDelay.innerHTML=`Effective app delay: <strong>${(appDelayMs/1000).toFixed(2)}s</strong>`;
}
sync();
[interval,threshold,duration,volume].forEach(el=>el.oninput=sync);

async function setupAudio(){
 if(!ctx) ctx=new(window.AudioContext||window.webkitAudioContext)();
 if(ctx.state==="suspended") await ctx.resume();

 if(!mic){
  mic=await navigator.mediaDevices.getUserMedia({
    audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}
  });
  source=ctx.createMediaStreamSource(mic);
  analyser=ctx.createAnalyser();
  analyser.fftSize=2048;
  analyser.smoothingTimeConstant=.08;
  source.connect(analyser);
 }
}

function dbPercent(db){return Math.max(0,Math.min(100,((db+80)/75)*100));}

function getDb(){
 const data=new Float32Array(analyser.fftSize);
 analyser.getFloatTimeDomainData(data);
 let sum=0;
 for(const s of data) sum+=s*s;
 const rms=Math.sqrt(sum/data.length)||0.000001;
 return 20*Math.log10(rms);
}

function elapsed(){
 if(!startedAt) return "00:00.00";
 const ms=performance.now()-startedAt;
 const h=Math.floor(ms/10)%100;
 const s=Math.floor(ms/1000)%60;
 const m=Math.floor(ms/60000);
 return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(h).padStart(2,"0")}`;
}

function makeTone({freq=1000,endFreq=null,type="sine",dur=2.5,gainAmt=1,start=0}){
 const o=ctx.createOscillator();
 const g=ctx.createGain();
 const now=ctx.currentTime+start;
 const end=now+dur;

 o.type=type;
 o.frequency.setValueAtTime(freq,now);
 if(endFreq!==null) o.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq),end);

 g.gain.setValueAtTime(0.0001,now);
 g.gain.exponentialRampToValueAtTime(Math.max(.0001,gainAmt),now+.025);
 g.gain.setValueAtTime(Math.max(.0001,gainAmt),end-.12);
 g.gain.exponentialRampToValueAtTime(0.0001,end);

 o.connect(g).connect(ctx.destination);
 o.start(now);
 o.stop(end+.03);
 active.push(o,g);
}

function playCalibrationChirp(){
 const o=ctx.createOscillator();
 const g=ctx.createGain();
 const now=ctx.currentTime;
 const dur=.08;

 o.type="square";
 o.frequency.setValueAtTime(2000,now);

 g.gain.setValueAtTime(0.0001,now);
 g.gain.exponentialRampToValueAtTime(1,now+.005);
 g.gain.exponentialRampToValueAtTime(0.0001,now+dur);

 o.connect(g).connect(ctx.destination);
 o.start(now);
 o.stop(now+dur+.02);
 active.push(o,g);

 return performance.now();
}

function playSound(){
 stopAudio();

 const dur=Number(duration.value);
 const vol=Math.max(.0001,Number(volume.value)/100);
 const s=soundChoice.value;

 if(s==="beep"){
   makeTone({freq:1050,type:"sine",dur,gainAmt:vol});
 }

 if(s==="alarm"){
   makeTone({freq:1250,endFreq:850,type:"square",dur,gainAmt:vol});
 }

 if(s==="gong"){
   makeTone({freq:260,endFreq:120,type:"triangle",dur,gainAmt:vol});
   makeTone({freq:390,endFreq:180,type:"sine",dur:dur*.95,gainAmt:vol*.35});
 }

 if(s==="woo"){
   makeTone({freq:520,endFreq:920,type:"sawtooth",dur:dur*.45,gainAmt:vol});
   makeTone({freq:920,endFreq:460,type:"triangle",dur:dur*.55,gainAmt:vol*.9,start:dur*.45});
 }
}

function stopAudio(){
 for(const n of active){
   try{
     if(n.stop) n.stop();
     if(n.disconnect) n.disconnect();
   }catch(e){}
 }
 active=[];
}

function stopAll(){
 armed=false;
 startedAt=0;
 clearTimeout(timingTimeout);
 clearTimeout(stopTimeout);
 cancelAnimationFrame(raf);
 stopAudio();
 stateEl.textContent="Idle";
 elapsedEl.textContent="00:00.00";
}

async function arm(){
 await setupAudio();
 stopAll();

 armed=true;
 stateEl.textContent="Armed";

 const check=()=>{
   if(!armed) return;

   const db=getDb();
   dbReadout.textContent=`${db.toFixed(1)} dB`;
   meterBar.style.width=`${dbPercent(db)}%`;

   if(db>=Number(threshold.value)){
      armed=false;
      startedAt=performance.now();
      stateEl.textContent="Timing";

      const targetDelayMs=Number(interval.value)*1000;
      const correctedDelayMs=Math.max(0,targetDelayMs-latencyMs);

      timingTimeout=setTimeout(()=>{
        stateEl.textContent="Sound";
        playSound();

        stopTimeout=setTimeout(()=>{
          stateEl.textContent="Complete";
          startedAt=0;
        },Number(duration.value)*1000);

      },correctedDelayMs);
   }

   elapsedEl.textContent=elapsed();
   raf=requestAnimationFrame(check);
 };

 check();
}

async function calibrateLatency(){
 await setupAudio();
 stopAll();

 stateEl.textContent="Calibrating";
 latencyReadout.innerHTML="Measured latency: <strong>listening...</strong>";

 // Establish ambient level before playing chirp.
 let ambient=0;
 for(let i=0;i<12;i++){
   ambient+=getDb();
   await new Promise(r=>setTimeout(r,35));
 }
 ambient/=12;

 const detectionThreshold=Math.max(ambient+18,-35);
 const chirpStart=playCalibrationChirp();

 let detectedAt=null;
 const deadline=performance.now()+1200;

 while(performance.now()<deadline){
   const db=getDb();
   meterBar.style.width=`${dbPercent(db)}%`;
   dbReadout.textContent=`${db.toFixed(1)} dB`;

   if(performance.now()-chirpStart>40 && db>detectionThreshold){
     detectedAt=performance.now();
     break;
   }

   await new Promise(r=>setTimeout(r,5));
 }

 if(detectedAt){
   // Subtract a small acoustic/mic detection cushion. This keeps compensation conservative.
   latencyMs=Math.max(0,detectedAt-chirpStart-20);
   localStorage.setItem("soundTimerLatencyMs",String(latencyMs));
   stateEl.textContent="Calibrated";
 }else{
   stateEl.textContent="Calibration failed";
   alert("Could not detect the calibration chirp. Move the phone closer to the speaker, turn up volume, and try again.");
 }

 sync();
}

document.getElementById("armBtn").onclick=arm;

document.getElementById("testBtn").onclick=async()=>{
 await setupAudio();
 playSound();
 setTimeout(stopAudio,Number(duration.value)*1000+100);
};

document.getElementById("stopBtn").onclick=stopAll;

document.getElementById("calibrateBtn").onclick=calibrateLatency;

document.getElementById("clearLatencyBtn").onclick=()=>{
 latencyMs=0;
 localStorage.removeItem("soundTimerLatencyMs");
 sync();
 stateEl.textContent="Offset cleared";
};
