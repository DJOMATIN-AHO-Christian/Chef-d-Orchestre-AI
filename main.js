/* =============================================
   Chef d'Orchestre AI — Optimized Engine v3
   Lazy PoseNet | Fast Demo Mode | Musical Scales
   ============================================= */

// ─── DOM ────────────────────────────────────
const $ = id => document.getElementById(id);

const canvas      = $('canvas');
const ctx         = canvas.getContext('2d');
const pCanvas     = $('particle-canvas');
const pCtx        = pCanvas.getContext('2d');
const fftCanvas   = $('fft-canvas');
const fftCtx      = fftCanvas.getContext('2d');
const video       = $('video');
const container   = $('video-container');
const overlay     = $('status-overlay');
const statusMsg   = $('status-message');
const demoBtn     = $('demo-btn');
const cameraBtn   = $('camera-btn');
const noteFlash   = $('note-flash');
const helpToast   = $('help-toast');
const errorToast  = $('error-toast');
const errorMsg    = $('error-message');
const hudNote     = $('hud-note');
const hudScale    = $('hud-scale-name');
const volBar      = $('volume-bar-fill');
const volSpan     = $('vol-val');
const pitchSpan   = $('pitch-val');
const noteSpan    = $('note-val');
const modeSpan    = $('mode-val');
const fpsSpan     = $('fps-val');
const scaleSelect = $('scale-select');
const synthSelect = $('synth-select');
const tempoSlider = $('tempo-slider');
const tempoVal    = $('tempo-val');
const reverbSlider= $('reverb-slider');
const reverbVal   = $('reverb-val');
const muteBtn     = $('mute-btn');

// ─── MUSICAL DATA ───────────────────────────
const SCALES = {
    pentatonic: { name:'Pentatonique', intervals:[0,2,4,7,9]},
    major:      { name:'Majeure',      intervals:[0,2,4,5,7,9,11]},
    minor:      { name:'Mineure',      intervals:[0,2,3,5,7,8,10]},
    blues:      { name:'Blues',         intervals:[0,3,5,6,7,10]},
    dorian:     { name:'Dorienne',     intervals:[0,2,3,5,7,9,10]},
    chromatic:  { name:'Chromatique',  intervals:[0,1,2,3,4,5,6,7,8,9,10,11]}
};
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function buildScale(key, root=48, octaves=3) {
    const out = [];
    for (let o = 0; o < octaves; o++)
        for (const i of SCALES[key].intervals) {
            const m = root + o*12 + i;
            if (m <= 96) out.push(m);
        }
    return out;
}
function midiFreq(m)  { return 440 * Math.pow(2, (m-69)/12); }
function midiName(m)  { return NOTE_NAMES[m%12] + (Math.floor(m/12)-1); }

// ─── SYNTH PRESETS ──────────────────────────
const PRESETS = {
    pad:     { oscillator:{type:'fatsawtooth',spread:20,count:2}, envelope:{attack:0.3,decay:0.2,sustain:0.5,release:1}},
    piano:   { oscillator:{type:'triangle'},                       envelope:{attack:0.005,decay:0.4,sustain:0.08,release:0.6}},
    lead:    { oscillator:{type:'square'},                         envelope:{attack:0.03,decay:0.15,sustain:0.3,release:0.4}},
    strings: { oscillator:{type:'fatsine',spread:15,count:2},      envelope:{attack:0.6,decay:0.3,sustain:0.6,release:1.5}}
};

// ─── STATE ──────────────────────────────────
let synth, filter, reverb, analyser;
let audioReady  = false;
let muted       = false;
let demoMode    = false;
let cameraMode  = false;
let net         = null; // PoseNet (lazy)
let scale       = 'pentatonic';
let synthType   = 'pad';
let notes       = buildScale('pentatonic');
let lastNote    = -1;
let lastNoteT   = 0;
let lastPlayedMidi = -1;
let particles   = [];
let fc = 0, fpsT = performance.now();

// Mouse / touch state
let mxNorm = 0.5, myNorm = 0.5;
let pressing = false;

