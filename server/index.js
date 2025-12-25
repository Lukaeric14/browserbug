const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bugReportsRouter = require('./routes/bugReports');

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Make pool available to routes
app.locals.db = pool;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow larger payloads for screenshots

// API Key authentication middleware
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.BUG_REPORTS_API_KEY;

  if (!validApiKey) {
    console.warn('WARNING: BUG_REPORTS_API_KEY not set, authentication disabled');
    return next();
  }

  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
};

// Routes
app.use('/api/bug-reports', authenticateApiKey, bugReportsRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database and start server
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bug_reports (
        id SERIAL PRIMARY KEY,
        url TEXT NOT NULL,
        console_logs JSONB NOT NULL DEFAULT '[]',
        network_errors JSONB NOT NULL DEFAULT '[]',
        user_note TEXT,
        screenshot TEXT,
        project_id TEXT DEFAULT 'default',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bug_reports_created_at ON bug_reports(created_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bug_reports_project_id ON bug_reports(project_id)
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    // Don't exit - table might already exist with different structure
  }
}

initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Bug Reports API server running on port ${port}`);
  });
});
