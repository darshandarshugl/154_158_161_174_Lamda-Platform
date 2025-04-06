// backend/src/executors/docker.js
const { Docker } = require('dockerode');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const docker = new Docker();
const os = require('os');

// Base image names
const IMAGES = {
  javascript: 'node:16-alpine',
  python: 'python:3.9-alpine'
};

// Create temporary directory for function files
const TEMP_DIR = path.join(os.tmpdir(), 'lambda-functions');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Create function files based on language
 * @param {Object} functionObj - Function object with code and language
 * @returns {String} - Path to the directory containing function files
 */
const createFunctionFiles = (functionObj) => {
  const functionId = uuidv4();
  const functionDir = path.join(TEMP_DIR, functionId);
  fs.mkdirSync(functionDir, { recursive: true });

  if (functionObj.language === 'javascript') {
    // Create JavaScript function handler
    const jsCode = `
      const handler = async (event) => {
        try {
          // User's function code begins
          ${functionObj.code}
          // User's function code ends
          
          // Execute the function with the event
          return await main(event);
        } catch (error) {
          return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
          };
        }
      };
      
      process.on('message', async (event) => {
        try {
          const result = await handler(event);
          process.send({ type: 'result', data: result });
        } catch (error) {
          process.send({ type: 'error', error: error.message });
        }
      });
    `;
    fs.writeFileSync(path.join(functionDir, 'index.js'), jsCode);
    
    // Create package.json
    const packageJson = {
      name: `lambda-function-${functionId}`,
      version: '1.0.0',
      main: 'index.js',
      dependencies: {}
    };
    fs.writeFileSync(
      path.join(functionDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
    
    // Create execution wrapper script
    const executionScript = `
      const { fork } = require('child_process');
      const path = require('path');
      const fs = require('fs');
      
      // Read input from the arguments
      const event = JSON.parse(process.argv[2] || '{}');
      
      // Fork the function process
      const functionProcess = fork(path.join(__dirname, 'index.js'));
      
      // Set timeout
      const timeout = ${functionObj.timeout || 30000};
      const timeoutId = setTimeout(() => {
        functionProcess.kill();
        console.error(JSON.stringify({ 
          statusCode: 408, 
          body: { error: 'Function execution timed out' } 
        }));
        process.exit(1);
      }, timeout);
      
      // Send event to function
      functionProcess.send(event);
      
      // Handle function result
      functionProcess.on('message', (message) => {
        clearTimeout(timeoutId);
        if (message.type === 'error') {
          console.error(JSON.stringify({ 
            statusCode: 500, 
            body: { error: message.error } 
          }));
          process.exit(1);
        } else {
          console.log(JSON.stringify(message.data));
          process.exit(0);
        }
      });
      
      // Handle process errors
      functionProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        console.error(JSON.stringify({ 
          statusCode: 500, 
          body: { error: error.message } 
        }));
        process.exit(1);
      });
      
      // Handle process exit
      functionProcess.on('exit', (code) => {
        if (code !== 0) {
          clearTimeout(timeoutId);
          console.error(JSON.stringify({ 
            statusCode: 500, 
            body: { error: 'Function process exited with code ' + code } 
          }));
          process.exit(1);
        }
      });
    `;
    fs.writeFileSync(path.join(functionDir, 'execute.js'), executionScript);
    
  } else if (functionObj.language === 'python') {
    // Create Python function handler
    const pyCode = `
import json
import sys
import traceback

def handler(event):
    try:
        # User's function code begins
${functionObj.code.split('\n').map(line => '        ' + line).join('\n')}
        # User's function code ends
        
        # Execute the function with the event
        return main(event)
    except Exception as e:
        traceback.print_exc()
        return {
            'statusCode': 500,
            'body': {'error': str(e)}
        }

if __name__ == '__main__':
    try:
        # Read input from command line argument
        event = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        
        # Execute handler
        result = handler(event)
        
        # Print result as JSON
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({
            'statusCode': 500,
            'body': {'error': str(e)}
        }))
        sys.exit(1)
    `;
    fs.writeFileSync(path.join(functionDir, 'function.py'), pyCode);
    
    // Create execution wrapper script
    const executionScript = `
import json
import sys
import subprocess
import time
import signal
import os

# Timeout handler
def timeout_handler(signum, frame):
    print(json.dumps({
        'statusCode': 408,
        'body': {'error': 'Function execution timed out'}
    }))
    sys.exit(1)

try:
    # Read input from command line argument
    event = sys.argv[1] if len(sys.argv) > 1 else '{}'
    
    # Set timeout
    timeout = ${functionObj.timeout || 30000} / 1000  # Convert to seconds
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(int(timeout))
    
    # Execute the function
    process = subprocess.Popen(
        ['python', 'function.py', event],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    
    stdout, stderr = process.communicate()
    
    # Cancel the alarm
    signal.alarm(0)
    
    if process.returncode != 0:
        print(json.dumps({
            'statusCode': 500,
            'body': {'error': stderr.decode('utf-8')}
        }))
        sys.exit(1)
    
    # Print function output
    print(stdout.decode('utf-8').strip())
    
except Exception as e:
    print(json.dumps({
        'statusCode': 500,
        'body': {'error': str(e)}
    }))
    sys.exit(1)
    `;
    fs.writeFileSync(path.join(functionDir, 'execute.py'), executionScript);
  }

  return functionDir;
};

/**
 * Execute a function in a Docker container
 * @param {Object} functionObj - Function object with code and language
 * @param {Object} event - Event data to pass to the function
 * @returns {Promise<Object>} - Function execution result
 */
const executeFunction = async (functionObj, event = {}) => {
  const functionDir = createFunctionFiles(functionObj);
  const functionId = path.basename(functionDir);
  
  try {
    const baseImage = IMAGES[functionObj.language];
    if (!baseImage) {
      throw new Error(`Unsupported language: ${functionObj.language}`);
    }
    
    // Create container
    const container = await docker.createContainer({
      Image: baseImage,
      Cmd: functionObj.language === 'javascript' 
        ? ['node', 'execute.js', JSON.stringify(event)]
        : ['python', 'execute.py', JSON.stringify(event)],
      WorkingDir: '/app',
      HostConfig: {
        Memory: (functionObj.memory || 128) * 1024 * 1024, // Convert MB to bytes
        MemorySwap: (functionObj.memory || 128) * 1024 * 1024, // Disable swap
        CpuPeriod: 100000,
        CpuQuota: 100000, // Limit to 1 CPU
        Binds: [`${functionDir}:/app`]
      }
    });
    
    // Start container
    await container.start();
    
    // Wait for container to finish
    const data = await container.wait();
    
    // Get logs
    const logs = await container.logs({
      stdout: true,
      stderr: true
    });
    
    // Convert Buffer to string and parse logs
    const output = logs.toString();
    
    // Clean up
    await container.remove();
    
    if (data.StatusCode !== 0) {
      // Extract error message from logs if possible
      try {
        const errorJson = JSON.parse(output);
        return errorJson;
      } catch (e) {
        return {
          statusCode: 500,
          body: { error: output || 'Unknown error occurred' }
        };
      }
    }
    
    // Parse the output as JSON if possible
    try {
      return JSON.parse(output);
    } catch (e) {
      return {
        statusCode: 200,
        body: output
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      body: { error: error.message }
    };
  } finally {
    // Clean up function directory
    try {
      fs.rmSync(functionDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Failed to clean up function directory:', e);
    }
  }
};

module.exports = {
  executeFunction
};