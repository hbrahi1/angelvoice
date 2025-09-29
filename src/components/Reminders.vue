<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { nextTick } from 'vue'

const highlightId = ref('')   // which reminder to highlight

// Local storage key
const STORAGE_KEY = 'reminders.v1'
const AUDIO_PREFIX = 'reminders.v1.audio.'

// State
const reminders = ref([])
const text = ref('')
const due = ref('') // ISO date string (yyyy-mm-dd)

const time = ref('') // HH:MM (24h) required after recording
const error = ref('')

// New reminder recording state (pre-save)
const newId = ref('') // temporary id used to store pre-save recording
const hasNewAudio = ref(false)

// Save enablement
const canSave = computed(() => {
  try {
    return hasNewAudio.value && !!(text.value || '').trim() && !!due.value && !!time.value
  } catch (e) {
    return false
  }
})

// Recording state
const recordingId = ref('')
const recError = ref('')
const recordingSecondsLeft = ref(0)
let mediaRecorder = null
let recordChunks = []
let recordTimer = null
let recordInterval = null
let currentStream = null

// Playback state
const playingId = ref('')
let currentAudio = null

// If playback is initiated from a calendar link, we may need a user interaction
const pendingPlayId = ref('')

// Hidden audio element used for element-based autoplay
const autoplayAudioEl = ref(null)

// Storage usage state (bytes)
const storageUsedBytes = ref(0)

function calcStorageBytes() {
  let total = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (k === STORAGE_KEY || k.startsWith(AUDIO_PREFIX)) {
        try {
          const v = localStorage.getItem(k) || ''
          total += new Blob([v]).size
        } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
  storageUsedBytes.value = total
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      reminders.value = []
      return
    }
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      // Normalize items: { id, text, due, time?, hasAudio? }
      const list = parsed.filter(r => r && typeof r.text === 'string' && typeof r.due === 'string')
      // Mark whether an audio recording exists for each reminder
      for (const r of list) {
        try { r.hasAudio = !!localStorage.getItem(AUDIO_PREFIX + r.id) } catch (e) { /* ignore */ }
      }
      reminders.value = list
    } else {
      reminders.value = []
    }
  } catch (e) {
    console.warn('Failed to read reminders from localStorage', e)
    reminders.value = []
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders.value))
  } catch (e) {
    console.warn('Failed to write reminders to localStorage', e)
  } finally {
    try { calcStorageBytes() } catch (e) { /* ignore */ }
  }
}

function ensureNewId() {
  if (!newId.value) {
    newId.value = (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)) + '-new'
  }
}

function startNewRecording() {
  recError.value = ''
  ensureNewId()
  // Start recording against the temporary id
  startRecording(newId.value)
}

