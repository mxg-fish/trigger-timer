
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
const testBtn=document.getElementById("testBtn");

let ctx, analyser, mic, source;
let armed=false;
let startedAt=0;
let raf;
let active=[];
let timingTimeout=null;
let stopTimeout=null;
let soundStartedAt=0;
let soundDurationMs=2500;
let latencyMs=Number(localStorage.getItem("soundTimerLatencyMs") || 0);

function sync(){
 const dur=Number(duration.value);
 intervalValue.textContent=Number(interval.value).toFixed(2);
 thresholdValue.textContent=threshold.value;
 durationValue.textContent=dur.toFixed(2);
 volumeValue.textContent=volume.value;
 testBtn.textContent=`Test ${dur.toFixed(2)}s Sound`;

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

function makeTone({freq=1000,endFreq=null,type="sine",start=0,dur=2.5,gainAmt=1}){
 const o=ctx.createOscillator();
 const g=ctx.createGain();
 const startTime=ctx.currentTime+start;
 const endTime=startTime+dur;

 o.type=type;
 o.frequency.setValueAtTime(freq,startTime);
 if(endFreq!==null) {
   o.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq),endTime);
 }

 const attack=0.015;
 const release=Math.min(0.18,dur*0.18);
 const peak=Math.max(.0001,gainAmt);

 g.gain.setValueAtTime(0.0001,startTime);
 g.gain.exponentialRampToValueAtTime(peak,startTime+attack);
 g.gain.setValueAtTime(peak,Math.max(startTime+attack,endTime-release));
 g.gain.exponentialRampToValueAtTime(0.0001,endTime);

 o.connect(g).connect(ctx.destination);
 o.start(startTime);
 o.stop(endTime+.04);
 active.push(o,g);
}

function playSound(){
 stopAudio();

 const dur=Number(duration.value);
 const vol=Math.max(.0001,Number(volume.value)/100);
 const s=soundChoice.value;
 soundStartedAt=performance.now();
 soundDurationMs=dur*1000;

 // Every option below starts once and ends exactly from the Sound Length slider.
 if(s==="beep"){
   makeTone({freq:1050,type:"sine",dur,gainAmt:vol});
 }

 if(s==="alarm"){
   makeTone({freq:1200,endFreq:900,type:"square",dur,gainAmt:vol});
 }

 if(s==="gong"){
   makeTone({freq:260,endFreq:95,type:"triangle",dur,gainAmt:vol});
   makeTone({freq:390,endFreq:145,type:"sine",dur,gainAmt:vol*.35});
 }

 if(s==="woo"){
   makeTone({freq:520,endFreq:880,type:"sawtooth",dur,gainAmt:vol*.85});
   makeTone({freq:780,endFreq:430,type:"triangle",dur,gainAmt:vol*.45});
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
 soundStartedAt=0;
 clearTimeout(timingTimeout);
 clearTimeout(stopTimeout);
 cancelAnimationFrame(raf);
 stopAudio();
 stateEl.textContent="Idle";
 elapsedEl.textContent="00:00.00";
}

function watchSoundCompletion(){
 const tick=()=>{
   if(!soundStartedAt) return;
   const remaining=Math.max(0,soundDurationMs-(performance.now()-soundStartedAt));
   stateEl.textContent=`Sound ${(remaining/1000).toFixed(1)}s`;
   if(remaining>0){
     raf=requestAnimationFrame(tick);
   } else {
     soundStartedAt=0;
     stateEl.textContent="Complete";
   }
 };
 tick();
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
        playSound();
        watchSoundCompletion();
        stopTimeout=setTimeout(()=>{
          stopAudio();
          soundStartedAt=0;
          stateEl.textContent="Complete";
          startedAt=0;
        },Number(duration.value)*1000+80);

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
   latencyMs=Math.max(0,detectedAt-chirpStart-20);
   localStorage.setItem("soundTimerLatencyMs",String(latencyMs));
   stateEl.textContent="Calibrated";
 }else{
   stateEl.textContent="Calibration failed";
   alert("Could not detect the calibration chirp. Move the phone closer to the speaker, turn up volume, and try again.");
 }

 sync();
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

document.getElementById("armBtn").onclick=arm;

testBtn.onclick=async()=>{
 await setupAudio();
 playSound();
 watchSoundCompletion();
 setTimeout(()=>{
   stopAudio();
   soundStartedAt=0;
   if(stateEl.textContent.startsWith("Sound")) stateEl.textContent="Idle";
 },Number(duration.value)*1000+80);
};

document.getElementById("stopBtn").onclick=stopAll;

document.getElementById("calibrateBtn").onclick=calibrateLatency;

document.getElementById("clearLatencyBtn").onclick=()=>{
 latencyMs=0;
 localStorage.removeItem("soundTimerLatencyMs");
 sync();
 stateEl.textContent="Offset cleared";
};
