// backend/src/executors/container-pool.js
const { Docker } = require('dockerode');
const docker = new Docker();
const EventEmitter = require('events');

// Base image names
const IMAGES = {
  javascript: 'node:16-alpine',
  python: 'python:3.9-alpine'
};

class ContainerPool extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxSize = options.maxSize || 10;
    this.minSize = options.minSize || 2;
    this.idleTimeout = options.idleTimeout || 300000; // 5 minutes
    this.pools = {};
    this.initialize();
  }

  // Initialize the container pool
  initialize() {
    Object.keys(IMAGES).forEach(language => {
      this.pools[language] = {
        idle: [],
        busy: {},
        initialization: Promise.resolve()
      };
    });
  }

  // Get pool key based on function properties
  getPoolKey(functionObj) {
    return `${functionObj.language}-${functionObj.memory || 128}`;
  }

  // Create a new container for a function
  async createContainer(functionObj) {
    const language = functionObj.language;
    const memory = functionObj.memory || 128;
    const image = IMAGES[language];
    
    if (!image) {
      throw new Error(`Unsupported language: ${language}`);
    }

    // Create a base container that can be reused
    const container = await docker.createContainer({
      Image: image,
      Cmd: ['sleep', 'infinity'], // Keep container running
      WorkingDir: '/app',
      Tty: true,
      HostConfig: {
        Memory: memory * 1024 * 1024, // Convert MB to bytes
        MemorySwap: memory * 1024 * 1024, // Disable swap
        CpuPeriod: 100000,
        CpuQuota: 100000 // Limit to 1 CPU
      }
    });

    await container.start();
    
    // Store container metadata
    const containerData = {
      id: container.id,
      container,
      language,
      memory,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };

    return containerData;
  }

  // Get an idle container or create a new one
  async getContainer(functionObj) {
    const key = this.getPoolKey(functionObj);
    const pool = this.pools[functionObj.language];
    
    if (!pool) {
      throw new Error(`Unsupported language: ${functionObj.language}`);
    }
    
    // Check if there's an idle container available
    if (pool.idle.length > 0) {
      const containerData = pool.idle.pop();
      pool.busy[containerData.id] = containerData;
      containerData.lastUsed = Date.now();
      return containerData;
    }
    
    // Create a new container if the pool is not full
    if (Object.keys(pool.busy).length < this.maxSize) {
      const containerData = await this.createContainer(functionObj);
      pool.busy[containerData.id] = containerData;
      return containerData;
    }
    
    // If the pool is full, wait for a container to become available
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('container-released', onContainerReleased);
        reject(new Error('Timeout waiting for available container'));
      }, 30000);
      
      const onContainerReleased = (releasedContainerData) => {
        if (releasedContainerData.language === functionObj.language) {
          clearTimeout(timeout);
          this.removeListener('container-released', onContainerReleased);
          pool.busy[releasedContainerData.id] = releasedContainerData;
          releasedContainerData.lastUsed = Date.now();
          resolve(releasedContainerData);
        }
      };
      
      this.once('container-released', onContainerReleased);
    });
  }

  // Release a container back to the pool
  releaseContainer(containerData) {
    const pool = this.pools[containerData.language];
    
    if (!pool) {
      return;
    }
    
    // Remove from busy pool
    delete pool.busy[containerData.id];
    
    // Update last used time
    containerData.lastUsed = Date.now();
    
    // Add to idle pool if below max size, otherwise destroy
    if (pool.idle.length < this.minSize) {
      pool.idle.push(containerData);
      this.emit('container-released', containerData);
    } else {
      this.destroyContainer(containerData);
    }
  }

  // Destroy a container
  async destroyContainer(containerData) {
    try {
      await containerData.container.stop();
      await containerData.container.remove();
    } catch (error) {
      console.error('Error destroying container:', error);
    }
  }

  // Clean up idle containers periodically
  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      
      Object.keys(this.pools).forEach(language => {
        const pool = this.pools[language];
        
        // Filter out containers that have been idle for too long
        const idleTimeout = now - this.idleTimeout;
        const containersToKeep = [];
        
        pool.idle.forEach(containerData => {
          if (containerData.lastUsed > idleTimeout) {
            containersToKeep.push(containerData);
          } else {
            this.destroyContainer(containerData);
          }
        });
        
        pool.idle = containersToKeep;
      });
    }, 60000); // Clean up every minute
  }

  // Warm up containers for a function
  async warmupFunction(functionObj, count = 1) {
    const containers = [];
    
    for (let i = 0; i < count; i++) {
      try {
        const containerData = await this.createContainer(functionObj);
        const pool = this.pools[functionObj.language];
        pool.idle.push(containerData);
        containers.push(containerData);
      } catch (error) {
        console.error('Error warming up container:', error);
      }
    }
    
    return containers;
  }
}

// Singleton instance
const containerPool = new ContainerPool();
containerPool.startCleanup();

module.exports = containerPool;