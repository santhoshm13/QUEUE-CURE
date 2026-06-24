// Socket.io connection
const socket = io();

// Client state variables
let myActiveToken = sessionStorage.getItem("patientToken") || null;
let currentServerState = null;
let countdownRemainingSeconds = 0;
let countdownTimerInterval = null;

// Core token regex: starts with T or t, followed by exactly 3 digits
const tokenRegex = /^[tT]\d{3}$/;

// Elements Cache
const gateInput = document.getElementById("gate-token-input");
const gateError = document.getElementById("gate-error-message");
const personalPanel = document.getElementById("personal-status-panel");
const myTokenBadge = document.getElementById("badge-my-token");

// Sound state and toggle buttons setup
const lobbyAudioToggleBtn = document.getElementById("btn-waiting-room-audio-toggle");
const lobbyAudioIcon = document.getElementById("audio-toggle-icon");
const lobbyAudioText = document.getElementById("audio-toggle-text");

let lobbySoundOn = localStorage.getItem("lobbySoundOn") !== "false"; // default to true
let synthVoices = [];

if ("speechSynthesis" in window) {
  synthVoices = window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    synthVoices = window.speechSynthesis.getVoices();
  };
}

function updateLobbyAudioUI() {
  if (!lobbyAudioToggleBtn || !lobbyAudioIcon || !lobbyAudioText) return;
  if (lobbySoundOn) {
    lobbyAudioIcon.textContent = "🔊";
    lobbyAudioText.textContent = "Audio: ON";
    lobbyAudioToggleBtn.className = "px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors cursor-pointer shadow-sm flex items-center gap-1.5";
  } else {
    lobbyAudioIcon.textContent = "🔇";
    lobbyAudioText.textContent = "Audio: OFF";
    lobbyAudioToggleBtn.className = "px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-500 rounded-lg text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer shadow-sm flex items-center gap-1.5";
  }
}

function speakAnnouncement(token, name) {
  if (!lobbySoundOn) return;

  if (!("speechSynthesis" in window)) {
    console.warn("Speech synthesis not supported in this client.");
    return;
  }

  // Cancel any ongoing speaking queues to prevent overlaps
  window.speechSynthesis.cancel();

  // Spell out token letters clearly (e.g. "T 0 0 3")
  const spaceSpelledToken = token.split("").join(" ");
  const messageText = `Attention please. Patient with token number ${spaceSpelledToken}, ${name}, is kindly requested to proceed to the consultation room. Thank you.`;

  const utterance = new SpeechSynthesisUtterance(messageText);
  utterance.rate = 0.9;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // Prefer a clean English voice
  if (synthVoices.length === 0) {
    synthVoices = window.speechSynthesis.getVoices();
  }
  const calmVoice = synthVoices.find(v => v.lang.startsWith("en-US") || v.lang.startsWith("en"));
  if (calmVoice) {
    utterance.voice = calmVoice;
  }

  window.speechSynthesis.speak(utterance);
}

if (lobbyAudioToggleBtn) {
  // Sync UI state on initialization
  updateLobbyAudioUI();
  
  lobbyAudioToggleBtn.addEventListener("click", () => {
    lobbySoundOn = !lobbySoundOn;
    localStorage.setItem("lobbySoundOn", lobbySoundOn ? "true" : "false");
    updateLobbyAudioUI();
  });
}

// Auto-align active token casing on input typing
if (gateInput) {
  gateInput.addEventListener("input", () => {
    gateInput.value = gateInput.value.toUpperCase();
  });
}

// Handle Gate Submit lookups
function handleTokenSubmit(event) {
  event.preventDefault();
  const rawToken = gateInput.value.trim().toUpperCase();
  
  gateError.classList.add("hidden");

  // A. Format validation via Regex
  if (!tokenRegex.test(rawToken)) {
    gateError.textContent = "⚠ Invalid token format. Must be T001 to T999.";
    gateError.classList.remove("hidden");
    gateInput.focus();
    return;
  }

  // B. Roster lookup
  if (!currentServerState) {
    gateError.textContent = "Connection loading, please try again in a split second.";
    gateError.classList.remove("hidden");
    return;
  }

  const patientExists = currentServerState.patients.some(p => p.token === rawToken);
  
  if (patientExists) {
    myActiveToken = rawToken;
    sessionStorage.setItem("patientToken", rawToken);
    
    // Clear inputs
    gateInput.value = "";
    gateError.classList.add("hidden");
    
    // Trigger updates immediately
    renderView();
  } else {
    gateError.textContent = "Token not found. Please check with the receptionist.";
    gateError.classList.remove("hidden");
    gateInput.focus();
  }
}

