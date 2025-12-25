const API_URL = process.env.BUG_REPORTS_API_URL;
const API_KEY = process.env.BUG_REPORTS_API_KEY;

if (!API_URL) {
  console.error('Warning: BUG_REPORTS_API_URL environment variable not set');
}

async function apiRequest(path, options = {}) {
  if (!API_URL) {
    throw new Error('BUG_REPORTS_API_URL environment variable not set');
  }

  const url = `${API_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
  };

  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

export async function fetchBugReports({ limit = 5, projectId, since } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));

  if (projectId) {
    params.set('projectId', projectId);
  }

  if (since) {
    params.set('since', since);
  }

  return apiRequest(`/api/bug-reports?${params.toString()}`);
}

export async function fetchBugReport(id) {
  try {
    return await apiRequest(`/api/bug-reports/${id}`);
  } catch (error) {
    if (error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

export async function clearBugReports(olderThanHours = 24) {
  return apiRequest(`/api/bug-reports?olderThanHours=${olderThanHours}`, {
    method: 'DELETE',
  });
}
