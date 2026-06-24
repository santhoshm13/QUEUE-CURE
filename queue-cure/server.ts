import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import path from "path";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3000; // Hardcoded to 3000 as per platform requirement

// In-Memory State Object
interface Patient {
  token: string;
  name: string;
  status: "waiting" | "current" | "done" | "noshowed";
  addedAt: number;
  problem?: string;
  isOnlineBooked?: boolean;
  onlinePrepayment?: number;
  totalBill?: number;
  finalBillPaid?: boolean;
  calledAt?: number;
  completedAt?: number;
  servedDurationMinutes?: number;
}

interface AppState {
  patients: Patient[];
  currentToken: string | null;
  avgConsultTime: number;
  tokenCounter: number;
  isProcessing: boolean;
  isPaused: boolean;
}

const state: AppState = {
  patients: [],
  currentToken: null,
  avgConsultTime: 5,
  tokenCounter: 0,
  isProcessing: false,
  isPaused: false
};

// Express Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from public/ folder
app.use(express.static(path.join(process.cwd(), "public")));

// REST API Page serving endpoints
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.get("/receptionist", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "receptionist.html"));
});

app.get("/waiting-room", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "waiting-room.html"));
});

// GET /api/state -> return full current state
app.get("/api/state", (req, res) => {
  res.json(state);
});