// Clear active ticket
function clearMyToken() {
  myActiveToken = null;
  sessionStorage.removeItem("patientToken");
  if (gateInput) gateInput.value = "";
  if (gateError) gateError.classList.add("hidden");
  renderView();
}

// Bind both clear triggers
document.getElementById("btn-re-verify-token").addEventListener("click", clearMyToken);
const btnClearToken = document.getElementById("btn-clear-token");
if (btnClearToken) {
  btnClearToken.addEventListener("click", clearMyToken);
}

// Fetch/Auto-refresh state request every 30 seconds
setInterval(() => {
  if (socket.connected) {
    socket.emit("request_state");
  }
}, 30000);

// Timer countdown ticker helper
function setCountdown(seconds) {
  if (countdownTimerInterval) clearInterval(countdownTimerInterval);

  countdownRemainingSeconds = seconds;
  paintClockDisplay();

  countdownTimerInterval = setInterval(() => {
    if (countdownRemainingSeconds > 60) {
      countdownRemainingSeconds--;
      paintClockDisplay();
    } else {
      // Stopped/Frozen at 1:00 (60 seconds)
      countdownRemainingSeconds = 60;
      paintClockDisplay();
      clearInterval(countdownTimerInterval); // stop local ticker
    }
  }, 1000);
}

function paintClockDisplay() {
  const clockEl = document.getElementById("txt-countdown-clock");
  const subtextEl = document.getElementById("txt-countdown-subtext");
  if (!clockEl) return;

  const mins = Math.floor(countdownRemainingSeconds / 60);
  const secs = countdownRemainingSeconds % 60;
  clockEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  if (countdownRemainingSeconds <= 60) {
    subtextEl.textContent = "Almost your turn — please be ready";
    subtextEl.className = "text-[11px] font-mono text-amber-600 font-bold block mt-2 animate-pulse";
  } else {
    subtextEl.textContent = `Estimated wait: ${mins}m ${secs}s`;
    subtextEl.className = "text-[11px] font-mono text-slate-400 block mt-2";
  }
}

// Get patient's first name
function getFirstName(fullName) {
  if (!fullName) return "";
  return fullName.trim().split(" ")[0];
}

// Utility to update any DOM element's text content with an elegant organic spark pulse animation
function updateValueAndAnimate(elementId, text) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (el.textContent === String(text)) return; // Avoid redundant animation triggers
  el.textContent = text;
  // Restart animation
  el.classList.remove("animate-metric-flash");
  void el.offsetWidth; // Force CSS reflow
  el.classList.add("animate-metric-flash");
  setTimeout(() => {
    el.classList.remove("animate-metric-flash");
  }, 800);
}

