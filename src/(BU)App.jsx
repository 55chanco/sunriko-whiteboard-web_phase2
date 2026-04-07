import { useEffect, useState, useRef } from "react";
import { db } from "./firebase";
import {
  collection,
  getDocs,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  doc,
  deleteDoc,
  updateDoc,
} from "firebase/firestore";

export default function App() {
  // --- base lists ---
  const [sites, setSites] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  const [baseDate, setBaseDate] = useState(new Date());

  const [editingId, setEditingId] = useState(null);

  const [teamLabel, setTeamLabel] = useState("");

  const [notice, setNotice] = useState("");


  // --- selections for assignment ---
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [assignDate, setAssignDate] = useState(""); // 例: "2026-02-23"

  // --- assignments list ---
  const [assignments, setAssignments] = useState([]);

  const [warning, setWarning] = useState("");

  // --- ui states ---
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const formTopRef = useRef(null);


  // -------- load functions --------
  async function loadSites() {
    const snap = await getDocs(collection(db, "sites"));
    setSites(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  async function loadWorkers() {
    const snap = await getDocs(collection(db, "workers"));
    setWorkers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  async function loadVehicles() {
    const snap = await getDocs(collection(db, "vehicles"));
    setVehicles(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  async function loadAssignments() {
  const snap = await getDocs(collection(db, "assignments"));
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log("ASSIGNMENTS:", data);
  setAssignments(data);
  }

  async function handleDelete(id) {
  const ok = window.confirm("削除しますか？");
  if (!ok) return;

  await deleteDoc(doc(db, "assignments", id));
}

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");
        await Promise.all([loadSites(), loadWorkers(), loadVehicles(), loadAssignments()]);
      } catch (e) {
        console.error(e);
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // -------- add assignment (ここがスコープの本丸) --------

async function updateAssignment() {
  try {
    setLoading(true);
    setError("");

    if (!editingId) return;

    await updateDoc(doc(db, "assignments", editingId), {
      siteId: selectedSiteId,
      workerId: selectedWorkerId,
      vehicleId: selectedVehicleId || "",
      date: assignDate,
      team: teamLabel || "",
    });

    setEditingId(null);
    await loadAssignments();
  } catch (e) {
    console.error(e);
    setError(String(e?.message || e));
  } finally {
    setLoading(false);
  }
}


async function deleteAssignment(id) {
  try {
    const ok = window.confirm("この配備を削除しますか？");
    if (!ok) return;

    setLoading(true);
    setError("");
    await deleteDoc(doc(db, "assignments", id));
    await loadAssignments();
  } catch (e) {
    console.error(e);
    setError(String(e?.message || e));
  } finally {
    setLoading(false);
  }
}
async function addAssignment() {
  try {
    setLoading(true);
    setError("");
    setWarning(""); // ★追加（warning表示用）

    // ★ここがガード（必須チェック）
    if (!selectedSiteId || !selectedWorkerId || !assignDate) {
      throw new Error("現場・職人・日付は必須だよ（未選択があります）");
    }

    // ★ガードの直後：警告だけ出す（保存は止めない）
const alreadyAssigned = assignments.some(
  (a) => a.workerId === selectedWorkerId && a.date === assignDate
);

if (alreadyAssigned) {
  setWarning("⚠ 同日に同じ職人がいます");
  setTimeout(() => {
    setWarning("");
  }, 2500);
}

    const payload = {
      siteId: selectedSiteId,
      workerId: selectedWorkerId,
      vehicleId: selectedVehicleId || "",
      date: assignDate,
      createdAt: serverTimestamp(),
      team: teamLabel || "",

    };

    await addDoc(collection(db, "assignments"), payload);
    await loadAssignments();

    setSelectedWorkerId("");
    setSelectedVehicleId("");
  } catch (e) {
    console.error(e);
    setError(String(e?.message || e));
  } finally {
    setLoading(false);
  }
}


const grouped = assignments.reduce((acc, a) => {
  const key = a.date || "日付未設定";
  acc[key] = acc[key] || [];
  acc[key].push(a);
  return acc;
}, {});

const days = Array.from({ length: 14 }).map((_, i) => {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + i - 7); // ← ここがミソ
  return d.toISOString().slice(0, 10);
});

  return (
    <div style={{ padding: 16 }}>
      <h1>現場管理ボード（LOG版）</h1>

      {notice && (
        <div className="notice">
      {notice}
        </div>
      )}

      {loading && (
        <div style={{ padding: 12, background: "#fff3cd", borderRadius: 8, marginBottom: 12 }}>
          読み込み中...
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: "#f8d7da", borderRadius: 8, marginBottom: 12 }}>
          <b>エラー:</b> {error}
        </div>
      )}

      {warning && (
        <div style={{ padding: 12, background: "#cff4fc", borderRadius: 8, marginBottom: 12 }}>
          <b>注意:</b> {warning}
        </div>
      )}


      <h2 ref={formTopRef}>配備を追加</h2>

      <div
  style={{
    display: "grid",
    gap: 8,
    maxWidth: 520,
    background: editingId ? "#fff7ed" : "transparent",
    padding: editingId ? 12 : 0,
    borderRadius: 10,
    transition: "all 0.2s ease",
  }}
>
        <label>
          現場:
          <select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)}>
            <option value="">選択</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.siteName || s.id}
              </option>
            ))}
          </select>
        </label>

        <label>
          職人:
          <select value={selectedWorkerId} onChange={(e) => setSelectedWorkerId(e.target.value)}>
            <option value="">選択</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name || w.workerName || w.id}
              </option>
            ))}
          </select>
        </label>

