/* ============================================================================
   ECHONET X — EDGE THREAT FUSION & TELEMETRY DASHBOARD ENGINE
   ============================================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ==========================================================================
  //  1. SHARED NODE STATE
  // ==========================================================================
  const state = {
    audioRms: 450.0,
    audioScore: 0.08,
    visionScore: 0.05,
    visionActivities: "Human presence",
    hasFix: true,
    lat: 37.774929,
    lng: -122.419416,
    altitude: 15.2,
    satellites: 8,
    threatScore: 0.08,
    level: "GREEN",
    previousLevel: "GREEN",
    redEdge: false,
    corroboration: false,

    // Runtime state
    uptimeSeconds: 0,
    loraTxCount: 0,
    isSimulating: true,
    isMuted: true,
    autoScrollSerial: true,
    connectionMode: 'SIMULATOR', // 'SIMULATOR' or 'WEBSERIAL'
    activeVisionTags: ["Human presence"]
  };

  // Audio Context for browser mic / alarm sound
  let audioCtx = null;
  let micAnalyser = null;
  let micMediaStream = null;
  let alarmOscillator = null;

  // WebSerial
  let serialPort = null;
  let serialReader = null;

  // Leaflet Map
  let map = null;
  let nodeMarker = null;
  let accuracyCircle = null;

  // Timers
  let uptimeInterval = null;
  let audioTimer = null;
  let visionTimer = null;
  let gpsReportTimer = null;
  let telemetryTimer = null;
  let tTelemetryLast = Date.now();

  // DOM Elements
  const elNodeId = document.getElementById('node-id-val');
  const elConnectionMode = document.getElementById('connection-mode-label');
  const elThreatBadge = document.getElementById('threat-level-badge');
  const elThreatIcon = document.getElementById('threat-icon');
  const elThreatText = document.getElementById('threat-level-text');
  const elEmergencyBanner = document.getElementById('emergency-banner');
  const elEmergencyDesc = document.getElementById('emergency-desc');
  const elBtnAckEmergency = document.getElementById('btn-ack-emergency');

  const elThreatScoreNum = document.getElementById('threat-score-num');
  const elBarVision = document.getElementById('bar-vision');
  const elValVision = document.getElementById('val-vision');
  const elBarAudio = document.getElementById('bar-audio');
  const elValAudio = document.getElementById('val-audio');
  const elCorroborationBadge = document.getElementById('corroboration-badge');
  const elFormulaBonusText = document.getElementById('formula-bonus-text');
  const elDotRedEdge = document.getElementById('dot-red-edge');
  const elTxtRedEdge = document.getElementById('txt-red-edge');
  const elTxtPrevLevel = document.getElementById('txt-prev-level');

  const elLoraStatusBadge = document.getElementById('lora-status-badge');
  const elLoraUptimeVal = document.getElementById('lora-uptime-val');
  const elLoraTxCount = document.getElementById('lora-tx-count');
  const elLoraJsonPreview = document.getElementById('lora-json-preview');
  const elLoraLogList = document.getElementById('lora-log-list');

  const elAudioRmsVal = document.getElementById('audio-rms-val');
  const elAudioScoreVal = document.getElementById('audio-score-val');
  const elAudioTierVal = document.getElementById('audio-tier-val');
  const elSliderAudioRms = document.getElementById('slider-audio-rms');
  const elSliderRmsDisplay = document.getElementById('slider-rms-display');

  const elDetectedTagsContainer = document.getElementById('detected-tags-container');
  
  const elGpsSatsVal = document.getElementById('gps-sats-val');
  const elGpsLatVal = document.getElementById('gps-lat-val');
  const elGpsLngVal = document.getElementById('gps-lng-val');
  const elGpsAltVal = document.getElementById('gps-alt-val');
  const elGpsLockBadge = document.getElementById('gps-lock-badge');

  const elTerminalOutput = document.getElementById('terminal-output');

  // ==========================================================================
  //  2. FUSION THREAT ENGINE (Mirroring C++ FusionEngine namespace)
  // ==========================================================================
  function evaluateFusion() {
    let fused = (0.60 * state.visionScore) + (0.40 * state.audioScore);

    if (state.visionScore >= 0.60 && state.audioScore >= 0.85) {
      fused += 0.15; // corroboration bonus
      state.corroboration = true;
    } else {
      state.corroboration = false;
    }

    if (fused > 1.0) fused = 1.0;

    const LEVEL_RED_AT = 0.75;
    const LEVEL_AMBER_AT = 0.45;

    const newLevel = (fused >= LEVEL_RED_AT) ? "RED"
                   : (fused >= LEVEL_AMBER_AT) ? "AMBER" : "GREEN";

    if (newLevel !== state.level) {
      logSerial(`[Fusion] LEVEL CHANGE ${state.level} -> ${newLevel} (score ${fused.toFixed(2)})`, 'fusion');
      if (newLevel === "RED" && state.level !== "RED") {
        state.redEdge = true; // latched — cleared only after uplink
        playAlarmSound();
      }
    }

    state.previousLevel = state.level;
    state.level = newLevel;
    state.threatScore = fused;

    updateFusionUI();

    // Immediate uplink if escalated
    if (state.redEdge) {
      transmitLoRaTelemetry();
    }
  }

  function updateFusionUI() {
    elThreatScoreNum.textContent = state.threatScore.toFixed(2);
    elValVision.textContent = state.visionScore.toFixed(2);
    elValAudio.textContent = state.audioScore.toFixed(2);

    elBarVision.style.width = `${Math.min(100, state.visionScore * 100)}%`;
    elBarAudio.style.width = `${Math.min(100, state.audioScore * 100)}%`;

    // Corroboration bonus display
    if (state.corroboration) {
      elCorroborationBadge.textContent = "Bonus: +0.15 Active";
      elCorroborationBadge.className = "badge badge-success";
      elFormulaBonusText.style.display = "inline";
    } else {
      elCorroborationBadge.textContent = "Bonus: Off";
      elCorroborationBadge.className = "badge";
      elFormulaBonusText.style.display = "none";
    }

    // Threat level badge
    elThreatBadge.className = `threat-badge level-${state.level.toLowerCase()}`;
    elThreatText.textContent = `LEVEL: ${state.level}`;
    
    if (state.level === "RED") {
      elThreatIcon.className = "fa-solid fa-triangle-exclamation";
      elEmergencyBanner.classList.remove('hidden');
      elEmergencyDesc.textContent = `Threat score (${state.threatScore.toFixed(2)}) exceeded RED threshold (0.75). Emergency response latched.`;
    } else if (state.level === "AMBER") {
      elThreatIcon.className = "fa-solid fa-circle-exclamation";
      elEmergencyBanner.classList.add('hidden');
    } else {
      elThreatIcon.className = "fa-solid fa-shield-halved";
      elEmergencyBanner.classList.add('hidden');
    }

    // Edge latch state
    elTxtRedEdge.textContent = state.redEdge.toString();
    elTxtPrevLevel.textContent = state.previousLevel;
    if (state.redEdge) {
      elDotRedEdge.classList.add('active');
    } else {
      elDotRedEdge.classList.remove('active');
    }

    drawThreatGauge(state.threatScore);
  }

  function acknowledgeEmergency() {
    state.redEdge = false;
    stopAlarmSound();
    updateFusionUI();
    logSerial("[SYSTEM] Emergency edge manually acknowledged and reset.", "sys");
  }

  elBtnAckEmergency.addEventListener('click', acknowledgeEmergency);

  // ==========================================================================
  //  3. AUDIO SUBSYSTEM (INMP441 Simulation & Real Mic)
  // ==========================================================================
  function sampleAudio() {
    // If not using real browser mic, use slider RMS
    if (!micAnalyser) {
      // Add slight organic jitter around slider value
      const jitter = (Math.random() - 0.5) * 150;
      state.audioRms = Math.max(0, parseFloat(elSliderAudioRms.value) + jitter);
    }

    const AUDIO_RMS_HIGH = 8000.0;
    const AUDIO_RMS_MID = 4000.0;

    state.audioScore = (state.audioRms > AUDIO_RMS_HIGH) ? 0.95
                     : ((state.audioRms > AUDIO_RMS_MID) ? 0.85 : 0.08);

    elAudioRmsVal.textContent = state.audioRms.toFixed(1);
    elAudioScoreVal.textContent = state.audioScore.toFixed(2);

    if (state.audioRms > AUDIO_RMS_HIGH) {
      elAudioTierVal.textContent = "HIGH (Loud Shout/Bang)";
      elAudioTierVal.style.color = "var(--color-red)";
    } else if (state.audioRms > AUDIO_RMS_MID) {
      elAudioTierVal.textContent = "MID (Elevated Noise)";
      elAudioTierVal.style.color = "var(--color-amber)";
    } else {
      elAudioTierVal.textContent = "Low Ambient";
      elAudioTierVal.style.color = "var(--text-muted)";
    }

    logSerial(`[INMP441 Mic] RMS: ${state.audioRms.toFixed(2)} | Audio Confidence Score: ${state.audioScore.toFixed(2)}`, 'audio');
    evaluateFusion();
  }

  elSliderAudioRms.addEventListener('input', (e) => {
    elSliderRmsDisplay.textContent = e.target.value;
  });

  document.getElementById('btn-trigger-shout').addEventListener('click', () => {
    elSliderAudioRms.value = 9500;
    elSliderRmsDisplay.textContent = 9500;
    sampleAudio();
    setTimeout(() => {
      elSliderAudioRms.value = 450;
      elSliderRmsDisplay.textContent = 450;
    }, 2500);
  });

  // Real Browser Microphone setup using Web Audio API
  const btnMic = document.getElementById('btn-enable-browser-mic');

  btnMic.addEventListener('click', async () => {
    if (micMediaStream || micAnalyser) {
      disconnectBrowserMic();
    } else {
      await connectBrowserMic();
    }
  });

  async function connectBrowserMic() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micMediaStream = stream;
      const source = audioCtx.createMediaStreamSource(stream);
      micAnalyser = audioCtx.createAnalyser();
      micAnalyser.fftSize = 512;
      source.connect(micAnalyser);

      btnMic.innerHTML = '<i class="fa-solid fa-microphone-slash"></i> Disconnect PC Mic';
      btnMic.className = "btn btn-danger btn-small";
      document.getElementById('audio-status-badge').textContent = "Live PC Mic";
      document.getElementById('audio-status-badge').className = "badge badge-success";
      logSerial("[INMP441 Mic] Connected to PC Microphone feed via Web Audio API.", "sys");

      startRealtimeMicRMS();
    } catch (err) {
      alert("Microphone permission denied or unsupported: " + err.message);
    }
  }

  function disconnectBrowserMic() {
    if (micMediaStream) {
      micMediaStream.getTracks().forEach(track => track.stop());
      micMediaStream = null;
    }
    micAnalyser = null;

    btnMic.innerHTML = '<i class="fa-solid fa-microphone-slash"></i> Use PC Microphone';
    btnMic.innerHTML = '<i class="fa-solid fa-microphone-lines"></i> Use PC Microphone';
    btnMic.className = "btn btn-outline btn-small";
    document.getElementById('audio-status-badge').textContent = "I2S 16kHz";
    document.getElementById('audio-status-badge').className = "badge";
    logSerial("[INMP441 Mic] Disconnected PC Microphone. Reverted to simulated audio.", "sys");
  }

  function startRealtimeMicRMS() {
    if (!micAnalyser) return;
    const dataArray = new Uint8Array(micAnalyser.fftSize);
    
    function checkRMS() {
      if (!micAnalyser) return;
      micAnalyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const norm = (dataArray[i] - 128) / 128.0;
        sum += norm * norm;
      }
      const rawRms = Math.sqrt(sum / dataArray.length);
      // Scale to INMP441 range (0 - 12000)
      state.audioRms = rawRms * 12000;
      elSliderAudioRms.value = Math.round(state.audioRms);
      elSliderRmsDisplay.textContent = Math.round(state.audioRms);

      requestAnimationFrame(checkRMS);
    }
    checkRMS();
  }

  // ==========================================================================
  //  4. VISION SUBSYSTEM (ESP32-CAM Simulation)
  // ==========================================================================
  const ACTIVITIES = [
    { name: "Human presence", confidence: 0.05 },
    { name: "Continuous waving for assistance", confidence: 0.60 },
    { name: "Physical struggle", confidence: 0.85 },
    { name: "Possible assault", confidence: 0.92 }
  ];

  function getConfidenceOf(actName) {
    const found = ACTIVITIES.find(a => a.name === actName);
    return found ? found.confidence : 0.0;
  }

  function processVisionFrame() {
    let maxScore = 0.0;
    state.activeVisionTags.forEach(tag => {
      maxScore = Math.max(maxScore, getConfidenceOf(tag));
    });

    state.visionScore = maxScore;
    state.visionActivities = state.activeVisionTags.join(", ");

    renderVisionTags();
    logSerial(`[VisionBlock] Vision Confidence Score: ${state.visionScore.toFixed(2)} | Detected: ${state.visionActivities}`, 'vision');
    evaluateFusion();
  }

  function renderVisionTags() {
    elDetectedTagsContainer.innerHTML = '';
    if (state.activeVisionTags.length === 0) {
      elDetectedTagsContainer.innerHTML = '<span class="activity-tag text-muted">No high-threat activity</span>';
      return;
    }

    state.activeVisionTags.forEach(tag => {
      const conf = getConfidenceOf(tag);
      const span = document.createElement('span');
      span.className = `activity-tag ${conf >= 0.75 ? 'high-danger' : ''}`;
      span.textContent = `${tag} (${conf.toFixed(2)})`;
      elDetectedTagsContainer.appendChild(span);
    });
  }

  document.querySelectorAll('.btn-sim-tag[data-activity]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const act = e.currentTarget.getAttribute('data-activity');
      if (!state.activeVisionTags.includes(act)) {
        state.activeVisionTags.push(act);
      }
      processVisionFrame();
    });
  });

  document.getElementById('btn-clear-vision').addEventListener('click', () => {
    state.activeVisionTags = ["Human presence"];
    processVisionFrame();
  });

  // Default location: Rathinam Technical Campus, Coimbatore, Tamil Nadu, India
  state.lat = 10.937222;
  state.lng = 76.960278;

  // ==========================================================================
  //  5. GPS SUBSYSTEM (Neo-6M Map & Geoapify — Rathinam College, Coimbatore)
  // ==========================================================================
  let meshMarkers = [];

  function initGpsMap() {
    map = L.map('gps-map', {
      zoomControl: false,
      attributionControl: false
    }).setView([state.lat, state.lng], 16);

    // Geoapify Dark Matter Tile Layer with fallback
    L.tileLayer('https://maps.geoapify.com/v1/tile/dark-matter/{z}/{x}/{y}.png?apiKey=3c0422c549be4b3d88b4ee48981df5db', {
      maxZoom: 19,
      attribution: '&copy; Geoapify &copy; OpenStreetMap contributors'
    }).addTo(map);

    // Node 1 Icon (Rathinam Campus Node 1)
    const iconNode1 = L.divIcon({
      className: 'custom-gps-marker',
      html: '<div style="background:#38bdf8; width:18px; height:18px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 16px #38bdf8; display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:bold; color:#000;">N1</div>',
      iconSize: [18, 18]
    });

    nodeMarker = L.marker([state.lat, state.lng], { icon: iconNode1 }).addTo(map);
    nodeMarker.bindPopup("<b>NODE 1: Rathinam College</b><br>Primary Edge Node").openPopup();

    accuracyCircle = L.circle([state.lat, state.lng], {
      color: '#38bdf8',
      fillColor: '#38bdf8',
      fillOpacity: 0.15,
      radius: 40
    }).addTo(map);
  }

  function reportGps() {
    if (state.hasFix) {
      elGpsSatsVal.textContent = state.satellites;
      elGpsLatVal.textContent = state.lat.toFixed(6);
      elGpsLngVal.textContent = state.lng.toFixed(6);
      elGpsAltVal.textContent = `Rathinam Campus`;
      elGpsLockBadge.textContent = "Fix: Locked (Node 1)";
      elGpsLockBadge.className = "badge badge-success";

      logSerial(`[GPS Fix] Node 1 (Rathinam College) | Satellites: ${state.satellites} | Lat: ${state.lat.toFixed(6)} | Lng: ${state.lng.toFixed(6)}`, 'gps');
    } else {
      elGpsLockBadge.textContent = "Fix: Searching...";
      elGpsLockBadge.className = "badge badge-amber";
      logSerial(`[GPS Searching] Waiting for Satellite Lock...`, 'gps');
    }
  }

  // Add Mesh Node 2 to Rathinam College Campus Map
  let node2Added = false;
  const btnAddMeshNode = document.getElementById('btn-add-mesh-node');
  if (btnAddMeshNode) {
    btnAddMeshNode.addEventListener('click', () => {
      if (node2Added) return;
      node2Added = true;
      const node2Lat = 10.938100;
      const node2Lng = 76.961400;

      const iconNode2 = L.divIcon({
        className: 'custom-gps-marker',
        html: '<div style="background:#10b981; width:18px; height:18px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 16px #10b981; display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:bold; color:#000;">N2</div>',
        iconSize: [18, 18]
      });

      const m2 = L.marker([node2Lat, node2Lng], { icon: iconNode2 }).addTo(map);
      m2.bindPopup("<b>NODE 2: Rathinam Tech Park</b><br>LoRa Mesh Node Connected").openPopup();

      // Connect Node 1 and Node 2 with LoRa Mesh Polyline
      L.polyline([[state.lat, state.lng], [node2Lat, node2Lng]], {
        color: '#10b981',
        dashArray: '5, 10',
        weight: 2
      }).addTo(map);

      btnAddMeshNode.innerHTML = '<i class="fa-solid fa-check"></i> Node 2 Connected';
      btnAddMeshNode.className = 'btn btn-primary btn-small';
      logSerial("[SYSTEM] Mesh expansion: Node 2 (Rathinam Tech Park) added to LoRa network.", "sys");
    });
  }

  document.getElementById('btn-random-gps-drift').addEventListener('click', () => {
    state.lat += (Math.random() - 0.5) * 0.0004;
    state.lng += (Math.random() - 0.5) * 0.0004;
    if (nodeMarker && map) {
      const newPos = [state.lat, state.lng];
      nodeMarker.setLatLng(newPos);
      accuracyCircle.setLatLng(newPos);
      map.panTo(newPos);
    }
    reportGps();
  });

  // ==========================================================================
  //  6. LORA TELEMETRY UPLINK (SX1276 Mirror)
  // ==========================================================================
  function transmitLoRaTelemetry() {
    state.loraTxCount++;

    const doc = {
      node_id: "ECHONET-NODE-01",
      fw: "1.0.1-unified",
      uptime_s: Math.floor(state.uptimeSeconds),
      level: state.level,
      score: Math.round(state.threatScore * 100) / 100.0,
      audio_score: Math.round(state.audioScore * 100) / 100.0,
      audio_rms: Math.round(state.audioRms * 10) / 10.0,
      vision_score: Math.round(state.visionScore * 100) / 100.0,
      activities: state.visionActivities,
      gps_fix: state.hasFix,
      lat: state.hasFix ? state.lat : 0.0,
      lng: state.hasFix ? state.lng : 0.0,
      sats: state.satellites
    };

    const payload = JSON.stringify(doc);

    elLoraTxCount.textContent = state.loraTxCount;
    elLoraJsonPreview.textContent = JSON.stringify(doc, null, 2);

    logSerial(`[LoRa TX] Broadcasting Packet: ${payload}`, 'lora');

    // Add entry to transmission history log stream
    const li = document.createElement('li');
    const timeStr = new Date().toLocaleTimeString();
    li.innerHTML = `<span><strong style="color:var(--color-accent)">#${state.loraTxCount}</strong> [${timeStr}] ${state.level} (${state.threatScore.toFixed(2)})</span> <span>-84 dBm</span>`;
    
    if (elLoraLogList.querySelector('.empty-log')) {
      elLoraLogList.innerHTML = '';
    }
    elLoraLogList.insertBefore(li, elLoraLogList.firstChild);

    // Consume escalation edge if set
    if (state.redEdge) {
      state.redEdge = false;
      logSerial("[Fusion] Escalation edge consumed by LoRa transmission.", "fusion");
      updateFusionUI();
    }

    tTelemetryLast = Date.now();
  }

  document.getElementById('btn-copy-json').addEventListener('click', () => {
    navigator.clipboard.writeText(elLoraJsonPreview.textContent);
    const btn = document.getElementById('btn-copy-json');
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
    setTimeout(() => { btn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy'; }, 2000);
  });

  // ==========================================================================
  //  7. WEBSERIAL LIVE USB CONNECTION (ESP32 Live Bridge)
  // ==========================================================================
  const btnWebSerial = document.getElementById('btn-web-serial');

  if ('serial' in navigator) {
    btnWebSerial.addEventListener('click', toggleWebSerial);
  } else {
    btnWebSerial.disabled = true;
    btnWebSerial.title = "WebSerial is supported on Chrome, Edge, and Opera.";
  }

  async function toggleWebSerial() {
    if (serialPort) {
      await disconnectWebSerial();
    } else {
      await connectWebSerial();
    }
  }

  async function connectWebSerial() {
    try {
      serialPort = await navigator.serial.requestPort();
      await serialPort.open({ baudRate: 115200 });

      state.connectionMode = 'WEBSERIAL';
      elConnectionMode.textContent = "ESP32 USB";
      elConnectionMode.className = "chip-value highlight";
      btnWebSerial.innerHTML = '<i class="fa-solid fa-plug-circle-xmark"></i> Disconnect Serial';
      btnWebSerial.className = "btn btn-danger";
      btnWebSerial.title = "Click to disconnect physical ESP32 serial port";

      logSerial("[SYSTEM] Connected to physical ESP32 via WebSerial at 115200 baud.", "sys");

      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
      serialReader = textDecoder.readable.getReader();

      readSerialLoop();
    } catch (err) {
      logSerial(`[SYSTEM] WebSerial Error: ${err.message}`, "sys");
    }
  }

  async function disconnectWebSerial() {
    if (serialReader) {
      try {
        await serialReader.cancel();
      } catch (err) {}
      serialReader = null;
    }
    if (serialPort) {
      try {
        await serialPort.close();
      } catch (err) {}
      serialPort = null;
    }

    state.connectionMode = 'SIMULATOR';
    elConnectionMode.textContent = "SIMULATOR";
    elConnectionMode.className = "chip-value";
    btnWebSerial.innerHTML = '<i class="fa-solid fa-plug"></i> WebSerial Connect';
    btnWebSerial.className = "btn btn-outline";
    btnWebSerial.title = "Connect to physical ESP32 via USB Serial";

    logSerial("[SYSTEM] Disconnected WebSerial. Reverted to Simulator mode.", "sys");
  }

  async function readSerialLoop() {
    let lineBuffer = "";
    try {
      while (true) {
        if (!serialReader) break;
        const { value, done } = await serialReader.read();
        if (done) {
          break;
        }
        lineBuffer += value;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop(); // Keep last incomplete chunk

        lines.forEach(parseEsp32LogLine);
      }
    } catch (err) {
      // Reader cancelled or port disconnected
    } finally {
      if (serialReader) {
        try { serialReader.releaseLock(); } catch(e) {}
      }
    }
  }

  function parseEsp32LogLine(line) {
    line = line.trim();
    if (!line) return;

    // Parse INMP441 Mic
    // e.g. [INMP441 Mic] RMS: 8240.12 | Audio Confidence Score: 0.95
    const micMatch = line.match(/\[INMP441 Mic\] RMS: ([\d.]+) \| Audio Confidence Score: ([\d.]+)/);
    if (micMatch) {
      state.audioRms = parseFloat(micMatch[1]);
      state.audioScore = parseFloat(micMatch[2]);
      logSerial(line, 'audio');
      evaluateFusion();
      return;
    }

    // Parse GPS Fix
    // e.g. [GPS Fix] Satellites: 8 | Lat: 37.774929 | Lng: -122.419416 | Alt: 15.2m
    const gpsMatch = line.match(/\[GPS Fix\] Satellites: (\d+) \| Lat: ([-\d.]+) \| Lng: ([-\d.]+) \| Alt: ([-\d.]+)m/);
    if (gpsMatch) {
      state.hasFix = true;
      state.satellites = parseInt(gpsMatch[1]);
      state.lat = parseFloat(gpsMatch[2]);
      state.lng = parseFloat(gpsMatch[3]);
      state.altitude = parseFloat(gpsMatch[4]);
      logSerial(line, 'gps');
      reportGps();
      return;
    }

    // Parse Vision Block
    // e.g. [VisionBlock] Vision Confidence Score: 0.92 | Detected: Physical struggle, Possible assault
    const visMatch = line.match(/\[VisionBlock\] Vision Confidence Score: ([\d.]+) \| Detected: (.*)/);
    if (visMatch) {
      state.visionScore = parseFloat(visMatch[1]);
      state.visionActivities = visMatch[2];
      logSerial(line, 'vision');
      evaluateFusion();
      return;
    }

    // Parse LoRa TX
    if (line.includes('[LoRa TX]')) {
      logSerial(line, 'lora');
      state.loraTxCount++;
      elLoraTxCount.textContent = state.loraTxCount;
      return;
    }

    logSerial(line, 'sys');
  }

  // ==========================================================================
  //  AUTO-POLL PYTHON HARDWARE SERIAL BRIDGE
  // ==========================================================================
  setInterval(async () => {
    if (state.connectionMode === 'WEBSERIAL') return;
    try {
      const res = await fetch('/api/serial/stream');
      if (!res.ok) return;
      const data = await res.json();
      if (data.port) {
        state.connectionMode = 'PYTHON_SERIAL';
        elConnectionMode.textContent = `ESP32 (${data.port})`;
        elConnectionMode.className = "chip-value highlight";
      } else if (state.connectionMode === 'PYTHON_SERIAL') {
        state.connectionMode = 'SIMULATOR';
        elConnectionMode.textContent = "SIMULATOR";
        elConnectionMode.className = "chip-value";
      }

      if (data.lines && data.lines.length > 0) {
        data.lines.forEach(parseEsp32LogLine);
      }
    } catch(e) {}
  }, 500);

  // ==========================================================================
  //  8. CANVAS VISUALIZERS (Audio Waveform & Vision Feed & Gauge)
  // ==========================================================================
  
  // A. Audio Waveform Canvas
  const waveformCanvas = document.getElementById('audioWaveformCanvas');
  const wfCtx = waveformCanvas.getContext('2d');

  function drawAudioWaveform() {
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;
    wfCtx.clearRect(0, 0, width, height);

    // Draw background grid lines
    wfCtx.strokeStyle = 'rgba(255,255,255,0.05)';
    wfCtx.lineWidth = 1;
    for (let y = 0; y < height; y += 20) {
      wfCtx.beginPath(); wfCtx.moveTo(0, y); wfCtx.lineTo(width, y); wfCtx.stroke();
    }

    // Draw Sine / Noise Wave
    wfCtx.beginPath();
    wfCtx.lineWidth = 2;
    wfCtx.strokeStyle = state.audioRms > 8000 ? '#ef4444' : (state.audioRms > 4000 ? '#f59e0b' : '#38bdf8');

    const amplitude = Math.min(height / 2 - 5, (state.audioRms / 10000.0) * (height / 2));
    const now = Date.now() / 150.0;

    for (let x = 0; x < width; x++) {
      const freq = 0.05;
      const noise = (Math.random() - 0.5) * (amplitude * 0.3);
      const y = (height / 2) + Math.sin(x * freq + now) * amplitude + noise;
      if (x === 0) wfCtx.moveTo(x, y);
      else wfCtx.lineTo(x, y);
    }
    wfCtx.stroke();

    requestAnimationFrame(drawAudioWaveform);
  }
  drawAudioWaveform();

  // B. Vision Feed Canvas Simulation & Laptop Webcam
  const camCanvas = document.getElementById('cameraFeedCanvas');
  const camCtx = camCanvas.getContext('2d');
  const webcamVideoEl = document.getElementById('hiddenWebcamVideo');

  let webcamStream = null;

  const btnWebcam = document.getElementById('btn-toggle-laptop-webcam');
  const webcamStatusLabel = document.getElementById('webcam-status-label');

  if (btnWebcam) {
    btnWebcam.addEventListener('click', async () => {
      if (webcamStream) {
        stopLaptopWebcam();
      } else {
        await startLaptopWebcam();
      }
    });
  }

  async function startLaptopWebcam() {
    try {
      if (webcamStatusLabel) webcamStatusLabel.textContent = "Requesting Permission...";
      logSerial("[VisionBlock] Prompting browser camera permission for http://localhost:8080...", "sys");

      webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" }
      });
      if (webcamVideoEl) {
        webcamVideoEl.srcObject = webcamStream;
        webcamVideoEl.style.display = "none";
        await webcamVideoEl.play();
      }

      btnWebcam.innerHTML = '<i class="fa-solid fa-video-slash"></i> Disconnect Laptop Camera';
      btnWebcam.className = 'btn btn-danger btn-small';
      if (webcamStatusLabel) webcamStatusLabel.textContent = "Live Laptop Webcam";
      logSerial("[VisionBlock] Connected to Laptop Web Camera feed.", "sys");
    } catch(err) {
      console.error("Webcam error:", err);
      if (webcamStatusLabel) webcamStatusLabel.textContent = "Camera Blocked/Error";
      logSerial(`[VisionBlock] Webcam error: ${err.message}`, "sys");
      alert("Camera Permission Required:\n\n1. Look at your browser address bar (top left near 'http://localhost:8080').\n2. Click the Lock/Camera icon and set Camera to 'Allow'.\n3. Refresh the page and click 'Use Laptop Webcam' again.\n\nError details: " + err.message);
    }
  }

  function stopLaptopWebcam() {
    if (webcamStream) {
      webcamStream.getTracks().forEach(track => track.stop());
      webcamStream = null;
    }
    if (webcamVideoEl) {
      webcamVideoEl.srcObject = null;
    }
    btnWebcam.innerHTML = '<i class="fa-solid fa-camera"></i> Use Laptop Webcam';
    btnWebcam.className = 'btn btn-outline btn-small';
    if (webcamStatusLabel) webcamStatusLabel.textContent = "Synthetic Canvas";
    logSerial("[VisionBlock] Disconnected Laptop Webcam feed.", "sys");
  }

  function drawCameraFeed() {
    const w = camCanvas.width;
    const h = camCanvas.height;

    if (webcamStream && webcamVideoEl && webcamVideoEl.readyState >= 2) {
      camCtx.drawImage(webcamVideoEl, 0, 0, w, h);
    } else {
      camCtx.fillStyle = '#050a14';
      camCtx.fillRect(0, 0, w, h);
    }

    // Animated scanlines
    const time = Date.now() / 20.0;
    camCtx.fillStyle = 'rgba(56, 189, 248, 0.03)';
    for (let y = 0; y < h; y += 4) {
      camCtx.fillRect(0, (y + time) % h, w, 2);
    }

    // Draw simulated target silhouettes & bounding boxes
    if (state.activeVisionTags.length > 0 && !state.activeVisionTags.includes("Human presence")) {
      const boxColor = state.visionScore >= 0.75 ? '#ef4444' : '#f59e0b';
      
      // Target Bounding Box
      camCtx.strokeStyle = boxColor;
      camCtx.lineWidth = 3;
      camCtx.strokeRect(140, 40, 200, 180);

      // Label background
      camCtx.fillStyle = boxColor;
      camCtx.fillRect(140, 15, 200, 25);

      camCtx.fillStyle = '#ffffff';
      camCtx.font = 'bold 12px JetBrains Mono';
      camCtx.fillText(`ALERT: ${state.activeVisionTags[0]}`, 146, 32);
    } else {
      // Normal green box for human presence
      camCtx.strokeStyle = '#10b981';
      camCtx.lineWidth = 2;
      camCtx.strokeRect(180, 50, 120, 160);
      camCtx.fillStyle = '#10b981';
      camCtx.font = 'bold 11px JetBrains Mono';
      camCtx.fillText('NODE 1 HUMAN (0.05)', 185, 45);
    }

    requestAnimationFrame(drawCameraFeed);
  }
  drawCameraFeed();

  // C. Semi-circular Threat Gauge Canvas
  const gaugeCanvas = document.getElementById('threatGaugeCanvas');
  const gCtx = gaugeCanvas.getContext('2d');

  function drawThreatGauge(score) {
    const cx = gaugeCanvas.width / 2;
    const cy = gaugeCanvas.height - 20;
    const radius = 70;

    gCtx.clearRect(0, 0, gaugeCanvas.width, gaugeCanvas.height);

    // Background arc (180 deg)
    gCtx.beginPath();
    gCtx.arc(cx, cy, radius, Math.PI, 2 * Math.PI);
    gCtx.lineWidth = 14;
    gCtx.strokeStyle = 'rgba(255,255,255,0.08)';
    gCtx.stroke();

    // Value Arc
    const valAngle = Math.PI + (score * Math.PI);
    const color = score >= 0.75 ? '#ef4444' : (score >= 0.45 ? '#f59e0b' : '#10b981');

    gCtx.beginPath();
    gCtx.arc(cx, cy, radius, Math.PI, valAngle);
    gCtx.lineWidth = 14;
    gCtx.strokeStyle = color;
    gCtx.lineCap = 'round';
    gCtx.stroke();

    // Threshold Tick lines for 0.45 and 0.75
    drawTick(cx, cy, radius, Math.PI + (0.45 * Math.PI), '#f59e0b');
    drawTick(cx, cy, radius, Math.PI + (0.75 * Math.PI), '#ef4444');
  }

  function drawTick(cx, cy, radius, angle, tickColor) {
    const x1 = cx + (radius - 12) * Math.cos(angle);
    const y1 = cy + (radius - 12) * Math.sin(angle);
    const x2 = cx + (radius + 12) * Math.cos(angle);
    const y2 = cy + (radius + 12) * Math.sin(angle);

    gCtx.beginPath();
    gCtx.moveTo(x1, y1);
    gCtx.lineTo(x2, y2);
    gCtx.lineWidth = 3;
    gCtx.strokeStyle = tickColor;
    gCtx.stroke();
  }

  // ==========================================================================
  //  9. SERIAL MONITOR & ALARM UTILITIES
  // ==========================================================================
  function logSerial(msg, type = 'sys') {
    const div = document.createElement('div');
    div.className = `term-line ${type}`;
    div.textContent = msg;
    elTerminalOutput.appendChild(div);

    if (state.autoScrollSerial) {
      elTerminalOutput.scrollTop = elTerminalOutput.scrollHeight;
    }

    // Keep log buffer bounded to 200 lines
    while (elTerminalOutput.children.length > 200) {
      elTerminalOutput.removeChild(elTerminalOutput.firstChild);
    }
  }

  document.getElementById('btn-clear-serial').addEventListener('click', () => {
    elTerminalOutput.innerHTML = '';
  });

  document.getElementById('btn-toggle-autoscroll').addEventListener('click', (e) => {
    state.autoScrollSerial = !state.autoScrollSerial;
    e.target.textContent = `AutoScroll: ${state.autoScrollSerial ? 'ON' : 'OFF'}`;
  });

  function playAlarmSound() {
    if (state.isMuted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (alarmOscillator) alarmOscillator.stop();

      alarmOscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      alarmOscillator.type = 'sawtooth';
      alarmOscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
      alarmOscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.4);

      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      alarmOscillator.connect(gain);
      gain.connect(audioCtx.destination);

      alarmOscillator.start();
      alarmOscillator.stop(audioCtx.currentTime + 0.5);
    } catch(e) {}
  }

  function stopAlarmSound() {
    if (alarmOscillator) {
      try { alarmOscillator.stop(); } catch(e) {}
    }
  }

  document.getElementById('btn-audio-mute').addEventListener('click', () => {
    state.isMuted = !state.isMuted;
    const icon = document.getElementById('mute-icon');
    if (state.isMuted) {
      icon.className = "fa-solid fa-volume-xmark";
    } else {
      icon.className = "fa-solid fa-volume-high";
      playAlarmSound();
    }
  });

  // ==========================================================================
  //  10. SCHEDULER & INITIALIZATION
  // ==========================================================================
  function startSimulationTimers() {
    // 1-second Uptime Counter
    uptimeInterval = setInterval(() => {
      state.uptimeSeconds++;
      elLoraUptimeVal.textContent = `${state.uptimeSeconds}s`;
    }, 1000);

    // Audio sampling interval (500 ms)
    audioTimer = setInterval(() => {
      if (state.isSimulating && state.connectionMode === 'SIMULATOR') {
        sampleAudio();
      }
    }, 500);

    // Vision processing interval (1000 ms)
    visionTimer = setInterval(() => {
      if (state.isSimulating && state.connectionMode === 'SIMULATOR') {
        processVisionFrame();
      }
    }, 1000);

    // GPS report interval (2000 ms)
    gpsReportTimer = setInterval(() => {
      if (state.isSimulating && state.connectionMode === 'SIMULATOR') {
        reportGps();
      }
    }, 2000);

    // Telemetry heartbeat interval (8000 ms)
    telemetryTimer = setInterval(() => {
      if (state.isSimulating && state.connectionMode === 'SIMULATOR') {
        transmitLoRaTelemetry();
      }
    }, 8000);
  }

  const btnToggleSim = document.getElementById('btn-toggle-sim');
  btnToggleSim.addEventListener('click', () => {
    state.isSimulating = !state.isSimulating;
    document.getElementById('sim-play-icon').className = state.isSimulating ? "fa-solid fa-pause" : "fa-solid fa-play";
    document.getElementById('sim-play-text').textContent = state.isSimulating ? "Pause Sim" : "Resume Sim";
    logSerial(`[SYSTEM] Simulation engine ${state.isSimulating ? 'resumed' : 'paused'}.`, "sys");
  });

  // Boot UI and components
  initGpsMap();
  startSimulationTimers();
  updateFusionUI();

});