// POST /api/add-patient -> add patient to queue
app.post("/api/add-patient", (req, res) => {
  try {
    const rawName = req.body.name;
    if (!rawName || typeof rawName !== "string") {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const name = rawName.trim();
    if (name === "") {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    // Name Validation Checks:
    if (name.length < 2) {
      res.status(400).json({ error: "Name must be at least 2 characters long." });
      return;
    }
    if (/\d/.test(name)) {
      res.status(400).json({ error: "Name cannot contain numbers." });
      return;
    }
    const letterRegex = /\p{L}/gu;
    const matches = name.match(letterRegex);
    if (!matches || matches.length < 2) {
      res.status(400).json({ error: "Name must contain at least 2 alphabetic letters." });
      return;
    }

    const isOnlineBooked = !!req.body.isOnlineBooked;
    const onlinePrepayment = 0; // prepaying option removed
    const totalBill = 250; // standard consultation fee
    const finalBillPaid = false;
    const problem = req.body.problem ? String(req.body.problem).trim() : "General Consultation";

    state.tokenCounter += 1;
    const token = `T${String(state.tokenCounter).padStart(3, "0")}`;

    const newPatient: Patient = {
      token,
      name,
      status: "waiting",
      addedAt: Date.now(),
      problem,
      isOnlineBooked,
      onlinePrepayment,
      totalBill,
      finalBillPaid
    };

    state.patients.push(newPatient);

    // If currentToken === null and queue not paused, auto-set this as current with status "current"
    if (state.currentToken === null && !state.isPaused) {
      newPatient.status = "current";
      newPatient.calledAt = Date.now();
      state.currentToken = token;
    }

    // Emit queue_update to ALL clients
    io.emit("queue_update", state);

    res.json({ success: true, token, name, isOnlineBooked });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Helper function to advance to next waiting patient
function advanceQueue() {
  const now = Date.now();
  // Find current patient and set status to "done"
  const currentPatient = state.patients.find(p => p.status === "current");
  if (currentPatient) {
    currentPatient.status = "done";
    currentPatient.completedAt = now;

    // Calculate actual consultation time (minutes)
    const servedTimeMs = now - (currentPatient.calledAt || currentPatient.addedAt);
    const rawMins = servedTimeMs / 60000;

    // Simulate realistic 3-6 min duration if clicked within 15 seconds in demo context
    const elapsedMinutes = rawMins < 0.25 ? Math.floor(Math.random() * 4) + 3 : Math.round(rawMins * 10) / 10;
    currentPatient.servedDurationMinutes = elapsedMinutes;

    // Re-calculate the average consultation time dynamically from all completed patients
    const donePatients = state.patients.filter(p => p.status === "done" && p.servedDurationMinutes !== undefined);
    if (donePatients.length > 0) {
      const totalDuration = donePatients.reduce((sum, p) => sum + (p.servedDurationMinutes || 0), 0);
      state.avgConsultTime = Math.round((totalDuration / donePatients.length) * 10) / 10;
    }
  }

  // Find next patient with status "waiting"
  const nextPatient = state.patients.find(p => p.status === "waiting");
  if (nextPatient) {
    nextPatient.status = "current";
    nextPatient.calledAt = now;
    state.currentToken = nextPatient.token;
    return { token: nextPatient.token, name: nextPatient.name };
  } else {
    state.currentToken = null;
    return { token: null, name: "" };
  }
}

// POST /api/call-next -> advance to next token
app.post("/api/call-next", (req, res) => {
  try {
    if (state.isPaused) {
      res.status(403).json({ error: "Queue is paused" });
      return;
    }

    const { token: nextToken, name: nextName } = advanceQueue();

    // Broadcast change immediately
    io.emit("queue_update", state);

    if (nextToken) {
      io.emit("voice_announcement", { token: nextToken, name: nextName });
    }

    res.json({
      success: true,
      currentToken: nextToken,
      currentPatientName: nextName,
      avgConsultTime: state.avgConsultTime
    });

  } catch (err: any) {
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/recall-patient -> trigger voice announcement for specific patient on all connected screens
app.post("/api/recall-patient", (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    const patient = state.patients.find(p => p.token === token);
    const name = patient ? patient.name : "Unknown Patient";

    io.emit("voice_announcement", { token, name });

    res.json({ success: true, token, name });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/no-show -> mark a patient as no-show and skip
app.post("/api/no-show", (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    const patient = state.patients.find(
      p => p.token === token && (p.status === "waiting" || p.status === "current")
    );

    if (!patient) {
      res.status(404).json({ error: "Patient not found or status not editable" });
      return;
    }

    const wasCurrent = patient.status === "current";
    patient.status = "noshowed";

    // If that patient was "current", automatically call next (same logic as /api/call-next)
    if (wasCurrent) {
      advanceQueue();
    }

    io.emit("queue_update", state);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/toggle-pause -> toggle isPaused true/false
app.post("/api/toggle-pause", (req, res) => {
  try {
    state.isPaused = !state.isPaused;
    io.emit("queue_update", state);
    res.json({ success: true, isPaused: state.isPaused });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/set-consult-time -> update avgConsultTime
app.post("/api/set-consult-time", (req, res) => {
  try {
    const minutes = parseInt(req.body.minutes, 10);
    if (isNaN(minutes) || minutes < 1) {
      res.status(400).json({ error: "Minutes must be at least 1" });
      return;
    }

    state.avgConsultTime = minutes;
    io.emit("queue_update", state);
    res.json({ success: true, avgConsultTime: state.avgConsultTime });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/pay-bill -> set finalBillPaid to true
app.post("/api/pay-bill", (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    const patient = state.patients.find(p => p.token === token);
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    patient.finalBillPaid = true;

    // If they were currently serving (status "current"), transition them to "done"
    if (patient.status === "current") {
      const now = Date.now();
      patient.status = "done";
      patient.completedAt = now;

      // Calculate actual consultation time (minutes)
      const servedTimeMs = now - (patient.calledAt || patient.addedAt);
      const rawMins = servedTimeMs / 60000;

      // Simulate realistic 3-6 min duration if clicked within 15 seconds in demo context
      const elapsedMinutes = rawMins < 0.25 ? Math.floor(Math.random() * 4) + 3 : Math.round(rawMins * 10) / 10;
      patient.servedDurationMinutes = elapsedMinutes;

      // Re-calculate the average consultation time dynamically from all completed patients
      const donePatients = state.patients.filter(p => p.status === "done" && p.servedDurationMinutes !== undefined);
      if (donePatients.length > 0) {
        const totalDuration = donePatients.reduce((sum, p) => sum + (p.servedDurationMinutes || 0), 0);
        state.avgConsultTime = Math.round((totalDuration / donePatients.length) * 10) / 10;
      }
    }

    // Clear currentToken if it matches the paid patient so the UI doesn't say we're still serving them
    if (state.currentToken === token) {
      state.currentToken = null;
    }

    io.emit("queue_update", state);
    res.json({ success: true, patient });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/clear-history -> delete patients who are already served (done) or no-showed (noshowed)
app.post("/api/clear-history", (req, res) => {
  try {
    state.patients = state.patients.filter(p => p.status === "waiting" || p.status === "current");
    io.emit("queue_update", state);
    res.json({ success: true, message: "History cleared successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/reset-queue -> wipe all patients and reset counters to fresh state
app.post("/api/reset-queue", (req, res) => {
  try {
    state.patients = [];
    state.currentToken = null;
    state.tokenCounter = 0;
    state.isProcessing = false;
    state.isPaused = false;
    io.emit("queue_update", state);
    res.json({ success: true, message: "Entire queue reset successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Socket.io Setup
io.on("connection", (socket: Socket) => {
  // On every new connection, immediately emit queue_update with full state to that socket only
  socket.emit("queue_update", state);

  // On request_state from client, emit queue_update back to that client only
  socket.on("request_state", () => {
    socket.emit("queue_update", state);
  });
});

// Start Server on PORT 3000 and bind to 0.0.0.0
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