function deleteNewRecording() {
  try {
    if (newId.value) {
      localStorage.removeItem(audioKey(newId.value))
      hasNewAudio.value = false
      try { calcStorageBytes() } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}

function resetNewForm() {
  text.value = ''
  due.value = ''
  time.value = ''
  hasNewAudio.value = false
  // Do not keep stale temp audio
  deleteNewRecording()
  newId.value = ''
}


function addReminder() {
  error.value = ''
  const trimmed = text.value.trim()
  if (!hasNewAudio.value) {
    error.value = 'Please record your reminder first.'
    return
  }
  if (!trimmed) {
    error.value = 'Please enter a reminder text.'
    return
  }
  if (!due.value) {
    error.value = 'Please choose a due date.'
    return
  }
  if (!time.value) {
    error.value = 'Please choose a time.'
    return
  }
  // Validate that the temp audio exists
  const tempKey = newId.value ? audioKey(newId.value) : ''
  let audioData = ''
  try { audioData = tempKey ? (localStorage.getItem(tempKey) || '') : '' } catch (e) { audioData = '' }
  if (!audioData) {
    error.value = 'Recording was not found. Please record again.'
    hasNewAudio.value = false
    return
  }

  const id = crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)
  const reminder = { id, text: trimmed, due: due.value, time: time.value }
  reminders.value.unshift(reminder)

  // Move audio from temp key to final key
  try {
    localStorage.setItem(audioKey(id), audioData)
    localStorage.removeItem(tempKey)
    reminder.hasAudio = true
  } catch (e) {
    recError.value = 'Saved reminder but failed to move audio to permanent storage.'
    reminder.hasAudio = false
  } finally {
    try { calcStorageBytes() } catch (e) { /* ignore */ }
  }

  // Persist first, then trigger ICS download immediately
  persist()
  try { downloadICS(reminder) } catch (e) { /* ignore */ }
  resetNewForm()
}

function deleteReminder(id) {
  const idx = reminders.value.findIndex(r => r.id === id)
  if (idx !== -1) {
    try { localStorage.removeItem(AUDIO_PREFIX + id) } catch (e) { /* ignore */ }
    if (playingId.value === id) {
      stopCurrentAudio()
    }
    reminders.value.splice(idx, 1)
    persist()
  }
}

function audioKey(id) { return AUDIO_PREFIX + id }

function clearRecordingTimers() {
  if (recordInterval) { clearInterval(recordInterval); recordInterval = null }
  if (recordTimer) { clearTimeout(recordTimer); recordTimer = null }
}

function cleanupStream() {
  try {
    if (currentStream) {
      currentStream.getTracks().forEach(t => t.stop())
      currentStream = null
    }
  } catch (e) { /* ignore */ }
  clearRecordingTimers()
}

function stopCurrentAudio() {
  try {
    if (currentAudio) {
      // Remove listeners
      currentAudio.onended = null
      currentAudio.onpause = null
      currentAudio.onerror = null
      currentAudio.pause()
      try { currentAudio.currentTime = 0 } catch (e) { /* ignore */ }
    }
  } finally {
    currentAudio = null
    playingId.value = ''
  }
}

async function startRecording(id) {
  recError.value = ''
  if (recordingId.value) return // already recording
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    recError.value = 'Audio recording is not supported in this browser.'
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    currentStream = stream
    recordChunks = []
    // Prefer audio/webm or default
    mediaRecorder = new MediaRecorder(stream)

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordChunks.push(e.data)
    }

    mediaRecorder.onstop = async () => {
      try {
        const mime = mediaRecorder && mediaRecorder.mimeType ? mediaRecorder.mimeType : 'audio/webm'
        const blob = new Blob(recordChunks, { type: mime })
        const reader = new FileReader()
        reader.onloadend = () => {
          try {
            localStorage.setItem(audioKey(id), String(reader.result))
            const r = reminders.value.find(x => x.id === id)
            if (r) r.hasAudio = true
            // If this was a pre-save recording, mark it as available
            if (id === newId.value) {
              hasNewAudio.value = true
            }
          } catch (e) {
            recError.value = 'Failed to save recording. Storage may be full.'
          } finally {
            try { calcStorageBytes() } catch (e) { /* ignore */ }
          }
        }
        reader.readAsDataURL(blob)
      } catch (e) {
        recError.value = 'Failed to process recording.'
      } finally {
        recordingId.value = ''
        recordingSecondsLeft.value = 0
        cleanupStream()
      }
    }

    recordingId.value = id
    recordingSecondsLeft.value = 30
    mediaRecorder.start()
    recordInterval = setInterval(() => {
      if (recordingSecondsLeft.value > 0) recordingSecondsLeft.value--
    }, 1000)
    recordTimer = setTimeout(() => {
      try { mediaRecorder && mediaRecorder.stop() } catch (e) { /* ignore */ }
    }, 30000)
  } catch (e) {
    recError.value = 'Microphone permission denied or unavailable.'
    cleanupStream()
    recordingId.value = ''
  }
}

function stopRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
  } catch (e) {
    cleanupStream()
    recordingId.value = ''
  }
}