// Visual layout painter
function renderView() {
  if (!currentServerState) return;

  const state = currentServerState;

  // Update token gate waiting count (visible before logging in)
  const totalWaitingCount = state.patients.filter(p => p.status === "waiting").length;
  updateValueAndAnimate("gate-waiting-count", totalWaitingCount);

  // 1. Queue Paused Banner sync
  const pauseBanner = document.getElementById("break-banner-overlay");
  if (state.isPaused) {
    pauseBanner.classList.remove("hidden");
  } else {
    pauseBanner.classList.add("hidden");
  }

  // 2. Info Footer sync
  updateValueAndAnimate("txt-global-avg-mins", `${state.avgConsultTime} mins / patient`);
  document.getElementById("txt-term-sync").textContent = `Last update: ${new Date().toLocaleTimeString()}`;

  // 3. Render Personal Panel (if applicable)
  const personalPanelContent = document.getElementById("personal-status-panel");
  const statusTitle = document.getElementById("txt-status-title");
  const statusSubtitle = document.getElementById("txt-status-subtitle");
  const timerContainer = document.getElementById("countdown-timer-container");

  const activeCard = document.getElementById("active-token-card");
  const inactiveCard = document.getElementById("inactive-token-card");
  const switchBtn = document.getElementById("btn-re-verify-token");

  if (myActiveToken) {
    if (activeCard) activeCard.classList.remove("hidden");
    if (inactiveCard) inactiveCard.classList.add("hidden");
    if (switchBtn) switchBtn.classList.remove("hidden");

    if (myTokenBadge) myTokenBadge.textContent = `Token: ${myActiveToken}`;
    
    // Find patient status
    const me = state.patients.find(p => p.token === myActiveToken);
    
    if (!me) {
      // If token vanished from server state, force logout
      sessionStorage.removeItem("patientToken");
      myActiveToken = null;
      if (activeCard) activeCard.classList.add("hidden");
      if (inactiveCard) inactiveCard.classList.remove("hidden");
      if (switchBtn) switchBtn.classList.add("hidden");
      
      if (gateError) {
        gateError.textContent = "Your session token is no longer registered. Please speak with the receptionist.";
        gateError.classList.remove("hidden");
      }
      return;
    }

    // Evaluate Personal views
    personalPanelContent.className = "transition-all"; // clear styles
    
    if (me.status === "waiting") {
      // Determine tokens waiting ahead of us
      const waitingPatients = state.patients.filter(p => p.status === "waiting");
      const myIndexInWaiting = waitingPatients.findIndex(p => p.token === myActiveToken);
      const tokensAhead = myIndexInWaiting >= 0 ? myIndexInWaiting : 0;
      
      if (tokensAhead > 0) {
        const estMins = tokensAhead * state.avgConsultTime;
        statusTitle.innerHTML = `You are <span class="text-[var(--primary)] font-display font-medium font-bold">#${tokensAhead + 1}</span> in line`;
        statusSubtitle.innerHTML = `There are <strong>${tokensAhead} patients</strong> ahead of you in queue. The average wait rate is <strong>${state.avgConsultTime} minutes</strong> per consultation. Your absolute estimated delay is approx <strong class="text-[var(--primary)] font-bold">${estMins} minutes</strong>.`;
        
        // Show and Start live timer countdown
        timerContainer.classList.remove("hidden");
        setCountdown(estMins * 60);
      } else {
        // Next up!
        statusTitle.innerHTML = `You are <span class="text-amber-600 font-display font-bold">Next in Line</span> — please be ready.`;
        statusSubtitle.innerHTML = `There are <strong>0 patients</strong> ahead of you. The average consultation duration is <strong>${state.avgConsultTime} minutes</strong>. Please prepare to enter Consultation Room #1 now.`;
        
        timerContainer.classList.remove("hidden");
        // Next up countdown sets directly to 1:00 or active transition
        setCountdown(60); 
      }
    } else if (me.status === "current") {
      // Active call! Use custom pulsing banner styles
      personalPanelContent.className = "pulse-primary-banner rounded-3xl p-1 transition-all";
      statusTitle.innerHTML = `Please Proceed to Consultation — Token <span class="text-[var(--primary)] font-display font-bold">${myActiveToken}</span>`;
      statusSubtitle.textContent = "The physician is ready to consult with you inside Room #1 now.";
      
      // Hide timer
      timerContainer.classList.add("hidden");
      if (countdownTimerInterval) clearInterval(countdownTimerInterval);
    } else if (me.status === "done") {
      if (!me.finalBillPaid) {
        statusTitle.innerHTML = `Consultation Complete — <span class="text-amber-600 font-display font-bold">Payment Pending</span>`;
        statusSubtitle.textContent = "Please proceed to the Billing & Reception Desk to settle your invoice. Once payment is collected, your turn will be fully finalized.";
      } else {
        statusTitle.innerHTML = `Consultation Complete — <span class="text-[var(--primary)] font-display font-bold">Paid & Settled</span>`;
        statusSubtitle.textContent = "Thank you for visiting City Care Clinic! We hope you received pristine care today. Feel free to depart.";
      }
      
      timerContainer.classList.add("hidden");
      if (countdownTimerInterval) clearInterval(countdownTimerInterval);
    } else if (me.status === "noshowed") {
      statusTitle.innerHTML = `Token marked as <span class="text-red-700 font-bold">No-Show</span>. Please speak to the receptionist.`;
      statusSubtitle.textContent = "We triggered calling for your token but were unable to register your presence inside Room #1.";
      
      timerContainer.classList.add("hidden");
      if (countdownTimerInterval) clearInterval(countdownTimerInterval);
    }

  } else {
    if (activeCard) activeCard.classList.add("hidden");
    if (inactiveCard) inactiveCard.classList.remove("hidden");
    if (switchBtn) switchBtn.classList.add("hidden");
    if (countdownTimerInterval) clearInterval(countdownTimerInterval);
  }

  // 4. Render Active Lobby Table list
  const lobbyQueueEl = document.getElementById("lobby-queue");
  lobbyQueueEl.innerHTML = "";

  const activeQueueList = state.patients.filter(p => p.status === "waiting" || p.status === "current" || (p.status === "done" && !p.finalBillPaid));
  
  // Update waiting counter badge
  const totalWaiting = state.patients.filter(p => p.status === "waiting").length;
  updateValueAndAnimate("txt-lobby-size", `${totalWaiting} patients waiting`);

  if (activeQueueList.length === 0) {
    lobbyQueueEl.innerHTML = `
      <div class="py-12 text-center text-slate-400 font-medium animate-fade-up">
        <span>The lobby queue is empty. No patients currently waiting.</span>
      </div>
    `;
    return;
  }

  activeQueueList.forEach((p, index) => {
    const listCard = document.createElement("div");
    
    // Staggered delay up to 10 items to prevent lag, yet look incredibly polished
    const animationDelay = `${Math.min(index, 8) * 60}ms`;
    
    if (p.status === "current") {
      listCard.className = "bg-white border-2 border-[var(--primary)]/70 rounded-2xl p-4 flex justify-between items-center shadow-sm select-none animate-fade-up opacity-0";
      listCard.style.animationDelay = animationDelay;
      listCard.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-[var(--primary)] rounded-xl flex items-center justify-center text-white font-mono font-bold text-sm">
            ${p.token}
          </div>
          <div>
            <span class="block text-sm font-bold text-slate-900 font-sans">${getFirstName(p.name)}</span>
            <span class="block text-[10px] text-indigo-600 font-medium">🩺 ${p.problem || 'General Consultation'}</span>
            <span class="block text-[10px] text-[var(--primary)] font-semibold font-mono tracking-wider uppercase leading-none mt-1">
              Serving Inside
            </span>
          </div>
        </div>
        <div class="w-2 h-2 bg-[var(--primary)] rounded-full animate-ping"></div>
      `;
    } else if (p.status === "done" && !p.finalBillPaid) {
      // Payment Pending
      const isMe = myActiveToken === p.token;
      const cardBorder = isMe ? 'border-2 border-amber-500 bg-amber-50/10 shadow-sm' : 'border border-amber-200 bg-slate-50';
      
      listCard.className = `${cardBorder} rounded-2xl p-4 flex justify-between items-center transition-all duration-300 select-none shadow-sm animate-fade-up opacity-0`;
      listCard.style.animationDelay = animationDelay;
      listCard.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 ${isMe ? 'bg-amber-600 text-white' : 'bg-slate-100 text-amber-700'} rounded-xl flex items-center justify-center font-mono font-bold text-sm">
            ${p.token}
          </div>
          <div>
            <span class="block text-sm font-semibold text-slate-800">${getFirstName(p.name)} ${isMe ? '(You)' : ''}</span>
            <span class="block text-[10px] text-indigo-600 font-medium">🩺 ${p.problem || 'General Consultation'}</span>
            <span class="block text-[10px] text-amber-605 font-bold uppercase font-mono tracking-wider mt-1">
              Payment Pending
            </span>
          </div>
        </div>
        <span class="text-[9px] font-bold text-amber-600 uppercase tracking-wider bg-amber-50 px-2 py-0.5 rounded border border-amber-200">Settle Bill</span>
      `;
    } else {
      // Status waiting
      const isMe = myActiveToken === p.token;
      const cardBorder = isMe ? 'border-2 border-[var(--primary)] bg-slate-50 shadow-sm' : 'border border-slate-200 bg-white hover:bg-slate-50/85';
      
      listCard.className = `${cardBorder} rounded-2xl p-4 flex justify-between items-center transition-all duration-300 select-none shadow-sm hover:shadow-md animate-fade-up opacity-0`;
      listCard.style.animationDelay = animationDelay;
      listCard.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 ${isMe ? 'bg-[var(--primary)] text-white' : 'bg-slate-100 text-slate-600'} rounded-xl flex items-center justify-center font-mono font-bold text-sm">
            ${p.token}
          </div>
          <div>
            <span class="block text-sm font-semibold text-slate-800">${getFirstName(p.name)} ${isMe ? '(You)' : ''}</span>
            <span class="block text-[10px] text-indigo-600 font-medium">🩺 ${p.problem || 'General Consultation'}</span>
            <span class="block text-[10px] text-slate-400 font-semibold uppercase font-mono tracking-wider mt-1">
              waiting in lobby
            </span>
          </div>
        </div>
        <span class="text-xs text-slate-400 font-mono">#${state.patients.filter(pt => pt.status === "waiting").indexOf(p) + 1}</span>
      `;
    }

    lobbyQueueEl.appendChild(listCard);
  });
}

// Socket updates receiver
socket.on("queue_update", (state) => {
  currentServerState = state;
  renderView();
});

// Real-time voice announcement broadcast
let announcementTimer = null;

function showVoiceAnnouncementVisual(token, name) {
  const alertEl = document.getElementById("announcement-broadcast-alert");
  const tokenEl = document.getElementById("announcement-token");
  const nameEl = document.getElementById("announcement-name");
  
  if (!alertEl || !tokenEl || !nameEl) return;

  tokenEl.textContent = token;
  nameEl.textContent = name;

  // Make it display
  alertEl.classList.remove("hidden");
  
  // Clean up any existing auto-hide timers if consecutive announcements arrive
  if (announcementTimer) {
    clearTimeout(announcementTimer);
  }

  // Auto-hide after 10 seconds of peaceful display
  announcementTimer = setTimeout(() => {
    alertEl.classList.add("hidden");
  }, 10000);
}

socket.on("voice_announcement", (data) => {
  if (data && data.token) {
    speakAnnouncement(data.token, data.name);
    showVoiceAnnouncementVisual(data.token, data.name);
  }
});

// Update syncing statuses
socket.on("connect", () => {
  document.getElementById("txt-term-conn").textContent = "Sync: Connected";
  document.getElementById("txt-term-conn").className = "text-[var(--primary)] font-bold";
});

socket.on("disconnect", () => {
  document.getElementById("txt-term-conn").textContent = "Sync: Offline";
  document.getElementById("txt-term-conn").className = "text-red-500 font-bold animate-pulse";
});

// ==================== PREMIUM ONLINE BOOKING JAVASCRIPT LOGIC ====================
const bookingModal = document.getElementById("booking-modal");
const bookingModalContent = document.getElementById("booking-modal-content");
const closeBookingModal = document.getElementById("close-booking-modal");
const openBookingModalBtn = document.getElementById("btn-open-booking-modal");
const bookingNameInput = document.getElementById("booking-name-input");
const bookingStep1Error = document.getElementById("booking-step1-error");

let bookedName = "";
let bookedToken = "";

if (openBookingModalBtn) {
  openBookingModalBtn.addEventListener("click", () => {
    // Reset steps
    document.getElementById("booking-step-1").classList.remove("hidden");
    document.getElementById("booking-step-2").classList.add("hidden");
    
    // Reset classes for Step Indicators
    setStepIndicatorActive(1);

    bookingNameInput.value = "";
    const pInput = document.getElementById("booking-problem-input");
    if (pInput) pInput.value = "";
    
    const submitBtn = document.getElementById("btn-confirm-booking");
    const loader = document.getElementById("booking-submit-loader");
    if (submitBtn) submitBtn.classList.remove("hidden");
    if (loader) loader.classList.add("hidden");

    if (bookingStep1Error) bookingStep1Error.classList.add("hidden");

    if (bookingModal) {
      bookingModal.classList.remove("hidden");
      setTimeout(() => {
        bookingModal.classList.remove("opacity-0");
        if (bookingModalContent) bookingModalContent.classList.remove("scale-95");
      }, 50);
    }
  });
}

if (closeBookingModal) {
  closeBookingModal.addEventListener("click", hideBookingModal);
}

// Close booking modal when background is clicked
if (bookingModal) {
  bookingModal.addEventListener("click", (e) => {
    if (e.target === bookingModal) {
      hideBookingModal();
    }
  });
}

// Hide Modal
// Hide Modal
function hideBookingModal() {
  if (bookingModal) bookingModal.classList.add("opacity-0");
  if (bookingModalContent) bookingModalContent.classList.add("scale-95");
  setTimeout(() => {
    if (bookingModal) bookingModal.classList.add("hidden");
  }, 300);
}

function setStepIndicatorActive(step) {
  const step1 = document.getElementById("step-id-1");
  const step2 = document.getElementById("step-id-2");
  
  if (!step1 || !step2) return;

  step1.className = "flex items-center gap-1 font-sans " + (step === 1 ? "text-[var(--primary)] font-bold animate-pulse" : "text-slate-400");
  step2.className = "flex items-center gap-1 font-sans " + (step === 2 ? "text-[var(--primary)] font-bold" : "text-slate-400");
}

function submitOnlineBooking() {
  if (!bookingNameInput) return;
  bookedName = bookingNameInput.value.trim();
  
  if (bookingStep1Error) {
    bookingStep1Error.classList.add("hidden");
  }

  if (!bookedName) {
    if (bookingStep1Error) {
      bookingStep1Error.textContent = "Please enter a valid full name.";
      bookingStep1Error.classList.remove("hidden");
    }
    bookingNameInput.focus();
    return;
  }

  // Robust Name Validation:
  if (bookedName.length < 2) {
    if (bookingStep1Error) {
      bookingStep1Error.textContent = "Name must be at least 2 characters long.";
      bookingStep1Error.classList.remove("hidden");
    }
    bookingNameInput.focus();
    return;
  }
  if (/\d/.test(bookedName)) {
    if (bookingStep1Error) {
      bookingStep1Error.textContent = "Name cannot contain numbers.";
      bookingStep1Error.classList.remove("hidden");
    }
    bookingNameInput.focus();
    return;
  }
  const letterRegex = /\p{L}/gu;
  const matches = bookedName.match(letterRegex);
  if (!matches || matches.length < 2) {
    if (bookingStep1Error) {
      bookingStep1Error.textContent = "Name must contain at least 2 letters.";
      bookingStep1Error.classList.remove("hidden");
    }
    bookingNameInput.focus();
    return;
  }

  const probInput = document.getElementById("booking-problem-input");
  const problemVal = probInput ? probInput.value.trim() : "General Consultation";

  // Hide button, show loader
  const submitBtn = document.getElementById("btn-confirm-booking");
  const loader = document.getElementById("booking-submit-loader");
  if (submitBtn) submitBtn.classList.add("hidden");
  if (loader) loader.classList.remove("hidden");

  // Send register request
  fetch("/api/add-patient", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: bookedName,
      problem: problemVal,
      isOnlineBooked: true
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      bookedToken = data.token;
      
      // Populate receipt elements
      document.getElementById("receipt-token-id").textContent = bookedToken;
      document.getElementById("receipt-patient-name").textContent = bookedName;

      // Transition to success step 2
      if (loader) loader.classList.add("hidden");
      document.getElementById("booking-step-1").classList.add("hidden");
      document.getElementById("booking-step-2").classList.remove("hidden");
      setStepIndicatorActive(2);
    } else {
      alert("Server registration error. Please try again.");
      if (submitBtn) submitBtn.classList.remove("hidden");
      if (loader) loader.classList.add("hidden");
    }
  })
  .catch(err => {
    console.error(err);
    alert("Protocol error. Please retry.");
    if (submitBtn) submitBtn.classList.remove("hidden");
    if (loader) loader.classList.add("hidden");
  });
}

function claimAndEnterWaiting() {
  if (bookedToken) {
    myActiveToken = bookedToken;
    sessionStorage.setItem("patientToken", bookedToken);
    
    // Close modal
    hideBookingModal();
    
    // Switch screens to wait room instantly
    if (gateScreen) gateScreen.classList.add("hidden");
    if (dashboardScreen) dashboardScreen.classList.remove("hidden");
    if (personalPanel) personalPanel.classList.remove("hidden");
    
    // Request server state to make sure it's synced
    socket.emit("request_state");
  }
}
