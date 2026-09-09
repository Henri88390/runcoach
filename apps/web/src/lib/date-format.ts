const MONTH_LABELS = [
  "Jan.",
  "Feb.",
  "Mar.",
  "Apr.",
  "May",
  "Jun.",
  "Jul.",
  "Aug.",
  "Sept.",
  "Oct.",
  "Nov.",
  "Dec.",
];

const parseDate = (date: string) => new Date(`${date}T00:00:00`);

export const formatEnglishDate = (date: string) => {
  const value = parseDate(date);
  return `${value.getDate()} ${MONTH_LABELS[value.getMonth()]} ${value.getFullYear()}`;
};

export const formatEnglishDateRange = (weekStart: string) => {
  const start = parseDate(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  if (
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear()
  ) {
    return `${start.getDate()}–${end.getDate()} ${MONTH_LABELS[start.getMonth()]} ${start.getFullYear()}`;
  }

  return `${formatEnglishDate(weekStart)}–${formatEnglishDate(
    end.toISOString().slice(0, 10),
  )}`;
};