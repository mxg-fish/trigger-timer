const stateEl = document.getElementById("state");
const elapsedEl = document.getElementById("elapsed");
const dbReadout = document.getElementById("dbReadout");
const meterBar = document.getElementById("meterBar");
const thresholdMarker = document.getElementById("thresholdMarker");

const threshold = document.getElementById("threshold");
const interval = document.getElementById("interval");
const volume = document.getElementById("volume");
const frequency = document.getElementById("frequency");

const thresholdValue = document.getElementById("thresholdValue");
const intervalValue = document.getElementById("intervalValue");
const volumeValue = document.getElementById("volumeValue");
const frequencyValue = document.getElementById("frequencyValue");

const armBtn = document.getElementById("armBtn");
const testBtn = document.getElementById("testBtn");
const stopBtn = document.getElementById("stopBtn");

let audioCtx, analyser, micStream, source;
let animationId, beepTimerId, elapsedTimerId;
let armed = false;
let running = false;
let startedAt = 0;
let lastTriggerAt = 0;

function syncLabels() {
  thresholdValue.textContent = threshold.value;
  intervalValue.textContent = Number(interval.value).toFixed(1);
  volumeValue.textContent = volume.value;
  frequencyValue.textContent = frequency.value;
  thresholdMarker.style.left = `${dbToPercent(Number(threshold.value))}%`;
}
[threshold, interval, volume, frequency].forEach(el => el.addEventListener("input", syncLabels));
syncLabels();

function dbToPercent(db) {
  const min = -80, max = -5;
  return Math.max(0, Math.min(100, ((db - min) / (max - min)) * 100));
}

function formatElapsed(ms) {
  const totalTenths = Math.floor(ms / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

async function setupAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") await audioCtx.resume();

  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);
  }
}

function getDbLevel() {
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);

  let sumSquares = 0;
  for (const sample of data) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / data.length) || 0.000001;

  return 20 * Math.log10(rms);
}

function monitor() {
  const db = getDbLevel();
  dbReadout.textContent = `${db.toFixed(1)} dB`;
  meterBar.style.width = `${dbToPercent(db)}%`;

  const now = performance.now();
  const debounceMs = 120;

  if (armed && !running && db >= Number(threshold.value) && now - lastTriggerAt > debounceMs) {
    lastTriggerAt = now;
    startTimer();
  }

  animationId = requestAnimationFrame(monitor);
}

function startTimer() {
  running = true;
  armed = false;
  startedAt = performance.now();

  stateEl.textContent = "Running";
  armBtn.disabled = true;
  stopBtn.disabled = false;

  playBeep();

  beepTimerId = setInterval(playBeep, Number(interval.value) * 1000);
  elapsedTimerId = setInterval(() => {
    elapsedEl.textContent = formatElapsed(performance.now() - startedAt);
  }, 100);
}

function playBeep() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.frequency.value = Number(frequency.value);
  osc.type = "sine";

  const now = audioCtx.currentTime;
  const peak = Number(volume.value) / 100;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

async function arm() {
  try {
    await setupAudio();
    armed = true;
    running = false;
    stateEl.textContent = "Armed";
    armBtn.disabled = true;
    stopBtn.disabled = false;

    if (!animationId) monitor();
  } catch (err) {
    stateEl.textContent = "Mic blocked";
    alert("Microphone access is required. On iOS, allow microphone access in Safari settings and reload the app.");
    console.error(err);
  }
}

function stopAll() {
  armed = false;
  running = false;
  stateEl.textContent = "Idle";
  elapsedEl.textContent = "00:00.0";

  clearInterval(beepTimerId);
  clearInterval(elapsedTimerId);
  beepTimerId = null;
  elapsedTimerId = null;

  armBtn.disabled = false;
  stopBtn.disabled = true;
}

armBtn.addEventListener("click", arm);
testBtn.addEventListener("click", async () => {
  await setupAudio();
  playBeep();
});
stopBtn.addEventListener("click", stopAll);

window.addEventListener("pagehide", () => {
  clearInterval(beepTimerId);
  clearInterval(elapsedTimerId);
});
