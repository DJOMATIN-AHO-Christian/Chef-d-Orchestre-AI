const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusMsg = document.getElementById('status-message');
const startBtn = document.getElementById('start-btn');
const statusOverlay = document.getElementById('status-overlay');

const volSpan = document.getElementById('vol-val');
const pitchSpan = document.getElementById('pitch-val');
const countSpan = document.getElementById('count-val');

// Tone.js Components
let synth, lfo, filter, reverb;
let audioStarted = false;

// PoseNet State
let net;
const width = 640;
const height = 480;

canvas.width = width;
canvas.height = height;

async function setupCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Webcam non supportée sur ce navigateur');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: width, height: height },
        audio: false
    });
    video.srcObject = stream;

    return new Promise((resolve) => {
        video.onloadedmetadata = () => {
            video.play();
            resolve(video);
        };
    });
}

async function initAudio() {
    // Create a rich synth
    synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: {
            attack: 0.1,
            decay: 0.2,
            sustain: 0.5,
            release: 1
        }
    }).toDestination();

    filter = new Tone.Filter(2000, "lowpass").toDestination();
    reverb = new Tone.Reverb(2).toDestination();
    synth.connect(filter);
    filter.connect(reverb);

    await Tone.start();
    audioStarted = true;
    console.log("Audio ready");
}

async function loadPoseNet() {
    statusMsg.innerText = "Chargement du modèle d'IA...";
    net = await posenet.load({
        architecture: 'MobileNetV1',
        outputStride: 16,
        inputResolution: { width: 640, height: 480 },
        multiplier: 0.75
    });
    statusMsg.innerText = "Prêt !";
    startBtn.style.display = 'block';
}

function drawKeypoint(keypoint) {
    const { y, x } = keypoint.position;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, 2 * Math.PI);
    ctx.fillStyle = keypoint.part.includes('Left') ? '#00f2ff' : '#ffd700';
    ctx.fill();
}

function updateAudio(pose) {
    if (!audioStarted) return;

    const leftWrist = pose.keypoints.find(k => k.part === 'leftWrist');
    const rightWrist = pose.keypoints.find(k => k.part === 'rightWrist');

    // MAPPING
    // Right Wrist -> Volume (Vertical)
    if (rightWrist && rightWrist.score > 0.5) {
        const volNorm = 1 - (rightWrist.position.y / height); // 0 at bottom, 1 at top
        const db = Tone.gainToDb(volNorm);
        Tone.getDestination().volume.rampTo(db, 0.1);
        volSpan.innerText = Math.round(volNorm * 100) + '%';
    }

    // Left Wrist -> Pitch (Vertical)
    if (leftWrist && leftWrist.score > 0.5) {
        const pitchNorm = 1 - (leftWrist.position.y / height);
        // Map 0-1 to a frequency range (C2 to C6)
        const freq = 65 + (pitchNorm * 1000);
        synth.set({ frequency: freq });

        // Trigger a note periodically if hands are moving
        if (Math.random() > 0.9) {
            synth.triggerAttackRelease(freq, "8n");
        }
        pitchSpan.innerText = Math.round(freq) + 'Hz';
    }
}

async function detect() {
    const poses = await net.estimateMultiplePoses(video, {
        flipHorizontal: false, // We flip the canvas via CSS
        maxDetections: 5,
        scoreThreshold: 0.5,
        nmsRadius: 20
    });

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);

    // Multi-person blur logic
    if (poses.length > 1) {
        document.body.classList.add('skeleton-blur');
    } else {
        document.body.classList.remove('skeleton-blur');
    }
    countSpan.innerText = poses.length;

    poses.forEach(pose => {
        pose.keypoints.forEach(keypoint => {
            if (keypoint.score > 0.5 && (keypoint.part.includes('Wrist') || keypoint.part.includes('Elbow'))) {
                drawKeypoint(keypoint);
            }
        });
        updateAudio(pose);
    });

    requestAnimationFrame(detect);
}

startBtn.addEventListener('click', async () => {
    await initAudio();
    statusOverlay.classList.add('hidden');
    detect();
});

async function main() {
    try {
        await setupCamera();
        await loadPoseNet();
    } catch (err) {
        statusMsg.innerText = "Erreur: " + err.message;
        console.error(err);
    }
}

main();
