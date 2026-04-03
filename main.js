/* =============================================
   Chef d'Orchestre AI — Vraie Musique Edition
   Mode: Tone.Sampler HQ | MoveNet | Backing Drone
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

function buildScale(key, root=48, octaves=3) { // 48 = C3
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

// ─── SAMPLER DATA ───────────────────────────
const PIANO_URLS = {
    "A0": "A0.mp3", "C1": "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3",
    "A1": "A1.mp3", "C2": "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
    "A2": "A2.mp3", "C3": "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
    "A3": "A3.mp3", "C4": "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
    "A4": "A4.mp3", "C5": "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
    "A5": "A5.mp3"
};

const CASIO_URLS = {
    "A1": "A1.mp3", "C2": "C2.mp3", "E2": "E2.mp3", "G2": "G2.mp3"
};

// ─── STATE ──────────────────────────────────
let synth, drone, filter, reverb, analyser;
let audioReady  = false;
let muted       = false;
let demoMode    = false;
let cameraMode  = false;
let net         = null; // MoveNet (lazy)
let scale       = 'pentatonic';
let synthType   = 'piano';
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
    
    // UI Feedback for loading HQ audio
    statusMsg.innerText = 'Chargement des samples HD...';
    demoBtn.style.display = 'none';
    cameraBtn.style.display = 'none';

    filter   = new Tone.Filter({frequency:4000, type:'lowpass', rolloff:-12});
    reverb   = new Tone.Reverb({decay:3, wet:0.4}); // richer reverb
    analyser = new Tone.Analyser('fft', 64);
    await reverb.ready;

    synth = new Tone.Sampler({
        urls: synthType === 'piano' ? PIANO_URLS : CASIO_URLS,
        baseUrl: synthType === 'piano' ? "https://tonejs.github.io/audio/salamander/" : "https://tonejs.github.io/audio/casio/",
        release: 1,
    }).chain(filter, reverb, analyser, Tone.getDestination());
    
    // Background Ambient Drone (Backing track)
    drone = new Tone.FatOscillator({
        type: "sawtooth",
        spread: 30,
        count: 3
    }).chain(new Tone.Filter(300, "lowpass"), reverb, Tone.getDestination());
    drone.volume.value = -Infinity;
    drone.start();
    updateDrone();

    await Tone.loaded(); // Wait for all mp3s to download

    synth.volume.value = -6; // Main sampler volume
    await Tone.start();
    Tone.Transport.bpm.value = parseInt(tempoSlider.value);
    audioReady = true;

    statusMsg.innerText = 'Prêt à jouer';
}

function updateDrone() {
    if (!drone) return;
    // Base frequency is C2 (midi 36)
    drone.frequency.rampTo(midiFreq(36), 1);
}

async function swapSynth(key) {
    if (!audioReady) { synthType = key; return; }
    const oldSynth = synth;
    synth = new Tone.Sampler({
        urls: key === 'piano' ? PIANO_URLS : CASIO_URLS,
        baseUrl: key === 'piano' ? "https://tonejs.github.io/audio/salamander/" : "https://tonejs.github.io/audio/casio/",
        release: 1,
    }).chain(filter, reverb, analyser, Tone.getDestination());
    synth.volume.value = -6;
    await Tone.loaded();
    oldSynth.dispose();
    synthType = key;
}

// Play a note with cooldown — returns true if played
function playNote(midi, volNorm) {
    if (!audioReady || muted) return false;
    const now = performance.now();
    const bpm = Tone.Transport.bpm.value;
    const cooldown = (60 / bpm) * 1000 * 0.45; 
    
    if (now - lastNoteT < cooldown) return false;
    if (midi === lastPlayedMidi && now - lastNoteT < cooldown * 2.5) return false;

    const freq = midiFreq(midi);
    const vel = 0.3 + volNorm * 0.7; // velocity 0.3–1.0
    synth.triggerAttackRelease(freq, '4n', undefined, vel);
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
function spawnP(x, y, color, n=3, scaleMultiplier=1) {
    for (let i = 0; i < n; i++)
        particles.push({
            x, y,
            vx: (Math.random()-0.5)*4,
            vy: -1 - Math.random()*3,
            life: 1,
            d: 0.015 + Math.random()*0.02,
            s: (2 + Math.random()*4) * scaleMultiplier,
            color
        });
}

function tickParticles() {
    pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    let alive = [];
    for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= p.d;
        if (p.life <= 0) continue;
        alive.push(p);
        pCtx.globalAlpha = p.life;
        pCtx.fillStyle = p.color;
        // Square particles for wireframe look
        const sz = p.s * p.life;
        pCtx.fillRect(p.x - sz/2, p.y - sz/2, sz, sz);
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
        // Cyan technical bars
        fftCtx.fillStyle = `rgba(0, 242, 255, ${0.3 + norm * 0.7})`;
        fftCtx.fillRect(i*bw, h-bh, bw-1, bh);
        // Top peak line
        if (norm > 0.05) {
            fftCtx.fillStyle = '#fff';
            fftCtx.fillRect(i*bw, h-bh-1, bw-1, 1);
        }
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

    container.addEventListener('mousemove', onPointerMove);
    container.addEventListener('mousedown', () => { pressing = true; });
    container.addEventListener('mouseup',   () => { pressing = false; });
    container.addEventListener('mouseleave',() => { pressing = false; });

    container.addEventListener('touchstart', e => {
        pressing = true; updateTouch(e);
    }, {passive:false});
    container.addEventListener('touchmove', e => {
        e.preventDefault(); updateTouch(e);
    }, {passive:false});
    container.addEventListener('touchend', () => { pressing = false; });

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

    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 50) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for (let y = 0; y < h; y += 50) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

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
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillStyle = isActive ? 'rgba(0,242,255,0.6)' : 'rgba(255,255,255,0.12)';
        ctx.fillText(midiName(notes[notes.length - 1 - i]), 6, ly + laneH/2 + 3);
    }

    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,215,0,0.3)';
    ctx.textAlign = 'right';
    ctx.fillText('🔊 VOLUME →', w - 10, 20);
    ctx.fillStyle = 'rgba(0,242,255,0.3)';
    ctx.textAlign = 'left';
    ctx.fillText('🎵 NOTE ↕', 10, h - 10);
    ctx.textAlign = 'start';

    const pitchNorm = 1 - myNorm; 
    const volNorm = mxNorm;       
    const noteIdx = Math.floor(pitchNorm * (notes.length - 1));
    const midi = notes[Math.max(0, Math.min(noteIdx, notes.length-1))];
    const filterNorm = mxNorm;
    const cutoff = 400 + filterNorm * 4600;
    if (filter) filter.frequency.rampTo(cutoff, 0.08);

    const db = Tone.gainToDb(Math.max(0.01, volNorm));
    if (audioReady && !muted) {
        Tone.getDestination().volume.rampTo(db, 0.08);
        // Drone volume mapping
        drone.volume.rampTo(-20 + volNorm * 10, 0.1); 
    }
    volBar.style.height = (volNorm * 100) + '%';
    volSpan.innerText = Math.round(volNorm * 100) + '%';

    // ─ Cursor ─
    const cursorColor = pressing ? '#00f2ff' : '#fff';
    const sz = pressing ? 12 : 8;
    
    // Crosshair lines (technical dashed)
    ctx.strokeStyle = pressing ? 'rgba(0,242,255,0.3)' : 'rgba(255,255,255,0.15)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    ctx.setLineDash([]);

    // Technical Square Cursor
    ctx.strokeStyle = cursorColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px - sz, py - sz, sz*2, sz*2);
    if (pressing) {
        ctx.fillStyle = 'rgba(0,242,255,0.15)';
        ctx.fillRect(px - sz, py - sz, sz*2, sz*2);
    }

    if (pressing) {
        const played = playNote(midi, volNorm);
        if (played) {
            spawnP(px, py, '#00f2ff', 5, volNorm*2);
            if (volNorm > 0.6) spawnP(px, py, '#ffd700', 3, 2);
        }
    } else {
        if (drone) drone.volume.rampTo(-Infinity, 0.5);
    }

    // Hint text
    if (!pressing) {
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(0,242,255,0.5)';
        ctx.textAlign = 'center';
        ctx.fillText('[SYSTEM_READY] CLICK_AND_MOVE_TO_DIRIGATE', w/2, h - 14);
        ctx.textAlign = 'start';
    }

    tickParticles(); drawFFT(); tickFPS();
    requestAnimationFrame(demoLoop);
}

// ═══════════════════════════════════════════
//  CAMERA MODE (MoveNet lazy-loaded)
// ═══════════════════════════════════════════
async function startCameraMode() {
    overlay.querySelector('.start-buttons').style.display = 'none';
    statusMsg.innerText = 'Chargement caméra...';

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {width: W, height: H, facingMode:'user'}, audio: false
        });
        video.srcObject = stream;
        await new Promise(r => { video.onloadedmetadata = () => { video.play(); r(); }; });

        statusMsg.innerText = "Chargement TensorFlow & MoveNet...";
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs');
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection');

        statusMsg.innerText = "Initialisation IA...";
        net = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
            modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
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
        const poses = await net.estimatePoses(video);

        if (poses.length > 0) {
            const pose = poses[0];
            drawSkeleton(pose.keypoints);
            drawPoints(pose.keypoints);
            processPose(pose);
            helpToast.classList.remove('visible');
        } else {
            helpToast.classList.add('visible');
            $('help-text').innerText = 'Placez-vous face à la caméra et levez les mains.';
            if (drone) drone.volume.rampTo(-Infinity, 1);
        }
    } catch(e) {
        // Skip frame on error
        console.error(e);
    }

    ctx.restore();
    tickParticles(); drawFFT(); tickFPS();
    requestAnimationFrame(cameraLoop);
}

function drawPoints(kps) {
    for (const kp of kps) {
        if (kp.score < 0.4) continue;
        if (!kp.name.includes('wrist') && !kp.name.includes('elbow')) continue;
        const {x, y} = kp;
        const isL = kp.name.includes('left');
        const c = isL ? '#00f2ff' : '#fff';
        
        // Technical Square Point
        ctx.strokeStyle = c;
        ctx.lineWidth = 1;
        ctx.strokeRect(x-8, y-8, 16, 16);
        
        // Center cross
        ctx.beginPath();
        ctx.moveTo(x-4, y); ctx.lineTo(x+4, y);
        ctx.moveTo(x, y-4); ctx.lineTo(x, y+4);
        ctx.stroke();
    }
}

function drawSkeleton(kps) {
    const map = {}; kps.forEach(k => map[k.name] = k);
    const pairs = [['left_shoulder','left_elbow'],['left_elbow','left_wrist'],
                   ['right_shoulder','right_elbow'],['right_elbow','right_wrist']];
    ctx.save();
    ctx.setLineDash([2, 4]);
    for (const [a,b] of pairs) {
        if (map[a]?.score > 0.4 && map[b]?.score > 0.4) {
            ctx.beginPath();
            ctx.moveTo(map[a].x, map[a].y);
            ctx.lineTo(map[b].x, map[b].y);
            ctx.strokeStyle = 'rgba(0, 242, 255, 0.4)';
            ctx.lineWidth = 1; ctx.stroke();
        }
    }
    ctx.restore();
}

function processPose(pose) {
    const lw = pose.keypoints.find(k => k.name==='left_wrist');
    const rw = pose.keypoints.find(k => k.name==='right_wrist');

    let volNorm = 0.5;

    if (rw && rw.score > 0.4) {
        volNorm = Math.max(0, Math.min(1, 1 - rw.y/H));
        const db = Tone.gainToDb(Math.max(0.01, volNorm));
        if (!muted) {
            Tone.getDestination().volume.rampTo(db, 0.08);
            drone.volume.rampTo(-20 + volNorm * 10, 0.1); 
        }
        volBar.style.height = (volNorm*100) + '%';
        volSpan.innerText = Math.round(volNorm*100) + '%';
    } else {
        drone.volume.rampTo(-Infinity, 0.5);
    }

    if (lw && lw.score > 0.4) {
        const pn = Math.max(0, Math.min(1, 1 - lw.y/H));
        const idx = Math.floor(pn * (notes.length-1));
        const midi = notes[Math.max(0, Math.min(idx, notes.length-1))];
        const filterN = lw.x / W;
        filter.frequency.rampTo(400 + filterN*4600, 0.08);

        const played = playNote(midi, volNorm);
        if (played) {
            spawnP(lw.x, lw.y, '#00f2ff', 4, volNorm*2);
        }
    }
}

// ─── CONTROLS ───────────────────────────────
scaleSelect.onchange = e => {
    scale = e.target.value;
    notes = buildScale(scale);
    hudScale.innerText = SCALES[scale].name;
    updateDrone();
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
    try { await initAudio(); startDemoMode(); } 
    catch(e) { showError('Audio: '+e.message); }
};

cameraBtn.onclick = async () => {
    try { await initAudio(); await startCameraMode(); } 
    catch(e) { showError('Caméra/Audio: '+e.message); }
};

// ─── ERROR ──────────────────────────────────
function showError(msg) {
    errorMsg.innerText = msg;
    errorToast.style.display = 'flex';
    setTimeout(() => { errorToast.style.display = 'none'; }, 8000);
}
