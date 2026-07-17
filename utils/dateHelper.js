const dateHelper = {
    /**
     * Get start of day
     * @param {Date} date - Date object
     * @returns {Date} Start of day (00:00:00)
     */
    startOfDay: (date = new Date()) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    },
  
    /**
     * Get end of day
     * @param {Date} date - Date object
     * @returns {Date} End of day (23:59:59)
     */
    endOfDay: (date = new Date()) => {
      const d = new Date(date);
      d.setHours(23, 59, 59, 999);
      return d;
    },
  
    /**
     * Check if date is today
     * @param {Date} date - Date to check
     * @returns {Boolean}
     */
    isToday: (date) => {
      const today = dateHelper.startOfDay();
      const checkDate = dateHelper.startOfDay(date);
      return today.getTime() === checkDate.getTime();
    },
  
    /**
     * Check if date is overdue
     * @param {Date} dueDate - Due date
     * @returns {Boolean}
     */
    isOverdue: (dueDate) => {
      return new Date(dueDate) < dateHelper.startOfDay();
    },
  
    /**
     * Get days until deadline
     * @param {Date} dueDate - Due date
     * @returns {Number} Days remaining (negative if overdue)
     */
    daysUntil: (dueDate) => {
      const today = dateHelper.startOfDay();
      const due = dateHelper.startOfDay(dueDate);
      const diffTime = due - today;
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    },
  
    /**
     * Format date to readable string
     * @param {Date} date - Date to format
     * @param {String} format - Format template (e.g., 'DD/MM/YYYY')
     * @returns {String} Formatted date
     */
    format: (date, format = 'DD/MM/YYYY') => {
      const d = new Date(date);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
  
      return format
        .replace('DD', day)
        .replace('MM', month)
        .replace('YYYY', year)
        .replace('HH', hours)
        .replace('mm', minutes);
    }
  };
  
  module.exports = dateHelper;