const W = 640, H = 480;

// ─── AUDIO ENGINE ───────────────────────────
async function initAudio() {
    if (audioReady) return;
    filter   = new Tone.Filter({frequency:3000, type:'lowpass', rolloff:-12});
    reverb   = new Tone.Reverb({decay:2, wet:0.25});
    analyser = new Tone.Analyser('fft', 64); // 64 bins is enough, lighter than 128
    await reverb.ready;
    synth = new Tone.PolySynth(Tone.Synth, {maxPolyphony: 4, ...PRESETS[synthType]});
    synth.chain(filter, reverb, analyser, Tone.getDestination());
    synth.volume.value = -8;
    await Tone.start();
    Tone.Transport.bpm.value = parseInt(tempoSlider.value);
    audioReady = true;
}

function swapSynth(key) {
    if (!audioReady) return;
    const vol = synth.volume.value;
    synth.disconnect(); synth.dispose();
    synth = new Tone.PolySynth(Tone.Synth, {maxPolyphony: 4, ...PRESETS[key]});
    synth.chain(filter, reverb, analyser, Tone.getDestination());
    synth.volume.value = vol;
    synthType = key;
}

// Play a note with cooldown — returns true if played
function playNote(midi, volNorm) {
    if (!audioReady || muted) return false;
    const now = performance.now();
    const bpm = Tone.Transport.bpm.value;
    const cooldown = (60 / bpm) * 1000 * 0.45; // slightly less than half-beat
    if (now - lastNoteT < cooldown) return false;
    // Don't repeat same note unless enough time passed
    if (midi === lastPlayedMidi && now - lastNoteT < cooldown * 2) return false;

    const freq = midiFreq(midi);
    const vel = 0.3 + volNorm * 0.7; // velocity 0.3–1.0
    synth.triggerAttackRelease(freq, '8n', undefined, vel);
    lastNoteT = now;
    lastPlayedMidi = midi;

    // Update displays
    const name = midiName(midi);
    hudNote.innerText = name;
    noteSpan.innerText = name;
    pitchSpan.innerText = Math.round(freq) + 'Hz';

    // Flash
    noteFlash.classList.add('active');
    setTimeout(() => noteFlash.classList.remove('active'), 120);
    return true;
}

// ─── PARTICLES (lightweight) ────────────────
function spawnP(x, y, color, n=3) {
    for (let i = 0; i < n; i++)
        particles.push({
            x, y,
            vx: (Math.random()-0.5)*3,
            vy: -1 - Math.random()*2,
            life: 1,
            d: 0.02 + Math.random()*0.02,
            s: 1.5 + Math.random()*3,
            color
        });
}

function tickParticles() {
    pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    let alive = [];
    for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.life -= p.d;
        if (p.life <= 0) continue;
        alive.push(p);
        pCtx.globalAlpha = p.life;
        pCtx.fillStyle = p.color;
        pCtx.beginPath();
        pCtx.arc(p.x, p.y, p.s * p.life, 0, 6.28);
        pCtx.fill();
    }
    pCtx.globalAlpha = 1;
    particles = alive;
}

// ─── FFT ────────────────────────────────────
function drawFFT() {
    if (!analyser) return;
    const vals = analyser.getValue();
    const w = fftCanvas.width, h = fftCanvas.height;
    if (w === 0) return;
    fftCtx.clearRect(0, 0, w, h);
    const bw = w / vals.length;
    for (let i = 0; i < vals.length; i++) {
        const norm = Math.max(0, (vals[i]+100)/100);
        const bh = norm * h;
        // Color based on position
        const hue = 40 + (i / vals.length) * 280; // gold → cyan
        fftCtx.fillStyle = `hsla(${hue}, 80%, 60%, 0.7)`;
        fftCtx.fillRect(i*bw, h-bh, bw-1, bh);
    }
}