<label>
  班ラベル（任意）:
  <input
    value={teamLabel}
    onChange={(e) => setTeamLabel(e.target.value)}
    placeholder="例: 1班 / A班 / 応援"
  />
</label>

        <label>
          トラック:
          <select value={selectedVehicleId} onChange={(e) => setSelectedVehicleId(e.target.value)}>
            <option value="">（任意）</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name || v.vehicleName || v.id}
              </option>
            ))}
          </select>
        </label>

        <label>
          日付:
          <input type="date" value={assignDate} onChange={(e) => setAssignDate(e.target.value)} />
        </label>

  <button
  onClick={editingId ? updateAssignment : addAssignment}
  >
  {editingId ? "✏️ 更新する" : "配備を追加"}
  </button>

      </div>

<h2 style={{ marginTop: 24 }}>配備一覧（2週間）</h2>

<div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
  <button
    onClick={() => {
      const d = new Date(baseDate);
      d.setDate(d.getDate() - 14);
      setBaseDate(d);
    }}
  >
    ← 前の2週間
  </button>

  <button
    onClick={() => setBaseDate(new Date())}
  >
    今日へ戻る
  </button>

  <button
    onClick={() => {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + 14);
      setBaseDate(d);
    }}
  >
    次の2週間 →
  </button>
</div>


<div
  style={{
    display: "flex",
    gap: 16,
    overflowX: "auto",
    paddingBottom: 8,
  }}
>
{days.map((date) => {
const items = (grouped[date] || []).slice().sort((a, b) => {
  const teamA = a.team || "";
  const teamB = b.team || "";

  // ① まず班で並べる
  const teamCompare = teamA.localeCompare(teamB, "ja");
  if (teamCompare !== 0) return teamCompare;

  // ② 同じ班なら職人名順
  const wa = workers.find((w) => w.id === a.workerId)?.name || "";
  const wb = workers.find((w) => w.id === b.workerId)?.name || "";
  return wa.localeCompare(wb, "ja");
});

  const today = new Date().toISOString().slice(0, 10);
  const isToday = date === today;
  const w = new Date(date).getDay(); // 0=日,1=月,...6=土
  const jpWeek = ["日", "月", "火", "水", "木", "金", "土"][w];
  const dayOfWeek = new Date(date).getDay(); // 0=日曜, 6=土曜
  const isSunday = dayOfWeek === 0;
  const isSaturday = dayOfWeek === 6;

  return (
<div
  key={date}
  style={{
    minWidth: 220,
    background: isToday
      ? "#eef6ff"
      : isSunday
      ? "#fff1f2"
      : isSaturday
      ? "#f0f9ff"
      : "#f9fafb",
    border: isToday ? "2px solid #93c5fd" : "1px solid transparent",
    borderRadius: 10,
    padding: 12,
    boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
  }}
>
<h3 style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
<span>
  📅 {date}{" "}
  <span style={{ color: "#6b7280", fontSize: 12 }}>
    （{jpWeek}）{isToday ? "・今日" : ""}
  </span>
</span>

  <span
    style={{
      background: "#e5e7eb",
      borderRadius: 12,
      padding: "2px 8px",
      fontSize: 12,
      fontWeight: 600,
    }}
  >
    {items.length}人
  </span>
</h3>

  <button
    onClick={() => {
      setAssignDate(date);
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }}
    style={{
      width: "100%",
      marginBottom: 10,
      padding: "6px 10px",
      borderRadius: 8,
      border: "1px solid #ddd",
      background: "white",
      cursor: "pointer",
    }}
  >
    この日に追加する
  </button>


        {items.length === 0 ? (
          <div style={{ color: "#aaa" }}>（配備なし）</div>
        ) : (
          items.map((a) => {
            const worker = workers.find((w) => w.id === a.workerId);
            const vehicle = vehicles.find((v) => v.id === a.vehicleId);
            const site = sites.find((s) => s.id === a.siteId);
            const isEditing = editingId === a.id;


            return (
              <div
  key={a.id}
  style={{
    background: "white",
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
    outline: isEditing ? "2px solid #fb923c" : "1px solid #e5e7eb",
    boxShadow: isEditing ? "0 0 0 4px rgba(251,146,60,0.15)" : "none",
  }}>

  {a.team && (
    <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>
      🏷 {a.team}
    </div>
  )}
                <div>🏗 {site?.name || "不明"}</div>
                <div>👷 {worker?.name || "不明"}</div>
                <div>
  🚚{" "}
  {vehicle
    ? `${vehicle.owner} / ${vehicle.type} / ${vehicle.plateNo}`
    : "なし"}

  {vehicle?.etcNo && (
    <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 6 }}>
      （ETC: {vehicle.etcNo}）
    </span>
  )}
</div>

                <button
                  onClick={() => {
                  setSelectedSiteId(a.siteId);
                  setSelectedWorkerId(a.workerId);
                  setSelectedVehicleId(a.vehicleId || "");
                  setAssignDate(a.date);
                  setEditingId(a.id);
                  setTeamLabel(a.team || "");
                  formTopRef.current?.scrollIntoView({ behavior: "smooth" });
                  }}
                    style={{ marginLeft: 6 }}
                >
                  編集
                </button>


              </div>
            );
          })
        )}
      </div>
    );
  })}
</div>

</div>
  );
}