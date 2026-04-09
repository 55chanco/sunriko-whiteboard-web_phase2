import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "./firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  runTransaction,
  updateDoc,
  where,
} from "firebase/firestore";
import { DndContext, useDraggable, useDroppable } from "@dnd-kit/core";

function getLocalDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeekStartMonday(d) {
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return x;
}

function makeDays(baseDate, mode) {
  if (mode === "month") {
    const first = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }).map((_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return getLocalDateKey(d);
    });
  }

  const len = mode === "week" ? 7 : 14;
  const start = getWeekStartMonday(baseDate);
  return Array.from({ length: len }).map((_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return getLocalDateKey(d);
  });
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function roundTimeTo5(v) {
  if (!v || !/^\d{2}:\d{2}$/.test(v)) return "";
  const [hh, mm] = v.split(":").map(Number);
  const total = hh * 60 + mm;
  const rounded = Math.round(total / 5) * 5;
  const h = Math.floor(rounded / 60) % 24;
  const m = rounded % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function phaseColor(phaseType) {
  const t = String(phaseType || "").toLowerCase();
  if (t === "green") return "#22c55e";
  if (t === "blue") return "#3b82f6";
  if (t === "yellow") return "#eab308";
  if (t === "red") return "#ef4444";
  return "#9ca3af";
}

function siteLabel(site, fallback = "") {
  if (!site) return fallback;
  return [site.customer_name, site.site_name || site.name].filter(Boolean).join(" ");
}

function cleanString(v) {
  return String(v ?? "").trim();
}

function cleanNullableString(v) {
  const x = cleanString(v);
  return x === "" ? "" : x;
}

function cleanNullableNumber(v) {
  const x = String(v ?? "").trim();
  if (x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normalizeMaster(x) {
  return {
    ...x,
    id: x.id,
    name: x.name ?? x.site_name ?? x.workerName ?? x.vehicle_number ?? "",
    site_number: x.site_number ?? x.siteNumber ?? "",
    customer_name: x.customer_name ?? x.client_name ?? x.clientName ?? "",
    site_name: x.site_name ?? x.siteName ?? x.name ?? "",
    address: x.address ?? "",
    memo: x.memo ?? "",
    has_safety_docs: x.has_safety_docs ?? x.hasSafetyDocs ?? false,
    vehicle_code: x.vehicle_code ?? x.vehicleCode ?? "",
    plateNo: x.plateNo ?? "",
    etcNo: x.etcNo ?? x.etc_no ?? "",
    owner: x.owner ?? "",
    type: x.type ?? x.vehicle_type ?? x.vehicleType ?? "",
    worker_code: x.worker_code ?? x.workerCode ?? "",
    affiliation: x.affiliation ?? "",
    daily_wage: x.daily_wage ?? null,
    equipment_code: x.equipment_code ?? x.equipmentCode ?? "",
    category: x.category ?? "",
    active: x.active !== false,
  };
}

function normalizeAssignment(a) {
  return {
    ...a,
    team_id: a.team_id ?? a.teamId ?? "",
    date: a.date ?? "",
    worker_id: a.worker_id ?? a.workerId ?? "",
    truck_id: a.truck_id ?? a.vehicle_id ?? a.truckId ?? "",
    equipment_id: a.equipment_id ?? a.equipmentId ?? "",
    site_id: a.site_id ?? a.siteId ?? "",
    site_order: Number(a.site_order ?? a.siteOrder ?? 999999),
    planned_in: a.planned_in ?? a.plannedIn ?? "",
    actual_in: a.actual_in ?? a.actualIn ?? "",
    actual_out: a.actual_out ?? a.actualOut ?? "",
    status: a.status ?? "unset",
    done_at: a.done_at ?? a.doneAt ?? "",
  };
}

function DraggableChip({ id, children, style, title }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      title={title}
      style={{
        ...style,
        opacity: isDragging ? 0.6 : 1,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
    >
      {children}
    </button>
  );
}

function DropArea({ id, children, style }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} style={{ ...style, outline: isOver ? "2px solid #f97316" : style?.outline }}>
      {children}
    </div>
  );
}

function labelForMasterType(masterType) {
  if (masterType === "sites") return "現場";
  if (masterType === "workers") return "職人";
  if (masterType === "trucks") return "トラック";
  return "備品";
}

function collectionNameForMasterType(masterType) {
  return masterType;
}

export default function App() {
  const [mode, setMode] = useState("week");
  const [screen, setScreen] = useState("board");
  const [baseDate, setBaseDate] = useState(new Date());
  const [poolDay, setPoolDay] = useState(getLocalDateKey(new Date()));

  const [sites, setSites] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [equipments, setEquipments] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [phases, setPhases] = useState([]);
  const [siteDays, setSiteDays] = useState([]);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [masterType, setMasterType] = useState("sites");

  const [siteDraft, setSiteDraft] = useState({
    customer_name: "",
    site_name: "",
    address: "",
    memo: "",
    has_safety_docs: false,
  });

  const [truckDraft, setTruckDraft] = useState({
    name: "",
    plateNo: "",
    etcNo: "",
    owner: "",
    type: "",
  });

  const [workerDraft, setWorkerDraft] = useState({
    name: "",
    affiliation: "",
    daily_wage: "",
  });

  const [equipmentDraft, setEquipmentDraft] = useState({
    name: "",
    category: "",
    memo: "",
  });

  const [editDrafts, setEditDrafts] = useState({});
  const [savingEditKey, setSavingEditKey] = useState("");

  const [siteNoteDrafts, setSiteNoteDrafts] = useState({});
  const [editingSiteNoteKey, setEditingSiteNoteKey] = useState("");
  const suppressNoteBlurSaveRef = useRef(false);

  const assignmentRules = {
    allowMultiSitePerDay: false,
    allowMultiWorkerPerDay: false,
    allowMultiTruckPerDay: false,
    allowMultiEquipmentPerDay: false,
  };

  const days = useMemo(() => makeDays(baseDate, mode), [baseDate, mode]);
  const todayKey = getLocalDateKey(new Date());

  async function loadMasters(opts = {}) {
    const { setBusy = true } = opts;
    if (setBusy) setLoading(true);
    setError("");
    try {
const [siteSnap, workerSnap, truckSnap, equipmentSnap, phaseSnap] = await Promise.all([
  getDocs(collection(db, "sites")),
  getDocs(collection(db, "workers")),
  getDocs(collection(db, "trucks")),
  getDocs(collection(db, "equipments")),
  getDocs(collection(db, "site_phases")),
]);
      setSites(siteSnap.docs.map((d) => normalizeMaster({ id: d.id, ...d.data() })));
      setWorkers(workerSnap.docs.map((d) => normalizeMaster({ id: d.id, ...d.data() })));
      setTrucks(truckSnap.docs.map((d) => normalizeMaster({ id: d.id, ...d.data() })));
      setEquipments(equipmentSnap.docs.map((d) => normalizeMaster({ id: d.id, ...d.data() })));
      setPhases(phaseSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      if (setBusy) setLoading(false);
    }
  }

  async function loadBoardData(dateKeys, opts = {}) {
    const { setBusy = true } = opts;
    if (!dateKeys || dateKeys.length === 0) return;
    const sorted = [...dateKeys].sort();
    const from = sorted[0];
    const to = sorted[sorted.length - 1];

    if (setBusy) setLoading(true);
    setError("");
    try {
      const assignQ = query(collection(db, "assignments"), where("date", ">=", from), where("date", "<=", to));
      const siteDayQ = query(collection(db, "site_days"), where("date", ">=", from), where("date", "<=", to));
      const [assignSnap, siteDaySnap] = await Promise.all([getDocs(assignQ), getDocs(siteDayQ)]);
      setAssignments(assignSnap.docs.map((d) => normalizeAssignment({ id: d.id, ...d.data() })));
      setSiteDays(siteDaySnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      if (setBusy) setLoading(false);
    }
  }

  async function reloadAssignments(dateKeys, opts = {}) {
    const { setBusy = true } = opts;
    if (!dateKeys || dateKeys.length === 0) return;
    const sorted = [...dateKeys].sort();
    const from = sorted[0];
    const to = sorted[sorted.length - 1];

    if (setBusy) setLoading(true);
    try {
      const assignQ = query(collection(db, "assignments"), where("date", ">=", from), where("date", "<=", to));
      const assignSnap = await getDocs(assignQ);
      setAssignments(assignSnap.docs.map((d) => normalizeAssignment({ id: d.id, ...d.data() })));
    } finally {
      if (setBusy) setLoading(false);
    }
  }

  async function reloadSiteDays(dateKeys, opts = {}) {
    const { setBusy = true } = opts;
    if (!dateKeys || dateKeys.length === 0) return;
    const sorted = [...dateKeys].sort();
    const from = sorted[0];
    const to = sorted[sorted.length - 1];

    if (setBusy) setLoading(true);
    try {
      const siteDayQ = query(collection(db, "site_days"), where("date", ">=", from), where("date", "<=", to));
      const siteDaySnap = await getDocs(siteDayQ);
      setSiteDays(siteDaySnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } finally {
      if (setBusy) setLoading(false);
    }
  }

  async function reloadMasters(opts = {}) {
    return loadMasters(opts);
  }

  useEffect(() => {
    loadMasters();
  }, []);

  useEffect(() => {
    loadBoardData(days);
  }, [days]);

  const activeSites = sites.filter((x) => x.active);
  const activeWorkers = workers.filter((x) => x.active);
  const activeTrucks = trucks.filter((x) => x.active);
  const activeEquipments = equipments.filter((x) => x.active);

  const teamSlots = useMemo(() => {
    const map = new Map();
    for (const a of assignments) {
      if (!a.date || !a.team_id) continue;
      const key = `${a.date}__${a.team_id}`;
      if (!map.has(key)) {
        map.set(key, {
          date: a.date,
          team_id: a.team_id,
          workerRows: [],
          truckRows: [],
          equipmentRows: [],
          siteRows: [],
        });
      }
      const slot = map.get(key);
      if (a.worker_id) slot.workerRows.push(a);
      if (a.truck_id) slot.truckRows.push(a);
      if (a.equipment_id) slot.equipmentRows.push(a);
      if (a.site_id) slot.siteRows.push(a);
    }

    for (const slot of map.values()) {
      slot.siteRows.sort((a, b) => a.site_order - b.site_order);
    }

    return Array.from(map.values()).sort((a, b) => a.team_id.localeCompare(b.team_id, "ja"));
  }, [assignments]);

  function getDaySlots(day) {
    return teamSlots.filter((s) => s.date === day);
  }

  function assignedIdsForDay(day, kind) {
    const set = new Set();
    assignments.forEach((a) => {
      if (a.date !== day) return;
      if (kind === "worker" && a.worker_id) set.add(a.worker_id);
      if (kind === "truck" && a.truck_id) set.add(a.truck_id);
      if (kind === "equipment" && a.equipment_id) set.add(a.equipment_id);
      if (kind === "site" && a.site_id) set.add(a.site_id);
    });
    return set;
  }

  function unassignedForDay(day, kind) {
    const used = assignedIdsForDay(day, kind);
    if (kind === "worker") return activeWorkers.filter((w) => !used.has(w.id));
    if (kind === "truck") return activeTrucks.filter((t) => !used.has(t.id));
    if (kind === "equipment") return activeEquipments.filter((x) => !used.has(x.id));
    return activeSites.filter((s) => !used.has(s.id));
  }

  const unassignedWorkers = useMemo(() => unassignedForDay(poolDay, "worker"), [poolDay, activeWorkers, assignments]);
  const unassignedTrucks = useMemo(() => unassignedForDay(poolDay, "truck"), [poolDay, activeTrucks, assignments]);
  const unassignedEquipments = useMemo(() => unassignedForDay(poolDay, "equipment"), [poolDay, activeEquipments, assignments]);
  const unassignedSites = useMemo(() => unassignedForDay(poolDay, "site"), [poolDay, activeSites, assignments]);

  async function ensureTeamSlot(day, teamId) {
    const slot = assignments.find((a) => a.date === day && a.team_id === teamId);
    if (slot) return;
    await addDoc(collection(db, "assignments"), { date: day, team_id: teamId, marker: "team_slot" });
  }

  function hasDuplicateForDay(payload) {
    return assignments.some((a) => {
      if (a.date !== payload.date) return false;
      if (payload.worker_id && !assignmentRules.allowMultiWorkerPerDay && a.worker_id === payload.worker_id) return true;
      if (payload.truck_id && !assignmentRules.allowMultiTruckPerDay && a.truck_id === payload.truck_id) return true;
      if (payload.equipment_id && !assignmentRules.allowMultiEquipmentPerDay && a.equipment_id === payload.equipment_id) return true;
      if (payload.site_id && !assignmentRules.allowMultiSitePerDay && a.site_id === payload.site_id) return true;
      return false;
    });
  }

  async function addAssignmentRow(payload) {
    try {
      setError("");
      setMessage("");
      setLoading(true);

      const duplicate = hasDuplicateForDay(payload);
      if (duplicate) {
        setMessage("重複のため配備できませんでした。");
        return;
      }

      await ensureTeamSlot(payload.date, payload.team_id);
      await addDoc(collection(db, "assignments"), payload);
      setMessage("配備しました。");
      await reloadAssignments(days, { setBusy: false });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function moveRow(rowId, day, teamId) {
    try {
      setLoading(true);
      await ensureTeamSlot(day, teamId);
      await updateDoc(doc(db, "assignments", rowId), { date: day, team_id: teamId });
      await reloadAssignments(days, { setBusy: false });
    } finally {
      setLoading(false);
    }
  }

  async function unassignRow(rowId) {
    try {
      setLoading(true);
      await deleteDoc(doc(db, "assignments", rowId));
      await reloadAssignments(days, { setBusy: false });
    } finally {
      setLoading(false);
    }
  }

  async function removeSiteAssignment(rowId) {
    try {
      setLoading(true);
      await deleteDoc(doc(db, "assignments", rowId));
      setMessage("現場配備を解除しました。");
      await reloadAssignments(days, { setBusy: false });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  function getSiteDay(date, siteId) {
    return siteDays.find((x) => x.date === date && x.site_id === siteId);
  }

  async function setSiteDayPhase(date, siteId, phaseType) {
    const existing = getSiteDay(date, siteId);
    try {
      setLoading(true);
      if (existing?.id) {
        await updateDoc(doc(db, "site_days", existing.id), { phase_type: phaseType });
      } else {
        await addDoc(collection(db, "site_days"), { date, site_id: siteId, phase_type: phaseType, note: "" });
      }
      await reloadSiteDays(days, { setBusy: false });
    } finally {
      setLoading(false);
    }
  }

  async function setSiteDayNote(date, siteId, note) {
    const existing = getSiteDay(date, siteId);
    try {
      setLoading(true);
      const nextNote = String(note || "").trim();
      if (existing?.id) {
        await updateDoc(doc(db, "site_days", existing.id), { note: nextNote });
      } else {
        await addDoc(collection(db, "site_days"), { date, site_id: siteId, phase_type: "", note: nextNote });
      }
      await reloadSiteDays(days, { setBusy: false });
    } finally {
      setLoading(false);
    }
  }

  async function updateSiteTime(rowId, patch) {
    try {
      setLoading(true);
      const next = { ...patch };
      if (Object.prototype.hasOwnProperty.call(next, "planned_in")) next.planned_in = roundTimeTo5(next.planned_in);
      if (Object.prototype.hasOwnProperty.call(next, "actual_in")) next.actual_in = roundTimeTo5(next.actual_in);
      if (Object.prototype.hasOwnProperty.call(next, "actual_out")) next.actual_out = roundTimeTo5(next.actual_out);
      await updateDoc(doc(db, "assignments", rowId), next);
      await reloadAssignments(days, { setBusy: false });
    } finally {
      setLoading(false);
    }
  }

  async function updateSiteStatus(rowId, status) {
    const patch = { status };
    if (status === "complete") patch.done_at = new Date().toISOString();
    else patch.done_at = "";
    try {
      setLoading(true);
      await updateDoc(doc(db, "assignments", rowId), patch);
      await reloadAssignments(days, { setBusy: false });
    } finally {
      setLoading(false);
    }
  }

  async function reorderSiteRows(day, teamId, draggedId, targetId) {
    const slot = getDaySlots(day).find((s) => s.team_id === teamId);
    if (!slot) return;
    const rows = [...slot.siteRows];
    const from = rows.findIndex((r) => r.id === draggedId);
    const to = rows.findIndex((r) => r.id === targetId);
    if (from < 0 || to < 0 || from === to) return;

    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved);

    try {
      setLoading(true);
      await Promise.all(rows.map((r, i) => updateDoc(doc(db, "assignments", r.id), { site_order: i + 1 })));
      await reloadAssignments(days, { setBusy: false });
    } finally {
      setLoading(false);
    }
  }

  function nextTeamIdForDay(day) {
    const nums = getDaySlots(day)
      .map((s) => {
        const m = String(s.team_id || "").match(/^班(\d+)$/);
        return m ? Number(m[1]) : 0;
      })
      .filter((n) => Number.isFinite(n));
    const max = nums.length ? Math.max(...nums) : 0;
    return `班${max + 1}`;
  }

  async function createTeamForDay(day) {
    const teamId = nextTeamIdForDay(day);
    await ensureTeamSlot(day, teamId);
    await reloadAssignments(days, { setBusy: false });
  }

  async function deleteTeam(day, teamId) {
    try {
      const ok = window.confirm(`${teamId} を削除しますか？\n所属している現場・職人・トラック・ETCカード・備品は未割当に戻ります。`);
      if (!ok) return;
      setLoading(true);
      const rows = assignments.filter((a) => a.date === day && a.team_id === teamId);
      await Promise.all(rows.map((r) => deleteDoc(doc(db, "assignments", r.id))));
      setMessage(`${teamId} を削除しました。`);
      await reloadAssignments(days, { setBusy: false });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function toggleArchive(kind, id, active) {
    await updateDoc(doc(db, kind, id), { active: !active });
    await reloadMasters({ setBusy: false });
  }

  async function allocateCode(counterKey, format) {
    const ref = doc(db, "counters", counterKey);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const next = snap.exists() ? Number(snap.data().next || 1) : 1;
      tx.set(ref, { next: next + 1 });
      return format(next);
    });
  }

  function getMasterItems() {
    if (masterType === "sites") return sites;
    if (masterType === "workers") return workers;
    if (masterType === "trucks") return trucks;
    return equipments;
  }

  function buildEditDraft(masterTypeValue, x) {
    if (masterTypeValue === "sites") {
      return {
        customer_name: x.customer_name || "",
        site_name: x.site_name || "",
        address: x.address || "",
        memo: x.memo || "",
        has_safety_docs: !!x.has_safety_docs,
      };
    }
    if (masterTypeValue === "workers") {
      return {
        name: x.name || "",
        affiliation: x.affiliation || "",
        daily_wage: x.daily_wage ?? "",
      };
    }
    if (masterTypeValue === "trucks") {
      return {
        name: x.name || "",
        plateNo: x.plateNo || "",
        etcNo: x.etcNo || "",
        owner: x.owner || "",
        type: x.type || "",
      };
    }
    return {
      name: x.name || "",
      category: x.category || "",
      memo: x.memo || "",
    };
  }

  function ensureEditDraft(masterTypeValue, x) {
    const key = `${masterTypeValue}:${x.id}`;
    if (!editDrafts[key]) {
      setEditDrafts((prev) => ({ ...prev, [key]: buildEditDraft(masterTypeValue, x) }));
    }
  }

  function getEditDraft(masterTypeValue, x) {
    const key = `${masterTypeValue}:${x.id}`;
    return editDrafts[key] || buildEditDraft(masterTypeValue, x);
  }

  function setEditDraftField(masterTypeValue, id, field, value) {
    const key = `${masterTypeValue}:${id}`;
    setEditDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [field]: value,
      },
    }));
  }

  async function saveMasterRow(masterTypeValue, x) {
    const key = `${masterTypeValue}:${x.id}`;
    const draft = editDrafts[key] || buildEditDraft(masterTypeValue, x);

    try {
      setSavingEditKey(key);
      setLoading(true);
      setError("");
      setMessage("");

      if (masterTypeValue === "sites") {
        if (!cleanString(draft.customer_name) || !cleanString(draft.site_name)) {
          setError("現場は元請名と現場名が必須です。");
          return;
        }
        await updateDoc(doc(db, "sites", x.id), {
          customer_name: cleanString(draft.customer_name),
          site_name: cleanString(draft.site_name),
          name: cleanString(draft.site_name),
          address: cleanNullableString(draft.address),
          memo: cleanNullableString(draft.memo),
          has_safety_docs: !!draft.has_safety_docs,
        });
      } else if (masterTypeValue === "workers") {
        if (!cleanString(draft.name) || !cleanString(draft.affiliation)) {
          setError("職人は名前と所属が必須です。");
          return;
        }
        await updateDoc(doc(db, "workers", x.id), {
          name: cleanString(draft.name),
          affiliation: cleanString(draft.affiliation),
          daily_wage: cleanNullableNumber(draft.daily_wage),
        });
      } else if (masterTypeValue === "trucks") {
        if (!cleanString(draft.name)) {
          setError("トラック名は必須です。");
          return;
        }
        await updateDoc(doc(db, "trucks", x.id), {
          name: cleanString(draft.name),
          plateNo: cleanNullableString(draft.plateNo),
          etcNo: cleanNullableString(draft.etcNo),
          owner: cleanNullableString(draft.owner),
          type: cleanNullableString(draft.type),
        });
      } else if (masterTypeValue === "equipments") {
        if (!cleanString(draft.name)) {
          setError("備品名は必須です。");
          return;
        }
        await updateDoc(doc(db, "equipments", x.id), {
          name: cleanString(draft.name),
          category: cleanNullableString(draft.category),
          memo: cleanNullableString(draft.memo),
        });
      }

      setMessage(`${labelForMasterType(masterTypeValue)}を保存しました。`);
      await reloadMasters({ setBusy: false });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSavingEditKey("");
      setLoading(false);
    }
  }

  async function resetEditDraft(masterTypeValue, x) {
    const key = `${masterTypeValue}:${x.id}`;
    setEditDrafts((prev) => ({
      ...prev,
      [key]: buildEditDraft(masterTypeValue, x),
    }));
  }

  async function addMasterRow() {
    try {
      setLoading(true);
      setError("");
      setMessage("");

      if (masterType === "sites") {
        if (!cleanString(siteDraft.site_name) || !cleanString(siteDraft.customer_name)) {
          setError("現場は元請名と現場名が必須です。");
          return;
        }
        const site_number = await allocateCode("sites_next", (n) => String(n).padStart(5, "0"));
        await addDoc(collection(db, "sites"), {
          site_number,
          customer_name: cleanString(siteDraft.customer_name),
          site_name: cleanString(siteDraft.site_name),
          address: cleanNullableString(siteDraft.address),
          memo: cleanNullableString(siteDraft.memo),
          has_safety_docs: !!siteDraft.has_safety_docs,
          name: cleanString(siteDraft.site_name),
          active: true,
        });
        setSiteDraft({ customer_name: "", site_name: "", address: "", memo: "", has_safety_docs: false });
      } else if (masterType === "trucks") {
        if (!cleanString(truckDraft.name)) {
          setError("車両名が必須です。");
          return;
        }
        const vehicle_code = await allocateCode("vehicles_next", (n) => `T${String(n).padStart(3, "0")}`);
        await addDoc(collection(db, "trucks"), {
          vehicle_code,
          name: cleanString(truckDraft.name),
          plateNo: cleanNullableString(truckDraft.plateNo),
          etcNo: cleanNullableString(truckDraft.etcNo),
          owner: cleanNullableString(truckDraft.owner),
          type: cleanNullableString(truckDraft.type),
          active: true,
        });
        setTruckDraft({ name: "", plateNo: "", etcNo: "", owner: "", type: "" });
      } else if (masterType === "workers") {
        if (!cleanString(workerDraft.name) || !cleanString(workerDraft.affiliation)) {
          setError("職人は名前と所属が必須です。");
          return;
        }
        const worker_code = await allocateCode("workers_next", (n) => `W${String(n).padStart(3, "0")}`);
        await addDoc(collection(db, "workers"), {
          worker_code,
          name: cleanString(workerDraft.name),
          affiliation: cleanString(workerDraft.affiliation),
          daily_wage: cleanNullableNumber(workerDraft.daily_wage),
          active: true,
        });
        setWorkerDraft({ name: "", affiliation: "", daily_wage: "" });
      } else if (masterType === "equipments") {
        if (!cleanString(equipmentDraft.name)) {
          setError("備品名が必須です。");
          return;
        }
        const equipment_code = await allocateCode("equipments_next", (n) => `Q${String(n).padStart(3, "0")}`);
        await addDoc(collection(db, "equipments"), {
          equipment_code,
          name: cleanString(equipmentDraft.name),
          category: cleanNullableString(equipmentDraft.category),
          memo: cleanNullableString(equipmentDraft.memo),
          active: true,
        });
        setEquipmentDraft({ name: "", category: "", memo: "" });
      }

      await reloadMasters({ setBusy: false });
      setMessage(`${labelForMasterType(masterType)}を追加しました。`);
    } finally {
      setLoading(false);
    }
  }

  function parseActiveId(id) {
    const raw = String(id || "");
    const [kind, p1, p2] = raw.split(":");
    if (kind === "poolWorker") return { type: "poolWorker", workerId: p1 };
    if (kind === "poolTruck") return { type: "poolTruck", truckId: p1 };
    if (kind === "poolEquipment") return { type: "poolEquipment", equipmentId: p1 };
    if (kind === "poolSite") return { type: "poolSite", siteId: p1 };

    if (kind === "dayWorker") return { type: "dayWorker", date: p1, workerId: p2 };
    if (kind === "dayTruck") return { type: "dayTruck", date: p1, truckId: p2 };
    if (kind === "dayEquipment") return { type: "dayEquipment", date: p1, equipmentId: p2 };

    if (kind === "rowWorker") return { type: "rowWorker", rowId: p1, workerId: p2 };
    if (kind === "rowTruck") return { type: "rowTruck", rowId: p1, truckId: p2 };
    if (kind === "rowEquipment") return { type: "rowEquipment", rowId: p1, equipmentId: p2 };
    if (kind === "rowSite") return { type: "rowSite", rowId: p1, siteId: p2 };

    return null;
  }

  function parseDropId(id) {
    const raw = String(id || "");
    const [kind, date, teamId, rowId] = raw.split(":");
    if (kind === "teamWorker") return { type: "teamWorker", date, teamId };
    if (kind === "teamTruck") return { type: "teamTruck", date, teamId };
    if (kind === "teamEquipment") return { type: "teamEquipment", date, teamId };
    if (kind === "teamSite") return { type: "teamSite", date, teamId };
    if (kind === "sitePos") return { type: "sitePos", date, teamId, rowId };
    if (kind === "unassignWorker") return { type: "unassignWorker", date };
    if (kind === "unassignTruck") return { type: "unassignTruck", date };
    if (kind === "unassignEquipment") return { type: "unassignEquipment", date };
    if (kind === "unassignSite") return { type: "unassignSite", date };
    return null;
  }

  async function onDragEnd(e) {
    const active = parseActiveId(e.active?.id);
    const over = parseDropId(e.over?.id);
    if (!active || !over) return;

    if (active.type === "poolWorker" && over.type === "teamWorker") {
      return addAssignmentRow({ date: over.date, team_id: over.teamId, worker_id: active.workerId });
    }
    if (active.type === "poolTruck" && over.type === "teamTruck") {
      return addAssignmentRow({ date: over.date, team_id: over.teamId, truck_id: active.truckId });
    }
    if (active.type === "poolEquipment" && over.type === "teamEquipment") {
      return addAssignmentRow({ date: over.date, team_id: over.teamId, equipment_id: active.equipmentId });
    }
    if (active.type === "poolSite" && over.type === "teamSite") {
      return addAssignmentRow({ date: over.date, team_id: over.teamId, site_id: active.siteId, site_order: 999999 });
    }

    if (active.type === "dayWorker" && over.type === "teamWorker") {
      return addAssignmentRow({ date: over.date, team_id: over.teamId, worker_id: active.workerId });
    }
    if (active.type === "dayTruck" && over.type === "teamTruck") {
      return addAssignmentRow({ date: over.date, team_id: over.teamId, truck_id: active.truckId });
    }
    if (active.type === "dayEquipment" && over.type === "teamEquipment") {
      return addAssignmentRow({ date: over.date, team_id: over.teamId, equipment_id: active.equipmentId });
    }

    if (active.type === "rowWorker" && over.type === "teamWorker") return moveRow(active.rowId, over.date, over.teamId);
    if (active.type === "rowTruck" && over.type === "teamTruck") return moveRow(active.rowId, over.date, over.teamId);
    if (active.type === "rowEquipment" && over.type === "teamEquipment") return moveRow(active.rowId, over.date, over.teamId);

    if (active.type === "rowSite" && over.type === "sitePos") {
      const source = assignments.find((a) => a.id === active.rowId);
      if (source && source.date === over.date && source.team_id === over.teamId) {
        return reorderSiteRows(over.date, over.teamId, active.rowId, over.rowId);
      }
      return moveRow(active.rowId, over.date, over.teamId);
    }
    if (active.type === "rowSite" && over.type === "teamSite") return moveRow(active.rowId, over.date, over.teamId);

    if (active.type === "rowWorker" && over.type === "unassignWorker") return unassignRow(active.rowId);
    if (active.type === "rowTruck" && over.type === "unassignTruck") return unassignRow(active.rowId);
    if (active.type === "rowEquipment" && over.type === "unassignEquipment") return unassignRow(active.rowId);
    if (active.type === "rowSite" && over.type === "unassignSite") return unassignRow(active.rowId);
  }

  const chip = {
    fontSize: 12,
    padding: "5px 8px",
    borderRadius: 999,
    border: "1px solid #d1d5db",
    background: "#fff",
    marginRight: 6,
    marginBottom: 6,
  };

  const monthCells = useMemo(() => {
    const firstMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1).getMonth();
    return days.map((d) => {
      const [, m, day] = d.split("-").map(Number);
      return { key: d, inMonth: m - 1 === firstMonth, day, m };
    });
  }, [days, baseDate]);

  const masterItems = getMasterItems();

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div style={{ padding: 16, fontFamily: "sans-serif" }}>
        <h1>現場ホワイトボードシステム（Phase 1 Produced by Madoka with ChatGPT）</h1>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setScreen("board")}>配備ボード</button>
          <button onClick={() => setScreen("master")}>マスター管理</button>
        </div>

        {error && <div style={{ background: "#fee2e2", padding: 8, borderRadius: 6 }}>エラー: {error}</div>}
        {message && <div style={{ background: "#e0f2fe", padding: 8, borderRadius: 6 }}>{message}</div>}
        {loading && <div style={{ fontSize: 12, color: "#6b7280" }}>保存中...</div>}

        {screen === "master" && (
          <div style={{ marginTop: 12 }}>
            <h2>マスター管理</h2>

            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <button onClick={() => setMasterType("sites")}>現場</button>
              <button onClick={() => setMasterType("workers")}>職人</button>
              <button onClick={() => setMasterType("trucks")}>トラック</button>
              <button onClick={() => setMasterType("equipments")}>備品</button>
            </div>

            {masterType === "sites" && (
              <div style={{ display: "grid", gap: 8, marginBottom: 12, maxWidth: 560 }}>
                <input
                  value={siteDraft.customer_name}
                  onChange={(e) => setSiteDraft({ ...siteDraft, customer_name: e.target.value })}
                  placeholder="元請名（必須）"
                />
                <input
                  value={siteDraft.site_name}
                  onChange={(e) => setSiteDraft({ ...siteDraft, site_name: e.target.value })}
                  placeholder="現場名（必須）"
                />
                <input
                  value={siteDraft.address}
                  onChange={(e) => setSiteDraft({ ...siteDraft, address: e.target.value })}
                  placeholder="住所"
                />
                <input
                  value={siteDraft.memo}
                  onChange={(e) => setSiteDraft({ ...siteDraft, memo: e.target.value })}
                  placeholder="メモ"
                />
                <label style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={siteDraft.has_safety_docs}
                    onChange={(e) => setSiteDraft({ ...siteDraft, has_safety_docs: e.target.checked })}
                  />
                  {" "}安全書類あり
                </label>
                <button onClick={addMasterRow}>現場を追加（site_number自動採番）</button>
              </div>
            )}

            {masterType === "workers" && (
              <div style={{ display: "grid", gap: 8, marginBottom: 12, maxWidth: 560 }}>
                <input
                  value={workerDraft.name}
                  onChange={(e) => setWorkerDraft({ ...workerDraft, name: e.target.value })}
                  placeholder="職人名（必須）"
                />
                <input
                  value={workerDraft.affiliation}
                  onChange={(e) => setWorkerDraft({ ...workerDraft, affiliation: e.target.value })}
                  placeholder="所属（必須）"
                />
                <input
                  value={workerDraft.daily_wage}
                  onChange={(e) => setWorkerDraft({ ...workerDraft, daily_wage: e.target.value })}
                  placeholder="日当（任意）"
                  inputMode="numeric"
                />
                <button onClick={addMasterRow}>職人を追加（worker_code自動採番）</button>
              </div>
            )}

            {masterType === "trucks" && (
              <div style={{ display: "grid", gap: 8, marginBottom: 12, maxWidth: 560 }}>
                <input
                  value={truckDraft.name}
                  onChange={(e) => setTruckDraft({ ...truckDraft, name: e.target.value })}
                  placeholder="車両名（必須）"
                />
                <input
                  value={truckDraft.plateNo}
                  onChange={(e) => setTruckDraft({ ...truckDraft, plateNo: e.target.value })}
                  placeholder="ナンバー"
                />
                <input
                  value={truckDraft.etcNo}
                  onChange={(e) => setTruckDraft({ ...truckDraft, etcNo: e.target.value })}
                  placeholder="ETC番号"
                />
                <input
                  value={truckDraft.owner}
                  onChange={(e) => setTruckDraft({ ...truckDraft, owner: e.target.value })}
                  placeholder="所有者"
                />
                <input
                  value={truckDraft.type}
                  onChange={(e) => setTruckDraft({ ...truckDraft, type: e.target.value })}
                  placeholder="種別"
                />
                <button onClick={addMasterRow}>車両を追加（vehicle_code自動採番）</button>
              </div>
            )}


            {masterType === "equipments" && (
              <div style={{ display: "grid", gap: 8, marginBottom: 12, maxWidth: 560 }}>
                <input
                  value={equipmentDraft.name}
                  onChange={(e) => setEquipmentDraft({ ...equipmentDraft, name: e.target.value })}
                  placeholder="備品名（必須）"
                />
                <input
                  value={equipmentDraft.category}
                  onChange={(e) => setEquipmentDraft({ ...equipmentDraft, category: e.target.value })}
                  placeholder="カテゴリ"
                />
                <input
                  value={equipmentDraft.memo}
                  onChange={(e) => setEquipmentDraft({ ...equipmentDraft, memo: e.target.value })}
                  placeholder="メモ"
                />
                <button onClick={addMasterRow}>備品を追加（equipment_code自動採番）</button>
              </div>
            )}

            <div style={{ display: "grid", gap: 12 }}>
              {masterItems.map((x) => {
                const draft = getEditDraft(masterType, x);
                const key = `${masterType}:${x.id}`;
                const isSaving = savingEditKey === key;

                return (
                  <div key={x.id} style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: 10 }}>
                    {ensureEditDraft(masterType, x) || null}

                    {masterType === "sites" && (
                      <>
                        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                          現場番号: {x.site_number || "-"}
                        </div>
                        <div style={{ display: "grid", gap: 6, maxWidth: 700 }}>
                          <input
                            value={draft.customer_name}
                            onChange={(e) => setEditDraftField(masterType, x.id, "customer_name", e.target.value)}
                            placeholder="元請名"
                          />
                          <input
                            value={draft.site_name}
                            onChange={(e) => setEditDraftField(masterType, x.id, "site_name", e.target.value)}
                            placeholder="現場名"
                          />
                          <input
                            value={draft.address}
                            onChange={(e) => setEditDraftField(masterType, x.id, "address", e.target.value)}
                            placeholder="住所"
                          />
                          <input
                            value={draft.memo}
                            onChange={(e) => setEditDraftField(masterType, x.id, "memo", e.target.value)}
                            placeholder="メモ"
                          />
                          <label style={{ fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={!!draft.has_safety_docs}
                              onChange={(e) => setEditDraftField(masterType, x.id, "has_safety_docs", e.target.checked)}
                            />
                            {" "}安全書類あり
                          </label>
                        </div>
                      </>
                    )}

                    {masterType === "workers" && (
                      <>
                        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                          職人コード: {x.worker_code || "-"}
                        </div>
                        <div style={{ display: "grid", gap: 6, maxWidth: 700 }}>
                          <input
                            value={draft.name}
                            onChange={(e) => setEditDraftField(masterType, x.id, "name", e.target.value)}
                            placeholder="職人名"
                          />
                          <input
                            value={draft.affiliation}
                            onChange={(e) => setEditDraftField(masterType, x.id, "affiliation", e.target.value)}
                            placeholder="所属"
                          />
                          <input
                            value={draft.daily_wage}
                            onChange={(e) => setEditDraftField(masterType, x.id, "daily_wage", e.target.value)}
                            placeholder="日当"
                            inputMode="numeric"
                          />
                        </div>
                      </>
                    )}

                    {masterType === "trucks" && (
                      <>
                        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                          車両コード: {x.vehicle_code || "-"}
                        </div>
                        <div style={{ display: "grid", gap: 6, maxWidth: 700 }}>
                          <input
                            value={draft.name}
                            onChange={(e) => setEditDraftField(masterType, x.id, "name", e.target.value)}
                            placeholder="車両名"
                          />
                          <input
                            value={draft.plateNo}
                            onChange={(e) => setEditDraftField(masterType, x.id, "plateNo", e.target.value)}
                            placeholder="ナンバー"
                          />
                          <input
                            value={draft.etcNo}
                            onChange={(e) => setEditDraftField(masterType, x.id, "etcNo", e.target.value)}
                            placeholder="ETC番号"
                          />
                          <input
                            value={draft.owner}
                            onChange={(e) => setEditDraftField(masterType, x.id, "owner", e.target.value)}
                            placeholder="所有者"
                          />
                          <input
                            value={draft.type}
                            onChange={(e) => setEditDraftField(masterType, x.id, "type", e.target.value)}
                            placeholder="種別"
                          />
                        </div>
                      </>
                    )}

                    {masterType === "equipments" && (
                      <>
                        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                          備品コード: {x.equipment_code || "-"}
                        </div>
                        <div style={{ display: "grid", gap: 6, maxWidth: 700 }}>
                          <input
                            value={draft.name}
                            onChange={(e) => setEditDraftField(masterType, x.id, "name", e.target.value)}
                            placeholder="備品名"
                          />
                          <input
                            value={draft.category}
                            onChange={(e) => setEditDraftField(masterType, x.id, "category", e.target.value)}
                            placeholder="カテゴリ"
                          />
                          <input
                            value={draft.memo}
                            onChange={(e) => setEditDraftField(masterType, x.id, "memo", e.target.value)}
                            placeholder="メモ"
                          />
                        </div>
                      </>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <button type="button" onClick={() => saveMasterRow(masterType, x)} disabled={isSaving}>
                        {isSaving ? "保存中..." : "保存"}
                      </button>
                      <button type="button" onClick={() => resetEditDraft(masterType, x)}>
                        入力を戻す
                      </button>
                      <button onClick={() => toggleArchive(collectionNameForMasterType(masterType), x.id, x.active)}>
                        {x.active ? "アーカイブ" : "再有効化"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {screen === "board" && (
          <>
            <div style={{ marginTop: 12, marginBottom: 10 }}>
              <button onClick={() => setMode("week")}>1週間</button>
              <button onClick={() => setMode("twoWeeks")} style={{ marginLeft: 6 }}>2週間</button>
              <button onClick={() => setMode("month")} style={{ marginLeft: 6 }}>1ヶ月</button>
              <button
                style={{ marginLeft: 10 }}
                onClick={() => {
                  const d = new Date(baseDate);
                  d.setDate(d.getDate() - (mode === "week" ? 7 : mode === "twoWeeks" ? 14 : 30));
                  setBaseDate(d);
                }}
              >
                ←
              </button>
              <button onClick={() => setBaseDate(new Date())}>今日</button>
              <button
                onClick={() => {
                  const d = new Date(baseDate);
                  d.setDate(d.getDate() + (mode === "week" ? 7 : mode === "twoWeeks" ? 14 : 30));
                  setBaseDate(d);
                }}
              >
                →
              </button>
            </div>

            {(mode === "week" || mode === "twoWeeks") && (
              <>
                <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>共有未割当プール基準日</span>
                  <input type="date" value={poolDay} onChange={(e) => setPoolDay(e.target.value)} />
                </div>

                <div style={{ background: "#f3f4f6", borderRadius: 8, padding: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>未割当 職人（共有）</div>
                  <DropArea id={`unassignWorker:${poolDay}:_`} style={{ minHeight: 40 }}>
                    {unassignedWorkers.map((w) => (
                      <DraggableChip
                        key={w.id}
                        id={`poolWorker:${w.id}`}
                        style={chip}
                        title={w.name || ""}
                      >
                        👷 {w.name || w.id}
                      </DraggableChip>
                    ))}
                  </DropArea>
                </div>

                <div style={{ background: "#f3f4f6", borderRadius: 8, padding: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>未割当 トラック（共有）</div>
                  <DropArea id={`unassignTruck:${poolDay}:_`} style={{ minHeight: 40 }}>
                    {unassignedTrucks.map((t) => (
                      <DraggableChip key={t.id} id={`poolTruck:${t.id}`} style={chip}>
                        🚚 {t.name || t.id}
                      </DraggableChip>
                    ))}
                  </DropArea>
                </div>

                <div style={{ background: "#f3f4f6", borderRadius: 8, padding: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>未割当 備品（共有）</div>
                  <DropArea id={`unassignEquipment:${poolDay}:_`} style={{ minHeight: 40 }}>
                    {unassignedEquipments.map((x) => (
                      <DraggableChip key={x.id} id={`poolEquipment:${x.id}`} style={chip}>
                        🧰 {x.name || x.id}{x.category ? `（${x.category}）` : ""}
                      </DraggableChip>
                    ))}
                  </DropArea>
                </div>

                <div style={{ background: "#f3f4f6", borderRadius: 8, padding: 8, marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>未割当 現場（共有）</div>
                  <DropArea id={`unassignSite:${poolDay}:_`} style={{ minHeight: 40 }}>
                    {unassignedSites.map((site) => (
                      <DraggableChip key={site.id} id={`poolSite:${site.id}`} style={chip}>
                        🏗 {siteLabel(site, site.id)}
                      </DraggableChip>
                    ))}
                  </DropArea>
                </div>

                <div style={{ display: "flex", gap: 10, overflowX: "auto", border: "2px solid #111", padding: 8 }}>
                  {days.map((day) => {
                    const slots = getDaySlots(day);
                    const dailyUnassignedWorkers = unassignedForDay(day, "worker");
                    const dailyUnassignedTrucks = unassignedForDay(day, "truck");
                    const dailyUnassignedEtcCards = unassignedForDay(day, "etc_card");
                    const dailyUnassignedEquipments = unassignedForDay(day, "equipment");

                    return (
                      <div key={day} style={{ minWidth: 360, background: day === todayKey ? "#eff6ff" : "#fafafa", padding: 8, borderRadius: 8 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>📅 {day}</div>

                        <div style={{ background: "#eef2f7", borderRadius: 8, padding: 6, marginBottom: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>日別未割当（見える化）</div>

                          <div style={{ fontSize: 11, marginBottom: 3 }}>職人:</div>
                          <div style={{ marginBottom: 4 }}>
                            {dailyUnassignedWorkers.length === 0 ? (
                              <span style={{ fontSize: 11, color: "#6b7280" }}>なし</span>
                            ) : (
                              dailyUnassignedWorkers.map((w) => (
                                <DraggableChip key={`dw-${day}-${w.id}`} id={`dayWorker:${day}:${w.id}`} style={chip}>
                                  👷 {w.name || w.id}
                                </DraggableChip>
                              ))
                            )}
                          </div>

                          <div style={{ fontSize: 11, marginBottom: 3 }}>トラック:</div>
                          <div style={{ marginBottom: 4 }}>
                            {dailyUnassignedTrucks.length === 0 ? (
                              <span style={{ fontSize: 11, color: "#6b7280" }}>なし</span>
                            ) : (
                              dailyUnassignedTrucks.map((t) => (
                                <DraggableChip key={`dt-${day}-${t.id}`} id={`dayTruck:${day}:${t.id}`} style={chip}>
                                  🚚 {t.name || t.id}
                                </DraggableChip>
                              ))
                            )}
                          </div>


                          <div style={{ fontSize: 11, marginBottom: 3 }}>備品:</div>
                          <div>
                            {dailyUnassignedEquipments.length === 0 ? (
                              <span style={{ fontSize: 11, color: "#6b7280" }}>なし</span>
                            ) : (
                              dailyUnassignedEquipments.map((x) => (
                                <DraggableChip key={`dq-${day}-${x.id}`} id={`dayEquipment:${day}:${x.id}`} style={chip}>
                                  🧰 {x.name || x.id}{x.category ? `（${x.category}）` : ""}
                                </DraggableChip>
                              ))
                            )}
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                          <button onClick={() => createTeamForDay(day)}>班作成</button>
                        </div>

                        {slots.map((slot) => {
                          const workerRows = slot.workerRows;
                          const truckRows = slot.truckRows;
                          const equipmentRows = slot.equipmentRows;
                          const siteRows = slot.siteRows;

                          return (
                            <div key={`${day}-${slot.team_id}`} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, padding: 8, marginBottom: 8 }}>
                              <div style={{ fontWeight: 700, marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span>班: {slot.team_id}</span>
                                <button
                                  type="button"
                                  onClick={() => deleteTeam(day, slot.team_id)}
                                  style={{ fontSize: 12, background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 6, padding: "4px 8px" }}
                                >
                                  削除
                                </button>
                              </div>

                              <DropArea id={`teamSite:${day}:${slot.team_id}`} style={{ minHeight: 44, borderTop: "1px dashed #d1d5db", paddingTop: 6, marginBottom: 6 }}>
                                <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 700 }}>現場（縦順）</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {siteRows.map((r) => {
                                    const site = activeSites.find((s) => s.id === r.site_id) || sites.find((s) => s.id === r.site_id);
                                    const dayPhase = getSiteDay(day, r.site_id);

                                    return (
                                      <DropArea key={r.id} id={`sitePos:${day}:${slot.team_id}:${r.id}`} style={{ padding: 0 }}>
                                        <div style={{ border: "1px solid #fcd34d", borderRadius: 8, background: "#fffdf5", padding: 6 }}>

<div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
  <DraggableChip id={`rowSite:${r.id}:${r.site_id}`} style={{ ...chip }}>
    ↕
  </DraggableChip>

  <span style={{ width: 10, height: 10, borderRadius: 999, background: phaseColor(dayPhase?.phase_type), marginTop: 3 }} />

  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
    <strong style={{ fontSize: 12, lineHeight: 1.2, wordBreak: "break-word" }}>
      {[site?.site_number, site?.customer_name, site?.site_name].filter(Boolean).join(" ") || site?.name || r.site_id}
    </strong>

    <span style={{ fontSize: 10, color: "#6b7280", lineHeight: 1.2 }}>
      {site?.address || ""}{site?.memo ? `  📝 ${String(site.memo).slice(0, 24)}` : ""}
    </span>
  </div>
</div>

                                          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                                            <span style={{ fontSize: 11, color: "#374151" }}>💬 {String(dayPhase?.note || "").slice(0, 28) || "（日別メモなし）"}</span>
                                            <button
                                              type="button"
                                              style={{ fontSize: 10 }}
                                              onClick={() => {
                                                const k = `${day}_${r.site_id}`;
                                                setEditingSiteNoteKey(k);
                                                setSiteNoteDrafts({ ...siteNoteDrafts, [k]: dayPhase?.note || "" });
                                              }}
                                            >
                                              編集
                                            </button>
                                          </div>

                                          {editingSiteNoteKey === `${day}_${r.site_id}` && (
                                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                                              <input
                                                value={siteNoteDrafts[`${day}_${r.site_id}`] ?? ""}
                                                onChange={(e) => setSiteNoteDrafts({ ...siteNoteDrafts, [`${day}_${r.site_id}`]: e.target.value })}
                                                onBlur={async () => {
                                                  if (suppressNoteBlurSaveRef.current) {
                                                    suppressNoteBlurSaveRef.current = false;
                                                    return;
                                                  }
                                                  const k = `${day}_${r.site_id}`;
                                                  await setSiteDayNote(day, r.site_id, siteNoteDrafts[k] || "");
                                                }}
                                                placeholder="日別コメント"
                                                style={{ flex: 1, minWidth: 140 }}
                                              />
                                              <button
                                                type="button"
                                                style={{ fontSize: 10 }}
                                                onMouseDown={() => {
                                                  suppressNoteBlurSaveRef.current = true;
                                                }}
                                                onClick={async () => {
                                                  const k = `${day}_${r.site_id}`;
                                                  await setSiteDayNote(day, r.site_id, siteNoteDrafts[k] || "");
                                                  setEditingSiteNoteKey("");
                                                }}
                                              >
                                                保存
                                              </button>
                                            </div>
                                          )}

                                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
<label style={{ fontSize: 11 }}>
  工程
  <select value={dayPhase?.phase_type || ""} onChange={(e) => setSiteDayPhase(day, r.site_id, e.target.value)}>
    <option value="">未設定</option>
    <option value="green">Lead</option>
    <option value="blue">架</option>
    <option value="yellow">追加</option>
    <option value="red">払</option>
  </select>
</label>

<label style={{ fontSize: 11 }}>
  状態
  <select value={r.status || "unset"} onChange={(e) => updateSiteStatus(r.id, e.target.value)}>
    <option value="unset">unset</option>
    <option value="incomplete">incomplete</option>
    <option value="complete">complete</option>
  </select>
</label>

<label style={{ fontSize: 11 }}>
  予定 <input type="time" step={300} defaultValue={r.planned_in || ""} onBlur={(e) => updateSiteTime(r.id, { planned_in: e.target.value })} />
</label>

<label style={{ fontSize: 11 }}>
  IN <input type="time" step={300} defaultValue={r.actual_in || ""} onBlur={(e) => updateSiteTime(r.id, { actual_in: e.target.value })} />
</label>
<button type="button" style={{ fontSize: 11 }} onClick={() => updateSiteTime(r.id, { actual_in: nowTime() })}>IN</button>

<label style={{ fontSize: 11 }}>
  OUT <input type="time" step={300} defaultValue={r.actual_out || ""} onBlur={(e) => updateSiteTime(r.id, { actual_out: e.target.value })} />
</label>
<button type="button" style={{ fontSize: 11 }} onClick={() => updateSiteTime(r.id, { actual_out: nowTime() })}>OUT</button>

<button type="button" style={{ fontSize: 11, fontWeight: 700 }} onClick={() => updateSiteStatus(r.id, "complete")}>完了</button>
                                            {r.done_at ? (
                                              <span style={{ fontSize: 10, color: "#6b7280" }}>
                                                done: {String(r.done_at).slice(0, 16).replace("T", " ")}
                                              </span>
                                            ) : null}
                                          </div>
                                        </div>
                                      </DropArea>
                                    );
                                  })}
                                </div>
                              </DropArea>

                              <DropArea id={`teamWorker:${day}:${slot.team_id}`} style={{ minHeight: 36, borderTop: "1px dashed #d1d5db", paddingTop: 6 }}>
                                <div style={{ fontSize: 12, marginBottom: 4 }}>職人</div>
                                {workerRows.map((r) => {
                                  const w = activeWorkers.find((x) => x.id === r.worker_id) || workers.find((x) => x.id === r.worker_id);
                                  return (
                                    <DraggableChip key={r.id} id={`rowWorker:${r.id}:${r.worker_id}`} style={chip}>
                                      👷 {w?.name || r.worker_id}
                                    </DraggableChip>
                                  );
                                })}
                              </DropArea>

                              <DropArea id={`teamTruck:${day}:${slot.team_id}`} style={{ minHeight: 36, borderTop: "1px dashed #d1d5db", paddingTop: 6, marginTop: 6 }}>
                                <div style={{ fontSize: 12, marginBottom: 4 }}>トラック</div>
                                {truckRows.map((r) => {
                                  const t = activeTrucks.find((x) => x.id === r.truck_id) || trucks.find((x) => x.id === r.truck_id);
                                  return (
                                    <DraggableChip key={r.id} id={`rowTruck:${r.id}:${r.truck_id}`} style={chip}>
                                      🚚 {t?.name || r.truck_id}
                                    </DraggableChip>
                                  );
                                })}
                              </DropArea>

                              <DropArea id={`teamEquipment:${day}:${slot.team_id}`} style={{ minHeight: 36, borderTop: "1px dashed #d1d5db", paddingTop: 6, marginTop: 6 }}>
                                <div style={{ fontSize: 12, marginBottom: 4 }}>備品</div>
                                {equipmentRows.map((r) => {
                                  const t = activeEquipments.find((x) => x.id === r.equipment_id) || equipments.find((x) => x.id === r.equipment_id);
                                  return (
                                    <DraggableChip key={r.id} id={`rowEquipment:${r.id}:${r.equipment_id}`} style={chip}>
                                      🧰 {t?.name || r.equipment_id}{t?.category ? `（${t.category}）` : ""}
                                    </DraggableChip>
                                  );
                                })}
                              </DropArea>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {mode === "month" && (
              <div>
                <h2>月間ビュー（読み取り専用）</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(120px,1fr))", gap: 6 }}>
                  {monthCells.map((c) => {
                    const daySites = assignments.filter((a) => a.date === c.key && a.site_id);
                    const phaseBars = phases.filter((p) => p.start_date <= c.key && p.end_date >= c.key);
                    return (
                      <div key={c.key} style={{ minHeight: 90, border: "1px solid #ddd", background: c.inMonth ? "#fff" : "#f3f4f6", padding: 6 }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>{c.m}/{c.day}</div>
                        {daySites.slice(0, 3).map((a) => {
                          const site = activeSites.find((s) => s.id === a.site_id) || sites.find((s) => s.id === a.site_id);
                          return <div key={a.id} style={{ fontSize: 11 }}>🏗 {siteLabel(site, a.site_id)}</div>;
                        })}
                        {phaseBars.slice(0, 2).map((p) => (
                          <div key={p.id} style={{ fontSize: 10, background: "#fef3c7", marginTop: 2, borderRadius: 4, padding: "1px 4px" }}>
                            {p.phase_type || "工程"}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <p style={{ color: "#6b7280", fontSize: 12 }}>※ 月間ビューは編集不可（ドラッグ＆ドロップ無効）</p>
              </div>
            )}
          </>
        )}
      </div>
    </DndContext>
  );
}