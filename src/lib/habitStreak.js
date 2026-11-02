function validDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function habitStreak(log = {}, today = new Date().toISOString().slice(0, 10)) {
  if (!validDateKey(today) || !log || typeof log !== "object") return 0;

  const cursor = new Date(`${today}T00:00:00Z`);
  if (!log[today]) cursor.setUTCDate(cursor.getUTCDate() - 1);

  let streak = 0;
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!log[key]) return streak;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
}