function playRecording(id, opts = {}) {
  const { suppressError = false } = opts
  if (!suppressError) recError.value = ''
  try {
    // Toggle: if this id is already playing, stop it
    if (playingId.value === id) {
      stopCurrentAudio()
      return Promise.resolve()
    }
    // Stop any currently playing audio first
    if (currentAudio) {
      stopCurrentAudio()
    }

    const data = localStorage.getItem(audioKey(id))
    if (!data) {
      if (!suppressError) recError.value = 'No recording found for this reminder.'
      const r = reminders.value.find(x => x.id === id)
      if (r) r.hasAudio = false
      return Promise.reject(new Error('no-recording'))
    }
    const audio = new Audio(data)
    currentAudio = audio
    playingId.value = id

    audio.onended = () => {
      stopCurrentAudio()
    }
    audio.onerror = () => {
      if (!suppressError) recError.value = 'Failed to play recording.'
      stopCurrentAudio()
    }

    const p = audio.play()
    if (p && typeof p.then === 'function') {
      return p.catch((err) => {
        if (!suppressError) recError.value = 'Failed to play recording.'
        stopCurrentAudio()
        return Promise.reject(err)
      })
    }
    return Promise.resolve()
  } catch (e) {
    if (!suppressError) recError.value = 'Failed to play recording.'
    stopCurrentAudio()
    return Promise.reject(e)
  }
}

function deleteAudio(id) {
  try {
    localStorage.removeItem(audioKey(id))
    if (playingId.value === id) {
      stopCurrentAudio()
    }
    const r = reminders.value.find(x => x.id === id)
    if (r) r.hasAudio = false
  } catch (e) { /* ignore */ }
  try { calcStorageBytes() } catch (e) { /* ignore */ }
}

// Attempt to autoplay using a DOM <audio autoplay> element, which can succeed in more contexts
function tryAutoplayViaElement(id) {
  recError.value = ''
  try {
    const data = localStorage.getItem(audioKey(id))
    if (!data) {
      const r = reminders.value.find(x => x.id === id)
      if (r) r.hasAudio = false
      return Promise.reject(new Error('no-recording'))
    }

    // Stop any audio already playing
    if (currentAudio) {
      stopCurrentAudio()
    }

    const el = autoplayAudioEl.value || new Audio()
    // Ensure element has needed attributes
    try { el.setAttribute && el.setAttribute('playsinline', ''); } catch (e) { /* ignore */ }
    el.autoplay = true
    // Use muted autoplay trick: start muted (allowed), then unmute once playing
    el.muted = true
    el.src = data

    // Wire events
    el.onended = () => { stopCurrentAudio() }
    el.onerror = () => { recError.value = 'Failed to play recording.'; stopCurrentAudio() }
    el.onplaying = () => { try { el.muted = false } catch (e) { /* ignore */ } }

    // Update state
    currentAudio = el
    playingId.value = id

    const p = el.play()
    if (p && typeof p.then === 'function') {
      return p.then(() => {
        // Ensure unmute shortly after start in case 'playing' wasn't fired yet
        setTimeout(() => { try { el.muted = false } catch (e) { /* ignore */ } }, 150)
      }).catch(err => {
        stopCurrentAudio()
        return Promise.reject(err)
      })
    }
    // Fallback path
    setTimeout(() => { try { el.muted = false } catch (e) { /* ignore */ } }, 150)
    return Promise.resolve()
  } catch (e) {
    stopCurrentAudio()
    return Promise.reject(e)
  }
}

function stopPlayback() {
  stopCurrentAudio()
}


const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

function localDateFromISO(isoDate /* 'yyyy-mm-dd' */) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d) // local time, no timezone shift
}

function formatDateLocal(isoDate) {
  return dateFmt.format(localDateFromISO(isoDate))
}

function isScrollable(el) {
  if (!el) return false
  const style = getComputedStyle(el)
  const overflowY = style.overflowY
  return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight
}

function getScrollParent(el) {
  let p = el?.parentElement
  while (p && p !== document.body && !isScrollable(p)) p = p.parentElement
  return p || document.scrollingElement || document.documentElement
}

function scrollToReveal(el) {
  const parent = getScrollParent(el)
  const parentRect = parent.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const current = parent.scrollTop
  const offset = (elRect.top - parentRect.top) - (parent.clientHeight / 2 - elRect.height / 2)
  // iOS/Safari may ignore smooth; that’s fine—still scrolls.
  try {
    parent.scrollTo({ top: current + offset, behavior: 'smooth' })
  } catch {
    parent.scrollTop = current + offset
  }
  // Also nudge the window (fallback for some mobile modes)
  try {
    window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 80, behavior: 'smooth' })
  } catch {}
}

