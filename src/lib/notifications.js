const NOTIFICATION_HOURS = [10, 12, 14, 16, 18, 20, 22, 24];
let timers = [];

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function showMealReminder(hour) {
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification("Meal Tracker", {
        body: `Add your meals now for tracking!`,
        tag: `meal-reminder-${hour}`,
        renotify: true,
        requireInteraction: false,
      });
    });
  } else if (
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    new Notification("Meal Tracker", {
      body: `Add your meals now for tracking!`,
      tag: `meal-reminder-${hour}`,
    });
  }
}

export function scheduleNotifications() {
  timers.forEach(clearTimeout);
  timers = [];
  const now = new Date();
  NOTIFICATION_HOURS.forEach((hour) => {
    const target = new Date();
    target.setHours(hour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const delay = target.getTime() - now.getTime();
    timers.push(
      setTimeout(() => {
        showMealReminder(hour);
        scheduleNotifications();
      }, delay)
    );
  });
}

export async function initNotifications() {
  const granted = await requestNotificationPermission();
  if (granted) scheduleNotifications();
}
