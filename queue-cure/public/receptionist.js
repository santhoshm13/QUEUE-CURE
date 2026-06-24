// Socket.io connection
const socket = io();
let currentServerState = null;

// Clock updates
setInterval(() => {
  const clockEl = document.getElementById("cln-current-time");
  if (clockEl) {
    clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}, 1000);

// Logout logic
document.getElementById("btn-logout").addEventListener("click", () => {
  sessionStorage.removeItem("receptionistAuth");
  window.location.href = "/";
});

// Toast notification helper
function showToast(text, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type} toast-slide`;
  
  let emoji = "✅";
  if (type === "error") emoji = "❌";
  if (type === "info") emoji = "ℹ️";
  if (type === "warning") emoji = "⚠️";

  toast.innerHTML = `<span class="text-lg">${emoji}</span> <span class="font-sans">${text}</span>`;
  container.appendChild(toast);

  // Auto-dismiss after 3000ms
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

// Sound Preference & Announcement engine
const soundToggle = document.getElementById("sound-toggle-element");
const soundToggleText = document.getElementById("sound-toggle-text");

// Cache voice-list updates (important for Chrome/Safari compatibility)
let synthVoices = [];
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    synthVoices = window.speechSynthesis.getVoices();
  };
}

// Initialize sound toggle state from localStorage
const storedSound = localStorage.getItem("soundOn");
if (storedSound !== null) {
  const soundOn = storedSound === "true";
  soundToggle.checked = soundOn;
  soundToggleText.textContent = soundOn ? "Audio: ON" : "Audio: OFF";
} else {
  soundToggle.checked = true;
  soundToggleText.textContent = "Audio: ON";
  localStorage.setItem("soundOn", "true");
}

soundToggle.addEventListener("change", () => {
  const isOn = soundToggle.checked;
  localStorage.setItem("soundOn", isOn ? "true" : "false");
  soundToggleText.textContent = isOn ? "Audio: ON" : "Audio: OFF";
  showToast(`Voice announcement turned ${isOn ? 'ON' : 'OFF'}`, isOn ? "success" : "warning");
});

function speakAnnouncement(token, name) {
  const isSoundOn = localStorage.getItem("soundOn") === "true";
  if (!isSoundOn) return;

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

// Debounce flag for "Call Next" control to avoid rapid multiple API submissions
let isDebouncingNextCall = false;

// Handle Add Patient Form Submission
async function handleAddPatient(event) {
  event.preventDefault();
  const nameInput = document.getElementById("patient-name-input");
  const valError = document.getElementById("add-val-error");
  const name = nameInput.value.trim();

  valError.classList.add("hidden");

  if (name === "") {
    valError.textContent = "⚠ Name is required.";
    valError.classList.remove("hidden");
    nameInput.focus();
    return;
  }

  // Robust Name Validation:
  if (name.length < 2) {
    valError.textContent = "⚠ Name must be at least 2 characters long.";
    valError.classList.remove("hidden");
    nameInput.focus();
    return;
  }
  if (/\d/.test(name)) {
    valError.textContent = "⚠ Name cannot contain numbers.";
    valError.classList.remove("hidden");
    nameInput.focus();
    return;
  }
  
  // Unicode alphanumeric / alphabet unicode character validation (supports multi-cultural names)
  const letterRegex = /\p{L}/gu;
  const matches = name.match(letterRegex);
  if (!matches || matches.length < 2) {
    valError.textContent = "⚠ Name must contain at least 2 letters.";
    valError.classList.remove("hidden");
    nameInput.focus();
    return;
  }

  const problemInput = document.getElementById("patient-problem-input");
  const problem = problemInput ? problemInput.value.trim() : "";

  try {
    const res = await fetch("/api/add-patient", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, problem })
    });

    const data = await res.json();
    if (res.ok) {
      showToast(`${data.token} — ${data.name} added successfully`, "success");
      nameInput.value = "";
      if (problemInput) {
        problemInput.value = "";
      }
      nameInput.focus();
    } else {
      showToast(data.error || "Failed to add patient", "error");
    }
  } catch (err) {
    showToast("Network error. Could not connect to clinic server.", "error");
  }
}

// Handle Call Next Token click (debounced)
const callNextBtn = document.getElementById("btn-call-next");
callNextBtn.addEventListener("click", async () => {
  if (isDebouncingNextCall) return;

  isDebouncingNextCall = true;
  callNextBtn.disabled = true;

  try {
    const res = await fetch("/api/call-next", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    const data = await res.json();
    if (res.ok) {
      if (data.currentToken) {
        showToast(`Now Serving Token ${data.currentToken} (${data.currentPatientName})`, "info");
      } else {
        showToast("Queue is empty — no next patient.", "warning");
      }
    } else {
      showToast(data.error || "Failed to advance queue", "error");
    }
  } catch (err) {
    showToast("Server communication error.", "error");
  } finally {
    isDebouncingNextCall = false;
    callNextBtn.disabled = false;
  }
});

// Handle Polite Recall Patient click
document.getElementById("btn-shoutout").addEventListener("click", async () => {
  if (!currentServerState) {
    showToast("No queue data retrieved from server.", "warning");
    return;
  }
  const token = currentServerState.currentToken;
  if (!token) {
    showToast("No active patient is currently being served to recall.", "warning");
    return;
  }
  
  try {
    const res = await fetch("/api/recall-patient", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`📣 Re-announced: Kindly recalling Token ${token} — ${data.name} to the consultation room.`, "info");
    } else {
      showToast(data.error || "Failed to trigger recall announcement", "error");
    }
  } catch (err) {
    showToast("Server communication error.", "error");
  }
});

// Handle Pause Toggle click
document.getElementById("btn-pause-queue").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/toggle-pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.isPaused ? "Doctor on Break — Queue Paused" : "Queue resumed!", data.isPaused ? "warning" : "success");
    } else {
      showToast("Could not modify pause state", "error");
    }
  } catch (err) {
    showToast("Server connection error.", "error");
  }
});

// Handle Average Consult Time update
document.getElementById("btn-update-consult").addEventListener("click", async () => {
  const input = document.getElementById("consult-time-input");
  const value = parseInt(input.value, 10);
  if (isNaN(value) || value < 1) {
    showToast("Value must be a valid number of at least 1 minute.", "error");
    return;
  }

  try {
    const res = await fetch("/api/set-consult-time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: value })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Updated to ${data.avgConsultTime} minutes`, "info");
    } else {
      showToast(data.error || "Failed to update consult rate", "error");
    }
  } catch (err) {
    showToast("Could not contact server to alter configuration.", "error");
  }
});

