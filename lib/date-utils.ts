export const formatLastSeenArabic = (dateString: string | null): string => {
  if (!dateString) return 'غير متصل';
  
  const date = new Date(dateString);
  const now = new Date();
  
  // Strip time for day comparison
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  
  const targetDateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  // Format time manually to ensure Arabic AM/PM (ص/م)
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'م' : 'ص';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const timeStr = `${hours}:${minutes} ${ampm}`;
  
  if (targetDateStart.getTime() === todayStart.getTime()) {
    return `آخر ظهور اليوم ${timeStr}`;
  } else if (targetDateStart.getTime() === yesterdayStart.getTime()) {
    return `آخر ظهور البارحة ${timeStr}`;
  } else {
    // Check if within the last 7 days
    const diffDays = Math.floor((todayStart.getTime() - targetDateStart.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 7) {
      const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      return `آخر ظهور ${days[date.getDay()]} ${timeStr}`;
    } else {
      // Full date
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      return `آخر ظهور ${year}/${month}/${day} ${timeStr}`;
    }
  }
};
