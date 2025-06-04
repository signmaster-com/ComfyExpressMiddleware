const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

/**
 * Represents a pooled WebSocket connection for ComfyUI
 */
class PooledConnection extends EventEmitter {
  constructor(host, useSSL = false) {
    super();
    this.id = uuidv4();
    this.host = host;
    this.useSSL = useSSL;
    this.ws = null;
    this.isConnected = false;
    this.isAvailable = true;
    this.createdAt = Date.now();
    this.lastUsed = Date.now();
    this.useCount = 0;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1 second
    this.maxReconnectDelay = 30000; // Max 30 seconds
    
    this.connect();
  }

  get wsUrl() {
    const protocol = this.useSSL ? 'wss' : 'ws';
    return `${protocol}://${this.host}/ws?clientId=${this.id}`;
  }

  connect() {
    try {
      console.log(`🔌 Connecting pooled WebSocket ${this.id} to ${this.host}`);
      
      this.ws = new WebSocket(this.wsUrl);
      
      this.ws.on('open', () => {
        console.log(`✅ Pooled WebSocket ${this.id} connected to ${this.host}`);
        this.isConnected = true;
        this.isAvailable = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.emit('connected');
      });

      this.ws.on('close', (code, reason) => {
        console.log(`❌ Pooled WebSocket ${this.id} closed (${code}): ${reason}`);
        this.isConnected = false;
        this.isAvailable = false;
        this.emit('disconnected', code, reason);
        
        // Auto-reconnect if not intentionally closed
        if (code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (error) => {
        console.error(`💥 Pooled WebSocket ${this.id} error:`, error.message);
        this.isConnected = false;
        this.isAvailable = false;
        this.emit('error', error);
      });

      // Ping/pong for connection health
      this.ws.on('pong', () => {
        this.emit('pong');
      });

    } catch (error) {
      console.error(`Failed to create WebSocket connection to ${this.host}:`, error.message);
      this.emit('error', error);
    }
  }

  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
    
    console.log(`🔄 Scheduling reconnect for ${this.id} in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      if (!this.isConnected && this.reconnectAttempts <= this.maxReconnectAttempts) {
        this.connect();
      }
    }, delay);
  }

  acquire() {
    if (!this.isConnected || !this.isAvailable) {
      return false;
    }
    
    this.isAvailable = false;
    this.lastUsed = Date.now();
    this.useCount++;
    console.log(`🎯 Acquired connection ${this.id} (uses: ${this.useCount})`);
    return true;
  }

  release() {
    this.isAvailable = true;
    this.lastUsed = Date.now();
    console.log(`🔓 Released connection ${this.id}`);
    this.emit('released');
  }

  close() {
    console.log(`🔌 Closing pooled connection ${this.id}`);
    this.isConnected = false;
    this.isAvailable = false;
    if (this.ws) {
      this.ws.close(1000, 'Pool shutdown');
    }
  }

  ping() {
    if (this.ws && this.isConnected) {
      this.ws.ping();
    }
  }

  // Send message through this connection
  send(data) {
    if (!this.ws || !this.isConnected) {
      throw new Error(`Connection ${this.id} is not ready`);
    }
    return this.ws.send(data);
  }

  // Set up message listener with cleanup validation
  onMessage(callback) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.on('message', callback);
    }
  }

  // Remove message listener with leak prevention
  offMessage(callback) {
    if (this.ws && this.ws.listenerCount && this.ws.listenerCount('message') > 0) {
      this.ws.off('message', callback);
    }
  }
}

/**
 * Connection pool for a specific ComfyUI host
 */
class ConnectionPool extends EventEmitter {
  constructor(host, maxConnections = 3, useSSL = false) {
    super();
    this.host = host;
    this.maxConnections = maxConnections;
    this.useSSL = useSSL;
    this.connections = new Map();
    this.waitingQueue = [];
    this.healthCheckInterval = null;
    
    this.startHealthCheck();
  }

  async getConnection() {
    // Try to find an available connection
    for (const [id, conn] of this.connections) {
      if (conn.isConnected && conn.isAvailable && conn.acquire()) {
        return conn;
      }
    }

    // Create new connection if under limit
    if (this.connections.size < this.maxConnections) {
      const conn = await this.createConnection();
      if (conn && conn.acquire()) {
        return conn;
      }
    }

    // Queue the request if pool is exhausted
    console.log(`⏳ Connection pool for ${this.host} exhausted, queuing request`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitingQueue.findIndex(item => item.resolve === resolve);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
        }
        reject(new Error(`Connection pool timeout for ${this.host}`));
      }, 30000); // 30 second timeout

      this.waitingQueue.push({ resolve, reject, timeout });
    });
  }

  async createConnection() {
    const conn = new PooledConnection(this.host, this.useSSL);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout for ${this.host}`));
      }, 10000); // 10 second connection timeout

      conn.once('connected', () => {
        clearTimeout(timeout);
        this.connections.set(conn.id, conn);
        this.setupConnectionEvents(conn);
        console.log(`🎉 New connection ${conn.id} added to pool for ${this.host} (${this.connections.size}/${this.maxConnections})`);
        resolve(conn);
      });

      conn.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  setupConnectionEvents(conn) {
    conn.on('released', () => {
      this.processWaitingQueue();
    });

    conn.on('disconnected', () => {
      this.connections.delete(conn.id);
      console.log(`🗑️  Removed disconnected connection ${conn.id} from pool for ${this.host}`);
    });

    conn.on('error', (error) => {
      console.error(`Connection ${conn.id} error:`, error.message);
      this.connections.delete(conn.id);
    });
  }

  processWaitingQueue() {
    if (this.waitingQueue.length === 0) return;

    // Process queue more safely with retry limit
    let processedCount = 0;
    const maxRetries = this.waitingQueue.length;

    while (this.waitingQueue.length > 0 && processedCount < maxRetries) {
      const waiting = this.waitingQueue.shift();
      let connectionFound = false;

      for (const [id, conn] of this.connections) {
        if (conn.isConnected && conn.isAvailable) {
          if (conn.acquire()) {
            clearTimeout(waiting.timeout);
            waiting.resolve(conn);
            connectionFound = true;
            break;
          }
        }
      }

      if (!connectionFound) {
        // Put back in queue but increment processed count to prevent infinite loop
        this.waitingQueue.push(waiting);
        processedCount++;
      } else {
        break; // Successfully processed one, exit
      }
    }
  }

  startHealthCheck() {
    this.healthCheckInterval = setInterval(() => {
      console.log(`🏥 Health check for pool ${this.host}: ${this.connections.size} connections`);
      
      for (const [id, conn] of this.connections) {
        if (conn.isConnected) {
          conn.ping();
        }
      }
      
      // Log pool status
      const available = Array.from(this.connections.values()).filter(c => c.isAvailable).length;
      const connected = Array.from(this.connections.values()).filter(c => c.isConnected).length;
      console.log(`📊 Pool ${this.host} status: ${connected} connected, ${available} available, ${this.waitingQueue.length} queued`);
      
    }, 30000); // Health check every 30 seconds
  }

  getStats() {
    const connections = Array.from(this.connections.values());
    return {
      host: this.host,
      total: connections.length,
      connected: connections.filter(c => c.isConnected).length,
      available: connections.filter(c => c.isAvailable).length,
      queued: this.waitingQueue.length,
      totalUses: connections.reduce((sum, c) => sum + c.useCount, 0)
    };
  }

  close() {
    console.log(`🔌 Closing connection pool for ${this.host}`);
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Clear waiting queue
    this.waitingQueue.forEach(waiting => {
      clearTimeout(waiting.timeout);
      waiting.reject(new Error('Pool closed'));
    });
    this.waitingQueue = [];

    // Close all connections
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
  }
}