// Handle Clear History (Done and No-Show patients)
document.getElementById("btn-clear-history").addEventListener("click", async () => {
  const confirmed = confirm("Are you sure you want to clear all completed and no-show patient history records? Active waiting patients will not be cleared.");
  if (!confirmed) return;

  try {
    const res = await fetch("/api/clear-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const data = await res.json();
    if (res.ok) {
      showToast("Historical patient records cleared successfully.", "success");
    } else {
      showToast(data.error || "Failed to clear history.", "error");
    }
  } catch (err) {
    showToast("Server connection error.", "error");
  }
});

// Handle Reset Entire Queue & Counter
document.getElementById("btn-reset-queue").addEventListener("click", async () => {
  const confirmed = confirm("WARNING: This will completely wipe all patients in the queue (waiting, current, done, no-shows) and reset the token counter back to starting number (T001). Are you absolutely sure?");
  if (!confirmed) return;

  try {
    const res = await fetch("/api/reset-queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const data = await res.json();
    if (res.ok) {
      showToast("Entire queue state has been reset to defaults.", "info");
    } else {
      showToast(data.error || "Failed to reset queue.", "error");
    }
  } catch (err) {
    showToast("Server connection error.", "error");
  }
});

// Handle download dataset click
document.getElementById("btn-download-dataset").addEventListener("click", () => {
  downloadPatientDatasetCSV();
});

function downloadPatientDatasetCSV() {
  if (!currentServerState || !currentServerState.patients || currentServerState.patients.length === 0) {
    showToast("No patient records available to download.", "warning");
    return;
  }

  // Define headers
  const csvHeaders = [
    "Token",
    "Patient Name",
    "Problem / Reason for Visit",
    "Registration Type",
    "Status",
    "Time Added",
    "Consultation Started",
    "Consultation Completed",
    "Duration (Minutes)",
    "Bill Amount Paid (Rs.)"
  ];

  const csvRows = [csvHeaders.join(",")];

  currentServerState.patients.forEach(p => {
    // Escape cell values to prevent CSV issues
    const token = `"${p.token.replace(/"/g, '""')}"`;
    const name = `"${p.name.replace(/"/g, '""')}"`;
    const problem = `"${(p.problem || "General Consultation").replace(/"/g, '""')}"`;
    const regType = `"${p.isOnlineBooked ? "Online Booked" : "Walk-In"}"`;
    const status = `"${p.status.toUpperCase()}"`;
    
    const addedAtStr = p.addedAt ? `"${new Date(p.addedAt).toLocaleString()}"` : '"N/A"';
    const calledAtStr = p.calledAt ? `"${new Date(p.calledAt).toLocaleString()}"` : '"N/A"';
    const completedAtStr = p.completedAt ? `"${new Date(p.completedAt).toLocaleString()}"` : '"N/A"';
    
    const duration = p.servedDurationMinutes !== undefined 
      ? p.servedDurationMinutes 
      : (p.completedAt && p.calledAt ? Math.round((p.completedAt - p.calledAt) / 60000) : "N/A");
    
    // Bill amount
    let billAmount = 0;
    if (p.status === "done" || p.finalBillPaid) {
      billAmount = 250;
    }

    const rowData = [
      token,
      name,
      problem,
      regType,
      status,
      addedAtStr,
      calledAtStr,
      completedAtStr,
      duration,
      billAmount
    ];

    csvRows.push(rowData.join(","));
  });

  const csvString = csvRows.join("\r\n");
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const downloadAnchor = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadAnchor.setAttribute("href", url);
  downloadAnchor.setAttribute("download", `patient_clinic_dataset_${dateStr}.csv`);
  downloadAnchor.style.visibility = "hidden";
  
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  document.body.removeChild(downloadAnchor);
  
  showToast("Excel-friendly Dataset downloaded! 📥", "success");
}

// Handle marking patient as No Show
async function triggerNoShow(token, name) {
  const confirmed = confirm(`Mark patient ${name} (${token}) as No-Show & skip?`);
  if (!confirmed) return;

  try {
    const res = await fetch("/api/no-show", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    const data = await res.json();
    if (res.ok) {
      showToast(`${token} marked as No-Show.`, "error");
    } else {
      showToast(data.error || "Cannot set No-Show.", "error");
    }
  } catch (err) {
    showToast("Networking error during state update.", "error");
  }
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

// Client State syncing render engine
socket.on("queue_update", (state) => {
  console.log("Queue Update Received: ", state);
  currentServerState = state;

  // 1. Sync settings fields (if not focused to avoid disrupting editing)
  const consultInput = document.getElementById("consult-time-input");
  if (document.activeElement !== consultInput) {
    consultInput.value = state.avgConsultTime;
  }

  // 2. Render Metrics panel
  let waitingCount = 0;
  let completedCount = 0;
  let noShowCount = 0;

  state.patients.forEach(p => {
    if (p.status === "waiting") waitingCount++;
    else if (p.status === "done") completedCount++;
    else if (p.status === "noshowed") noShowCount++;
  });

  updateValueAndAnimate("metric-total", state.patients.length);
  updateValueAndAnimate("metric-waiting", waitingCount);
  updateValueAndAnimate("metric-done", completedCount);
  updateValueAndAnimate("metric-noshow", noShowCount);

  // 3. Render Current Serving Info
  const nowServingEl = document.getElementById("txt-now-serving");

  if (state.currentToken) {
    const activePatient = state.patients.find(p => p.token === state.currentToken);
    const activeName = activePatient ? activePatient.name : "Unknown Patient";
    if (nowServingEl) nowServingEl.textContent = `${state.currentToken} — ${activeName}`;
    updateValueAndAnimate("txt-now-serving-token", state.currentToken);
    updateValueAndAnimate("txt-now-serving-name", activeName);
  } else {
    if (nowServingEl) nowServingEl.textContent = "No patients in queue";
    updateValueAndAnimate("txt-now-serving-token", "T---");
    updateValueAndAnimate("txt-now-serving-name", "Ready for Next");
  }

  // 4. Update Queue Break states
  const breakBanner = document.getElementById("break-banner");
  const pauseBtn = document.getElementById("btn-pause-queue");
  const pauseIcon = document.getElementById("btn-pause-icon");
  const pauseText = document.getElementById("btn-pause-text");

  if (state.isPaused) {
    breakBanner.classList.remove("hidden");
    callNextBtn.disabled = true;
    
    // Set button to yellow state
    pauseBtn.className = "py-3 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold text-sm rounded-xl cursor-pointer transition-colors flex items-center justify-center gap-2";
    pauseIcon.textContent = "▶";
    pauseText.textContent = "Resume Queue";
  } else {
    breakBanner.classList.add("hidden");
    // Enable button unless debouncing is taking place
    callNextBtn.disabled = isDebouncingNextCall;

    // Set button to standard Grey state
    pauseBtn.className = "py-3 bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-700 font-semibold text-sm rounded-xl cursor-pointer transition-colors flex items-center justify-center gap-2";
    pauseIcon.textContent = "⏸";
    pauseText.textContent = "Pause Queue";
  }

  // 5. Render Seperated Walk-In and Online Patient Roster tables
  const walkinTableBody = document.getElementById("walkin-table-body");
  const onlineTableBody = document.getElementById("online-table-body");
  const onlineCounterBadge = document.getElementById("online-counter-badge");

  const activePatients = state.patients.filter(p => !p.finalBillPaid);
  const historyPatients = state.patients.filter(p => p.finalBillPaid);

  const walkinPatients = activePatients.filter(p => !p.isOnlineBooked);
  const onlinePatients = activePatients.filter(p => p.isOnlineBooked);

  if (onlineCounterBadge) {
    onlineCounterBadge.textContent = `${onlinePatients.length} Active`;
  }

  function createPatientRow(p, index) {
    const row = document.createElement("tr");
    
    // Status badges options mappings
    let badgeClass = "";
    let statusLabel = "";
    let rowClass = "";

    if (p.status === "waiting") {
      badgeClass = "badge-waiting";
      statusLabel = "Waiting";
    } else if (p.status === "current") {
      badgeClass = "badge-current";
      statusLabel = "Serving";
      rowClass = "bg-slate-50 border-l-4 border-[var(--primary)] font-medium";
    } else if (p.status === "done") {
      badgeClass = "badge-pending-pay";
      statusLabel = "Payment Pending";
      rowClass = "bg-white border-l-4 border-amber-600 font-medium";
    } else if (p.status === "noshowed") {
      badgeClass = "badge-noshowed";
      statusLabel = "No-Show";
      rowClass = "opacity-60 bg-red-50/5";
    }

    // Locale Join time formatting
    const timeStr = new Date(p.addedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Action button render logic
    let actionButtonHtml = "";
    const billBtnHtml = `<button 
      onclick="openBillingModal('${p.token}')"
      class="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer shrink-0"
    >
      Bill
    </button>`;

    if (p.status === "waiting") {
      actionButtonHtml = `
        <div class="flex items-center justify-end gap-2">
          <button 
            onclick="triggerNoShow('${p.token}', '${p.name.replace(/'/g, "\\'")}')"
            class="bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer border border-red-200 shrink-0"
          >
            No-Show
          </button>
          ${billBtnHtml}
        </div>
      `;
    } else {
      let statusBtnHtml = "";
      if (p.finalBillPaid) {
        statusBtnHtml = `<button 
          onclick="openBillingModal('${p.token}')"
          class="px-2.5 py-1.5 bg-slate-50 text-slate-600 text-xs font-bold border border-slate-200 rounded-lg shrink-0 flex items-center gap-1"
        >
          Paid
        </button>`;
      } else {
        statusBtnHtml = `<button 
          onclick="openBillingModal('${p.token}')"
          class="px-3 py-1.5 bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white text-xs font-bold rounded-lg shrink-0 flex items-center justify-center gap-1 shadow-sm active:scale-95"
        >
          Pay
        </button>`;
      }
      actionButtonHtml = `
        <div class="flex items-center justify-end gap-2">
          ${statusBtnHtml}
        </div>
      `;
    }

    const bookingChannelTag = p.isOnlineBooked 
      ? `<div class="flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-600 mt-1">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          Online Ticket Booked
         </div>`
      : `<div class="text-[9px] text-slate-400 font-semibold uppercase mt-1">Walk-In Registration</div>`;

    const animationDelay = `${Math.min(index, 8) * 50}ms`;
    row.className = `${rowClass} hover:bg-slate-50/85 transition-all duration-300 animate-fade-up opacity-0`;
    row.style.animationDelay = animationDelay;
    row.innerHTML = `
      <td class="py-4 px-6 font-mono font-bold text-slate-800">${p.token}</td>
      <td class="py-4 px-6 font-semibold">
        <div class="text-slate-900">${p.name}</div>
        <div class="text-[10px] text-indigo-700 bg-indigo-50/75 border border-indigo-100 rounded px-1.5 py-0.5 inline-block font-medium mt-1">
          🩺 Problem: ${p.problem || 'General Consultation'}
        </div>
        ${bookingChannelTag}
      </td>
      <td class="py-4 px-6">
        <span class="inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${badgeClass}">
          ${statusLabel}
        </span>
      </td>
      <td class="py-4 px-6 font-mono text-xs text-slate-500">${timeStr}</td>
      <td class="py-4 px-6 text-right">${actionButtonHtml}</td>
    `;
    return row;
  }

  // Populate Walk-In table
  if (walkinTableBody) {
    walkinTableBody.innerHTML = "";
    if (walkinPatients.length === 0) {
      walkinTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="py-12 text-center text-slate-400">
            <span>No active walk-in patients in the queue registry yet.</span>
          </td>
        </tr>
      `;
    } else {
      walkinPatients.forEach((p, index) => {
        const row = createPatientRow(p, index);
        walkinTableBody.appendChild(row);
      });
    }
  }

  // Populate Online table
  if (onlineTableBody) {
    onlineTableBody.innerHTML = "";
    if (onlinePatients.length === 0) {
      onlineTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="py-12 text-center text-slate-400">
            <span>No active online tickets booked yet.</span>
          </td>
        </tr>
      `;
    } else {
      onlinePatients.forEach((p, index) => {
        const row = createPatientRow(p, index);
        onlineTableBody.appendChild(row);
      });
    }
  }

  // 6. Render Patient History table
  const historyTableBody = document.getElementById("history-table-body");
  const historyCountEl = document.getElementById("txt-history-count");
  if (historyCountEl) {
    historyCountEl.textContent = `${historyPatients.length} Closed Session${historyPatients.length === 1 ? "" : "s"}`;
  }

  if (historyTableBody) {
    historyTableBody.innerHTML = "";
    if (historyPatients.length === 0) {
      historyTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="py-12 text-center text-slate-400">
            <span>No completed or paid records recorded in history yet.</span>
          </td>
        </tr>
      `;
    } else {
      historyPatients.forEach((p, index) => {
        const row = document.createElement("tr");
        const animationDelay = `${Math.min(index, 8) * 50}ms`;
        
        row.className = "opacity-85 hover:bg-slate-50/85 transition-all duration-300 animate-fade-up opacity-0";
        row.style.animationDelay = animationDelay;

        const durationStr = p.servedDurationMinutes 
          ? `${p.servedDurationMinutes} mins` 
          : "N/A";

        const bookingChannelTag = p.isOnlineBooked 
          ? `<span class="text-[9px] font-bold text-emerald-600 block">Online Ticket</span>`
          : `<span class="text-[9px] text-slate-400 block">Walk-In Registration</span>`;

        const finalBillText = "Rs. 250.00 Paid";

        row.innerHTML = `
          <td class="py-3 px-6 font-mono font-bold text-slate-500">${p.token}</td>
          <td class="py-3 px-6 font-semibold">
            <div class="text-slate-900">${p.name}</div>
            <div class="text-[10px] text-indigo-700 bg-indigo-50/75 border border-indigo-100 rounded px-1.5 py-0.5 inline-block font-medium mt-1">
              🩺 Problem: ${p.problem || 'General Consultation'}
            </div>
            ${bookingChannelTag}
          </td>
          <td class="py-3 px-6">
            <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold badge-paid">
              Fully Settled
            </span>
          </td>
          <td class="py-3 px-6 font-mono text-xs text-slate-500">${durationStr}</td>
          <td class="py-3 px-6 text-right font-bold text-[var(--primary)] font-mono text-sm">${finalBillText}</td>
        `;

        historyTableBody.appendChild(row);
      });
    }
  }
});

// Sync connection status on connection
socket.on("connect", () => {
  const syncEl = document.getElementById("txt-uptime-sync");
  if (syncEl) {
    syncEl.textContent = "Sync: Connected";
    syncEl.className = "text-xs text-emerald-500 font-mono";
  }
});

socket.on("disconnect", () => {
  const syncEl = document.getElementById("txt-uptime-sync");
  if (syncEl) {
    syncEl.textContent = "Sync: Disconnected";
    syncEl.className = "text-xs text-red-500 font-mono";
  }
});

// Real-time voice announcement broadcast
socket.on("voice_announcement", (data) => {
  if (data && data.token) {
    speakAnnouncement(data.token, data.name);
  }
});

// ==================== PREMIUM BILLING MODAL MANAGEMENT ====================
let checkoutActiveToken = null;

const bModal = document.getElementById("billing-modal");
const bModalContent = document.getElementById("billing-modal-content");
const closeBModalBtn = document.getElementById("close-billing-modal");

if (closeBModalBtn) {
  closeBModalBtn.addEventListener("click", hideBillingModal);
}
if (bModal) {
  bModal.addEventListener("click", (e) => {
    if (e.target === bModal) {
      hideBillingModal();
    }
  });
}

function hideBillingModal() {
  if (bModal) bModal.classList.add("opacity-0");
  if (bModalContent) bModalContent.classList.add("scale-95");
  setTimeout(() => {
    if (bModal) bModal.classList.add("hidden");
  }, 300);
}

function openBillingModal(token) {
  if (!socket.connected || !currentServerState) return;
  const p = currentServerState.patients.find(pt => pt.token === token);
  if (!p) return;

  checkoutActiveToken = token;

  // Set patient values
  document.getElementById("invoice-token").textContent = p.token;
  document.getElementById("invoice-name").textContent = p.name;
  
  // Calculate consult intervals
  let durationText = "No completed session";
  if (p.completedAt && p.calledAt) {
    const elapsedSecs = Math.round((p.completedAt - p.calledAt) / 1000);
    const elapsedMins = p.servedDurationMinutes || Math.round((elapsedSecs / 60) * 10) / 10;
    durationText = `${elapsedMins} mins (Settled)`;
  } else if (p.calledAt) {
    const elapsedSecs = Math.round((Date.now() - p.calledAt) / 1000);
    const elapsedMins = Math.round((elapsedSecs / 60) * 10) / 10;
    durationText = `${elapsedMins} mins (Ongoing)`;
  }
  document.getElementById("invoice-duration").textContent = durationText;

  // Prepayment Reduction Credit Check & visual sync
  const chanEl = document.getElementById("invoice-channel");
  const prepayRow = document.getElementById("invoice-prepay-row");
  const totalDueEl = document.getElementById("invoice-total");

  if (p.isOnlineBooked) {
    chanEl.textContent = "💻 Online Booking Channel";
    chanEl.className = "font-bold text-emerald-600";
    if (prepayRow) prepayRow.classList.add("hidden");
    if (totalDueEl) totalDueEl.textContent = "Rs. 250.00";
  } else {
    chanEl.textContent = "🏪 Walk-in Reception Desk";
    chanEl.className = "font-bold text-blue-600";
    if (prepayRow) prepayRow.classList.add("hidden");
    if (totalDueEl) totalDueEl.textContent = "Rs. 250.00";
  }

  // Display Stamp vs actions
  const unpaidActions = document.getElementById("invoice-unpaid-actions");
  const paidStamp = document.getElementById("invoice-paid-stamp");

  if (p.finalBillPaid) {
    if (unpaidActions) unpaidActions.classList.add("hidden");
    if (paidStamp) paidStamp.classList.remove("hidden");
  } else {
    if (unpaidActions) unpaidActions.classList.remove("hidden");
    if (paidStamp) paidStamp.classList.add("hidden");
  }

  // Open modal view with clean responsive scale transformations
  if (bModal) {
    bModal.classList.remove("hidden");
    setTimeout(() => {
      bModal.classList.remove("opacity-0");
      if (bModalContent) bModalContent.classList.remove("scale-95");
    }, 50);
  }
}

async function commitBillPayment() {
  if (!checkoutActiveToken) return;

  try {
    const res = await fetch("/api/pay-bill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: checkoutActiveToken })
    });

    if (res.ok) {
      showToast(`Payment collected for ${checkoutActiveToken}! Invoice cleared.`, "success");
      
      const unpaidActions = document.getElementById("invoice-unpaid-actions");
      const paidStamp = document.getElementById("invoice-paid-stamp");
      
      if (unpaidActions) unpaidActions.classList.add("hidden");
      if (paidStamp) paidStamp.classList.remove("hidden");

      setTimeout(() => {
        hideBillingModal();
      }, 900);
    } else {
      showToast("Billing database sync error.", "error");
    }
  } catch (err) {
    showToast("Ledger sync offline. Re-attempt.", "error");
  }
}