function highlightAndScroll(id) {
  highlightId.value = id
  nextTick(() => {
    const el = document.getElementById(`rem-${id}`)
    if (el) {
      // small delay helps after first paint / mobile emulation
      setTimeout(() => scrollToReveal(el), 50)
    }
  })
  setTimeout(() => { if (highlightId.value === id) highlightId.value = '' }, 10000)
}



onMounted(() => {
  load()
  try { calcStorageBytes() } catch (e) { /* ignore */ }

  // Handle calendar link (?play=<id>): attempt autoplay via <audio autoplay>, then fallback
  // try {
  //   const params = new URLSearchParams(window.location.search || '')
  //   const play = params.get('play')
  //   if (play) {
  //     setTimeout(() => {
  //       // First try element-based autoplay
  //       tryAutoplayViaElement(play)
  //         .then(() => { pendingPlayId.value = '' })
  //         .catch(() => {
  //           // Fallback to programmatic playback (may still be blocked)
  //           playRecording(play, { suppressError: true })
  //             .then(() => { pendingPlayId.value = '' })
  //             .catch(() => {
  //               // Autoplay blocked — show hint and wait for a click/key/touch
  //               pendingPlayId.value = play
  //               const onInteract = () => {
  //                 window.removeEventListener('click', onInteract, true)
  //                 window.removeEventListener('keydown', onInteract, true)
  //                 window.removeEventListener('touchstart', onInteract, true)
  //                 playRecording(play).finally(() => { pendingPlayId.value = '' })
  //               }
  //               window.addEventListener('click', onInteract, true)
  //               window.addEventListener('keydown', onInteract, true)
  //               window.addEventListener('touchstart', onInteract, true)
  //             })
  //         })
  //     }, 0)
  //   }
  // } catch (e) { console.log(e)/* ignore */ }



  try {
    const params = new URLSearchParams(window.location.search || '')
    const play = params.get('play')
    if (play) {
      pendingPlayId.value = play   // keeps your “tap to play” hint, if desired
      highlightAndScroll(play)
    }
  } catch {}


})

// Optional: keep storage in sync if user edits via DevTools
watch(reminders, persist, { deep: true })
function pad(n) { return n.toString().padStart(2, '0') }

