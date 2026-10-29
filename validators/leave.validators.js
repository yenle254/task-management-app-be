const { body, param, query } = require('express-validator');
const statuses = ['pending', 'draft', 'pending_team_lead', 'pending_hr', 'approved', 'rejected', 'cancelled'];
const revision = () => body('revision').optional().isInt({ min: 0 }).withMessage('Invalid revision').toInt();
const reason = key => body(key).optional().isString().bail().trim().isLength({ max: 500 });
const id = () => param('id').isMongoId().withMessage('Invalid leave ID');
const fields = optional => [
    optional ? body('type').optional().isIn(['sick', 'vacation', 'personal']) : body('type').isIn(['sick', 'vacation', 'personal']),
    optional ? body('startDate').optional().isISO8601() : body('startDate').isISO8601(),
    optional ? body('endDate').optional().isISO8601() : body('endDate').isISO8601(),
    reason('reason')
];
const submitLeaveValidation = [...fields(false), body('draft').optional().isBoolean({ strict: true }),
    body('idempotencyKey').optional().isString().bail().isLength({ min: 8, max: 100 }).matches(/^[a-zA-Z0-9_-]+$/)];
const editLeaveValidation = [id(), revision(), ...fields(true)];
const getLeavesValidation = [query('status').optional().isIn(statuses), query('type').optional().isIn(['sick', 'vacation', 'personal']),
    query('year').optional().isInt({ min: 2000, max: 2100 }), query('page').optional().isInt({ min: 1 }), query('limit').optional().isInt({ min: 1, max: 100 })];
const pendingLeavesValidation = [query('step').optional().isIn(['team_lead', 'hr'])];
const getLeaveByIdValidation = [id()];
const processLeaveValidation = [id(), revision(), reason('reason'), reason('rejectionReason')];
const getLeaveBalanceValidation = [query('year').optional().isInt({ min: 2000, max: 2100 })];
const getTeamLeavesValidation = [param('teamId').isMongoId(), ...getLeavesValidation, query('month').optional().isInt({ min: 1, max: 12 })];
const cancelLeaveValidation = [id(), revision()];
module.exports = { submitLeaveValidation, editLeaveValidation, pendingLeavesValidation, getLeavesValidation, getLeaveByIdValidation,
    processLeaveValidation, getLeaveBalanceValidation, getTeamLeavesValidation, cancelLeaveValidation };
