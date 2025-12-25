const express = require('express');
const router = express.Router();

// POST /api/bug-reports - Create a new bug report
router.post('/', async (req, res) => {
  const db = req.app.locals.db;
  const { url, consoleLogs, networkErrors, userNote, screenshot, projectId, timestamp } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO bug_reports (url, console_logs, network_errors, user_note, screenshot, project_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        url,
        JSON.stringify(consoleLogs || []),
        JSON.stringify(networkErrors || []),
        userNote || null,
        screenshot || null,
        projectId || 'default',
        timestamp || new Date().toISOString()
      ]
    );

    res.status(201).json({
      id: result.rows[0].id,
      createdAt: result.rows[0].created_at
    });
  } catch (error) {
    console.error('Error creating bug report:', error);
    res.status(500).json({ error: 'Failed to create bug report' });
  }
});

// GET /api/bug-reports - List bug reports
router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  const { limit = 10, projectId, since } = req.query;

  try {
    let query = 'SELECT id, url, console_logs, network_errors, user_note, project_id, created_at FROM bug_reports';
    const params = [];
    const conditions = [];

    if (projectId) {
      params.push(projectId);
      conditions.push(`project_id = $${params.length}`);
    }

    if (since) {
      params.push(since);
      conditions.push(`created_at >= $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    params.push(parseInt(limit, 10));
    query += ` LIMIT $${params.length}`;

    const result = await db.query(query, params);

    res.json(result.rows.map(row => ({
      id: row.id,
      url: row.url,
      consoleLogs: row.console_logs,
      networkErrors: row.network_errors,
      userNote: row.user_note,
      projectId: row.project_id,
      createdAt: row.created_at
    })));
  } catch (error) {
    console.error('Error fetching bug reports:', error);
    res.status(500).json({ error: 'Failed to fetch bug reports' });
  }
});

// GET /api/bug-reports/:id - Get a single bug report
router.get('/:id', async (req, res) => {
  const db = req.app.locals.db;
  const { id } = req.params;

  try {
    const result = await db.query(
      'SELECT * FROM bug_reports WHERE id = $1',
      [parseInt(id, 10)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bug report not found' });
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      url: row.url,
      consoleLogs: row.console_logs,
      networkErrors: row.network_errors,
      userNote: row.user_note,
      screenshot: row.screenshot,
      projectId: row.project_id,
      createdAt: row.created_at
    });
  } catch (error) {
    console.error('Error fetching bug report:', error);
    res.status(500).json({ error: 'Failed to fetch bug report' });
  }
});

// DELETE /api/bug-reports/:id - Delete a bug report
router.delete('/:id', async (req, res) => {
  const db = req.app.locals.db;
  const { id } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM bug_reports WHERE id = $1 RETURNING id',
      [parseInt(id, 10)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bug report not found' });
    }

    res.json({ success: true, deletedId: result.rows[0].id });
  } catch (error) {
    console.error('Error deleting bug report:', error);
    res.status(500).json({ error: 'Failed to delete bug report' });
  }
});

// DELETE /api/bug-reports - Clear old bug reports
router.delete('/', async (req, res) => {
  const db = req.app.locals.db;
  const { olderThanHours = 24 } = req.query;

  try {
    const cutoffDate = new Date(Date.now() - parseInt(olderThanHours, 10) * 60 * 60 * 1000);

    const result = await db.query(
      'DELETE FROM bug_reports WHERE created_at < $1 RETURNING id',
      [cutoffDate.toISOString()]
    );

    res.json({
      success: true,
      deletedCount: result.rows.length
    });
  } catch (error) {
    console.error('Error clearing bug reports:', error);
    res.status(500).json({ error: 'Failed to clear bug reports' });
  }
});

module.exports = router;