/**
 * Global connection manager for all ComfyUI instances
 */
class ComfyUIConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.pools = new Map();
    
    // Validate and set configuration
    const maxConnections = parseInt(process.env.MAX_CONNECTIONS_PER_INSTANCE) || 3;
    if (maxConnections < 1 || maxConnections > 10) {
      throw new Error(`Invalid MAX_CONNECTIONS_PER_INSTANCE: ${maxConnections}. Must be between 1 and 10.`);
    }
    this.maxConnectionsPerInstance = maxConnections;
    this.useSSL = process.env.COMFYUI_USE_SSL === 'true';
    
    console.log(`🏗️  ComfyUI Connection Manager initialized (max ${this.maxConnectionsPerInstance} connections per instance)`);
    
    // Graceful shutdown handling
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  getPool(host) {
    if (!this.pools.has(host)) {
      console.log(`🏊 Creating new connection pool for ${host}`);
      const pool = new ConnectionPool(host, this.maxConnectionsPerInstance, this.useSSL);
      this.pools.set(host, pool);
    }
    return this.pools.get(host);
  }

  async getConnection(host) {
    const pool = this.getPool(host);
    return await pool.getConnection();
  }

  releaseConnection(connection) {
    if (connection && typeof connection.release === 'function') {
      connection.release();
    }
  }

  getAllStats() {
    const stats = {};
    for (const [host, pool] of this.pools) {
      stats[host] = pool.getStats();
    }
    return stats;
  }

  logStatus() {
    const stats = this.getAllStats();
    console.log('🌐 Connection Manager Status:');
    for (const [host, stat] of Object.entries(stats)) {
      console.log(`   ${host}: ${stat.connected}/${stat.total} connected, ${stat.available} available, ${stat.queued} queued, ${stat.totalUses} total uses`);
    }
  }

  shutdown() {
    console.log('🛑 Shutting down ComfyUI Connection Manager...');
    for (const pool of this.pools.values()) {
      pool.close();
    }
    this.pools.clear();
    console.log('✅ Connection Manager shutdown complete');
  }
}

// Singleton instance
let connectionManager = null;

function getConnectionManager() {
  if (!connectionManager) {
    connectionManager = new ComfyUIConnectionManager();
  }
  return connectionManager;
}

module.exports = {
  ComfyUIConnectionManager,
  ConnectionPool,
  PooledConnection,
  getConnectionManager
};