function escapeICS(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function toUTCICS(dt) {
  const y = dt.getUTCFullYear()
  const m = pad(dt.getUTCMonth() + 1)
  const d = pad(dt.getUTCDate())
  const hh = pad(dt.getUTCHours())
  const mm = pad(dt.getUTCMinutes())
  const ss = pad(dt.getUTCSeconds())
  return `${y}${m}${d}T${hh}${mm}${ss}Z`
}

function toDateOnlyICS(date) {
  // date is a JS Date at local midnight; output VALUE=DATE format
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  return `${y}${m}${d}`
}

function buildICSOld(reminder) {
  const now = new Date()
  const dtstamp = toUTCICS(now)
  const uid = `${reminder.id}@angelvoice`

  // Prepare audio info early to include URL in DESCRIPTION
  let audioDataUrl = ''
  let audioMime = 'audio/webm'
  try {
    const data = localStorage.getItem(audioKey(reminder.id))
    if (data) {
      audioDataUrl = data
      const m = /^data:([^;]+);/.exec(audioDataUrl)
      if (m && m[1]) audioMime = m[1]
    }
  } catch (e) { /* ignore */ }

  // Build a play URL into this app so clicking opens and plays the recording
  let playUrl = ''
  try {
    const loc = window && window.location ? window.location : { origin: '', pathname: '' }
    playUrl = `${loc.origin}${loc.pathname}?play=${encodeURIComponent(reminder.id)}`
  } catch (e) { /* ignore */ }

  // Build DESCRIPTION text that includes the clickable play URL when audio exists
  const descriptionText = audioDataUrl
    ? `${String(reminder.text || '')}\n\nPlay recording: ${playUrl}`
    : String(reminder.text || '')
  const summary = escapeICS(reminder.text)
  const description = escapeICS(descriptionText)

  let lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AngelVoice//Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,

  ]
  if (playUrl) {
     lines.push(`URL:${escapeICS(playUrl)}`);
  }
  try {
    if (reminder.time && reminder.time.length >= 4) {
      // Timed event: compose local date/time and convert to UTC for interoperability
      const [h, mi] = reminder.time.split(':').map(x => parseInt(x || '0', 10))
      const [yy, mm, dd] = reminder.due.split('-').map(x => parseInt(x || '0', 10))
      const local = new Date(yy, (mm - 1), dd, h, mi, 0, 0)
      const dtstart = toUTCICS(local)
      lines.push(`DTSTART:${dtstart}`)
      // Set a default duration of 5 minutes
      lines.push('DURATION:PT5M')
    } else {
      // All-day event
      const [yy, mm, dd] = reminder.due.split('-').map(x => parseInt(x || '0', 10))
      const localMidnight = new Date(yy, (mm - 1), dd)
      const dateOnly = toDateOnlyICS(localMidnight)
      lines.push(`DTSTART;VALUE=DATE:${dateOnly}`)
      // Optional DTEND next day could be added for full-day; keeping minimal
    }
  } catch (e) {
    // Fallback: just drop DTSTART if something goes wrong
  }

  // If this reminder has an audio recording stored, add a clickable URL to this app and ATTACH with data URL
  try {
    if (audioDataUrl) {
      if (playUrl) lines.push(`URL:${playUrl}`)
      lines.push(`ATTACH;FMTTYPE=${audioMime}:${audioDataUrl}`)
    }
  } catch (e) { /* ignore */ }

  lines.push('END:VEVENT', 'END:VCALENDAR')

  console.log(playUrl);
  return lines.join('\r\n')
}



function buildICS(reminder) {
  const now = new Date();
  const dtstamp = toUTCICS(now);
  const uid = `${reminder.id}@angelvoice`;

  // Optional audio info (kept for MIME; most clients ignore custom audio)
  let audioDataUrl = '';
  let audioMime = 'audio/webm';
  try {
    const data = localStorage.getItem(audioKey(reminder.id));
    if (data) {
      audioDataUrl = data;
      const m = /^data:([^;]+);/.exec(audioDataUrl);
      if (m && m[1]) audioMime = m[1];
    }
  } catch (e) { /* ignore */ }

  // Play URL that opens this app and plays the recording
  let playUrl = '';
  try {
    const loc = (typeof window !== 'undefined' && window.location)
        ? window.location
        : { origin: '', pathname: '' };
    playUrl = `${loc.origin}${loc.pathname}?play=${encodeURIComponent(reminder.id)}`;
  } catch (e) { /* ignore */ }

  // Description with link as text (fallback)
  const descriptionText = audioDataUrl
      ? `${String(reminder.text || '')}\n\nPlay recording: ${playUrl}`
      : String(reminder.text || '');
  const summary = escapeICS(reminder.text);
  const description = escapeICS(descriptionText);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AngelVoice//Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`
  ];

  // DTSTART (timed or all-day)
  let hasDtStart = false;
  try {
    if (reminder.time && reminder.time.length >= 4) {
      // Timed event -> convert local to UTC
      const [h, mi] = reminder.time.split(':').map(x => parseInt(x || '0', 10));
      const [yy, mm, dd] = reminder.due.split('-').map(x => parseInt(x || '0', 10));
      const local = new Date(yy, (mm - 1), dd, h, mi, 0, 0);
      const dtstart = toUTCICS(local);
      lines.push(`DTSTART:${dtstart}`);
      lines.push('DURATION:PT5M'); // lightweight timed event
      hasDtStart = true;
    } else if (reminder.due) {
      // All-day
      const [yy, mm, dd] = reminder.due.split('-').map(x => parseInt(x || '0', 10));
      const localMidnight = new Date(yy, (mm - 1), dd);
      const dateOnly = toDateOnlyICS(localMidnight);
      lines.push(`DTSTART;VALUE=DATE:${dateOnly}`);
      hasDtStart = true;
    }
  } catch (e) {
    // proceed without DTSTART if parsing fails
  }

  // Clickable URL property (explicit). Use only if it's a real http(s) URL.
  const isHttpUrl = typeof playUrl === 'string' && /^https?:\/\//i.test(playUrl);
  if (isHttpUrl) {
    lines.push(`URL:${playUrl}`);
  }

  // VALARMs (one action per alarm). Fire at start.
  if (hasDtStart) {
    // Display alarm (reliable across clients)
    lines.push(
        'BEGIN:VALARM',
        'TRIGGER;RELATED=START:PT0S',
        'ACTION:DISPLAY',
        `DESCRIPTION:Reminder - ${summary}`,
        'END:VALARM'
    );

    // Optional audio alarm (many clients ignore or play default sound)
    if (isHttpUrl) {
      lines.push(
          'BEGIN:VALARM',
          'TRIGGER;RELATED=START:PT0S',
          'ACTION:AUDIO',
          `ATTACH;FMTTYPE=${audioMime}:${playUrl}`,
          'END:VALARM'
      );
    }
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  // RFC 5545 line endings
  return lines.join('\r\n') + '\r\n';
}



