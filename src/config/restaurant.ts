export interface DayHours {
  day: string;
  shortDay: string;
  dayIndex: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  isOpen: boolean;
  openTime: string; // "10:00 AM"
  closeTime: string; // "9:00 PM"
  openHour24: number; // 10
  openMinute: number; // 0
  closeHour24: number; // 21
  closeMinute: number; // 0
}

export const RESTAURANT_INFO = {
  name: "SavoryBites",
  tagline: "Freshly made. Simply delicious.",
  locality: "Buenavista, Bohol",
  fullAddress: "Poblacion, Buenavista, Bohol, 6333 Philippines",
  phone: "+63 917 123 4567",
  email: "hello@savorybites.ph",
  timeZone: "Asia/Manila",
  timeZoneLabel: "Philippine Standard Time (PST, UTC+8)",

  // Operating Schedule
  schedule: [
    {
      day: "Sunday",
      shortDay: "Sun",
      dayIndex: 0,
      isOpen: true,
      openTime: "10:00 AM",
      closeTime: "9:00 PM",
      openHour24: 10,
      openMinute: 0,
      closeHour24: 21,
      closeMinute: 0,
    },
    {
      day: "Monday",
      shortDay: "Mon",
      dayIndex: 1,
      isOpen: true,
      openTime: "10:00 AM",
      closeTime: "9:00 PM",
      openHour24: 10,
      openMinute: 0,
      closeHour24: 21,
      closeMinute: 0,
    },
    {
      day: "Tuesday",
      shortDay: "Tue",
      dayIndex: 2,
      isOpen: true,
      openTime: "10:00 AM",
      closeTime: "9:00 PM",
      openHour24: 10,
      openMinute: 0,
      closeHour24: 21,
      closeMinute: 0,
    },
    {
      day: "Wednesday",
      shortDay: "Wed",
      dayIndex: 3,
      isOpen: true,
      openTime: "10:00 AM",
      closeTime: "9:00 PM",
      openHour24: 10,
      openMinute: 0,
      closeHour24: 21,
      closeMinute: 0,
    },
    {
      day: "Thursday",
      shortDay: "Thu",
      dayIndex: 4,
      isOpen: true,
      openTime: "10:00 AM",
      closeTime: "9:00 PM",
      openHour24: 10,
      openMinute: 0,
      closeHour24: 21,
      closeMinute: 0,
    },
    {
      day: "Friday",
      shortDay: "Fri",
      dayIndex: 5,
      isOpen: true,
      openTime: "10:00 AM",
      closeTime: "10:00 PM",
      openHour24: 10,
      openMinute: 0,
      closeHour24: 22,
      closeMinute: 0,
    },
    {
      day: "Saturday",
      shortDay: "Sat",
      dayIndex: 6,
      isOpen: true,
      openTime: "10:00 AM",
      closeTime: "10:00 PM",
      openHour24: 10,
      openMinute: 0,
      closeHour24: 22,
      closeMinute: 0,
    },
  ] as DayHours[],

  kitchenNotice: "Last food and beverage orders are accepted 30 minutes before closing time.",
  holidayNotice: "Hours may vary on official national and municipal holidays. Please call ahead to confirm special holiday schedules.",

  fulfillment: {
    dineIn: {
      type: "table_service",
      title: "Dine-In Table Service",
      description: "Find an available table in our dining room, select your table number in the online order flow, and your freshly cooked meal will be served right to you.",
    },
    takeout: {
      type: "counter_pickup",
      title: "Takeout Counter Pickup",
      description: "Place your order online ahead of time. Our kitchen prepares and packs your food fresh, ready for quick pickup at the front counter.",
    },
    deliveryNotice: "Please note that delivery service is currently not available. All orders are fulfilled through dine-in table service or takeout counter pickup.",
  },
};

/**
 * Calculates whether the restaurant is currently open according to Philippine Standard Time (UTC+8).
 * Avoids relying solely on the client machine's local time zone.
 */
export function getLiveOperatingStatus(targetDate = new Date()): {
  isOpen: boolean;
  statusText: string;
  todaySchedule: DayHours;
  currentTimeString: string;
} {
  // Convert targetDate into Asia/Manila components
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: RESTAURANT_INFO.timeZone,
    weekday: "long",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(targetDate);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const currentWeekday = partMap.weekday || "Monday";
  const currentHour = parseInt(partMap.hour || "0", 10);
  const currentMinute = parseInt(partMap.minute || "0", 10);
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  const todaySchedule =
    RESTAURANT_INFO.schedule.find(
      (s) => s.day.toLowerCase() === currentWeekday.toLowerCase()
    ) || RESTAURANT_INFO.schedule[1];

  const openTotalMinutes = todaySchedule.openHour24 * 60 + todaySchedule.openMinute;
  const closeTotalMinutes = todaySchedule.closeHour24 * 60 + todaySchedule.closeMinute;

  let isOpen = false;
  let statusText = "Closed";

  if (todaySchedule.isOpen) {
    if (currentTotalMinutes >= openTotalMinutes && currentTotalMinutes < closeTotalMinutes) {
      isOpen = true;
      const minutesToClose = closeTotalMinutes - currentTotalMinutes;
      if (minutesToClose <= 45) {
        statusText = `Closing soon at ${todaySchedule.closeTime}`;
      } else {
        statusText = `Open today until ${todaySchedule.closeTime}`;
      }
    } else if (currentTotalMinutes < openTotalMinutes) {
      statusText = `Closed now · Opens at ${todaySchedule.openTime}`;
    } else {
      statusText = `Closed for the night · Opens tomorrow at 10:00 AM`;
    }
  }

  const timeStringFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: RESTAURANT_INFO.timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return {
    isOpen,
    statusText,
    todaySchedule,
    currentTimeString: `${timeStringFormatter.format(targetDate)} PHT`,
  };
}