// ─── CANVAS SIZING ──────────────────────────
function sizeCanvases() {
    const r = container.getBoundingClientRect();
    if (canvas.width !== r.width || canvas.height !== r.height) {
        canvas.width = r.width;   canvas.height = r.height;
        pCanvas.width = r.width;  pCanvas.height = r.height;
    }
    const fr = fftCanvas.parentElement.getBoundingClientRect();
    if (fftCanvas.width !== fr.width || fftCanvas.height !== fr.height) {
        fftCanvas.width = fr.width; fftCanvas.height = fr.height;
    }
}

// ─── FPS ────────────────────────────────────
function tickFPS() {
    fc++;
    const now = performance.now();
    if (now - fpsT >= 1000) {
        fpsSpan.innerText = fc;
        fc = 0; fpsT = now;
    }
}

// ═══════════════════════════════════════════
//  DEMO MODE
// ═══════════════════════════════════════════
function startDemoMode() {
    demoMode = true;
    modeSpan.innerText = '🖱️ Souris';
    overlay.classList.add('hidden');
    container.style.cursor = 'crosshair';

    // Mouse events
    container.addEventListener('mousemove', onPointerMove);
    container.addEventListener('mousedown', () => { pressing = true; });
    container.addEventListener('mouseup',   () => { pressing = false; });
    container.addEventListener('mouseleave',() => { pressing = false; });

    // Touch
    container.addEventListener('touchstart', e => {
        pressing = true; updateTouch(e);
    }, {passive:false});
    container.addEventListener('touchmove', e => {
        e.preventDefault(); updateTouch(e);
    }, {passive:false});
    container.addEventListener('touchend', () => { pressing = false; });

    // Show help briefly
    helpToast.classList.add('visible');
    setTimeout(() => helpToast.classList.remove('visible'), 4000);

    requestAnimationFrame(demoLoop);
}

function onPointerMove(e) {
    const r = container.getBoundingClientRect();
    mxNorm = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    myNorm = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
}
function updateTouch(e) {
    const r = container.getBoundingClientRect();
    const t = e.touches[0];
    mxNorm = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width));
    myNorm = Math.max(0, Math.min(1, (t.clientY - r.top) / r.height));
}

function demoLoop() {
    sizeCanvases();
    const w = canvas.width, h = canvas.height;
    const px = mxNorm * w, py = myNorm * h;

    // ─ Background ─
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 50) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for (let y = 0; y < h; y += 50) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

    // Note lanes (horizontal lines for each note in scale)
    const laneH = h / notes.length;
    for (let i = 0; i < notes.length; i++) {
        const ly = i * laneH;
        const isActive = py >= ly && py < ly + laneH;
        if (isActive && pressing) {
            ctx.fillStyle = 'rgba(0, 242, 255, 0.06)';
            ctx.fillRect(0, ly, w, laneH);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(w, ly); ctx.stroke();

        // Note label on left
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillStyle = isActive ? 'rgba(0,242,255,0.6)' : 'rgba(255,255,255,0.12)';
        ctx.fillText(midiName(notes[notes.length - 1 - i]), 6, ly + laneH/2 + 3);
    }

    // Zone labels
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,215,0,0.3)';
    ctx.textAlign = 'right';
    ctx.fillText('🔊 VOLUME →', w - 10, 20);
    ctx.fillStyle = 'rgba(0,242,255,0.3)';
    ctx.textAlign = 'left';
    ctx.fillText('🎵 NOTE ↕', 10, h - 10);
    ctx.textAlign = 'start';

    // ─ Compute musical params ─
    const pitchNorm = 1 - myNorm; // top = high, bottom = low
    const volNorm = mxNorm;       // left = quiet, right = loud
    const noteIdx = Math.floor(pitchNorm * (notes.length - 1));
    const midi = notes[Math.max(0, Math.min(noteIdx, notes.length-1))];
    const filterNorm = mxNorm;
    const cutoff = 300 + filterNorm * 4700;
    if (filter) filter.frequency.rampTo(cutoff, 0.08);

    // Update volume display
    const db = Tone.gainToDb(Math.max(0.01, volNorm));
    if (audioReady && !muted) Tone.getDestination().volume.rampTo(db, 0.08);
    volBar.style.height = (volNorm * 100) + '%';
    volSpan.innerText = Math.round(volNorm * 100) + '%';

    // ─ Cursor ─
    // Main cursor (follows mouse)
    const cursorColor = pressing ? '#00f2ff' : '#ffd700';
    const cursorGlow = pressing ? 'rgba(0,242,255,0.25)' : 'rgba(255,215,0,0.15)';
    const sz = pressing ? 24 : 16;
    ctx.beginPath(); ctx.arc(px, py, sz, 0, 6.28);
    ctx.fillStyle = cursorGlow; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, sz*0.5, 0, 6.28);
    ctx.fillStyle = cursorColor; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, sz*0.75, 0, 6.28);
    ctx.strokeStyle = cursorColor; ctx.lineWidth = 2; ctx.stroke();

    // Crosshair lines
    ctx.strokeStyle = pressing ? 'rgba(0,242,255,0.15)' : 'rgba(255,215,0,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();

    // ─ Play note if clicking ─
    if (pressing) {
        const played = playNote(midi, volNorm);
        if (played) {
            spawnP(px, py, '#00f2ff', 5);
            if (volNorm > 0.6) spawnP(px, py, '#ffd700', 3);
        }
    }

    // Hint text
    if (!pressing) {
        ctx.font = '12px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'center';
        ctx.fillText('Cliquez et bougez pour jouer', w/2, h - 14);
        ctx.textAlign = 'start';
    }

    tickParticles();
    drawFFT();
    tickFPS();
    requestAnimationFrame(demoLoop);
}

