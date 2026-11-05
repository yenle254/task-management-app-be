const audit = require('../services/audit.service');
const listAuditLogs = async (req, res) => {
  try { res.json(await audit.list(req.query)); }
  catch (error) { res.status(500).json({ success: false, error: 'Unable to load audit logs' }); }
};
const getTargetAuditLogs = async (req, res) => {
  try {
    const { from, to, page, limit } = req.query;
    res.json(await audit.list({ from, to, page, limit }, req.params));
  } catch (error) { res.status(500).json({ success: false, error: 'Unable to load audit history' }); }
};
const getAuditLogById = async (req, res) => {
  try {
    const data = await audit.getById(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: 'Audit log not found' });
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, error: 'Unable to load audit log' }); }
};
module.exports = { listAuditLogs, getTargetAuditLogs, getAuditLogById };
