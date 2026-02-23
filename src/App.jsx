import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  getWeekStart,
  formatDate,
  getDayName,
  getMonthName,
  isToday,
  getWeekDates,
  getWeekEnd,
  formatTime,
  formatFullDate,
  getMealEmoji,
} from "./lib/helpers";
import {
  openDB,
  addMeal,
  updateMeal,
  deleteMeal,
  getMealsByDate,
  getAllMeals,
  getDatesWithMeals,
  blobToURL,
  revokeURL,
} from "./lib/mealDB";
import { initNotifications, sendTestNotification } from "./lib/notifications";

export default function App() {
  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    getWeekStart(new Date())
  );
  const [selectedDate, setSelectedDate] = useState(() =>
    formatDate(new Date())
  );
  const [meals, setMeals] = useState([]);
  const [datesWithMeals, setDatesWithMeals] = useState(new Set());
  const [dbReady, setDbReady] = useState(false);
  const [toast, setToast] = useState(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState("");

  // Add/Edit form
  const [editingMeal, setEditingMeal] = useState(null);
  const [mealType, setMealType] = useState("lunch");
  const [mealNotes, setMealNotes] = useState("");
  const [pendingImages, setPendingImages] = useState([]);
  const fileInputRef = useRef(null);

  // View modal
  const [viewMeal, setViewMeal] = useState(null);

  // History
  const [historyData, setHistoryData] = useState([]);

  // Object URLs tracking
  const toastTimer = useRef(null);

  function showToastMsg(msg) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  const loadMeals = useCallback(async () => {
    const m = await getMealsByDate(selectedDate);
    setMeals(m);
  }, [selectedDate]);

  const loadWeekDots = useCallback(async () => {
    const startStr = formatDate(currentWeekStart);
    const endStr = formatDate(getWeekEnd(currentWeekStart));
    const dots = await getDatesWithMeals(startStr, endStr);
    setDatesWithMeals(dots);
  }, [currentWeekStart]);

  const closeAddModal = useCallback(() => {
    setShowAddModal(false);
    pendingImages.forEach((item) => {
      if (item.file instanceof File) URL.revokeObjectURL(item.url);
    });
    setPendingImages([]);
    setEditingMeal(null);
  }, [pendingImages]);

  // Init DB
  useEffect(() => {
    openDB().then(() => {
      setDbReady(true);
      initNotifications();
    });
  }, []);

  // Load meals when date or db changes
  useEffect(() => {
    if (!dbReady) return;
    let cancelled = false;
    getMealsByDate(selectedDate).then((m) => {
      if (!cancelled) setMeals(m);
    });
    const startStr = formatDate(currentWeekStart);
    const endStr = formatDate(getWeekEnd(currentWeekStart));
    getDatesWithMeals(startStr, endStr).then((dots) => {
      if (!cancelled) setDatesWithMeals(dots);
    });
    return () => { cancelled = true; };
  }, [selectedDate, dbReady, currentWeekStart]);


  // Keyboard escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        if (showLightbox) setShowLightbox(false);
        else if (showViewModal) setShowViewModal(false);
        else if (showAddModal) closeAddModal();
        else if (showHistoryModal) setShowHistoryModal(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showLightbox, showViewModal, showAddModal, showHistoryModal, closeAddModal]);

  // Week navigation
  const weekDates = getWeekDates(currentWeekStart);
  const weekEnd = getWeekEnd(currentWeekStart);
  const startMonth = getMonthName(currentWeekStart);
  const endMonth = getMonthName(weekEnd);
  let weekLabel = `${startMonth} ${currentWeekStart.getDate()} – `;
  weekLabel +=
    startMonth !== endMonth
      ? `${endMonth} ${weekEnd.getDate()}, ${currentWeekStart.getFullYear()}`
      : `${weekEnd.getDate()}, ${currentWeekStart.getFullYear()}`;

  function prevWeek() {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() - 7);
    setCurrentWeekStart(d);
    setSelectedDate(formatDate(d));
  }

  function nextWeek() {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + 7);
    setCurrentWeekStart(d);
    setSelectedDate(formatDate(d));
  }

  // Add/Edit modal
  function openAdd() {
    setEditingMeal(null);
    setMealType("lunch");
    setMealNotes("");
    clearPendingImages();
    setShowAddModal(true);
  }

  function openEdit(meal) {
    setEditingMeal(meal);
    setMealType(meal.type);
    setMealNotes(meal.notes || "");
    const imgs = (meal.images || []).map((blob) => ({
      file: blob,
      url: blobToURL(blob),
    }));
    setPendingImages(imgs);
    setShowAddModal(true);
    setShowViewModal(false);
  }

  function clearPendingImages() {
    pendingImages.forEach((item) => {
      if (item.file instanceof File) URL.revokeObjectURL(item.url);
    });
    setPendingImages([]);
  }

  function handleImageSelect(e) {
    const files = Array.from(e.target.files);
    const remaining = 5 - pendingImages.length;
    const toAdd = files.slice(0, remaining);
    const newItems = toAdd.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setPendingImages((prev) => [...prev, ...newItems]);
    if (files.length > remaining)
      showToastMsg(`Only ${remaining} more photo(s) allowed`);
    e.target.value = "";
  }

  function removePendingImage(index) {
    setPendingImages((prev) => {
      const item = prev[index];
      if (item.file instanceof File) URL.revokeObjectURL(item.url);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSave(e) {
    e.preventDefault();
    const images = pendingImages.map((item) => item.file);
    if (!mealNotes.trim() && images.length === 0) {
      showToastMsg("Add some notes or a photo");
      return;
    }
    try {
      if (editingMeal) {
        await updateMeal({
          id: editingMeal.id,
          type: mealType,
          notes: mealNotes.trim(),
          images,
          date: selectedDate,
        });
        showToastMsg("Meal updated");
      } else {
        await addMeal({
          type: mealType,
          notes: mealNotes.trim(),
          images,
          date: selectedDate,
        });
        showToastMsg("Meal saved");
      }
      closeAddModal();
      loadMeals();
      loadWeekDots();
    } catch (err) {
      console.error("Save error:", err);
      showToastMsg("Failed to save meal");
    }
  }

  // View modal
  function openView(meal) {
    setViewMeal(meal);
    setShowViewModal(true);
  }

  async function handleDelete() {
    if (!viewMeal || !confirm("Delete this meal?")) return;
    await deleteMeal(viewMeal.id);
    setShowViewModal(false);
    setViewMeal(null);
    loadMeals();
    loadWeekDots();
    showToastMsg("Meal deleted");
  }

  // Lightbox
  function openLightboxFn(url) {
    setLightboxUrl(url);
    setShowLightbox(true);
  }

  // History
  async function openHistory() {
    const all = await getAllMeals();
    if (all.length === 0) {
      setHistoryData([]);
      setShowHistoryModal(true);
      return;
    }
    const grouped = {};
    all.forEach((meal) => {
      if (!grouped[meal.date]) grouped[meal.date] = [];
      grouped[meal.date].push(meal);
    });
    const sorted = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
    const data = [];
    let currentMonth = "";
    sorted.forEach((dateStr) => {
      const dateObj = new Date(dateStr + "T12:00:00");
      const monthKey = dateObj.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
      if (monthKey !== currentMonth) {
        currentMonth = monthKey;
        data.push({ type: "month", label: monthKey });
      }
      const meals = grouped[dateStr].sort((a, b) => a.timestamp - b.timestamp);
      const dayLabel = isToday(dateObj)
        ? "Today"
        : dateObj.toLocaleDateString("en-US", {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
      data.push({
        type: "day",
        dateStr,
        dayLabel,
        isToday: isToday(dateObj),
        meals,
      });
    });
    setHistoryData(data);
    setShowHistoryModal(true);
  }

  function navigateToDate(dateStr) {
    setSelectedDate(dateStr);
    setCurrentWeekStart(getWeekStart(new Date(dateStr + "T12:00:00")));
    setShowHistoryModal(false);
  }

  // Register SW
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(import.meta.env.BASE_URL + "sw.js")
        .catch(() => {});
    }
  }, []);

  return (
    <div className="pb-24">
      {/* Header */}
      <header className="text-center pt-5 px-4 pb-2">
        <div className="flex items-center justify-center relative">
          <button
            onClick={async () => {
              const ok = await sendTestNotification();
              showToastMsg(ok ? "Test notification sent!" : "Notifications not allowed");
            }}
            className="absolute left-0 w-10 h-10 rounded-xl bg-white/8 flex items-center justify-center text-xl hover:bg-white/15 transition-colors"
            title="Test notification"
          >
            🔔
          </button>
          <h1 className="text-2xl font-bold tracking-tight">🍽️ Meal Tracker</h1>
          <button
            onClick={openHistory}
            className="absolute right-0 w-10 h-10 rounded-xl bg-white/8 flex items-center justify-center text-xl hover:bg-white/15 transition-colors"
          >
            📅
          </button>
        </div>
        <p className="text-text-muted text-sm mt-1">{weekLabel}</p>
      </header>

      {/* Week Nav */}
      <nav className="flex items-center gap-1 px-2 py-2 sticky top-0 z-10 bg-bg">
        <button
          onClick={prevWeek}
          className="text-text-muted p-2 rounded-lg hover:bg-border transition-colors shrink-0"
        >
          ◀
        </button>
        <div className="flex gap-1 overflow-x-auto flex-1 no-scrollbar">
          {weekDates.map((date) => {
            const dateStr = formatDate(date);
            const active = dateStr === selectedDate;
            const today = isToday(date);
            const hasMeals = datesWithMeals.has(dateStr);
            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(dateStr)}
                className={`flex flex-col items-center min-w-[48px] py-2 px-1 rounded-xl transition-all shrink-0
                  ${
                    active
                      ? "bg-accent text-white shadow-lg shadow-accent/30"
                      : "hover:bg-white/5"
                  }
                  ${today && !active ? "ring-1 ring-accent/50" : ""}`}
              >
                <span className="text-xs font-medium opacity-70">
                  {getDayName(date)}
                </span>
                <span className="text-base font-semibold">
                  {date.getDate()}
                </span>
                <span
                  className={`w-1.5 h-1.5 rounded-full mt-1 ${
                    hasMeals ? "bg-accent-light" : "bg-transparent"
                  }`}
                />
              </button>
            );
          })}
        </div>
        <button
          onClick={nextWeek}
          className="text-text-muted p-2 rounded-lg hover:bg-border transition-colors shrink-0"
        >
          ▶
        </button>
      </nav>

      {/* Meals List */}
      <main className="px-4 mt-2">
        {meals.length === 0 ? (
          <div className="text-center py-16 text-text-muted">
            <div className="text-5xl mb-3 opacity-50">📷</div>
            <p>No meals logged for this day</p>
            <p className="text-xs mt-2 opacity-60">
              Tap + to add your first meal
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {meals.map((meal, i) => (
              <MealCard
                key={meal.id}
                meal={meal}
                index={i}
                onClick={() => openView(meal)}
              />
            ))}
          </div>
        )}
      </main>

      {/* FAB */}
      <button
        onClick={openAdd}
        className="fixed bottom-6 right-5 w-15 h-15 rounded-full bg-accent text-white text-3xl font-light shadow-lg shadow-accent/50 z-20 flex items-center justify-center hover:scale-105 active:scale-92 transition-transform"
      >
        +
      </button>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <Modal onClose={closeAddModal}>
          <h2 className="text-lg font-semibold">
            {editingMeal ? "Edit Meal" : "Add Meal"}
          </h2>
          <form onSubmit={handleSave} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1.5">
                Meal Type
              </label>
              <select
                value={mealType}
                onChange={(e) => setMealType(e.target.value)}
                className="w-full p-3 rounded-xl border border-border bg-white/5 text-text outline-none focus:border-accent transition-colors appearance-none"
              >
                <option value="breakfast">🌅 Breakfast</option>
                <option value="lunch">☀️ Lunch</option>
                <option value="dinner">🌙 Dinner</option>
                <option value="snack">🍿 Snack</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1.5">
                Notes
              </label>
              <textarea
                value={mealNotes}
                onChange={(e) => setMealNotes(e.target.value)}
                placeholder="What did you eat?"
                rows={3}
                className="w-full p-3 rounded-xl border border-border bg-white/5 text-text outline-none focus:border-accent transition-colors resize-y font-[inherit]"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1.5">
                Photos (up to 5)
              </label>
              <div className="flex gap-2 flex-wrap mb-2">
                {pendingImages.map((item, i) => (
                  <div
                    key={i}
                    className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0"
                  >
                    <img
                      src={item.url}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePendingImage(i)}
                      className="absolute top-1 right-1 w-5.5 h-5.5 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              {pendingImages.length < 5 && (
                <label className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-dashed border-border text-text-muted cursor-pointer hover:border-accent hover:text-accent-light transition-colors text-sm">
                  <span>📷 Add Photo</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={handleImageSelect}
                  />
                </label>
              )}
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={closeAddModal}
                className="flex-1 py-3.5 rounded-xl bg-border text-text font-semibold hover:opacity-90 active:scale-[0.97] transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-3.5 rounded-xl bg-accent text-white font-semibold hover:opacity-90 active:scale-[0.97] transition-all"
              >
                Save Meal
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* View Modal */}
      {showViewModal && viewMeal && (
        <Modal onClose={() => setShowViewModal(false)}>
          <h2 className="text-lg font-semibold">
            {getMealEmoji(viewMeal.type)}{" "}
            {viewMeal.type.charAt(0).toUpperCase() + viewMeal.type.slice(1)}
          </h2>
          {viewMeal.images?.length > 0 && (
            <div className="flex gap-2 overflow-x-auto py-3 no-scrollbar">
              {viewMeal.images.map((blob, i) => (
                <BlobImage
                  key={i}
                  blob={blob}
                  alt="Meal photo"
                  className="h-48 rounded-xl object-cover shrink-0 cursor-pointer hover:scale-[0.97] active:scale-[0.97] transition-transform"
                  onClick={(url) => openLightboxFn(url)}
                />
              ))}
            </div>
          )}
          <p className="text-base leading-relaxed mt-3 whitespace-pre-wrap">
            {viewMeal.notes || "No notes"}
          </p>
          <p className="text-xs text-text-muted mt-2">
            {formatFullDate(viewMeal.date)} at {formatTime(viewMeal.timestamp)}
          </p>
          <div className="flex gap-2.5 mt-5">
            <button
              onClick={handleDelete}
              className="flex-1 py-3.5 rounded-xl bg-accent/15 text-accent-light font-semibold hover:opacity-90 active:scale-[0.97] transition-all"
            >
              Delete
            </button>
            <button
              onClick={() => openEdit(viewMeal)}
              className="flex-1 py-3.5 rounded-xl bg-accent text-white font-semibold hover:opacity-90 active:scale-[0.97] transition-all"
            >
              Edit
            </button>
          </div>
        </Modal>
      )}

      {/* History Modal */}
      {showHistoryModal && (
        <Modal onClose={() => setShowHistoryModal(false)}>
          <h2 className="text-lg font-semibold">📅 Meal History</h2>
          <div className="mt-3 max-h-[65dvh] overflow-y-auto space-y-0.5">
            {historyData.length === 0 ? (
              <p className="text-center py-10 text-text-muted">
                No meals logged yet
              </p>
            ) : (
              historyData.map((item, i) =>
                item.type === "month" ? (
                  <div
                    key={`m-${i}`}
                    className={`text-xs font-bold text-accent uppercase tracking-widest px-4 ${
                      i === 0 ? "pt-2 pb-2" : "pt-4 pb-2"
                    }`}
                  >
                    {item.label}
                  </div>
                ) : (
                  <button
                    key={item.dateStr}
                    onClick={() => navigateToDate(item.dateStr)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/4 hover:bg-white/8 transition-colors text-left"
                  >
                    <span
                      className={`font-semibold text-sm whitespace-nowrap ${
                        item.isToday ? "text-accent-light" : ""
                      }`}
                    >
                      {item.dayLabel}
                    </span>
                    <div className="flex flex-wrap gap-1.5 flex-1 justify-end">
                      {item.meals.map((m) => (
                        <span
                          key={m.id}
                          className="inline-flex items-center gap-1 bg-white/6 px-2.5 py-1 rounded-full text-[11px] text-text-muted whitespace-nowrap"
                        >
                          <span className="text-sm">
                            {getMealEmoji(m.type)}
                          </span>
                          {m.type} {formatTime(m.timestamp)}
                        </span>
                      ))}
                    </div>
                    <span className="text-text-muted text-xs opacity-50 shrink-0">
                      ▶
                    </span>
                  </button>
                )
              )
            )}
          </div>
        </Modal>
      )}

      {/* Lightbox */}
      {showLightbox && (
        <div
          className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center"
          onClick={() => setShowLightbox(false)}
        >
          <button
            onClick={() => setShowLightbox(false)}
            className="absolute top-4 right-4 bg-white/10 text-white text-2xl w-11 h-11 rounded-full flex items-center justify-center z-[201]"
          >
            ✕
          </button>
          <img
            src={lightboxUrl}
            alt="Full size"
            className="max-w-[95vw] max-h-[90dvh] object-contain rounded"
          />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-bg-card text-text px-6 py-3 rounded-full text-sm shadow-lg z-[300] animate-toast">
          {toast}
        </div>
      )}
    </div>
  );
}