// ═══════════════════════════════════════════
//  CAMERA MODE (lazy-loaded)
// ═══════════════════════════════════════════
async function startCameraMode() {
    overlay.querySelector('.start-buttons').style.display = 'none';
    statusMsg.innerText = 'Chargement...';

    try {
        // Setup camera
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {width: W, height: H, facingMode:'user'}, audio: false
        });
        video.srcObject = stream;
        await new Promise(r => { video.onloadedmetadata = () => { video.play(); r(); }; });

        // Lazy-load TF + PoseNet
        statusMsg.innerText = "Chargement de l'IA...";
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs');
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/posenet');

        statusMsg.innerText = "Chargement du modèle...";
        net = await posenet.load({
            architecture: 'MobileNetV1',
            outputStride: 16,
            inputResolution: {width: 320, height: 240}, // smaller = faster!
            multiplier: 0.5 // lighter model
        });

        cameraMode = true;
        modeSpan.innerText = '📷 Caméra';
        overlay.classList.add('hidden');
        requestAnimationFrame(cameraLoop);

    } catch (err) {
        statusMsg.innerText = 'Erreur';
        overlay.querySelector('.start-buttons').style.display = 'flex';
        showError('Caméra/IA : ' + err.message + ' — Essayez le mode démo.');
    }
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        // Don't load twice
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function cameraLoop() {
    sizeCanvases();
    const scX = canvas.width / W, scY = canvas.height / H;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.scale(scX, scY);
    ctx.drawImage(video, 0, 0, W, H);

    try {
        const poses = await net.estimateMultiplePoses(video, {
            flipHorizontal: false, maxDetections: 3,
            scoreThreshold: 0.5, nmsRadius: 20
        });

        if (poses.length > 1) document.body.classList.add('skeleton-blur');
        else document.body.classList.remove('skeleton-blur');

        for (const pose of poses) {
            drawSkeleton(pose.keypoints);
            drawPoints(pose.keypoints);
            processPose(pose);
        }

        if (poses.length === 0) {
            helpToast.classList.add('visible');
            $('help-text').innerText = 'Placez-vous face à la caméra et levez les mains.';
        } else {
            helpToast.classList.remove('visible');
        }
    } catch(e) {
        // Skip frame on error
    }

    ctx.restore();
    tickParticles(); drawFFT(); tickFPS();
    requestAnimationFrame(cameraLoop);
}