function downloadICS(reminder) {
  try {
    const ics = buildICS(reminder)
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeText = (reminder.text || '').trim().slice(0, 50).replace(/[^a-z0-9-_]+/gi, '_') || 'reminder'
    a.download = `reminder-${safeText}-${reminder.id}.ics`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    console.warn('Failed to download ICS', e)
  }
}

</script>

<template>
  <section class="reminders">
    <h1>Reminders</h1>
        <div class="storage">Storage used: {{ storageUsedBytes }} bytes</div>
    <form class="reminder-form" @submit.prevent="addReminder">
      <!-- Recording controls for new reminder -->
      <div class="field">
        <label>Recording</label>
        <div class="actions">
          <button v-if="recordingId && recordingId === newId" type="button" class="stop" @click="stopRecording">Stop ({{ recordingSecondsLeft }}s)</button>
          <button v-else style="min-width: 300px;" type="button" class="record" @click="startNewRecording" >{{ hasNewAudio ? 'Re-record' : 'Record' }}</button>
          <template v-if="hasNewAudio && recordingId !== newId">
            <button v-if="playingId === newId" type="button" class="stop" @click="stopPlayback">Stop</button>
            <button v-else type="button" class="play" @click="playRecording(newId)">Play</button>
            <button type="button" class="del-audio" @click="deleteNewRecording">Delete audio</button>
          </template>
        </div>
      </div>
      <div class="field">
        <label for="rem-text">Text</label>
        <input id="rem-text" v-model="text" type="text" placeholder="Buy milk" :disabled="!hasNewAudio" required />
      </div>
      <div class="field">
        <label for="rem-due">Due date</label>
        <input id="rem-due" v-model="due" type="date" :disabled="!hasNewAudio" required />
      </div>
      <div class="field">
        <label for="rem-time">Time</label>
        <input id="rem-time" v-model="time" type="time" :disabled="!hasNewAudio" required />
      </div>
      <button type="submit" :disabled="!canSave">Save</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="recError" class="error">{{ recError }}</p>
    <p v-if="pendingPlayId && !playingId" class="info">Click or tap anywhere to play the recording from the calendar link.</p>
    <audio ref="autoplayAudioEl" style="display:none" playsinline autoplay></audio>

    <div v-if="reminders.length === 0" class="empty">No reminders yet.</div>

    <ul class="list" v-else>
      <li v-for="r in reminders" :key="r.id" :class="['item', { highlight: r.id === highlightId }]">
        <div class="meta">
          <div class="text">{{ r.text }}</div>
          <div class="id">ID: {{ r.id }}</div>

          <div class="due">
            Due: {{ formatDateLocal(r.due) }} <span v-if="r.time"> {{ r.time }}</span>
          </div>
        </div>
        <div class="actions">

          <template v-if="r.hasAudio && recordingId !== r.id">
            <button v-if="playingId === r.id" class="stop" @click="stopPlayback">Stop</button>
            <button v-else class="play" @click="playRecording(r.id)">Play</button>
