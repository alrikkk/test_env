/**
 * QR Scanner — camera feed + jsQR canvas decoding + manual token entry.
 * No auth flow; dev-mode bypass handled server-side.
 */

var video = document.getElementById('preview');
var canvas = document.getElementById('canvas');
var ctx = canvas.getContext('2d', { willReadFrequently: true });
var startBtn = document.getElementById('startBtn');
var stopBtn = document.getElementById('stopBtn');
var resultDiv = document.getElementById('result');
var manualInput = document.getElementById('manualToken');
var submitBtn = document.getElementById('submitManual');

var stream = null;
var scanning = false;
var rafId = null;

startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
submitBtn.addEventListener('click', function () {
  var val = manualInput.value.trim();
  if (val) processToken(val);
});

async function startCamera() {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    var insecureMsg = 'Insecure context: Camera requires HTTPS or http://localhost. Current origin is not secure.';
    console.error('[Scanner] Camera error:', insecureMsg);
    showResult('err', insecureMsg);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    var unsupportedMsg = 'Camera API (navigator.mediaDevices.getUserMedia) is not supported in this browser or context.';
    console.error('[Scanner] Camera error:', unsupportedMsg);
    showResult('err', unsupportedMsg);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return;
  }

  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
    } catch (constraintErr) {
      if (constraintErr.name === 'OverconstrainedError' || constraintErr.name === 'ConstraintNotSatisfiedError') {
        console.warn('[Scanner] environment facingMode unavailable, falling back to default video device:', constraintErr);
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } else {
        throw constraintErr;
      }
    }
    video.srcObject = stream;
    await video.play();
    scanning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    showResult('', 'Camera active — scanning for QR codes…');
    rafId = requestAnimationFrame(tick);
  } catch (err) {
    console.error('[Scanner] Camera error:', err);
    var message = 'Camera error: ' + (err.message || 'Could not access camera');
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      message = 'Camera permission denied. Please allow camera permissions in your browser.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      message = 'No camera found on this device.';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      message = 'Camera is in use by another application or hardware error occurred.';
    } else if (err.name === 'OverconstrainedError') {
      message = 'Camera does not satisfy requirements: ' + (err.constraint || '');
    }
    showResult('err', message);
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function stopCamera() {
  scanning = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  video.srcObject = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

function tick() {
  if (!scanning) return;
  if (video.readyState >= video.HAVE_ENOUGH_DATA) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert'
    });
    if (code && code.data) {
      stopCamera();
      processToken(code.data);
      return;
    }
  }
  rafId = requestAnimationFrame(tick);
}

async function processToken(tokenInput) {
  showResult('', 'Processing…');
  try {
    var res = await fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenInput })
    });
    var data = await res.json();

    if (data.status === 'success') {
      showResult('ok', 'CHECK-IN OK\n' +
        (data.participant || 'Participant') + ' | ' +
        (data.team || 'Individual') + ' | ' +
        fmtTime(data.checkedInAt));
    } else if (data.status === 'already_checked_in') {
      showResult('warn', 'ALREADY CHECKED IN\n' +
        (data.participant || 'Participant') + ' | ' +
        (data.team || 'Individual') + ' | ' +
        fmtTime(data.checkedInAt));
    } else if (data.status === 'invalid_qr') {
      showResult('err', 'INVALID QR — not registered or deactivated');
    } else {
      showResult('err', data.message || 'Check-in failed');
    }
  } catch (err) {
    showResult('err', 'Network error: ' + (err.message || 'Could not reach server'));
  }
}

function fmtTime(v) {
  var d = new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString();
}

function showResult(type, text) {
  resultDiv.hidden = false;
  resultDiv.className = type;
  resultDiv.textContent = text;
}

window.addEventListener('pagehide', stopCamera);