function drawPoints(kps) {
    for (const kp of kps) {
        if (kp.score < 0.4) continue;
        if (!kp.part.includes('Wrist') && !kp.part.includes('Elbow')) continue;
        const {x, y} = kp.position;
        const isL = kp.part.includes('left') || kp.part.includes('Left');
        const c = isL ? '#00f2ff' : '#ffd700';
        ctx.beginPath(); ctx.arc(x,y,14,0,6.28);
        ctx.fillStyle = isL ? 'rgba(0,242,255,0.3)' : 'rgba(255,215,0,0.3)';
        ctx.fill();
        ctx.beginPath(); ctx.arc(x,y,6,0,6.28);
        ctx.fillStyle = c; ctx.fill();
    }
}

function drawSkeleton(kps) {
    const map = {}; kps.forEach(k => map[k.part] = k);
    const pairs = [['leftShoulder','leftElbow'],['leftElbow','leftWrist'],
                   ['rightShoulder','rightElbow'],['rightElbow','rightWrist']];
    for (const [a,b] of pairs) {
        if (map[a]?.score > 0.4 && map[b]?.score > 0.4) {
            ctx.beginPath();
            ctx.moveTo(map[a].position.x, map[a].position.y);
            ctx.lineTo(map[b].position.x, map[b].position.y);
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 2; ctx.stroke();
        }
    }
}

function processPose(pose) {
    const lw = pose.keypoints.find(k => k.part==='leftWrist');
    const rw = pose.keypoints.find(k => k.part==='rightWrist');

    if (rw && rw.score > 0.5) {
        const v = Math.max(0, Math.min(1, 1 - rw.position.y/H));
        const db = Tone.gainToDb(Math.max(0.01, v));
        if (!muted) Tone.getDestination().volume.rampTo(db, 0.08);
        volBar.style.height = (v*100) + '%';
        volSpan.innerText = Math.round(v*100) + '%';
    }

    if (lw && lw.score > 0.5) {
        const pn = Math.max(0, Math.min(1, 1 - lw.position.y/H));
        const idx = Math.floor(pn * (notes.length-1));
        const midi = notes[Math.max(0, Math.min(idx, notes.length-1))];
        const filterN = lw.position.x / W;
        filter.frequency.rampTo(300 + filterN*4700, 0.08);

        const v = rw && rw.score > 0.5 ? Math.max(0, Math.min(1, 1-rw.position.y/H)) : 0.5;
        const played = playNote(midi, v);
        if (played) {
            spawnP(lw.position.x, lw.position.y, '#00f2ff', 3);
        }
    }
}

// ─── CONTROLS ───────────────────────────────
scaleSelect.onchange = e => {
    scale = e.target.value;
    notes = buildScale(scale);
    hudScale.innerText = SCALES[scale].name;
};
synthSelect.onchange = e => swapSynth(e.target.value);
tempoSlider.oninput = e => {
    tempoVal.innerText = e.target.value;
    if (audioReady) Tone.Transport.bpm.value = parseInt(e.target.value);
};
reverbSlider.oninput = e => {
    reverbVal.innerText = e.target.value;
    if (reverb) reverb.wet.value = parseInt(e.target.value) / 100;
};
muteBtn.onclick = () => {
    muted = !muted;
    muteBtn.innerText = muted ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', muted);
    if (muted) Tone.getDestination().volume.rampTo(-Infinity, 0.05);
    else Tone.getDestination().volume.rampTo(-8, 0.05);
};

// ─── START BUTTONS ──────────────────────────
demoBtn.onclick = async () => {
    try { await initAudio(); } catch(e) { showError('Audio: '+e.message); return; }
    startDemoMode();
};

cameraBtn.onclick = async () => {
    try { await initAudio(); } catch(e) { showError('Audio: '+e.message); return; }
    await startCameraMode();
};

// ─── ERROR ──────────────────────────────────
function showError(msg) {
    errorMsg.innerText = msg;
    errorToast.style.display = 'flex';
    setTimeout(() => { errorToast.style.display = 'none'; }, 8000);
}
