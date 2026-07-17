const validators = {
    /**
     * Validate email
     * @param {String} email - Email to validate
     * @returns {Boolean}
     */
    isValidEmail: (email) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    },
  
    /**
     * Validate MongoDB ObjectId
     * @param {String} id - ID to validate
     * @returns {Boolean}
     */
    isValidObjectId: (id) => {
      return /^[0-9a-fA-F]{24}$/.test(id);
    },
  
    /**
     * Validate array of ObjectIds
     * @param {Array} ids - Array of IDs
     * @returns {Boolean}
     */
    isValidObjectIdArray: (ids) => {
      if (!Array.isArray(ids)) return false;
      return ids.every(id => validators.isValidObjectId(id));
    },
  
    /**
     * Validate task title
     * @param {String} title - Title to validate
     * @returns {Boolean}
     */
    isValidTaskTitle: (title) => {
      return title && title.trim().length >= 3 && title.trim().length <= 255;
    },
  
    /**
     * Validate date range
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Boolean}
     */
    isValidDateRange: (startDate, endDate) => {
      const start = new Date(startDate);
      const end = new Date(endDate);
      return start <= end;
    },
  
    /**
     * Validate priority value
     * @param {String} priority - Priority value
     * @returns {Boolean}
     */
    isValidPriority: (priority) => {
      return ['low', 'medium', 'high'].includes(priority);
    },
  
    /**
     * Validate task status
     * @param {String} status - Status value
     * @returns {Boolean}
     */
    isValidTaskStatus: (status) => {
      return ['todo', 'in_progress', 'done', 'deleted'].includes(status);
    },
  
    /**
     * Validate progress value
     * @param {Number} progress - Progress percentage
     * @returns {Boolean}
     */
    isValidProgress: (progress) => {
      return typeof progress === 'number' && progress >= 0 && progress <= 100;
    }
  };
  
  module.exports = validators;