// ========== Sub-components ==========

function Modal({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-bg-modal w-full max-w-[500px] max-h-[90dvh] rounded-t-2xl p-5 overflow-y-auto animate-slide-up">
        <div className="flex justify-between items-center mb-4">
          {children[0]}
          <button
            onClick={onClose}
            className="text-text-muted text-lg p-2 rounded-lg hover:bg-border transition-colors"
          >
            ✕
          </button>
        </div>
        {children.slice(1)}
      </div>
    </div>
  );
}

function MealCard({ meal, index, onClick }) {
  const images = meal.images || [];
  const count = images.length;
  const showCount = Math.min(count, 3);

  return (
    <div
      className="bg-bg-card rounded-xl overflow-hidden shadow-lg cursor-pointer hover:opacity-95 transition-opacity animate-fade-in"
      style={{ animationDelay: `${index * 0.05}s` }}
      onClick={onClick}
    >
      {count > 0 && (
        <div
          className={`grid gap-0.5 ${
            showCount === 1
              ? "grid-cols-1"
              : showCount === 2
              ? "grid-cols-2"
              : "grid-cols-3"
          }`}
        >
          {images.slice(0, showCount).map((blob, i) => {
            const isLast = i === showCount - 1 && count > 3;
            return (
              <div key={i} className="relative aspect-video">
                <BlobImage
                  blob={blob}
                  alt="Meal photo"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {isLast && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-lg font-semibold">
                    +{count - 2}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 bg-accent/15 text-accent-light text-xs font-semibold px-2.5 py-1 rounded-full">
            {getMealEmoji(meal.type)} {meal.type}
          </span>
          <span className="text-xs text-text-muted">
            {formatTime(meal.timestamp)}
          </span>
        </div>
        {meal.notes && (
          <p className="text-sm text-text mt-2 leading-relaxed line-clamp-2">
            {meal.notes}
          </p>
        )}
      </div>
    </div>
  );
}



function BlobImage({ blob, alt, className, onClick, loading }) {
  const url = useMemo(() => blobToURL(blob), [blob]);

  useEffect(() => {
    return () => revokeURL(url);
  }, [url]);

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading={loading}
      onClick={onClick ? () => onClick(url) : undefined}
    />
  );
}
