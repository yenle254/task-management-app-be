const { query, param, body } = require('express-validator');
const { AUDIT_ACTIONS, PAGINATION } = require('../utils/constants.utils');
const targetTypes = ['user', 'team', 'task', 'leave', 'attendance', 'office'];
const pagination = () => [
  query('page').optional().isInt({ min: 1, max: 1000000 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: PAGINATION.MAX_LIMIT }).toInt(),
  query('from').optional().isISO8601({ strict: true }).withMessage('from must be ISO date/time'),
  query('to').optional().isISO8601({ strict: true }).withMessage('to must be ISO date/time'),
  query().custom(value => {
    if (!!value.from !== !!value.to) throw new Error('from and to must be provided together');
    if (value.from && !(new Date(value.from) < new Date(value.to))) throw new Error('from must be before exclusive to');
    return true;
  })
];
const listAuditLogsValidation = [
  ...pagination(), query('action').optional().isIn(Object.keys(AUDIT_ACTIONS)),
  query('category').optional().isIn(['auth', 'user', 'admin', 'team', 'task', 'leave', 'attendance', 'office', 'security', 'system']),
  query('outcome').optional().isIn(['success', 'failure', 'denied']),
  query('severity').optional().isIn(['info', 'warning', 'critical']),
  query('actorId').optional().isMongoId(), query('targetId').optional().isMongoId(),
  query('targetType').optional().isIn([...targetTypes, 'auth-session'])
];
const auditLogIdValidation = [param('id').isMongoId()];
const targetAuditLogsValidation = [...pagination(), param('type').isIn(targetTypes), ...auditLogIdValidation];
// Audit-only input; trim and truncate instead of rejecting an otherwise valid write.
const auditReasonValidation = [body('reason').optional({ nullable: true }).isString().bail().trim().customSanitizer(value => value.slice(0, 500))];
module.exports = { listAuditLogsValidation, targetAuditLogsValidation, auditLogIdValidation, auditReasonValidation };
