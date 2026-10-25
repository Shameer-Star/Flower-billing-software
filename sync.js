// Real-Time Multi-Device Data Synchronization Engine
const crypto = require('crypto');
const db = require('./db');

// Set of active SSE response streams
const sseClients = new Set();
let heartbeatInterval = null;

function initHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    for (const res of sseClients) {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch (err) {
        sseClients.delete(res);
      }
    }
  }, 25000);
  if (heartbeatInterval.unref) heartbeatInterval.unref();
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Broadcast event to all connected devices and log to sync_events table
function broadcastSyncEvent(eventType, entityType, entityId, payload = {}, clientId = null) {
  const eventId = `EVT-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

  try {
    db.run(`
      INSERT INTO sync_events (event_id, event_type, entity_type, entity_id, payload, client_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [eventId, eventType, entityType, String(entityId), payloadStr, clientId, now]);
  } catch (err) {
    console.warn('[Sync] Could not save event to database:', err.message);
  }

  const sseData = JSON.stringify({
    event_id: eventId,
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId,
    payload,
    timestamp: now
  });

  const message = `id: ${eventId}\nevent: ${eventType}\ndata: ${sseData}\n\n`;

  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (err) {
      sseClients.delete(client);
    }
  }

  return eventId;
}

// Server-Sent Events HTTP Handler
function handleSyncEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const clientId = `CLI-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  sseClients.add(res);
  initHeartbeat();

  // Send initial handshake
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, status: 'connected', time: new Date().toISOString() })}\n\n`);

  // If client provided last-event-id or since_id query param, replay recent events
  const sinceId = req.query.since_id || req.headers['last-event-id'];
  if (sinceId) {
    try {
      const recent = db.query(`
        SELECT * FROM sync_events
        WHERE id > (SELECT COALESCE(MAX(id), 0) FROM sync_events WHERE event_id = ?)
        ORDER BY id ASC LIMIT 50
      `, [sinceId]);
      for (const ev of recent) {
        let parsed = ev.payload;
        try { parsed = JSON.parse(ev.payload); } catch (e) {}
        res.write(`id: ${ev.event_id}\nevent: ${ev.event_type}\ndata: ${JSON.stringify({
          event_id: ev.event_id,
          event_type: ev.event_type,
          entity_type: ev.entity_type,
          entity_id: ev.entity_id,
          payload: parsed,
          timestamp: ev.created_at
        })}\n\n`);
      }
    } catch (e) {}
  }

  req.on('close', () => {
    sseClients.delete(res);
  });
}

// Polling fallback endpoint for clients where SSE is disconnected
function handleSyncPoll(req, res) {
  const sinceId = parseInt(req.query.since_id || '0', 10);
  try {
    const events = db.query(`
      SELECT * FROM sync_events
      WHERE id > ?
      ORDER BY id ASC LIMIT 50
    `, [sinceId]);

    const formatted = events.map(ev => {
      let payload = ev.payload;
      try { payload = JSON.parse(ev.payload); } catch (e) {}
      return {
        id: ev.id,
        event_id: ev.event_id,
        event_type: ev.event_type,
        entity_type: ev.entity_type,
        entity_id: ev.entity_id,
        payload,
        created_at: ev.created_at
      };
    });

    res.json({
      success: true,
      last_id: formatted.length > 0 ? formatted[formatted.length - 1].id : sinceId,
      events: formatted
    });
  } catch (err) {
    res.status(500).json({ error: 'Sync polling failed', details: err.message });
  }
}

function getActiveClientCount() {
  return sseClients.size;
}

module.exports = {
  broadcastSyncEvent,
  handleSyncEvents,
  handleSyncPoll,
  getActiveClientCount
};