<!--            <button class="del-audio" @click="deleteAudio(r.id)">Delete audio</button>-->
          </template>
          <button v-if="recordingId === r.id" class="stop" @click="stopRecording">Stop ({{ recordingSecondsLeft }}s)</button>
          <button v-else class="record" @click="startRecording(r.id)">{{ r.hasAudio ? 'Re-record' : 'Record' }}</button>
          <button class="ics" @click="downloadICS(r)">Download ICS</button>
        </div>
        <button class="delete" @click="deleteReminder(r.id)">Delete</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.reminders {
  max-width: 720px;
  width: 100%;
  box-sizing: border-box;
  margin: 2rem auto;
  padding: 1rem;
}

h1 { margin-bottom: 0.25rem; }
.storage { color: #555; margin-bottom: 1rem; font-size: 0.9rem; }

.reminder-form {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 0.75rem;
  align-items: end;
}

.field { display: flex; flex-direction: column; }
label { font-size: 0.9rem; margin-bottom: 0.25rem; }
input[type="text"], input[type="date"], input[type="time"] {
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 6px;
}
button[type="submit"] {
  padding: 0.6rem 1rem;
  border-radius: 6px;
  border: 1px solid transparent;
  background: #3b82f6;
  color: white;
  cursor: pointer;
}
button[type="submit"]:hover { background: #2563eb; }
button[type="submit"][disabled],
button[type="submit"]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none; /* prevent clicks/taps on disabled button */
}

.error { color: #b91c1c; margin-top: 0.5rem; }
.info { color: #374151; margin-top: 0.5rem; }
.empty { color: #666; margin-top: 1rem; }

.list { list-style: none; padding: 0; margin-top: 1rem; }
.item { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #eee; }
.text { font-weight: 600; }
.id { font-size: 0.75rem; color: #666; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
.due { font-size: 0.85rem; color: #555; }
.delete { border: 1px solid #ef4444; background: white; color: #ef4444; padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; }
.delete:hover { background: #fee2e2; }

.actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.record { border: 1px solid #10b981; background: #10b981; color: 374151; padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; }
.record:hover { background: #059669; }
.stop { border: 1px solid #f59e0b; background: #f59e0b; color: white; padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; }
.stop:hover { background: #d97706; }
.play { border: 1px solid #6b7280; background: #10b981; color: #374151; padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; }
.play:hover { background: #f3f4f6; }
.del-audio { border: 1px solid #e11d48; background: white; color: #e11d48; padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; }
.del-audio:hover { background: #ffe4e6; }
.ics { border: 1px solid #6b7280; background: white; color: #374151; padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; }
.ics:hover { background: #f3f4f6; }
</style>

<style scoped>
@media (max-width: 600px) {
  .reminder-form {
    grid-template-columns: 1fr;
  }
  .reminder-form .actions {
    flex-wrap: wrap;
  }
  .list .item {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .list .item .actions {
    flex-wrap: wrap;
  }
  .text, .id, .due {
    word-break: break-word;
    overflow-wrap: anywhere;
  }
}

/* Make all action buttons match the Save button’s size */
.actions button,
.record, .stop, .play, .del-audio, .ics, .delete {
  padding: 0.6rem 1rem;        /* same as button[type="submit"] */
  font-size: 1rem;
  line-height: 1.25;
  min-height: 2.5rem;

}/* optional: ensures equal height */

/* highlight effect */
.item.highlight {
  position: relative;
  background: #fffbeb;              /* soft amber */
  transition: background 600ms ease;
  box-shadow: 0 0 0 2px #f59e0b33 inset, 0 0 0 0 rgba(245,158,11,.6);
  animation: pulseGlow 1200ms ease-out 3;
  border-radius: 8px;
}

@keyframes pulseGlow {
  0%   { box-shadow: 0 0 0 0 rgba(245,158,11,.6); }
  70%  { box-shadow: 0 0 0 12px rgba(245,158,11,0); }
  100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); }
}
html { scroll-behavior: smooth; }


</style>



