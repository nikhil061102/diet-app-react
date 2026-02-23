const DB_NAME = "MealTrackerDB";
const DB_VERSION = 1;
const STORE_NAME = "meals";

let db = null;

export function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("type", "type", { unique: false });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) =>
      reject(new Error("Failed to open database: " + e.target.error));
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function compressImage(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width,
          height = img.height;
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error("Failed to compress image")),
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function addMeal(meal) {
  const database = await openDB();
  const compressedImages = [];
  for (const img of meal.images || []) {
    compressedImages.push(await compressImage(img));
  }
  const record = {
    id: generateId(),
    type: meal.type || "snack",
    notes: meal.notes || "",
    images: compressedImages,
    timestamp: Date.now(),
    date: meal.date || new Date().toISOString().split("T")[0],
  };
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).add(record);
    request.onsuccess = () => resolve(record);
    request.onerror = (e) =>
      reject(new Error("Failed to add meal: " + e.target.error));
  });
}

export async function updateMeal(meal) {
  const database = await openDB();
  const existing = await getMeal(meal.id);
  if (!existing) throw new Error("Meal not found");
  const processedImages = [];
  for (const img of meal.images || []) {
    processedImages.push(img instanceof File ? await compressImage(img) : img);
  }
  const updated = {
    ...existing,
    type: meal.type !== undefined ? meal.type : existing.type,
    notes: meal.notes !== undefined ? meal.notes : existing.notes,
    images: processedImages,
    date: meal.date || existing.date,
  };
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).put(updated);
    request.onsuccess = () => resolve(updated);
    request.onerror = (e) =>
      reject(new Error("Failed to update meal: " + e.target.error));
  });
}

export async function getMeal(id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) =>
      reject(new Error("Failed to get meal: " + e.target.error));
  });
}

export async function getMealsByDate(dateStr) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).index("date").getAll(dateStr);
    request.onsuccess = () => {
      const meals = request.result || [];
      meals.sort((a, b) => b.timestamp - a.timestamp);
      resolve(meals);
    };
    request.onerror = (e) =>
      reject(new Error("Failed to get meals: " + e.target.error));
  });
}

export async function getMealsInRange(startDate, endDate) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const range = IDBKeyRange.bound(startDate, endDate);
    const request = tx.objectStore(STORE_NAME).index("date").getAll(range);
    request.onsuccess = () => {
      const meals = request.result || [];
      meals.sort((a, b) => b.timestamp - a.timestamp);
      resolve(meals);
    };
    request.onerror = (e) =>
      reject(new Error("Failed to get meals: " + e.target.error));
  });
}

export async function deleteMeal(id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => resolve(true);
    request.onerror = (e) =>
      reject(new Error("Failed to delete meal: " + e.target.error));
  });
}

export async function getAllMeals() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) =>
      reject(new Error("Failed to get all meals: " + e.target.error));
  });
}

export async function getDatesWithMeals(startDate, endDate) {
  const meals = await getMealsInRange(startDate, endDate);
  return new Set(meals.map((m) => m.date));
}

export function blobToURL(blob) {
  return URL.createObjectURL(blob);
}
export function revokeURL(url) {
  URL.revokeObjectURL(url);
}
